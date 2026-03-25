"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type WheelEvent,
} from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { InboxPanel } from "@/components/inbox-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  extractionResponseSchema,
  type ExtractedConnection,
  type ExtractedNode,
} from "@/lib/extraction";
import type { NodeLabel } from "@/lib/node-labels";
import { cn } from "@/lib/utils";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const COMPOSER_WIDTH = 288;
const COMPOSER_HEIGHT = 132;
const COMPOSER_MARGIN = 16;
const FALLBACK_NODE_SIZE = { width: 224, height: 96 };
const CONTEXT_MENU_WIDTH = 168;
const EXTRACTOR_SHELL_HEIGHT = 496;
const FRESH_NODE_ANIMATION_MS = 1_600;
const MIN_VIEWPORT_SCALE = 0.5;
const MAX_VIEWPORT_SCALE = 2.5;
const PAN_GESTURE_THRESHOLD = 3;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const DATE_HEADING_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const NODE_LABEL_STYLES: Record<
  NodeLabel,
  {
    badgeLabel: string;
    badgeClassName: string;
    borderClassName: string;
    connectorClassName: string;
  }
> = {
  source: {
    badgeLabel: "Source",
    badgeClassName: "bg-sky-300/15 text-sky-100",
    borderClassName: "border-sky-300/30",
    connectorClassName:
      "border-sky-200/60 bg-sky-300/15 text-sky-100 hover:bg-sky-300/25",
  },
  note: {
    badgeLabel: "Note",
    badgeClassName: "bg-white/10 text-white/72",
    borderClassName: "border-white/12",
    connectorClassName:
      "border-cyan-200/60 bg-cyan-300/15 text-cyan-100 hover:bg-cyan-300/25",
  },
  experience: {
    badgeLabel: "Experience",
    badgeClassName: "bg-rose-300/15 text-rose-100",
    borderClassName: "border-rose-300/30",
    connectorClassName:
      "border-rose-200/60 bg-rose-300/15 text-rose-100 hover:bg-rose-300/25",
  },
  learning: {
    badgeLabel: "Learning",
    badgeClassName: "bg-emerald-300/15 text-emerald-100",
    borderClassName: "border-emerald-300/32",
    connectorClassName:
      "border-emerald-200/60 bg-emerald-300/15 text-emerald-100 hover:bg-emerald-300/25",
  },
  realization: {
    badgeLabel: "Realization",
    badgeClassName: "bg-amber-300/18 text-amber-50",
    borderClassName: "border-amber-300/30",
    connectorClassName:
      "border-amber-200/60 bg-amber-300/15 text-amber-50 hover:bg-amber-300/25",
  },
};

type NodeDoc = Doc<"nodes"> & {
  label?: NodeLabel;
};
type PendingNodeDoc = Doc<"nodes"> & {
  label?: NodeLabel;
  sourceUrl?: string;
  sourceTitle?: string;
  status: "pending" | "active";
};
type ConnectionDoc = Doc<"connections">;

type Point = {
  x: number;
  y: number;
};

type Size = {
  width: number;
  height: number;
};

type ComposerState = Point & {
  text: string;
  error: string | null;
};

type DragState = {
  rootNodeId: Id<"nodes">;
  draggedNodeIds: Id<"nodes">[];
  pointerId: number;
  startPointer: Point;
  startPositions: Record<string, Point>;
  moved: boolean;
};

type ConnectionState = {
  fromId: Id<"nodes">;
  pointerId: number;
  pointer: Point;
  hoverId: Id<"nodes"> | null;
};

type EditState = {
  nodeId: Id<"nodes">;
  text: string;
  error: string | null;
};

type ContextMenuState =
  | (Point & {
      kind: "node";
      nodeId: Id<"nodes">;
    })
  | (Point & {
      kind: "canvas";
    });

type PanState = {
  pointerId: number;
  startPointer: Point;
  startOrigin: Point;
  moved: boolean;
};

type ViewportState = {
  origin: Point;
  scale: number;
};

type ViewMode = "general" | "date";

type DateGroup = {
  key: string;
  dayStart: number;
  label: string;
  isToday: boolean;
  nodes: NodeDoc[];
};

type SuggestConnectionResponse = {
  suggestedNodeId: string | null;
};

const EMPTY_NODES: NodeDoc[] = [];
const EMPTY_PENDING_NODES: PendingNodeDoc[] = [];
const EMPTY_CONNECTIONS: ConnectionDoc[] = [];

export function ThoughtWebCanvas() {
  if (!convexUrl) {
    return <MissingConvexState />;
  }

  return <ConnectedThoughtWebCanvas />;
}

function ConnectedThoughtWebCanvas() {
  const canvas = useQuery(api.graph.getCanvas);
  const pendingCanvasNodes = useQuery(api.inbox.listPending) as PendingNodeDoc[] | undefined;
  const createNode = useMutation(api.graph.createNode);
  const moveNode = useMutation(api.graph.moveNode);
  const updateNode = useMutation(api.graph.updateNode);
  const deleteNode = useMutation(api.graph.deleteNode);
  const clearCanvas = useMutation(api.graph.clearCanvas);
  const createConnection = useMutation(api.graph.createConnection);
  const importExtraction = useMutation(api.graph.importExtraction);
  const activatePendingNode = useMutation(api.inbox.activatePendingNode);
  const dismissPendingNode = useMutation(api.inbox.dismissPendingNode);

  const canvasRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const manualConnectionSelectionRef = useRef<Record<string, boolean>>({});
  const skipCanvasClickRef = useRef(false);
  const dragStateRef = useRef<DragState | null>(null);
  const connectionStateRef = useRef<ConnectionState | null>(null);
  const panStateRef = useRef<PanState | null>(null);
  const positionOverridesRef = useRef<Record<string, Point>>({});
  const viewportRef = useRef<ViewportState>({
    origin: { x: 0, y: 0 },
    scale: 1,
  });

  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isCreatingNode, setIsCreatingNode] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeletingNode, setIsDeletingNode] = useState<Id<"nodes"> | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [panState, setPanState] = useState<PanState | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState | null>(
    null,
  );
  const [editState, setEditState] = useState<EditState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const [isClearingCanvas, setIsClearingCanvas] = useState(false);
  const [positionOverrides, setPositionOverrides] = useState<
    Record<string, Point>
  >({});
  const [nodeSizes, setNodeSizes] = useState<Record<string, Size>>({});
  const [viewport, setViewport] = useState<ViewportState>({
    origin: { x: 0, y: 0 },
    scale: 1,
  });
  const [extractInput, setExtractInput] = useState("");
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractFeedback, setExtractFeedback] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isExtractorOpen, setIsExtractorOpen] = useState(false);
  const [isInboxOpen, setIsInboxOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("general");
  const [selectedNodeId, setSelectedNodeId] = useState<Id<"nodes"> | null>(null);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<
    Record<string, string>
  >({});
  const [manualConnectionSelection, setManualConnectionSelection] = useState<
    Record<string, boolean>
  >({});
  const [suggestedConnectionIds, setSuggestedConnectionIds] = useState<
    Record<string, string | null>
  >({});
  const [suggestionLoadingNodeIds, setSuggestionLoadingNodeIds] = useState<
    Record<string, boolean>
  >({});
  const [busyActionByNodeId, setBusyActionByNodeId] = useState<
    Record<string, "activate" | "dismiss" | undefined>
  >({});
  const [freshNodeIds, setFreshNodeIds] = useState<Record<string, boolean>>({});

  const nodes = canvas?.nodes ?? EMPTY_NODES;
  const connections = canvas?.connections ?? EMPTY_CONNECTIONS;
  const pendingNodes = pendingCanvasNodes ?? EMPTY_PENDING_NODES;
  const connectionOptions = [...nodes].sort((left, right) =>
    left.text.localeCompare(right.text),
  );
  const selectedNode =
    selectedNodeId ? nodes.find((node) => node._id === selectedNodeId) ?? null : null;

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  useEffect(() => {
    panStateRef.current = panState;
  }, [panState]);

  useEffect(() => {
    positionOverridesRef.current = positionOverrides;
  }, [positionOverrides]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    manualConnectionSelectionRef.current = manualConnectionSelection;
  }, [manualConnectionSelection]);

  useEffect(() => {
    if (viewMode !== "date") {
      return;
    }

    setComposer(null);
    setConnectionState(null);
    setContextMenu(null);
    setPanState(null);
    setIsExtractorOpen(false);
    setIsInboxOpen(false);
  }, [viewMode]);

  useEffect(() => {
    const pendingNodeIds = new Set(pendingNodes.map((node) => String(node._id)));

    const pruneMap = <T,>(currentValue: Record<string, T>) =>
      Object.fromEntries(
        Object.entries(currentValue).filter(([nodeId]) => pendingNodeIds.has(nodeId)),
      ) as Record<string, T>;

    setSelectedConnectionIds((currentValue) => pruneMap(currentValue));
    setManualConnectionSelection((currentValue) => pruneMap(currentValue));
    setSuggestedConnectionIds((currentValue) => pruneMap(currentValue));
    setSuggestionLoadingNodeIds((currentValue) => pruneMap(currentValue));
    setBusyActionByNodeId((currentValue) => pruneMap(currentValue));
  }, [pendingNodes]);

  useEffect(() => {
    if (viewMode !== "general" || pendingNodes.length === 0 || nodes.length === 0) {
      return;
    }

    let cancelled = false;

    const loadSuggestions = async () => {
      await Promise.all(
        pendingNodes.map(async (pendingNode) => {
          if (
            suggestionLoadingNodeIds[pendingNode._id] ||
            suggestedConnectionIds[pendingNode._id] !== undefined
          ) {
            return;
          }

          setSuggestionLoadingNodeIds((currentValue) => ({
            ...currentValue,
            [pendingNode._id]: true,
          }));

          try {
            const response = await fetch("/api/suggest-connections", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                pendingNode: {
                  text: pendingNode.text,
                  label: pendingNode.label,
                  sourceTitle: pendingNode.sourceTitle,
                  sourceUrl: pendingNode.sourceUrl,
                },
                activeNodes: nodes.slice(0, 200).map((node) => ({
                  id: node._id,
                  text: node.text,
                  label: node.label,
                })),
              }),
            });

            const payload = (await response.json().catch(() => null)) as
              | SuggestConnectionResponse
              | null;
            const nextSuggestedNodeId =
              response.ok && payload?.suggestedNodeId ? payload.suggestedNodeId : null;

            if (cancelled) {
              return;
            }

            setSuggestedConnectionIds((currentValue) => ({
              ...currentValue,
              [pendingNode._id]: nextSuggestedNodeId,
            }));

            setSelectedConnectionIds((currentValue) => {
              if (manualConnectionSelectionRef.current[pendingNode._id]) {
                return currentValue;
              }

              return {
                ...currentValue,
                [pendingNode._id]: nextSuggestedNodeId ?? "none",
              };
            });
          } catch {
            if (cancelled) {
              return;
            }

            setSuggestedConnectionIds((currentValue) => ({
              ...currentValue,
              [pendingNode._id]: null,
            }));
            setSelectedConnectionIds((currentValue) => {
              if (manualConnectionSelectionRef.current[pendingNode._id]) {
                return currentValue;
              }

              return {
                ...currentValue,
                [pendingNode._id]: "none",
              };
            });
          } finally {
            if (!cancelled) {
              setSuggestionLoadingNodeIds((currentValue) => ({
                ...currentValue,
                [pendingNode._id]: false,
              }));
            }
          }
        }),
      );
    };

    void loadSuggestions();

    return () => {
      cancelled = true;
    };
  }, [
    nodes,
    pendingNodes,
    suggestedConnectionIds,
    suggestionLoadingNodeIds,
    viewMode,
  ]);

  useEffect(() => {
    if (Object.keys(freshNodeIds).length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setFreshNodeIds({});
    }, FRESH_NODE_ANIMATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [freshNodeIds]);

  useEffect(() => {
    if (!canvas) {
      return;
    }

    setPositionOverrides((currentOverrides) => {
      let changed = false;
      const nextOverrides = { ...currentOverrides };
      const nodeLookup = new Map(
        canvas.nodes.map((node) => [node._id, { x: node.x, y: node.y }]),
      );

      for (const [nodeId, position] of Object.entries(currentOverrides)) {
        const serverPosition = nodeLookup.get(nodeId as Id<"nodes">);

        if (!serverPosition) {
          delete nextOverrides[nodeId];
          changed = true;
          continue;
        }

        if (
          Math.abs(serverPosition.x - position.x) < 0.5 &&
          Math.abs(serverPosition.y - position.y) < 0.5
        ) {
          delete nextOverrides[nodeId];
          changed = true;
        }
      }

      return changed ? nextOverrides : currentOverrides;
    });

    setNodeSizes((currentSizes) => {
      let changed = false;
      const nextSizes = { ...currentSizes };
      const currentNodeIds = new Set(canvas.nodes.map((node) => node._id));

      for (const nodeId of Object.keys(currentSizes)) {
        if (!currentNodeIds.has(nodeId as Id<"nodes">)) {
          delete nextSizes[nodeId];
          changed = true;
        }
      }

      return changed ? nextSizes : currentSizes;
    });

    if (editState && !canvas.nodes.some((node) => node._id === editState.nodeId)) {
      setEditState(null);
    }

    if (
      contextMenu?.kind === "node" &&
      !canvas.nodes.some((node) => node._id === contextMenu.nodeId)
    ) {
      setContextMenu(null);
    }

    if (selectedNodeId && !canvas.nodes.some((node) => node._id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [canvas, contextMenu, editState, selectedNodeId]);

  useEffect(() => {
    if (!isClearingCanvas || nodes.length > 0 || connections.length > 0) {
      return;
    }

    setIsClearingCanvas(false);
  }, [connections.length, isClearingCanvas, nodes.length]);

  useEffect(() => {
    if (!composerRef.current) {
      return;
    }

    composerRef.current.focus();
    resizeTextarea(composerRef.current);
  }, [composer]);

  useEffect(() => {
    const clearPositionOverrides = (nodeIds: Id<"nodes">[]) => {
      setPositionOverrides((currentOverrides) => {
        let changed = false;
        const nextOverrides = { ...currentOverrides };

        for (const nodeId of nodeIds) {
          if (!(nodeId in nextOverrides)) {
            continue;
          }

          delete nextOverrides[nodeId];
          changed = true;
        }

        return changed ? nextOverrides : currentOverrides;
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      const activeDrag = dragStateRef.current;
      const activeConnection = connectionStateRef.current;
      const activePan = panStateRef.current;

      if (activeDrag && event.pointerId === activeDrag.pointerId) {
        const rootStartPosition = activeDrag.startPositions[activeDrag.rootNodeId];

        if (!rootStartPosition) {
          return;
        }

        const nextPosition = {
          x:
            rootStartPosition.x +
            (event.clientX - activeDrag.startPointer.x) / viewportRef.current.scale,
          y:
            rootStartPosition.y +
            (event.clientY - activeDrag.startPointer.y) / viewportRef.current.scale,
        };
        const delta = {
          x: nextPosition.x - rootStartPosition.x,
          y: nextPosition.y - rootStartPosition.y,
        };
        const moved =
          activeDrag.moved ||
          Math.abs(delta.x) > 2 ||
          Math.abs(delta.y) > 2;

        if (moved) {
          skipCanvasClickRef.current = true;
        }

        setDragState((currentDrag) =>
          currentDrag
            ? {
                ...currentDrag,
                moved,
              }
            : currentDrag,
        );
        setPositionOverrides((currentOverrides) => {
          const nextOverrides = { ...currentOverrides };

          for (const nodeId of activeDrag.draggedNodeIds) {
            const startPosition = activeDrag.startPositions[nodeId];

            if (!startPosition) {
              continue;
            }

            nextOverrides[nodeId] = {
              x: startPosition.x + delta.x,
              y: startPosition.y + delta.y,
            };
          }

          return nextOverrides;
        });
        return;
      }

      if (activePan && event.pointerId === activePan.pointerId) {
        const pointerDelta = {
          x: event.clientX - activePan.startPointer.x,
          y: event.clientY - activePan.startPointer.y,
        };
        const moved =
          activePan.moved ||
          Math.abs(pointerDelta.x) > PAN_GESTURE_THRESHOLD ||
          Math.abs(pointerDelta.y) > PAN_GESTURE_THRESHOLD;

        if (!moved) {
          return;
        }

        skipCanvasClickRef.current = true;
        setPanState((currentPan) =>
          currentPan
            ? {
                ...currentPan,
                moved: true,
              }
            : currentPan,
        );
        setViewport((currentViewport) => ({
          ...currentViewport,
          origin: {
            x: activePan.startOrigin.x - pointerDelta.x / currentViewport.scale,
            y: activePan.startOrigin.y - pointerDelta.y / currentViewport.scale,
          },
        }));
        return;
      }

      if (activeConnection && event.pointerId === activeConnection.pointerId) {
        const nextPointer = screenToWorld(
          event.clientX,
          event.clientY,
          canvasRef.current,
          viewportRef.current,
        );

        if (!nextPointer) {
          return;
        }

        setConnectionState((currentConnection) =>
          currentConnection
            ? {
                ...currentConnection,
                pointer: nextPointer,
                hoverId: getDropTargetNodeId(
                  event.clientX,
                  event.clientY,
                  currentConnection.fromId,
                ),
              }
            : currentConnection,
        );
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      const activeDrag = dragStateRef.current;

      if (activeDrag && event.pointerId === activeDrag.pointerId) {
        const finalPosition =
          positionOverridesRef.current[activeDrag.rootNodeId] ??
          activeDrag.startPositions[activeDrag.rootNodeId];

        setDragState(null);

        if (!finalPosition) {
          clearPositionOverrides(activeDrag.draggedNodeIds);
          return;
        }

        if (!activeDrag.moved) {
          clearPositionOverrides(activeDrag.draggedNodeIds);
          return;
        }

        void moveNode({
          nodeId: activeDrag.rootNodeId,
          x: finalPosition.x,
          y: finalPosition.y,
        }).catch((error: unknown) => {
          setSaveError(
            error instanceof Error ? error.message : "Could not move that node.",
          );
          clearPositionOverrides(activeDrag.draggedNodeIds);
        });

        return;
      }

      const activePan = panStateRef.current;

      if (activePan && event.pointerId === activePan.pointerId) {
        if (activePan.moved) {
          skipCanvasClickRef.current = true;
        }

        setPanState(null);
        return;
      }

      const activeConnection = connectionStateRef.current;

      if (!activeConnection || event.pointerId !== activeConnection.pointerId) {
        return;
      }

      skipCanvasClickRef.current = true;
      setConnectionState(null);

      if (
        !activeConnection.hoverId ||
        activeConnection.hoverId === activeConnection.fromId
      ) {
        return;
      }

      void createConnection({
        from: activeConnection.fromId,
        to: activeConnection.hoverId,
      }).catch((error: unknown) => {
        setSaveError(
          error instanceof Error
            ? error.message
            : "Could not create that connection.",
        );
      });
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [createConnection, moveNode]);

  async function submitComposer() {
    if (!composer || isCreatingNode) {
      return;
    }

    const text = composer.text.trim();

    if (!text) {
      setComposer((currentComposer) =>
        currentComposer
          ? {
              ...currentComposer,
              error: "Text is required.",
            }
          : currentComposer,
      );
      return;
    }

    setIsCreatingNode(true);
    setSaveError(null);

    try {
      await createNode({
        text,
        label: "note",
        x: composer.x,
        y: composer.y,
      });
      setComposer(null);
    } catch (error) {
      setComposer((currentComposer) =>
        currentComposer
          ? {
              ...currentComposer,
              error:
                error instanceof Error
                  ? error.message
                  : "Could not create that node.",
            }
          : currentComposer,
      );
    } finally {
      setIsCreatingNode(false);
    }
  }

  async function submitEdit() {
    if (!editState || isSavingEdit) {
      return;
    }

    const text = editState.text.trim();

    if (!text) {
      setEditState((currentEdit) =>
        currentEdit
          ? {
              ...currentEdit,
              error: "Text is required.",
            }
          : currentEdit,
      );
      return;
    }

    setIsSavingEdit(true);
    setSaveError(null);

    try {
      await updateNode({
        nodeId: editState.nodeId,
        text,
      });
      setEditState(null);
    } catch (error) {
      setEditState((currentEdit) =>
        currentEdit
          ? {
              ...currentEdit,
              error:
                error instanceof Error
                  ? error.message
                  : "Could not save that edit.",
            }
          : currentEdit,
      );
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleExtract() {
    const text = extractInput.trim();

    if (!text || isExtracting) {
      setExtractError("Paste some text before extracting.");
      setExtractFeedback(null);
      return;
    }

    setIsExtracting(true);
    setExtractError(null);
    setExtractFeedback(null);
    setSaveError(null);

    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;

      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload) ?? "Could not extract nodes from that text.",
        );
      }

      const parsedPayload = extractionResponseSchema.safeParse(payload);

      if (!parsedPayload.success) {
        throw new Error("The extraction response was not valid.");
      }

      const positionedNodes = createExtractionNodePlacements(
        parsedPayload.data.nodes,
        parsedPayload.data.connections,
        canvasRef.current,
        viewportRef.current,
      );
      const result = await importExtraction({
        nodes: positionedNodes,
        connections: parsedPayload.data.connections,
      });

      setExtractInput("");
      setExtractFeedback(
        `Imported ${result.nodeCount} nodes and ${result.connectionCount} connections.`,
      );
    } catch (error) {
      setExtractError(
        error instanceof Error
          ? error.message
          : "Could not extract nodes from that text.",
      );
    } finally {
      setIsExtracting(false);
    }
  }

  function handlePendingConnectionSelect(nodeId: string, nextValue: string) {
    setSelectedConnectionIds((currentValue) => ({
      ...currentValue,
      [nodeId]: nextValue,
    }));
    setManualConnectionSelection((currentValue) => ({
      ...currentValue,
      [nodeId]: true,
    }));
  }

  async function handleActivatePendingNode(nodeId: Id<"nodes">) {
    if (busyActionByNodeId[nodeId]) {
      return;
    }

    const viewportCenter = getViewportCenterWorldPoint(
      canvasRef.current,
      viewportRef.current,
    ) ?? { x: 0, y: 0 };
    const selectedConnectionId = selectedConnectionIds[nodeId] ?? "none";

    setBusyActionByNodeId((currentValue) => ({
      ...currentValue,
      [nodeId]: "activate",
    }));
    setSaveError(null);

    try {
      const result = await activatePendingNode({
        nodeId,
        connectToNodeId:
          selectedConnectionId !== "none"
            ? (selectedConnectionId as Id<"nodes">)
            : null,
        viewportCenterX: viewportCenter.x,
        viewportCenterY: viewportCenter.y,
      });

      setPositionOverrides((currentValue) => ({
        ...currentValue,
        [result.activatedNodeId]: { x: result.x, y: result.y },
      }));
      setFreshNodeIds((currentValue) => ({
        ...currentValue,
        [result.activatedNodeId]: true,
      }));
      setIsInboxOpen(false);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not add that pending node to the canvas.",
      );
    } finally {
      setBusyActionByNodeId((currentValue) => ({
        ...currentValue,
        [nodeId]: undefined,
      }));
    }
  }

  async function handleDismissPendingNode(nodeId: Id<"nodes">) {
    if (busyActionByNodeId[nodeId]) {
      return;
    }

    setBusyActionByNodeId((currentValue) => ({
      ...currentValue,
      [nodeId]: "dismiss",
    }));
    setSaveError(null);

    try {
      await dismissPendingNode({ nodeId });
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not dismiss that pending node.",
      );
    } finally {
      setBusyActionByNodeId((currentValue) => ({
        ...currentValue,
        [nodeId]: undefined,
      }));
    }
  }

  function handleOutsidePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;

    if (!target) {
      return;
    }

    let handled = false;

    if (composer && !target.closest("[data-composer-card]")) {
      handled = true;

      if (composer.text.trim()) {
        void submitComposer();
      } else {
        setComposer(null);
      }
    }

    if (
      editState &&
      !target.closest(`[data-node-id="${editState.nodeId}"]`)
    ) {
      handled = true;

      if (editState.text.trim()) {
        void submitEdit();
      } else {
        setEditState(null);
      }
    }

    if (!handled) {
      return;
    }

    skipCanvasClickRef.current = true;
    event.preventDefault();
    event.stopPropagation();
  }

  async function handleDeleteNode(nodeId?: Id<"nodes">) {
    if (!nodeId) {
      setSaveError("Could not determine which node to delete.");
      return;
    }

    if (isDeletingNode === nodeId) {
      return;
    }

    setIsDeletingNode(nodeId);
    setSaveError(null);
    setContextMenu(null);
    setSelectedNodeId((currentNodeId) =>
      currentNodeId === nodeId ? null : currentNodeId,
    );
    setEditState((currentEdit) =>
      currentEdit?.nodeId === nodeId ? null : currentEdit,
    );
    setConnectionState((currentConnection) =>
      currentConnection?.fromId === nodeId ? null : currentConnection,
    );

    try {
      await deleteNode({ nodeId });
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Could not delete that node.",
      );
    } finally {
      setIsDeletingNode((currentNodeId) =>
        currentNodeId === nodeId ? null : currentNodeId,
      );
    }
  }

  async function handleClearCanvas() {
    if (isClearingCanvas) {
      return;
    }

    setIsClearingCanvas(true);
    setIsClearDialogOpen(false);
    setContextMenu(null);
    setComposer(null);
    setEditState(null);
    setSelectedNodeId(null);
    setConnectionState(null);
    setSaveError(null);

    try {
      const result = await clearCanvas({});

      if (result.completed) {
        setIsClearingCanvas(false);
      }
    } catch (error) {
      setIsClearingCanvas(false);
      setSaveError(
        error instanceof Error ? error.message : "Could not clear the canvas.",
      );
    }
  }

  function handleCanvasClick(event: ReactPointerEvent<HTMLDivElement>) {
    if (skipCanvasClickRef.current) {
      skipCanvasClickRef.current = false;
      return;
    }

    if (event.target !== event.currentTarget) {
      return;
    }

    setContextMenu(null);
    setSelectedNodeId(null);
    setSaveError(null);
  }

  function handleCanvasDoubleClick(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) {
      return;
    }

    const nextPoint = screenToWorld(
      event.clientX,
      event.clientY,
      canvasRef.current,
      viewportRef.current,
    );

    if (!nextPoint) {
      return;
    }

    setEditState(null);
    setSelectedNodeId(null);
    setSaveError(null);
    setComposer({
      ...clampComposerPoint(nextPoint, canvasRef.current, viewportRef.current),
      text: "",
      error: null,
    });
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      event.button !== 0 ||
      event.target !== event.currentTarget ||
      dragStateRef.current ||
      connectionStateRef.current
    ) {
      return;
    }

    setContextMenu(null);
    setPanState({
      pointerId: event.pointerId,
      startPointer: { x: event.clientX, y: event.clientY },
      startOrigin: viewportRef.current.origin,
      moved: false,
    });
  }

  function handleCanvasContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      event.preventDefault();
      setComposer(null);
      setConnectionState(null);
      setSaveError(null);
      const nextPoint = clampContextMenuPoint(
        screenToWorld(
          event.clientX,
          event.clientY,
          canvasRef.current,
          viewportRef.current,
        ) ?? {
          x: 0,
          y: 0,
        },
        canvasRef.current,
        viewportRef.current,
      );

      setContextMenu({
        kind: "canvas",
        ...nextPoint,
      });
    }
  }

  function handleCanvasWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();

    const wheelDelta = getWheelDeltaInPixels(event, canvasRef.current);

    if (
      Math.abs(wheelDelta.x) > 0.5 &&
      Math.abs(wheelDelta.x) >= Math.abs(wheelDelta.y)
    ) {
      setViewport((currentViewport) => ({
        ...currentViewport,
        origin: {
          x: currentViewport.origin.x + wheelDelta.x / currentViewport.scale,
          y: currentViewport.origin.y,
        },
      }));
      return;
    }

    const viewportPoint = getCanvasScreenPoint(
      event.clientX,
      event.clientY,
      canvasRef.current,
    );
    const worldPoint = screenToWorld(
      event.clientX,
      event.clientY,
      canvasRef.current,
      viewportRef.current,
    );

    if (!viewportPoint || !worldPoint) {
      return;
    }

    const nextScale = clamp(
      viewportRef.current.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY),
      MIN_VIEWPORT_SCALE,
      MAX_VIEWPORT_SCALE,
    );

    if (Math.abs(nextScale - viewportRef.current.scale) < 0.001) {
      return;
    }

    setViewport({
      scale: nextScale,
      origin: {
        x: worldPoint.x - viewportPoint.x / nextScale,
        y: worldPoint.y - viewportPoint.y / nextScale,
      },
    });
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setComposer(null);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitComposer();
    }
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setEditState(null);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitEdit();
    }
  }

  function handleComposerChange(value: string) {
    setComposer((currentComposer) =>
      currentComposer
        ? {
            ...currentComposer,
            text: value,
            error: null,
          }
        : currentComposer,
    );
    setSaveError(null);

    if (composerRef.current) {
      resizeTextarea(composerRef.current);
    }
  }

  function handleEditChange(value: string) {
    setEditState((currentEdit) =>
      currentEdit
        ? {
            ...currentEdit,
            text: value,
            error: null,
          }
        : currentEdit,
    );
    setSaveError(null);
  }

  function handleNodePointerDown(
    node: NodeDoc,
    event: ReactPointerEvent<HTMLElement>,
  ) {
    if (event.button !== 0 || editState?.nodeId === node._id) {
      return;
    }

    event.stopPropagation();
    setComposer(null);
    setContextMenu(null);
    setSaveError(null);

    const draggedNodeIds =
      node.label === "source"
        ? getMoveGroupNodeIds(nodes, connections, node._id)
        : [node._id];
    const startPositions = Object.fromEntries(
      draggedNodeIds.map((nodeId) => {
        const draggedNode = nodes.find((currentNode) => currentNode._id === nodeId);

        if (!draggedNode) {
          return [nodeId, { x: 0, y: 0 }] satisfies [string, Point];
        }

        return [
          nodeId,
          getNodePosition(draggedNode, positionOverrides),
        ] satisfies [string, Point];
      }),
    );

    setDragState({
      rootNodeId: node._id,
      draggedNodeIds,
      pointerId: event.pointerId,
      startPointer: { x: event.clientX, y: event.clientY },
      startPositions,
      moved: false,
    });
    setPositionOverrides((currentOverrides) => ({
      ...currentOverrides,
      ...startPositions,
    }));
  }

  function handleConnectionPointerDown(
    nodeId: Id<"nodes">,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (event.button !== 0 || editState?.nodeId === nodeId) {
      return;
    }

    const nextPoint = screenToWorld(
      event.clientX,
      event.clientY,
      canvasRef.current,
      viewportRef.current,
    );

    if (!nextPoint) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    skipCanvasClickRef.current = true;
    setComposer(null);
    setContextMenu(null);
    setSaveError(null);
    setConnectionState({
      fromId: nodeId,
      pointerId: event.pointerId,
      pointer: nextPoint,
      hoverId: null,
    });
  }

  function handleNodeDoubleClick(node: NodeDoc) {
    skipCanvasClickRef.current = true;
    setComposer(null);
    setContextMenu(null);
    setConnectionState(null);
    setSelectedNodeId(node._id);
    setSaveError(null);
    setEditState({
      nodeId: node._id,
      text: node.text,
      error: null,
    });
  }

  function handleNodeContextMenu(
    nodeId: Id<"nodes">,
    event: ReactMouseEvent<HTMLElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    skipCanvasClickRef.current = true;
    setComposer(null);
    setConnectionState(null);
    setSaveError(null);
    const nextPoint = clampContextMenuPoint(
      screenToWorld(
        event.clientX,
        event.clientY,
        canvasRef.current,
        viewportRef.current,
      ) ?? {
        x: 0,
        y: 0,
      },
      canvasRef.current,
      viewportRef.current,
    );

    setContextMenu({
      kind: "node",
      nodeId,
      ...nextPoint,
    });
  }

  function handleOpenExtractor() {
    setIsExtractorOpen(true);
    setContextMenu(null);
    setSaveError(null);
  }

  function handleCloseExtractor() {
    setIsExtractorOpen(false);
  }

  function handleNodeSelect(nodeId: Id<"nodes">) {
    setContextMenu(null);
    setSaveError(null);
    setSelectedNodeId(nodeId);
  }

  function handleNodeSizeChange(nodeId: Id<"nodes">, nextSize: Size) {
    setNodeSizes((currentSizes) => {
      const currentSize = currentSizes[nodeId];

      if (
        currentSize &&
        Math.abs(currentSize.width - nextSize.width) < 0.5 &&
        Math.abs(currentSize.height - nextSize.height) < 0.5
      ) {
        return currentSizes;
      }

      return {
        ...currentSizes,
        [nodeId]: nextSize,
      };
    });
  }

  const todayKey = getLocalDateKey(Date.now());
  const dateGroups = getDateGroups(nodes, todayKey);
  const previewStartPoint = connectionState
    ? getPreviewStartPoint(
        connectionState.fromId,
        nodes,
        positionOverrides,
        nodeSizes,
        connectionState.pointer,
      )
    : null;
  const sceneOrigin = worldToScreen({ x: 0, y: 0 }, viewport);

  return (
    <main
      ref={canvasRef}
      className={cn(
        "canvas-grid relative h-screen overflow-hidden",
        viewMode === "general"
          ? panState
            ? "cursor-grabbing"
            : "cursor-grab"
          : "cursor-default",
      )}
      style={{ touchAction: viewMode === "general" ? "none" : "auto" }}
      onPointerDownCapture={handleOutsidePointerDown}
      onPointerDown={viewMode === "general" ? handleCanvasPointerDown : undefined}
      onClick={viewMode === "general" ? handleCanvasClick : undefined}
      onDoubleClick={viewMode === "general" ? handleCanvasDoubleClick : undefined}
      onContextMenu={viewMode === "general" ? handleCanvasContextMenu : undefined}
      onWheel={viewMode === "general" ? handleCanvasWheel : undefined}
    >
      {viewMode === "general" ? (
        <>
          <div className="pointer-events-none absolute top-24 left-6 bottom-6 z-30 hidden w-[22rem] xl:block">
            <div className="pointer-events-auto h-full">
              <InboxPanel
                pendingNodes={pendingNodes}
                activeNodes={connectionOptions}
                selectedConnectionIds={selectedConnectionIds}
                suggestedConnectionIds={suggestedConnectionIds}
                suggestionLoadingNodeIds={suggestionLoadingNodeIds}
                busyActionByNodeId={busyActionByNodeId}
                onSelectConnection={handlePendingConnectionSelect}
                onActivate={(nodeId) =>
                  void handleActivatePendingNode(nodeId as Id<"nodes">)
                }
                onDismiss={(nodeId) =>
                  void handleDismissPendingNode(nodeId as Id<"nodes">)
                }
              />
            </div>
          </div>

          <div
            className={cn(
              "absolute inset-0 z-40 xl:hidden",
              isInboxOpen ? "pointer-events-auto" : "pointer-events-none",
            )}
            aria-hidden={!isInboxOpen}
          >
            <button
              type="button"
              className={cn(
                "absolute inset-0 bg-black/45 backdrop-blur-[1px] transition",
                isInboxOpen ? "opacity-100" : "opacity-0",
              )}
              onClick={() => setIsInboxOpen(false)}
              aria-label="Close inbox drawer"
            />
            <div
              className={cn(
                "absolute top-0 left-0 bottom-0 w-[min(24rem,calc(100vw-2rem))] p-4 transition duration-300 ease-out",
                isInboxOpen ? "translate-x-0" : "-translate-x-full",
              )}
            >
              <InboxPanel
                pendingNodes={pendingNodes}
                activeNodes={connectionOptions}
                selectedConnectionIds={selectedConnectionIds}
                suggestedConnectionIds={suggestedConnectionIds}
                suggestionLoadingNodeIds={suggestionLoadingNodeIds}
                busyActionByNodeId={busyActionByNodeId}
                onSelectConnection={handlePendingConnectionSelect}
                onActivate={(nodeId) =>
                  void handleActivatePendingNode(nodeId as Id<"nodes">)
                }
                onDismiss={(nodeId) =>
                  void handleDismissPendingNode(nodeId as Id<"nodes">)
                }
              />
            </div>
          </div>
        </>
      ) : null}

      {viewMode === "general" ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            transform: `translate(${sceneOrigin.x}px, ${sceneOrigin.y}px) scale(${viewport.scale})`,
            transformOrigin: "0 0",
          }}
        >
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{ overflow: "visible" }}
          >
            {connections.map((connection) => {
              const points = getConnectionPoints(
                connection,
                nodes,
                positionOverrides,
                nodeSizes,
              );

              if (!points) {
                return null;
              }

              return (
                <line
                  key={connection._id}
                  x1={points.start.x}
                  y1={points.start.y}
                  x2={points.end.x}
                  y2={points.end.y}
                  stroke="rgb(121 239 229 / 0.55)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              );
            })}
            {connectionState && previewStartPoint ? (
              <line
                x1={previewStartPoint.x}
                y1={previewStartPoint.y}
                x2={connectionState.pointer.x}
                y2={connectionState.pointer.y}
                stroke="rgb(255 255 255 / 0.8)"
                strokeWidth="2"
                strokeDasharray="7 6"
                strokeLinecap="round"
              />
            ) : null}
          </svg>

          {composer ? (
            <InlineTextCard
              textareaRef={composerRef}
              position={composer}
              value={composer.text}
              error={composer.error}
              buttonLabel={isCreatingNode ? "Saving..." : "Save"}
              disabled={isCreatingNode}
              placeholder="Type a thought..."
              onChange={handleComposerChange}
              onKeyDown={handleComposerKeyDown}
              onSubmit={() => void submitComposer()}
            />
          ) : null}

          {nodes.map((node, index) => (
            <NodeCard
              key={node._id}
              node={node}
              animationStyle={getStaggerStyle(index, 18)}
              position={getNodePosition(node, positionOverrides)}
              isConnectionSource={connectionState?.fromId === node._id}
              isConnectionTarget={connectionState?.hoverId === node._id}
              isEditing={editState?.nodeId === node._id}
              editValue={editState?.nodeId === node._id ? editState.text : ""}
              editError={editState?.nodeId === node._id ? editState.error : null}
              isDeleting={isDeletingNode === node._id}
              isSavingEdit={isSavingEdit && editState?.nodeId === node._id}
              isSelected={selectedNodeId === node._id}
              isFresh={freshNodeIds[node._id] ?? false}
              onPointerDown={handleNodePointerDown}
              onSelect={handleNodeSelect}
              onDoubleClick={handleNodeDoubleClick}
              onContextMenu={handleNodeContextMenu}
              onConnectionPointerDown={handleConnectionPointerDown}
              onSizeChange={handleNodeSizeChange}
              onEditChange={handleEditChange}
              onEditKeyDown={handleEditKeyDown}
              onEditSubmit={() => void submitEdit()}
            />
          ))}

          {contextMenu ? (
            <div
              className="pointer-events-auto absolute z-40 rounded-2xl border border-white/12 bg-[rgb(11_16_26_/_0.97)] p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.4)] backdrop-blur"
              style={{
                left: contextMenu.x,
                top: contextMenu.y,
                width: CONTEXT_MENU_WIDTH,
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {contextMenu.kind === "node" ? (
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-red-100 transition hover:bg-red-500/12 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isDeletingNode === contextMenu.nodeId}
                  onClick={() => void handleDeleteNode(contextMenu.nodeId)}
                >
                  <span>Delete node</span>
                  <span className="text-xs uppercase tracking-[0.2em] text-red-200/70">
                    Del
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-red-100 transition hover:bg-red-500/12 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isClearingCanvas}
                  onClick={() => {
                    setContextMenu(null);
                    setIsClearDialogOpen(true);
                  }}
                >
                  <span>Clear all nodes</span>
                  <span className="text-xs uppercase tracking-[0.2em] text-red-200/70">
                    Del
                  </span>
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="absolute inset-0 overflow-y-auto px-6 pt-28 pb-28">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            {dateGroups.length > 0 ? (
              dateGroups.map((group, groupIndex) => (
                <section
                  key={group.key}
                  className="rounded-[1.9rem] border border-white/10 bg-black/20 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.24)] backdrop-blur-sm"
                  style={getStaggerStyle(groupIndex, 55)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        {group.isToday ? (
                          <span className="rounded-full bg-cyan-300 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-950">
                            Today
                          </span>
                        ) : null}
                        <h2 className="text-lg font-semibold text-white">
                          {group.label}
                        </h2>
                      </div>
                      <p className="mt-1 text-sm text-white/55">
                        {group.nodes.length} {group.nodes.length === 1 ? "entry" : "entries"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {group.nodes.map((node, nodeIndex) => (
                      <DateNodeCard
                        key={node._id}
                        node={node}
                        animationStyle={getStaggerStyle(groupIndex + nodeIndex + 1, 38)}
                        isEditing={editState?.nodeId === node._id}
                        editValue={editState?.nodeId === node._id ? editState.text : ""}
                        editError={editState?.nodeId === node._id ? editState.error : null}
                        isDeleting={isDeletingNode === node._id}
                        isSavingEdit={isSavingEdit && editState?.nodeId === node._id}
                        isSelected={selectedNodeId === node._id}
                        onSelect={handleNodeSelect}
                        onDoubleClick={handleNodeDoubleClick}
                        onDelete={() => void handleDeleteNode(node._id)}
                        onEditChange={handleEditChange}
                        onEditKeyDown={handleEditKeyDown}
                        onEditSubmit={() => void submitEdit()}
                      />
                    ))}
                  </div>
                </section>
              ))
            ) : (
              <div className="rounded-[1.9rem] border border-white/10 bg-black/20 p-8 text-white/70 shadow-[0_20px_70px_rgba(0,0,0,0.24)] backdrop-blur-sm">
                <p className="text-sm uppercase tracking-[0.24em] text-cyan-100/70">
                  By Date
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-white">
                  No entries yet.
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6">
                  Switch back to General to create a node or import a conversation,
                  then come here to browse everything by the day it was entered.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-6 pt-6">
        <div className="pointer-events-auto flex items-center gap-3 rounded-[1.2rem] border border-white/10 bg-black/30 px-3 py-3 text-white/75 backdrop-blur-sm">
          {viewMode === "general" ? (
            <>
              <button
                type="button"
                className="xl:hidden rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-white transition hover:bg-white/[0.08]"
                onClick={() => setIsInboxOpen(true)}
              >
                Inbox {pendingNodes.length > 0 ? `(${pendingNodes.length})` : ""}
              </button>
              <div className="hidden xl:block rounded-full border border-cyan-200/20 bg-cyan-300/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100">
                Inbox {pendingNodes.length}
              </div>
            </>
          ) : null}
          <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
            <button
              type="button"
              className={cn(
                "rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.24em] transition",
                viewMode === "general"
                  ? "bg-cyan-300 text-slate-950"
                  : "text-white/65 hover:bg-white/[0.06] hover:text-white",
              )}
              onClick={() => setViewMode("general")}
            >
              General
            </button>
            <button
              type="button"
              className={cn(
                "rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.24em] transition",
                viewMode === "date"
                  ? "bg-cyan-300 text-slate-950"
                  : "text-white/65 hover:bg-white/[0.06] hover:text-white",
              )}
              onClick={() => setViewMode("date")}
            >
              By Date
            </button>
          </div>
          <div className="hidden h-8 w-px bg-white/10 sm:block" />
          <div className="hidden text-xs uppercase tracking-[0.28em] text-white/60 sm:block">
            {viewMode === "general"
              ? "Paste to extract. Double-click to make a node. Drag to pan. Scroll to zoom."
              : "Browse entries by day. Double-click a card to edit it."}
          </div>
        </div>
      </div>

      {viewMode === "general" ? (
        <ExtractorShell>
          <ExtractorPanel
            isOpen={isExtractorOpen}
            value={extractInput}
            error={extractError}
            feedback={extractFeedback}
            disabled={isExtracting}
            onOpen={handleOpenExtractor}
            onClose={handleCloseExtractor}
            onChange={(value) => {
              setExtractInput(value);
              setExtractError(null);
              setExtractFeedback(null);
            }}
            onClear={() => {
              setExtractInput("");
              setExtractError(null);
              setExtractFeedback(null);
            }}
            onSubmit={() => void handleExtract()}
          />
        </ExtractorShell>
      ) : null}

      <aside
        aria-hidden={!selectedNode}
        className={cn(
          "pointer-events-none absolute top-24 right-6 bottom-6 z-30 w-[min(24rem,calc(100vw-3rem))] transition duration-300 ease-out",
          selectedNode ? "translate-x-0 opacity-100" : "translate-x-full opacity-0",
        )}
      >
        <div className="pointer-events-auto flex h-full flex-col rounded-[1.8rem] border border-white/10 bg-[rgb(11_16_26_/_0.9)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.38)] backdrop-blur-xl">
          <h2 className="text-2xl font-semibold leading-tight whitespace-pre-wrap text-white">
            {selectedNode?.text ?? ""}
          </h2>
        </div>
      </aside>

      <div className="pointer-events-none absolute bottom-0 left-0 z-10 px-6 pb-6">
        <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/70 backdrop-blur-sm">
          {saveError ??
            (isClearingCanvas
              ? "Clearing canvas..."
              : null) ??
            (canvas
              ? `${nodes.length} nodes, ${connections.length} connections`
              : "Loading your canvas...")}
        </div>
      </div>

      <AlertDialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
        <AlertDialogContent className="border-white/12 bg-[rgb(11_16_26_/_0.98)] text-white shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              Clear the entire canvas?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/68">
              This removes every node and connection from the current canvas.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isClearingCanvas}
              className="border-white/12 bg-white/[0.03] text-white hover:bg-white/[0.08]"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isClearingCanvas}
              className="bg-red-500 text-white hover:opacity-100 hover:bg-red-400"
              onClick={(event) => {
                event.preventDefault();
                void handleClearCanvas();
              }}
            >
              {isClearingCanvas ? "Clearing..." : "Clear all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function NodeCard({
  node,
  animationStyle,
  position,
  isConnectionSource,
  isConnectionTarget,
  isEditing,
  editValue,
  editError,
  isDeleting,
  isSavingEdit,
  isSelected,
  isFresh,
  onPointerDown,
  onSelect,
  onDoubleClick,
  onContextMenu,
  onConnectionPointerDown,
  onSizeChange,
  onEditChange,
  onEditKeyDown,
  onEditSubmit,
}: {
  node: NodeDoc;
  animationStyle?: CSSProperties;
  position: Point;
  isConnectionSource: boolean;
  isConnectionTarget: boolean;
  isEditing: boolean;
  editValue: string;
  editError: string | null;
  isDeleting: boolean;
  isSavingEdit: boolean;
  isSelected: boolean;
  isFresh: boolean;
  onPointerDown: (node: NodeDoc, event: ReactPointerEvent<HTMLElement>) => void;
  onSelect: (nodeId: Id<"nodes">) => void;
  onDoubleClick: (node: NodeDoc) => void;
  onContextMenu: (
    nodeId: Id<"nodes">,
    event: ReactMouseEvent<HTMLElement>,
  ) => void;
  onConnectionPointerDown: (
    nodeId: Id<"nodes">,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onSizeChange: (nodeId: Id<"nodes">, size: Size) => void;
  onEditChange: (value: string) => void;
  onEditKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onEditSubmit: () => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const label = getNodeLabel(node);
  const labelStyle = NODE_LABEL_STYLES[label];

  useEffect(() => {
    const element = cardRef.current;

    if (!element) {
      return;
    }

    const reportSize = () => {
      onSizeChange(node._id, {
        width: element.offsetWidth,
        height: element.offsetHeight,
      });
    };

    reportSize();

    const observer = new ResizeObserver(reportSize);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [isEditing, node._id, node.text, onSizeChange]);

  useEffect(() => {
    if (!isEditing || !editRef.current) {
      return;
    }

    editRef.current.focus();
    editRef.current.setSelectionRange(editRef.current.value.length, editRef.current.value.length);
    resizeTextarea(editRef.current);
  }, [editValue, isEditing]);

  return (
    <article
      ref={cardRef}
      data-node-id={node._id}
      className={cn(
        "pointer-events-auto absolute z-20 max-w-72 rounded-[1.45rem] border bg-[rgb(21_28_44_/_0.92)] px-4 py-3 text-white shadow-[0_16px_45px_rgba(0,0,0,0.35)] backdrop-blur-sm",
        isEditing ? "cursor-text" : "cursor-grab active:cursor-grabbing",
        isConnectionSource
          ? "border-cyan-300/65 shadow-[0_0_0_1px_rgba(123,239,229,0.3),0_16px_45px_rgba(0,0,0,0.35)]"
          : labelStyle.borderClassName,
        isSelected && !isConnectionSource && "ring-2 ring-white/30 ring-offset-0",
        isConnectionTarget && "ring-2 ring-cyan-300/65 ring-offset-0",
        isFresh && "canvas-node-arrival",
        isDeleting && "opacity-60",
      )}
      style={{
        left: position.x,
        top: position.y,
        touchAction: isEditing ? "auto" : "none",
        ...animationStyle,
      }}
      onPointerDown={(event) => onPointerDown(node, event)}
      onClick={() => onSelect(node._id)}
      onDoubleClick={() => onDoubleClick(node)}
      onContextMenu={(event) => onContextMenu(node._id, event)}
    >
      <div className="mb-3 flex items-center gap-2">
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.22em]",
            labelStyle.badgeClassName,
          )}
        >
          {labelStyle.badgeLabel}
        </span>
      </div>
      {isEditing ? (
        <div onPointerDown={(event) => event.stopPropagation()}>
          <textarea
            ref={editRef}
            value={editValue}
            onChange={(event) => onEditChange(event.target.value)}
            onKeyDown={onEditKeyDown}
            className="min-h-16 w-full overflow-hidden bg-transparent pr-6 text-[15px] leading-6 text-white/92 outline-none"
            rows={1}
          />
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-white/55">
            <span>{editError ?? "Enter saves. Shift+Enter adds a line."}</span>
            <button
              type="button"
              onClick={onEditSubmit}
              disabled={isSavingEdit}
              className="rounded-full bg-white/10 px-3 py-1.5 font-medium text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingEdit ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <div className="pr-6 text-[15px] leading-6 whitespace-pre-wrap text-white/92">
          {node.text}
        </div>
      )}
      {!isEditing ? (
        <button
          type="button"
          className={cn(
            "absolute top-1/2 right-[-10px] flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border transition hover:scale-105",
            labelStyle.connectorClassName,
          )}
          onPointerDown={(event) => onConnectionPointerDown(node._id, event)}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Start a connection from ${node.text}`}
        >
          <span className="block h-2 w-2 rounded-full bg-current" />
        </button>
      ) : null}
    </article>
  );
}

function DateNodeCard({
  node,
  animationStyle,
  isEditing,
  editValue,
  editError,
  isDeleting,
  isSavingEdit,
  isSelected,
  onSelect,
  onDoubleClick,
  onDelete,
  onEditChange,
  onEditKeyDown,
  onEditSubmit,
}: {
  node: NodeDoc;
  animationStyle?: CSSProperties;
  isEditing: boolean;
  editValue: string;
  editError: string | null;
  isDeleting: boolean;
  isSavingEdit: boolean;
  isSelected: boolean;
  onSelect: (nodeId: Id<"nodes">) => void;
  onDoubleClick: (node: NodeDoc) => void;
  onDelete: () => void;
  onEditChange: (value: string) => void;
  onEditKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onEditSubmit: () => void;
}) {
  const editRef = useRef<HTMLTextAreaElement>(null);
  const label = getNodeLabel(node);
  const labelStyle = NODE_LABEL_STYLES[label];

  useEffect(() => {
    if (!isEditing || !editRef.current) {
      return;
    }

    editRef.current.focus();
    editRef.current.setSelectionRange(
      editRef.current.value.length,
      editRef.current.value.length,
    );
    resizeTextarea(editRef.current);
  }, [editValue, isEditing]);

  return (
    <article
      data-node-id={node._id}
      className={cn(
        "rounded-[1.45rem] border bg-[rgb(21_28_44_/_0.92)] px-4 py-3 text-white shadow-[0_16px_45px_rgba(0,0,0,0.35)] backdrop-blur-sm transition",
        labelStyle.borderClassName,
        isSelected && "ring-2 ring-white/30 ring-offset-0",
        isDeleting && "opacity-60",
      )}
      style={animationStyle}
      onClick={() => onSelect(node._id)}
      onDoubleClick={() => onDoubleClick(node)}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.22em]",
              labelStyle.badgeClassName,
            )}
          >
            {labelStyle.badgeLabel}
          </span>
          <span className="text-xs uppercase tracking-[0.18em] text-white/45">
            {DATE_TIME_FORMATTER.format(node.createdAt)}
          </span>
        </div>
        {!isEditing ? (
          <button
            type="button"
            className="rounded-full border border-red-300/18 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-red-100 transition hover:bg-red-500/12 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onDelete}
            disabled={isDeleting}
          >
            Delete
          </button>
        ) : null}
      </div>
      {isEditing ? (
        <div>
          <textarea
            ref={editRef}
            value={editValue}
            onChange={(event) => onEditChange(event.target.value)}
            onKeyDown={onEditKeyDown}
            className="min-h-16 w-full overflow-hidden bg-transparent text-[15px] leading-6 text-white/92 outline-none"
            rows={1}
          />
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-white/55">
            <span>{editError ?? "Enter saves. Shift+Enter adds a line."}</span>
            <button
              type="button"
              onClick={onEditSubmit}
              disabled={isSavingEdit}
              className="rounded-full bg-white/10 px-3 py-1.5 font-medium text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingEdit ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <div className="text-[15px] leading-6 whitespace-pre-wrap text-white/92">
          {node.text}
        </div>
      )}
    </article>
  );
}

function InlineTextCard({
  textareaRef,
  position,
  value,
  error,
  buttonLabel,
  disabled,
  placeholder,
  onChange,
  onKeyDown,
  onSubmit,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  position: Point;
  value: string;
  error: string | null;
  buttonLabel: string;
  disabled: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
}) {
  return (
    <div
      data-composer-card
      className="pointer-events-auto absolute z-20 w-72 rounded-[1.35rem] border border-white/12 bg-[rgb(19_24_38_/_0.96)] p-3 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur"
      style={{
        left: position.x,
        top: position.y,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="min-h-16 w-full overflow-hidden bg-transparent text-sm leading-6 text-white outline-none placeholder:text-white/35"
        rows={1}
      />
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-white/55">
        <span>{error ?? "Enter saves. Shift+Enter adds a line."}</span>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          className="rounded-full bg-white/10 px-3 py-1.5 font-medium text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

function ExtractorShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute top-6 right-6 z-20">
      <div
        className="relative w-[min(28rem,calc(100vw-3rem))]"
        style={{ height: EXTRACTOR_SHELL_HEIGHT }}
      >
        {children}
      </div>
    </div>
  );
}

function ExtractorPanel({
  isOpen,
  value,
  error,
  feedback,
  disabled,
  onOpen,
  onClose,
  onChange,
  onClear,
  onSubmit,
}: {
  isOpen: boolean;
  value: string;
  error: string | null;
  feedback: string | null;
  disabled: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (value: string) => void;
  onClear: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <div
        className={cn(
          "absolute top-0 right-0 flex h-14 w-14 origin-top-right items-center justify-center rounded-full border border-cyan-200/25 bg-[rgb(10_14_24_/_0.96)] text-cyan-100 shadow-[0_20px_55px_rgba(0,0,0,0.4)] backdrop-blur-md transition duration-300",
          isOpen
            ? "pointer-events-none scale-75 opacity-0"
            : "pointer-events-auto scale-100 opacity-100",
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          className="flex h-full w-full items-center justify-center rounded-full text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-100 transition hover:bg-cyan-300/10"
          aria-label="Open conversation extractor"
        >
          Extract
        </button>
      </div>

      <div
        className={cn(
          "absolute top-0 right-0 h-full w-full origin-top-right transition duration-300",
          isOpen
            ? "pointer-events-auto scale-100 opacity-100"
            : "pointer-events-none scale-[0.125] opacity-0",
        )}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex h-full flex-col rounded-[1.7rem] border border-white/12 bg-[rgb(10_14_24_/_0.92)] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.38)] backdrop-blur-md">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-cyan-100/70">
                Conversation Extractor
              </p>
              <h2 className="mt-2 text-lg leading-tight font-semibold text-white">
                Paste anything. Pull out the shape.
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClear}
                disabled={disabled || value.length === 0}
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:border-white/18 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-sm font-medium text-white/72 transition hover:border-white/20 hover:text-white"
                aria-label="Close conversation extractor"
              >
                X
              </button>
            </div>
          </div>

          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Paste a Claude conversation, voice note transcript, journal entry, or any other text."
            className="mt-4 min-h-0 flex-1 rounded-[1.35rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/35 focus:border-cyan-200/35"
          />

          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-sm leading-6 text-white/62">
              {error ??
                feedback ??
                "Aim for a few paragraphs or a full conversation. The import appends a source-organized cluster to your current canvas."}
            </p>
            <button
              type="button"
              onClick={onSubmit}
              disabled={disabled}
              className="shrink-0 rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:scale-[1.01] hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {disabled ? "Extracting..." : "Extract"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function MissingConvexState() {
  return (
    <main className="canvas-grid flex h-screen items-center justify-center px-6">
      <div className="max-w-xl rounded-[2rem] border border-white/12 bg-black/30 p-8 text-white shadow-[0_20px_80px_rgba(0,0,0,0.32)] backdrop-blur-sm">
        <p className="text-xs uppercase tracking-[0.32em] text-cyan-100/70">
          Convex Setup
        </p>
        <h1 className="mt-4 text-3xl leading-tight font-semibold">
          Connect a Convex deployment to make the canvas live.
        </h1>
        <p className="mt-4 text-base leading-7 text-white/70">
          Run <code className="rounded bg-white/8 px-1.5 py-0.5">npx convex dev</code>{" "}
          and keep it running so{" "}
          <code className="rounded bg-white/8 px-1.5 py-0.5">
            NEXT_PUBLIC_CONVEX_URL
          </code>{" "}
          stays available.
        </p>
      </div>
    </main>
  );
}

function getCanvasScreenPoint(
  clientX: number,
  clientY: number,
  canvas: HTMLDivElement | null,
) {
  if (!canvas) {
    return null;
  }

  const rect = canvas.getBoundingClientRect();

  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function screenToWorld(
  clientX: number,
  clientY: number,
  canvas: HTMLDivElement | null,
  viewport: ViewportState,
) {
  const screenPoint = getCanvasScreenPoint(clientX, clientY, canvas);

  if (!screenPoint) {
    return null;
  }

  return {
    x: viewport.origin.x + screenPoint.x / viewport.scale,
    y: viewport.origin.y + screenPoint.y / viewport.scale,
  };
}

function worldToScreen(point: Point, viewport: ViewportState) {
  return {
    x: (point.x - viewport.origin.x) * viewport.scale,
    y: (point.y - viewport.origin.y) * viewport.scale,
  };
}

function getVisibleWorldBounds(
  canvas: HTMLDivElement | null,
  viewport: ViewportState,
) {
  if (!canvas) {
    return null;
  }

  const rect = canvas.getBoundingClientRect();
  const margin = COMPOSER_MARGIN / viewport.scale;

  return {
    left: viewport.origin.x + margin,
    top: viewport.origin.y + margin,
    right: viewport.origin.x + rect.width / viewport.scale - margin,
    bottom: viewport.origin.y + rect.height / viewport.scale - margin,
  };
}

function getViewportCenterWorldPoint(
  canvas: HTMLDivElement | null,
  viewport: ViewportState,
) {
  if (!canvas) {
    return null;
  }

  const rect = canvas.getBoundingClientRect();

  return {
    x: viewport.origin.x + rect.width / viewport.scale / 2,
    y: viewport.origin.y + rect.height / viewport.scale / 2,
  };
}

function getWheelDeltaInPixels(
  event: WheelEvent<HTMLDivElement>,
  canvas: HTMLDivElement | null,
) {
  const pageSize = canvas?.clientHeight ?? 1;
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageSize : 1;

  return {
    x: event.deltaX * unit,
    y: event.deltaY * unit,
  };
}

function clampComposerPoint(
  point: Point,
  canvas: HTMLDivElement | null,
  viewport: ViewportState,
) {
  const bounds = getVisibleWorldBounds(canvas, viewport);

  if (!bounds) {
    return point;
  }

  return {
    x: clamp(point.x, bounds.left, bounds.right - COMPOSER_WIDTH),
    y: clamp(point.y, bounds.top, bounds.bottom - COMPOSER_HEIGHT),
  };
}

function clampContextMenuPoint(
  point: Point,
  canvas: HTMLDivElement | null,
  viewport: ViewportState,
) {
  const bounds = getVisibleWorldBounds(canvas, viewport);

  if (!bounds) {
    return point;
  }

  return {
    x: clamp(point.x, bounds.left, bounds.right - CONTEXT_MENU_WIDTH),
    y: clamp(point.y, bounds.top, bounds.bottom - 72),
  };
}

function getDropTargetNodeId(
  clientX: number,
  clientY: number,
  sourceId: Id<"nodes">,
) {
  const target = document.elementFromPoint(clientX, clientY);
  const nodeElement = target?.closest<HTMLElement>("[data-node-id]");
  const nodeId = nodeElement?.dataset.nodeId as Id<"nodes"> | undefined;

  if (!nodeId || nodeId === sourceId) {
    return null;
  }

  return nodeId;
}

function resizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = "0px";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function getNodePosition(
  node: NodeDoc,
  positionOverrides: Record<string, Point>,
) {
  return positionOverrides[node._id] ?? {
    x: node.x,
    y: node.y,
  };
}

function getNodeRect(
  node: NodeDoc,
  positionOverrides: Record<string, Point>,
  nodeSizes: Record<string, Size>,
) {
  const position = getNodePosition(node, positionOverrides);
  const size = nodeSizes[node._id] ?? FALLBACK_NODE_SIZE;

  return {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  };
}

function getConnectionPoints(
  connection: ConnectionDoc,
  nodes: NodeDoc[],
  positionOverrides: Record<string, Point>,
  nodeSizes: Record<string, Size>,
) {
  const fromNode = nodes.find((node) => node._id === connection.from);
  const toNode = nodes.find((node) => node._id === connection.to);

  if (!fromNode || !toNode) {
    return null;
  }

  const fromRect = getNodeRect(fromNode, positionOverrides, nodeSizes);
  const toRect = getNodeRect(toNode, positionOverrides, nodeSizes);
  const fromCenter = getRectCenter(fromRect);
  const toCenter = getRectCenter(toRect);

  return {
    start: getAnchorPoint(fromRect, toCenter),
    end: getAnchorPoint(toRect, fromCenter),
  };
}

function getPreviewStartPoint(
  nodeId: Id<"nodes">,
  nodes: NodeDoc[],
  positionOverrides: Record<string, Point>,
  nodeSizes: Record<string, Size>,
  targetPoint: Point,
) {
  const node = nodes.find((candidate) => candidate._id === nodeId);

  if (!node) {
    return targetPoint;
  }

  return getAnchorPoint(getNodeRect(node, positionOverrides, nodeSizes), targetPoint);
}

function getMoveGroupNodeIds(
  nodes: NodeDoc[],
  connections: ConnectionDoc[],
  rootNodeId: Id<"nodes">,
): Id<"nodes">[] {
  const rootNode = nodes.find((node) => node._id === rootNodeId);

  if (!rootNode || rootNode.label !== "source") {
    return [rootNodeId];
  }

  const nodeById = new Map(nodes.map((node) => [node._id, node] as const));
  const sourceNodeIds = new Set<Id<"nodes">>();
  const childIdsByParentId = new Map<Id<"nodes">, Id<"nodes">[]>();
  const adjacencyByNodeId = new Map<Id<"nodes">, Set<Id<"nodes">>>();

  for (const node of nodes) {
    adjacencyByNodeId.set(node._id, new Set());

    if (node.label !== "source") {
      continue;
    }

    sourceNodeIds.add(node._id);

    if (!node.sourceParentId || node.sourceParentId === node._id) {
      continue;
    }

    const childIds = childIdsByParentId.get(node.sourceParentId) ?? [];
    childIds.push(node._id);
    childIdsByParentId.set(node.sourceParentId, childIds);
  }

  for (const connection of connections) {
    adjacencyByNodeId.get(connection.from)?.add(connection.to);
    adjacencyByNodeId.get(connection.to)?.add(connection.from);
  }

  const subtreeNodeIds: Id<"nodes">[] = [];
  const stack: Id<"nodes">[] = [rootNodeId];
  const visited = new Set<Id<"nodes">>();

  while (stack.length > 0) {
    const nodeId = stack.pop();

    if (!nodeId || visited.has(nodeId) || !sourceNodeIds.has(nodeId)) {
      continue;
    }

    visited.add(nodeId);
    subtreeNodeIds.push(nodeId);

    const childIds = childIdsByParentId.get(nodeId) ?? [];

    for (let index = childIds.length - 1; index >= 0; index -= 1) {
      stack.push(childIds[index]);
    }
  }

  const moveGroupNodeIds = [...subtreeNodeIds];
  const moveGroupNodeIdSet = new Set(moveGroupNodeIds);
  const queue = [...subtreeNodeIds];

  const enqueueSourceBranch = (sourceNodeId: Id<"nodes">) => {
    const sourceQueue: Id<"nodes">[] = [sourceNodeId];

    while (sourceQueue.length > 0) {
      const currentSourceNodeId = sourceQueue.pop();

      if (
        !currentSourceNodeId ||
        moveGroupNodeIdSet.has(currentSourceNodeId) ||
        !sourceNodeIds.has(currentSourceNodeId)
      ) {
        continue;
      }

      moveGroupNodeIdSet.add(currentSourceNodeId);
      moveGroupNodeIds.push(currentSourceNodeId);
      queue.push(currentSourceNodeId);

      const childIds = childIdsByParentId.get(currentSourceNodeId) ?? [];

      for (let index = childIds.length - 1; index >= 0; index -= 1) {
        sourceQueue.push(childIds[index]);
      }
    }
  };

  while (queue.length > 0) {
    const nodeId = queue.shift();

    if (!nodeId) {
      continue;
    }

    for (const neighborId of adjacencyByNodeId.get(nodeId) ?? []) {
      if (moveGroupNodeIdSet.has(neighborId)) {
        continue;
      }

      const neighbor = nodeById.get(neighborId);

      if (!neighbor) {
        continue;
      }

      if (neighbor.label === "source") {
        enqueueSourceBranch(neighborId);
        continue;
      }

      moveGroupNodeIdSet.add(neighborId);
      moveGroupNodeIds.push(neighborId);
      queue.push(neighborId);
    }
  }

  return moveGroupNodeIds;
}

function getNodeLabel(node: Pick<NodeDoc, "label">): NodeLabel {
  return node.label ?? "note";
}

function getErrorMessage(payload: unknown) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return null;
}

function getDateGroups(nodes: NodeDoc[], todayKey: string): DateGroup[] {
  const groupsByKey = new Map<string, DateGroup>();

  for (const node of nodes) {
    const key = getLocalDateKey(node.createdAt);
    const dayStart = getLocalDayStart(node.createdAt);
    const existingGroup = groupsByKey.get(key);

    if (existingGroup) {
      existingGroup.nodes.push(node);
      continue;
    }

    groupsByKey.set(key, {
      key,
      dayStart,
      label: DATE_HEADING_FORMATTER.format(node.createdAt),
      isToday: key === todayKey,
      nodes: [node],
    });
  }

  return [...groupsByKey.values()]
    .sort((left, right) => right.dayStart - left.dayStart)
    .map((group) => ({
      ...group,
      nodes: [...group.nodes].sort((left, right) => right.createdAt - left.createdAt),
    }));
}

function getLocalDateKey(timestamp: number) {
  const date = new Date(timestamp);

  return [
    date.getFullYear(),
    `${date.getMonth() + 1}`.padStart(2, "0"),
    `${date.getDate()}`.padStart(2, "0"),
  ].join("-");
}

function getLocalDayStart(timestamp: number) {
  const date = new Date(timestamp);

  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function getStaggerStyle(index: number, stepMs: number): CSSProperties {
  const delay = Math.min(index, 16) * stepMs;

  return {
    animationName: "canvas-stagger-in",
    animationDuration: "480ms",
    animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
    animationFillMode: "both",
    animationDelay: `${delay}ms`,
    willChange: "transform, opacity",
  };
}

function createExtractionNodePlacements(
  nodes: ExtractedNode[],
  connections: ExtractedConnection[],
  canvas: HTMLDivElement | null,
  viewport: ViewportState,
) {
  const bounds = getVisibleWorldBounds(canvas, viewport);
  const center = bounds
    ? {
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2,
      }
    : {
        x: viewport.origin.x + 420,
        y: viewport.origin.y + 280,
      };
  const degreeByNodeId = new Map<string, number>();
  const adjacencyByNodeId = new Map<string, Set<string>>();
  const nodeById = new Map(nodes.map((node) => [node.clientId, node] as const));

  for (const node of nodes) {
    degreeByNodeId.set(node.clientId, 0);
    adjacencyByNodeId.set(node.clientId, new Set());
  }

  for (const connection of connections) {
    degreeByNodeId.set(
      connection.fromClientId,
      (degreeByNodeId.get(connection.fromClientId) ?? 0) + 1,
    );
    degreeByNodeId.set(
      connection.toClientId,
      (degreeByNodeId.get(connection.toClientId) ?? 0) + 1,
    );
    adjacencyByNodeId.get(connection.fromClientId)?.add(connection.toClientId);
    adjacencyByNodeId.get(connection.toClientId)?.add(connection.fromClientId);
  }

  const sortNodes = (left: ExtractedNode, right: ExtractedNode) => {
    const degreeDelta =
      (degreeByNodeId.get(right.clientId) ?? 0) -
      (degreeByNodeId.get(left.clientId) ?? 0);

    if (degreeDelta !== 0) {
      return degreeDelta;
    }

    return left.text.localeCompare(right.text);
  };
  const sourceNodes = nodes.filter((node) => node.label === "source");
  const validSourceParentById = new Map<string, string>();
  const sourceChildrenById = new Map<string, ExtractedNode[]>();

  for (const sourceNode of sourceNodes) {
    sourceChildrenById.set(sourceNode.clientId, []);
  }

  for (const sourceNode of sourceNodes) {
    const parentId = sourceNode.parentSourceClientId;
    const parentNode = parentId ? nodeById.get(parentId) : undefined;

    if (!parentId || parentId === sourceNode.clientId || parentNode?.label !== "source") {
      continue;
    }

    validSourceParentById.set(sourceNode.clientId, parentId);
    sourceChildrenById.get(parentId)?.push(sourceNode);
  }

  for (const childNodes of sourceChildrenById.values()) {
    childNodes.sort(sortNodes);
  }

  const sourceDepthCache = new Map<string, number>();
  const getSourceDepth = (nodeId: string, seen = new Set<string>()): number => {
    const cached = sourceDepthCache.get(nodeId);

    if (cached !== undefined) {
      return cached;
    }

    const parentId = validSourceParentById.get(nodeId);

    if (!parentId || seen.has(nodeId)) {
      sourceDepthCache.set(nodeId, 0);
      return 0;
    }

    seen.add(nodeId);
    const depth = getSourceDepth(parentId, seen) + 1;
    seen.delete(nodeId);
    sourceDepthCache.set(nodeId, depth);
    return depth;
  };
  const positionedById = new Map<string, Point>();
  const placedSourceIds = new Set<string>();
  const topLevelSources = sourceNodes
    .filter((node) => !validSourceParentById.has(node.clientId))
    .sort(sortNodes);

  const placeSourceBranch = (
    sourceNode: ExtractedNode,
    position: Point,
    lineage: Set<string>,
  ) => {
    positionedById.set(sourceNode.clientId, position);
    placedSourceIds.add(sourceNode.clientId);

    const childNodes = sourceChildrenById.get(sourceNode.clientId) ?? [];

    if (childNodes.length === 0) {
      return;
    }

    const baseAngle =
      position.x === center.x && position.y === center.y
        ? getStableAngle(sourceNode.clientId)
        : getPointAngle(center, position);
    const spread = childNodes.length === 1 ? 0 : Math.min(2.2, 0.7 + childNodes.length * 0.44);
    const radius = 190 + getSourceDepth(sourceNode.clientId) * 36;

    for (const [index, childNode] of childNodes.entries()) {
      if (lineage.has(childNode.clientId)) {
        continue;
      }

      const angle =
        childNodes.length === 1
          ? baseAngle
          : baseAngle - spread / 2 + (spread * index) / (childNodes.length - 1);
      const jitter = (getStableAngle(childNode.clientId) - Math.PI) * 0.08;
      const childPosition = {
        x: position.x + Math.cos(angle + jitter) * radius,
        y: position.y + Math.sin(angle + jitter) * radius * 0.82,
      };

      lineage.add(childNode.clientId);
      placeSourceBranch(childNode, childPosition, lineage);
      lineage.delete(childNode.clientId);
    }
  };

  const rootSources = topLevelSources.length > 0 ? topLevelSources : [...sourceNodes].sort(sortNodes);
  const sourceAnchorRadius =
    rootSources.length <= 1 ? 0 : 240 + Math.sqrt(rootSources.length) * 56;

  for (const [index, sourceNode] of rootSources.entries()) {
    if (placedSourceIds.has(sourceNode.clientId)) {
      continue;
    }

    const angle =
      rootSources.length === 1
        ? getStableAngle(sourceNode.clientId)
        : -Math.PI / 2 + (index * Math.PI * 2) / rootSources.length;
    const rootPosition = {
      x: center.x + Math.cos(angle) * sourceAnchorRadius,
      y: center.y + Math.sin(angle) * sourceAnchorRadius * 0.76,
    };

    placeSourceBranch(sourceNode, rootPosition, new Set([sourceNode.clientId]));
  }

  const anchoredNonSources = new Map<string, ExtractedNode[]>();
  const fallbackNodes: ExtractedNode[] = [];

  for (const node of nodes) {
    if (node.label === "source") {
      continue;
    }

    const sourceNeighbors = [...(adjacencyByNodeId.get(node.clientId) ?? [])]
      .map((neighborId) => nodeById.get(neighborId))
      .filter((neighbor): neighbor is ExtractedNode => neighbor?.label === "source");

    if (sourceNeighbors.length === 0) {
      fallbackNodes.push(node);
      continue;
    }

    sourceNeighbors.sort((left, right) => {
      const depthDelta = getSourceDepth(right.clientId) - getSourceDepth(left.clientId);

      if (depthDelta !== 0) {
        return depthDelta;
      }

      return sortNodes(left, right);
    });

    const anchorId = sourceNeighbors[0]?.clientId;

    if (!anchorId || !positionedById.has(anchorId)) {
      fallbackNodes.push(node);
      continue;
    }

    const anchoredNodes = anchoredNonSources.get(anchorId) ?? [];
    anchoredNodes.push(node);
    anchoredNonSources.set(anchorId, anchoredNodes);
  }

  for (const [anchorId, anchoredNodes] of anchoredNonSources) {
    anchoredNodes.sort(sortNodes);
    const anchorPosition = positionedById.get(anchorId);

    if (!anchorPosition) {
      fallbackNodes.push(...anchoredNodes);
      continue;
    }

    const baseAngle = getPointAngle(center, anchorPosition) + Math.PI / 2;

    for (const [index, node] of anchoredNodes.entries()) {
      const angle = baseAngle + index * (Math.PI * (3 - Math.sqrt(5)));
      const radius = 144 + Math.sqrt(index + 1) * 76;

      positionedById.set(node.clientId, {
        x: anchorPosition.x + Math.cos(angle) * radius,
        y: anchorPosition.y + Math.sin(angle) * radius * 0.84,
      });
    }
  }

  fallbackNodes.sort(sortNodes);

  const fallbackRadiusBase =
    sourceAnchorRadius + (sourceNodes.length > 0 ? 360 : 120);

  for (const [index, node] of fallbackNodes.entries()) {
    const angle = index * (Math.PI * (3 - Math.sqrt(5)));
    const radius = fallbackRadiusBase + Math.sqrt(index + 1) * 110;
    const jitterX = Math.sin(index * 1.37) * 18;
    const jitterY = Math.cos(index * 1.11) * 14;

    positionedById.set(node.clientId, {
      x: center.x + Math.cos(angle) * radius + jitterX,
      y: center.y + Math.sin(angle) * radius * 0.76 + jitterY,
    });
  }

  return nodes.map((node, index) => {
    const position = positionedById.get(node.clientId);

    if (position) {
      return {
        ...node,
        x: position.x,
        y: position.y,
      };
    }

    const angle = index * (Math.PI * (3 - Math.sqrt(5)));
    const radius = 36 + Math.sqrt(index + 1) * 138;

    return {
      ...node,
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius * 0.76,
    };
  });
}

function getPointAngle(origin: Point, target: Point) {
  return Math.atan2(target.y - origin.y, target.x - origin.x);
}

function getStableAngle(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return (hash / 0xffffffff) * Math.PI * 2;
}

function getRectCenter(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function getAnchorPoint(
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
  target: Point,
) {
  const center = getRectCenter(rect);
  const dx = target.x - center.x;
  const dy = target.y - center.y;

  if (dx === 0 && dy === 0) {
    return center;
  }

  const scale =
    1 / Math.max(Math.abs(dx) / (rect.width / 2), Math.abs(dy) / (rect.height / 2));

  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  };
}

function clamp(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}
