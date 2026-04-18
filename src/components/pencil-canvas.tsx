"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  Pencil,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  Download,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Point {
  x: number;
  y: number;
  pressure: number;
}

interface Stroke {
  points: Point[];
  color: string;
  lineWidth: number;
  tool: "pen" | "eraser";
}

export interface PencilCanvasRef {
  toBlob: () => Promise<Blob | null>;
  toDataURL: () => string;
  clear: () => void;
  isEmpty: () => boolean;
}

interface PencilCanvasProps {
  width?: number;
  height?: number;
  className?: string;
  label?: string;
  /** 每次笔画数量变化时回调，父组件可用于判定"是否已签名" */
  onStrokesChange?: (strokeCount: number) => void;
}

const COLORS = [
  { name: "黑色", value: "#1a2420" },
  { name: "红色", value: "#c43030" },
  { name: "蓝色", value: "#2b6055" },
];

const LINE_WIDTHS = [2, 4, 6];

export const PencilCanvas = forwardRef<PencilCanvasRef, PencilCanvasProps>(
  function PencilCanvas(
    { width = 800, height = 400, className, label, onStrokesChange },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [tool, setTool] = useState<"pen" | "eraser" | "line">("pen");
    const [color, setColor] = useState(COLORS[0].value);
    const [lineWidth, setLineWidth] = useState(LINE_WIDTHS[1]);
    const [isDrawing, setIsDrawing] = useState(false);
    const [strokes, setStrokes] = useState<Stroke[]>([]);
    const [redoStack, setRedoStack] = useState<Stroke[]>([]);
    const currentStroke = useRef<Stroke | null>(null);
    const lineStart = useRef<Point | null>(null);

    const getCtx = useCallback(() => {
      return canvasRef.current?.getContext("2d") ?? null;
    }, []);

    const redrawAll = useCallback(
      (strokeList: Stroke[]) => {
        const ctx = getCtx();
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);

        for (const s of strokeList) {
          // 防御：任何 null/缺字段的坏元素直接跳过，避免整个签名板崩溃
          if (!s || !Array.isArray(s.points) || s.points.length < 2) continue;
          ctx.beginPath();
          ctx.strokeStyle = s.tool === "eraser" ? "#faf8f4" : s.color;
          ctx.lineWidth = s.tool === "eraser" ? s.lineWidth * 4 : s.lineWidth;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";

          if (s.points.length === 2 && s.tool !== "eraser") {
            ctx.moveTo(s.points[0].x, s.points[0].y);
            ctx.lineTo(s.points[1].x, s.points[1].y);
          } else {
            ctx.moveTo(s.points[0].x, s.points[0].y);
            for (let i = 1; i < s.points.length; i++) {
              const p = s.points[i];
              const pressureFactor = 0.5 + p.pressure * 1.5;
              ctx.lineWidth = s.lineWidth * pressureFactor;
              ctx.lineTo(p.x, p.y);
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(p.x, p.y);
            }
          }
          ctx.stroke();
        }
      },
      [getCtx, width, height]
    );

    useEffect(() => {
      redrawAll(strokes);
    }, [strokes, redrawAll]);

    useEffect(() => {
      onStrokesChange?.(strokes.length);
    }, [strokes.length, onStrokesChange]);

    const getCoords = useCallback(
      (e: React.PointerEvent): Point => {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        const scaleX = width / rect.width;
        const scaleY = height / rect.height;
        return {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top) * scaleY,
          pressure: e.pressure || 0.5,
        };
      },
      [width, height]
    );

    const handlePointerDown = useCallback(
      (e: React.PointerEvent) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const pt = getCoords(e);
        setIsDrawing(true);

        if (tool === "line") {
          lineStart.current = pt;
          return;
        }

        currentStroke.current = {
          points: [pt],
          color,
          lineWidth,
          tool: tool === "eraser" ? "eraser" : "pen",
        };
      },
      [getCoords, tool, color, lineWidth]
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent) => {
        if (!isDrawing) return;
        e.preventDefault();
        const pt = getCoords(e);

        if (tool === "line" && lineStart.current) {
          redrawAll(strokes);
          const ctx = getCtx();
          if (ctx) {
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = "round";
            ctx.moveTo(lineStart.current.x, lineStart.current.y);
            ctx.lineTo(pt.x, pt.y);
            ctx.stroke();
          }
          return;
        }

        if (!currentStroke.current) return;
        currentStroke.current.points.push(pt);

        const ctx = getCtx();
        if (!ctx) return;
        const pts = currentStroke.current.points;
        if (pts.length < 2) return;
        const p0 = pts[pts.length - 2];
        const p1 = pts[pts.length - 1];
        const pressureFactor = 0.5 + p1.pressure * 1.5;
        ctx.beginPath();
        ctx.strokeStyle = currentStroke.current.tool === "eraser" ? "#faf8f4" : currentStroke.current.color;
        ctx.lineWidth = (currentStroke.current.tool === "eraser" ? lineWidth * 4 : lineWidth) * pressureFactor;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      },
      [isDrawing, getCoords, tool, strokes, redrawAll, getCtx, color, lineWidth]
    );

    const handlePointerUp = useCallback(
      (e: React.PointerEvent) => {
        if (!isDrawing) return;
        setIsDrawing(false);

        if (tool === "line" && lineStart.current) {
          const pt = getCoords(e);
          const stroke: Stroke = {
            points: [lineStart.current, pt],
            color,
            lineWidth,
            tool: "pen",
          };
          setStrokes((prev) => [...prev, stroke]);
          setRedoStack([]);
          lineStart.current = null;
          return;
        }

        // 关键修复：把 stroke 从 ref 里提出来保存到局部常量
        // 否则 React 延迟执行 updater 时 ref 已被清空为 null，导致 strokes 数组中混入 null，
        // 下次 redrawAll 遍历读 s.points 就会崩溃（"Cannot read properties of null (reading 'points')"）
        const finishedStroke = currentStroke.current;
        currentStroke.current = null;
        if (finishedStroke && finishedStroke.points.length > 1) {
          setStrokes((prev) => [...prev, finishedStroke]);
          setRedoStack([]);
        }
      },
      [isDrawing, tool, getCoords, color, lineWidth]
    );

    const undo = useCallback(() => {
      setStrokes((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last) setRedoStack((r) => [...r, last]);
        return prev.slice(0, -1);
      });
    }, []);

    const redo = useCallback(() => {
      setRedoStack((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (last) setStrokes((s) => [...s, last]);
        return prev.slice(0, -1);
      });
    }, []);

    const clearCanvas = useCallback(() => {
      setStrokes([]);
      setRedoStack([]);
      const ctx = getCtx();
      if (ctx) ctx.clearRect(0, 0, width, height);
    }, [getCtx, width, height]);

    useImperativeHandle(ref, () => ({
      toBlob: () =>
        new Promise((resolve) => {
          canvasRef.current?.toBlob((blob) => resolve(blob), "image/png");
        }),
      toDataURL: () => canvasRef.current?.toDataURL("image/png") ?? "",
      clear: clearCanvas,
      isEmpty: () => strokes.length === 0,
    }));

    const handleExport = useCallback(() => {
      const url = canvasRef.current?.toDataURL("image/png");
      if (!url) return;
      const a = document.createElement("a");
      a.download = `sketch-${Date.now()}.png`;
      a.href = url;
      a.click();
    }, []);

    return (
      <div className={cn("space-y-2", className)}>
        {label && (
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-white/80 px-2 py-1.5">
          {/* Tools */}
          <button
            onClick={() => setTool("pen")}
            className={cn(
              "rounded-md p-2 transition-colors",
              tool === "pen" ? "bg-foreground text-white" : "hover:bg-muted/20"
            )}
            title="画笔"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => setTool("line")}
            className={cn(
              "rounded-md p-2 transition-colors",
              tool === "line" ? "bg-foreground text-white" : "hover:bg-muted/20"
            )}
            title="直线"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            onClick={() => setTool("eraser")}
            className={cn(
              "rounded-md p-2 transition-colors",
              tool === "eraser" ? "bg-foreground text-white" : "hover:bg-muted/20"
            )}
            title="橡皮擦"
          >
            <Eraser className="h-4 w-4" />
          </button>

          <div className="mx-1 h-5 w-px bg-border" />

          {/* Colors */}
          {COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => setColor(c.value)}
              className={cn(
                "h-6 w-6 rounded-full border-2 transition-transform",
                color === c.value
                  ? "border-foreground scale-110"
                  : "border-transparent hover:scale-105"
              )}
              style={{ backgroundColor: c.value }}
              title={c.name}
            />
          ))}

          <div className="mx-1 h-5 w-px bg-border" />

          {/* Line widths */}
          {LINE_WIDTHS.map((w) => (
            <button
              key={w}
              onClick={() => setLineWidth(w)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                lineWidth === w ? "bg-muted/30" : "hover:bg-muted/10"
              )}
              title={`${w}px`}
            >
              <span
                className="rounded-full bg-foreground"
                style={{ width: w + 2, height: w + 2 }}
              />
            </button>
          ))}

          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={undo}
              disabled={strokes.length === 0}
              className="rounded-md p-2 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              title="撤销"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              onClick={redo}
              disabled={redoStack.length === 0}
              className="rounded-md p-2 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              title="重做"
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              onClick={clearCanvas}
              className="rounded-md p-2 text-muted-foreground hover:text-red-500 transition-colors"
              title="清空"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              onClick={handleExport}
              className="rounded-md p-2 text-muted-foreground hover:text-foreground transition-colors"
              title="导出 PNG"
            >
              <Download className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div className="overflow-hidden rounded-lg border border-border bg-[#faf8f4]">
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="w-full cursor-crosshair"
            style={{ touchAction: "none", aspectRatio: `${width}/${height}` }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        </div>
      </div>
    );
  }
);
