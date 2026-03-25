if (!window.__THE_SPACE_CONTENT_SCRIPT_READY__) {
  window.__THE_SPACE_CONTENT_SCRIPT_READY__ = true;

  let activePicker = null;
  let activeCleanup = null;
  let lastSelectionRect = null;
  let popupTemplatePromise = null;

  document.addEventListener("selectionchange", updateSelectionSnapshot);
  document.addEventListener("mouseup", () => {
    window.setTimeout(updateSelectionSnapshot, 0);
  });
  document.addEventListener("keyup", () => {
    window.setTimeout(updateSelectionSnapshot, 0);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "SHOW_PICKER") {
      void showLabelPicker(message);
    }
  });

  async function showLabelPicker({ text, sourceUrl, sourceTitle }) {
  const trimmedText = (text || "").trim();

  if (!trimmedText) {
    return;
  }

  destroyActivePicker();

  const template = await loadPopupTemplate();
  const popup = template.querySelector("#the-space-picker");

  if (!popup) {
    return;
  }

  const preview = popup.querySelector("[data-role='text']");
  const addButton = popup.querySelector("[data-role='add']");
  const errorNode = popup.querySelector("[data-role='error']");
  const labelButtons = [...popup.querySelectorAll("[data-label]")];
  let selectedLabel = "note";

  preview.textContent =
    trimmedText.length > 160 ? `${trimmedText.slice(0, 159)}...` : trimmedText;

  const setSelectedLabel = (nextLabel) => {
    selectedLabel = nextLabel;

    labelButtons.forEach((button) => {
      button.dataset.selected = button.dataset.label === nextLabel ? "true" : "false";
    });
  };

  labelButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setSelectedLabel(button.dataset.label || "note");
    });
  });

  setSelectedLabel(selectedLabel);

  const closeButton = popup.querySelector("[data-role='close']");
  closeButton?.addEventListener("click", () => {
    destroyActivePicker();
  });

  addButton?.addEventListener("click", () => {
    if (!addButton) {
      return;
    }

    addButton.disabled = true;
    errorNode.textContent = "";

    chrome.runtime.sendMessage(
      {
        type: "ADD_NODE",
        payload: {
          text: trimmedText,
          label: selectedLabel,
          sourceUrl,
          sourceTitle,
        },
      },
      (response) => {
        addButton.disabled = false;

        if (chrome.runtime.lastError) {
          errorNode.textContent = "Could not reach The Space.";
          return;
        }

        if (!response?.ok) {
          errorNode.textContent = response?.error || "Could not add that highlight.";
          return;
        }

        destroyActivePicker();
      },
    );
  });

  document.body.appendChild(popup);
  positionPopup(popup);

  const outsidePointerHandler = (event) => {
    if (popup.contains(event.target)) {
      return;
    }

    destroyActivePicker();
  };

  const escapeHandler = (event) => {
    if (event.key === "Escape") {
      destroyActivePicker();
    }
  };

  document.addEventListener("pointerdown", outsidePointerHandler, true);
  document.addEventListener("keydown", escapeHandler);

  activePicker = popup;
  activeCleanup = () => {
    document.removeEventListener("pointerdown", outsidePointerHandler, true);
    document.removeEventListener("keydown", escapeHandler);
  };
  }

  function destroyActivePicker() {
    if (activeCleanup) {
      activeCleanup();
      activeCleanup = null;
    }

    if (activePicker) {
      activePicker.remove();
      activePicker = null;
    }
  }

  function updateSelectionSnapshot() {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      lastSelectionRect = null;
      return;
    }

    const rect = selection.getRangeAt(0).getBoundingClientRect();

    if (!rect || (!rect.width && !rect.height)) {
      lastSelectionRect = null;
      return;
    }

    lastSelectionRect = {
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  async function loadPopupTemplate() {
    if (!popupTemplatePromise) {
      popupTemplatePromise = fetch(chrome.runtime.getURL("popup.html"))
        .then((response) => response.text())
        .then((html) => {
          const template = document.createElement("template");
          template.innerHTML = html.trim();
          return template.content.cloneNode(true);
        });
    }

    return popupTemplatePromise.then((fragment) => fragment.cloneNode(true));
  }

  function positionPopup(popup) {
    const rect = lastSelectionRect;
    const popupWidth = 320;
    const horizontalPadding = 12;
    const verticalPadding = 10;
    const fallbackTop = 32;
    const fallbackLeft = 32;

    popup.style.position = "fixed";
    popup.style.zIndex = "2147483647";

    if (!rect) {
      popup.style.top = `${fallbackTop}px`;
      popup.style.left = `${fallbackLeft}px`;
      return;
    }

    const maxLeft = window.innerWidth - popupWidth - horizontalPadding;
    const nextLeft = clamp(
      rect.left,
      horizontalPadding,
      Math.max(horizontalPadding, maxLeft),
    );
    const nextTop = rect.bottom + verticalPadding;

    popup.style.top = `${Math.max(fallbackTop, Math.min(nextTop, window.innerHeight - 280))}px`;
    popup.style.left = `${nextLeft}px`;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
}
