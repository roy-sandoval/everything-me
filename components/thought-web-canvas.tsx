"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const COMPOSER_WIDTH = 288;
const COMPOSER_HEIGHT = 132;
const COMPOSER_MARGIN = 16;
const FALLBACK_NODE_SIZE = { width: 224, height: 96 };
const CONTEXT_MENU_WIDTH = 168;

type NodeDoc = Doc<"nodes">;
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
  nodeId: Id<"nodes">;
  pointerId: number;
  startPointer: Point;
  startPosition: Point;
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

type ContextMenuState = Point & {
  nodeId: Id<"nodes">;
};

export function ThoughtWebCanvas() {
  if (!convexUrl) {
    return <MissingConvexState />;
  }

  return <ConnectedThoughtWebCanvas />;
}

function ConnectedThoughtWebCanvas() {
  const canvas = useQuery(api.graph.getCanvas);
  const createNode = useMutation(api.graph.createNode);
  const moveNode = useMutation(api.graph.moveNode);
  const updateNode = useMutation(api.graph.updateNode);
  const deleteNode = useMutation(api.graph.deleteNode);
  const createConnection = useMutation(api.graph.createConnection);

  const canvasRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const skipCanvasClickRef = useRef(false);
  const dragStateRef = useRef<DragState | null>(null);
  const connectionStateRef = useRef<ConnectionState | null>(null);
  const positionOverridesRef = useRef<Record<string, Point>>({});

  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isCreatingNode, setIsCreatingNode] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isDeletingNode, setIsDeletingNode] = useState<Id<"nodes"> | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState | null>(
    null,
  );
  const [editState, setEditState] = useState<EditState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [positionOverrides, setPositionOverrides] = useState<
    Record<string, Point>
  >({});
  const [nodeSizes, setNodeSizes] = useState<Record<string, Size>>({});

  const nodes = canvas?.nodes ?? [];
  const connections = canvas?.connections ?? [];

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  useEffect(() => {
    positionOverridesRef.current = positionOverrides;
  }, [positionOverrides]);

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
      contextMenu &&
      !canvas.nodes.some((node) => node._id === contextMenu.nodeId)
    ) {
      setContextMenu(null);
    }
  }, [canvas, contextMenu, editState]);

  useEffect(() => {
    if (!composerRef.current) {
      return;
    }

    composerRef.current.focus();
    resizeTextarea(composerRef.current);
  }, [composer]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const activeDrag = dragStateRef.current;
      const activeConnection = connectionStateRef.current;

      if (activeDrag && event.pointerId === activeDrag.pointerId) {
        const nextPosition = {
          x: activeDrag.startPosition.x + (event.clientX - activeDrag.startPointer.x),
          y: activeDrag.startPosition.y + (event.clientY - activeDrag.startPointer.y),
        };
        const moved =
          activeDrag.moved ||
          Math.abs(nextPosition.x - activeDrag.startPosition.x) > 2 ||
          Math.abs(nextPosition.y - activeDrag.startPosition.y) > 2;

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
        setPositionOverrides((currentOverrides) => ({
          ...currentOverrides,
          [activeDrag.nodeId]: nextPosition,
        }));
        return;
      }

      if (activeConnection && event.pointerId === activeConnection.pointerId) {
        const nextPointer = getCanvasPoint(event.clientX, event.clientY, canvasRef.current);

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
          positionOverridesRef.current[activeDrag.nodeId] ?? activeDrag.startPosition;

        setDragState(null);

        if (!activeDrag.moved) {
          setPositionOverrides((currentOverrides) => {
            const nextOverrides = { ...currentOverrides };
            delete nextOverrides[activeDrag.nodeId];
            return nextOverrides;
          });
          return;
        }

        void moveNode({
          nodeId: activeDrag.nodeId,
          x: finalPosition.x,
          y: finalPosition.y,
        }).catch((error: unknown) => {
          setSaveError(
            error instanceof Error ? error.message : "Could not move that node.",
          );
          setPositionOverrides((currentOverrides) => {
            const nextOverrides = { ...currentOverrides };
            delete nextOverrides[activeDrag.nodeId];
            return nextOverrides;
          });
        });

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

  async function handleDeleteNode(nodeId: Id<"nodes">) {
    if (isDeletingNode === nodeId) {
      return;
    }

    setIsDeletingNode(nodeId);
    setSaveError(null);
    setContextMenu(null);
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

  function handleCanvasClick(event: ReactPointerEvent<HTMLDivElement>) {
    setContextMenu(null);

    if (skipCanvasClickRef.current) {
      skipCanvasClickRef.current = false;
      return;
    }

    if (event.target !== event.currentTarget) {
      return;
    }

    const nextPoint = getCanvasPoint(event.clientX, event.clientY, canvasRef.current);

    if (!nextPoint) {
      return;
    }

    setEditState(null);
    setSaveError(null);
    setComposer({
      ...clampComposerPoint(nextPoint, canvasRef.current),
      text: "",
      error: null,
    });
  }

  function handleCanvasContextMenu(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      event.preventDefault();
      setContextMenu(null);
    }
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

    const currentPosition = getNodePosition(node, positionOverrides);

    setDragState({
      nodeId: node._id,
      pointerId: event.pointerId,
      startPointer: { x: event.clientX, y: event.clientY },
      startPosition: currentPosition,
      moved: false,
    });
    setPositionOverrides((currentOverrides) => ({
      ...currentOverrides,
      [node._id]: currentPosition,
    }));
  }

  function handleConnectionPointerDown(
    nodeId: Id<"nodes">,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (event.button !== 0 || editState?.nodeId === nodeId) {
      return;
    }

    const nextPoint = getCanvasPoint(event.clientX, event.clientY, canvasRef.current);

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
    setSaveError(null);
    setEditState({
      nodeId: node._id,
      text: node.text,
      error: null,
    });
  }

  function handleNodeContextMenu(
    nodeId: Id<"nodes">,
    event: ReactPointerEvent<HTMLElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    skipCanvasClickRef.current = true;
    setComposer(null);
    setConnectionState(null);
    setSaveError(null);
    const nextPoint = clampContextMenuPoint(
      getCanvasPoint(event.clientX, event.clientY, canvasRef.current) ?? {
        x: 0,
        y: 0,
      },
      canvasRef.current,
    );

    setContextMenu({
      nodeId,
      ...nextPoint,
    });
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

  const previewStartPoint = connectionState
    ? getPreviewStartPoint(
        connectionState.fromId,
        nodes,
        positionOverrides,
        nodeSizes,
        connectionState.pointer,
      )
    : null;

  return (
    <main
      ref={canvasRef}
      className="canvas-grid relative h-screen overflow-hidden"
      onClick={handleCanvasClick}
      onContextMenu={handleCanvasContextMenu}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
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

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-6 pt-6">
        <div className="rounded-full border border-white/10 bg-black/25 px-4 py-2 text-xs uppercase tracking-[0.28em] text-white/70 backdrop-blur-sm">
          Click to make a node. Double-click to edit. Right-click to delete.
        </div>
      </div>

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

      {nodes.map((node) => (
        <NodeCard
          key={node._id}
          node={node}
          position={getNodePosition(node, positionOverrides)}
          isConnectionSource={connectionState?.fromId === node._id}
          isConnectionTarget={connectionState?.hoverId === node._id}
          isEditing={editState?.nodeId === node._id}
          editValue={editState?.nodeId === node._id ? editState.text : ""}
          editError={editState?.nodeId === node._id ? editState.error : null}
          isDeleting={isDeletingNode === node._id}
          isSavingEdit={isSavingEdit && editState?.nodeId === node._id}
          onPointerDown={handleNodePointerDown}
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
          className="absolute z-40 rounded-2xl border border-white/12 bg-[rgb(11_16_26_/_0.97)] p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.4)] backdrop-blur"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            width: CONTEXT_MENU_WIDTH,
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
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
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-0 left-0 z-10 px-6 pb-6">
        <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/70 backdrop-blur-sm">
          {saveError ??
            (canvas
              ? `${nodes.length} nodes, ${connections.length} connections`
              : "Loading your canvas...")}
        </div>
      </div>
    </main>
  );
}

function NodeCard({
  node,
  position,
  isConnectionSource,
  isConnectionTarget,
  isEditing,
  editValue,
  editError,
  isDeleting,
  isSavingEdit,
  onPointerDown,
  onDoubleClick,
  onContextMenu,
  onConnectionPointerDown,
  onSizeChange,
  onEditChange,
  onEditKeyDown,
  onEditSubmit,
}: {
  node: NodeDoc;
  position: Point;
  isConnectionSource: boolean;
  isConnectionTarget: boolean;
  isEditing: boolean;
  editValue: string;
  editError: string | null;
  isDeleting: boolean;
  isSavingEdit: boolean;
  onPointerDown: (node: NodeDoc, event: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick: (node: NodeDoc) => void;
  onContextMenu: (
    nodeId: Id<"nodes">,
    event: ReactPointerEvent<HTMLElement>,
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
        "absolute z-20 max-w-72 rounded-[1.45rem] border bg-[rgb(21_28_44_/_0.92)] px-4 py-3 text-white shadow-[0_16px_45px_rgba(0,0,0,0.35)] backdrop-blur-sm",
        isEditing ? "cursor-text" : "cursor-grab active:cursor-grabbing",
        isConnectionSource
          ? "border-cyan-300/65 shadow-[0_0_0_1px_rgba(123,239,229,0.3),0_16px_45px_rgba(0,0,0,0.35)]"
          : "border-white/12",
        isConnectionTarget && "ring-2 ring-cyan-300/65 ring-offset-0",
        isDeleting && "opacity-60",
      )}
      style={{
        left: position.x,
        top: position.y,
        touchAction: isEditing ? "auto" : "none",
      }}
      onPointerDown={(event) => onPointerDown(node, event)}
      onDoubleClick={() => onDoubleClick(node)}
      onContextMenu={(event) => onContextMenu(node._id, event)}
    >
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
          className="absolute top-1/2 right-[-10px] flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-cyan-200/60 bg-cyan-300/15 text-cyan-100 transition hover:scale-105 hover:bg-cyan-300/25"
          onPointerDown={(event) => onConnectionPointerDown(node._id, event)}
          aria-label={`Start a connection from ${node.text}`}
        >
          <span className="block h-2 w-2 rounded-full bg-current" />
        </button>
      ) : null}
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
      className="absolute z-20 w-72 rounded-[1.35rem] border border-white/12 bg-[rgb(19_24_38_/_0.96)] p-3 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur"
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

function getCanvasPoint(
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

function clampComposerPoint(point: Point, canvas: HTMLDivElement | null) {
  if (!canvas) {
    return point;
  }

  const rect = canvas.getBoundingClientRect();

  return {
    x: clamp(point.x, COMPOSER_MARGIN, rect.width - COMPOSER_WIDTH - COMPOSER_MARGIN),
    y: clamp(
      point.y,
      COMPOSER_MARGIN,
      rect.height - COMPOSER_HEIGHT - COMPOSER_MARGIN,
    ),
  };
}

function clampContextMenuPoint(point: Point, canvas: HTMLDivElement | null) {
  if (!canvas) {
    return point;
  }

  const rect = canvas.getBoundingClientRect();

  return {
    x: clamp(point.x, COMPOSER_MARGIN, rect.width - CONTEXT_MENU_WIDTH - COMPOSER_MARGIN),
    y: clamp(point.y, COMPOSER_MARGIN, rect.height - 72),
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
