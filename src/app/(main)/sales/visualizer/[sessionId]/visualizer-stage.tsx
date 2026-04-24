"use client";

/**
 * Visualizer Konva 画布（仅客户端渲染，由 SessionEditor 动态导入）
 *
 * 坐标约定：
 * - 所有 region.points / productOption.transform 都以**原图像素**存储
 * - 画布按 imageScale 渲染，用户交互时把 canvas 坐标 / imageScale 还原成原图像素后上报
 *
 * 能力：
 * - 展示底图 + 现有 regions（半透明填充）
 * - 展示 selectedVariant 的 productOptions：按颜色/透明度填充对应 region，并支持 transformer
 * - 绘制模式：rect 拖拽 / polygon 点击成点 + 双击/Enter 完成
 * - 选中模式：点击 region（在没有 productOption 的情况下）或点击 productOption 以选中；Transformer 仅挂在 productOption 上
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import {
  Circle,
  Group,
  Image as KImage,
  Layer,
  Line,
  Rect,
  Stage,
  Transformer,
} from "react-konva";
import type {
  VisualizerProductOptionDetail,
  VisualizerProductOptionTransform,
  VisualizerRegionShape,
  VisualizerSourceImageSummary,
  VisualizerVariantSummary,
  VisualizerWindowRegionDetail,
} from "@/lib/visualizer/types";

export type VisualizerTool = "move" | "rect" | "polygon";

/**
 * 暴露给父组件的画布句柄
 *
 * 由父组件通过 onStageReady 注入一个 ref；句柄内部封装 Konva Stage 的 toDataURL，
 * 并在导出时按 "canvas 显示比例 → 原图像素"自动放大 pixelRatio，保证导出 PNG 还原
 * 原图分辨率（而不是被 canvas 容器尺寸压缩）。
 */
export interface VisualizerStageHandle {
  /**
   * 生成 PNG dataURL；若底图未就绪或 Konva Stage 尚未渲染，返回 null。
   * @param opts.pixelRatio 明确指定倍率；不传则根据原图/显示比例自适应（≥1）
   */
  toPngDataURL: (opts?: { pixelRatio?: number }) => string | null;
}

interface VisualizerStageProps {
  image: VisualizerSourceImageSummary;
  variant: VisualizerVariantSummary | null;
  tool: VisualizerTool;
  width: number;
  height: number;
  selectedRegionId: string | null;
  selectedProductOptionId: string | null;
  onSelectRegion: (id: string | null) => void;
  onSelectProductOption: (id: string | null) => void;
  /** region 绘制完成时，上报原图像素坐标 */
  onCreateRegion: (args: {
    shape: VisualizerRegionShape;
    points: Array<[number, number]>;
  }) => void;
  /** productOption 的 transform 改变时上报（原图像素） */
  onUpdateProductOptionTransform: (args: {
    id: string;
    transform: VisualizerProductOptionTransform;
  }) => void;
  /** 画布挂载后，向父组件暴露导出能力（父持有 ref 并赋值） */
  onStageReady?: (handle: VisualizerStageHandle | null) => void;
}

function useDomImage(src: string): HTMLImageElement | null {
  const [el, setEl] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) {
      setEl(null);
      return;
    }
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setEl(img);
    img.onerror = () => setEl(null);
    img.src = src;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);
  return el;
}

function rectBoundsFromPoints(points: Array<[number, number]>): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  if (points.length < 2) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  return { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin };
}

function clipForRegion(region: VisualizerWindowRegionDetail) {
  return (ctx: Konva.Context | { beginPath: () => void; rect: (x: number, y: number, w: number, h: number) => void; moveTo: (x: number, y: number) => void; lineTo: (x: number, y: number) => void; closePath: () => void }) => {
    ctx.beginPath();
    if (region.shape === "rect") {
      const b = rectBoundsFromPoints(region.points);
      ctx.rect(b.x, b.y, b.w, b.h);
    } else {
      const pts = region.points;
      if (pts.length === 0) return;
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.closePath();
    }
  };
}

export default function VisualizerStage(props: VisualizerStageProps) {
  const {
    image,
    variant,
    tool,
    width,
    height,
    selectedRegionId,
    selectedProductOptionId,
    onSelectRegion,
    onSelectProductOption,
    onCreateRegion,
    onUpdateProductOptionTransform,
    onStageReady,
  } = props;

  const domImage = useDomImage(image.fileUrl);
  const imgW = image.width ?? domImage?.naturalWidth ?? 0;
  const imgH = image.height ?? domImage?.naturalHeight ?? 0;

  const scale = useMemo(() => {
    if (!imgW || !imgH || !width || !height) return 1;
    return Math.min(width / imgW, height / imgH);
  }, [imgW, imgH, width, height]);

  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const overlayRefs = useRef<Record<string, Konva.Node | null>>({});

  // 向父组件暴露导出句柄（只要 image / scale 变化就重新构造，保证 pixelRatio 始终正确）
  useEffect(() => {
    if (!onStageReady) return;
    const handle: VisualizerStageHandle = {
      toPngDataURL: (opts) => {
        const stage = stageRef.current;
        if (!stage) return null;
        if (!domImage || !imgW || !imgH || !scale) return null;
        // 默认倍率：让导出画面回到原图像素。外部可覆盖。
        const pixelRatio = opts?.pixelRatio ?? Math.max(1, 1 / scale);
        // 导出时临时解挂 transformer，避免八个控制点被截进 PNG
        const tr = transformerRef.current;
        const prev = tr?.nodes() ?? [];
        tr?.nodes([]);
        tr?.getLayer()?.batchDraw();
        try {
          return stage.toDataURL({
            mimeType: "image/png",
            pixelRatio,
            // 只导出底图范围，不要把 stage 两边的黑色 padding 带进去
            x: 0,
            y: 0,
            width: imgW * scale,
            height: imgH * scale,
          });
        } finally {
          if (tr && prev.length > 0) {
            tr.nodes(prev);
            tr.getLayer()?.batchDraw();
          }
        }
      },
    };
    onStageReady(handle);
    return () => {
      onStageReady(null);
    };
  }, [onStageReady, domImage, imgW, imgH, scale]);

  // 挂接 transformer 到当前选中的 productOption
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    if (!selectedProductOptionId) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const node = overlayRefs.current[selectedProductOptionId];
    if (node) {
      tr.nodes([node]);
      tr.getLayer()?.batchDraw();
    } else {
      tr.nodes([]);
    }
  }, [selectedProductOptionId, variant]);

  // ================= 绘制状态 =================
  const [rectStart, setRectStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [rectCurrent, setRectCurrent] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [polyPoints, setPolyPoints] = useState<Array<[number, number]>>([]);
  const [polyHover, setPolyHover] = useState<[number, number] | null>(null);

  // 工具切换时，重置进行中的草图
  useEffect(() => {
    setRectStart(null);
    setRectCurrent(null);
    setPolyPoints([]);
    setPolyHover(null);
  }, [tool, image.id]);

  const stagePointToImage = (px: number, py: number): [number, number] => {
    if (!scale) return [0, 0];
    return [px / scale, py / scale];
  };

  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === "move") {
      // 点击空白处取消选中
      if (e.target === e.target.getStage()) {
        onSelectRegion(null);
        onSelectProductOption(null);
      }
      return;
    }
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    const [ix, iy] = stagePointToImage(pos.x, pos.y);
    if (tool === "rect") {
      setRectStart({ x: ix, y: iy });
      setRectCurrent({ x: ix, y: iy });
    } else if (tool === "polygon") {
      setPolyPoints((prev) => [...prev, [ix, iy]]);
    }
  };

  const handleStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    const [ix, iy] = stagePointToImage(pos.x, pos.y);
    if (tool === "rect" && rectStart) {
      setRectCurrent({ x: ix, y: iy });
    } else if (tool === "polygon" && polyPoints.length > 0) {
      setPolyHover([ix, iy]);
    }
  };

  const handleStageMouseUp = () => {
    if (tool === "rect" && rectStart && rectCurrent) {
      const dx = Math.abs(rectStart.x - rectCurrent.x);
      const dy = Math.abs(rectStart.y - rectCurrent.y);
      if (dx > 6 && dy > 6) {
        onCreateRegion({
          shape: "rect",
          points: [
            [rectStart.x, rectStart.y],
            [rectCurrent.x, rectCurrent.y],
          ],
        });
      }
      setRectStart(null);
      setRectCurrent(null);
    }
  };

  const handleStageDblClick = () => {
    if (tool === "polygon" && polyPoints.length >= 3) {
      onCreateRegion({ shape: "polygon", points: polyPoints });
      setPolyPoints([]);
      setPolyHover(null);
    }
  };

  // Enter 完成 polygon（键盘监听仅在 polygon 工具激活时）
  useEffect(() => {
    if (tool !== "polygon") return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" && polyPoints.length >= 3) {
        onCreateRegion({ shape: "polygon", points: polyPoints });
        setPolyPoints([]);
        setPolyHover(null);
      }
      if (ev.key === "Escape") {
        setPolyPoints([]);
        setPolyHover(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, polyPoints, onCreateRegion]);

  // ================= 渲染 =================
  const scaledImgW = imgW * scale;
  const scaledImgH = imgH * scale;

  // 当前 variant 的 productOption 根据 region 分组
  const optionsByRegion = useMemo(() => {
    const map: Record<string, VisualizerProductOptionDetail> = {};
    if (!variant) return map;
    for (const po of variant.productOptions) {
      map[po.regionId] = po;
    }
    return map;
  }, [variant]);

  const stageCursor =
    tool === "move" ? "default" : tool === "rect" ? "crosshair" : "crosshair";

  return (
    <div style={{ position: "relative", width, height }}>
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onDblClick={handleStageDblClick}
        style={{ cursor: stageCursor, background: "#0b0d10" }}
      >
        {/* Layer 1: 底图 */}
        <Layer listening={false}>
          {domImage && imgW > 0 && imgH > 0 && (
            <KImage
              image={domImage}
              x={0}
              y={0}
              width={scaledImgW}
              height={scaledImgH}
            />
          )}
        </Layer>

        {/* Layer 2: regions + overlays */}
        <Layer>
          <Group scaleX={scale} scaleY={scale}>
            {image.regions.map((region) => {
              const hasOverlay = Boolean(optionsByRegion[region.id]);
              const isSelectedRegion = selectedRegionId === region.id;
              // region 轮廓
              const outline =
                region.shape === "rect"
                  ? (() => {
                      const b = rectBoundsFromPoints(region.points);
                      return (
                        <Rect
                          key={region.id}
                          x={b.x}
                          y={b.y}
                          width={b.w}
                          height={b.h}
                          stroke={isSelectedRegion ? "#60a5fa" : "#93c5fd"}
                          strokeWidth={isSelectedRegion ? 3 / scale : 2 / scale}
                          fill={hasOverlay ? undefined : "rgba(147,197,253,0.12)"}
                          dash={[8 / scale, 6 / scale]}
                          onClick={() => {
                            if (tool === "move") onSelectRegion(region.id);
                          }}
                          onTap={() => {
                            if (tool === "move") onSelectRegion(region.id);
                          }}
                        />
                      );
                    })()
                  : (
                      <Line
                        key={region.id}
                        points={region.points.flat()}
                        closed
                        stroke={isSelectedRegion ? "#60a5fa" : "#93c5fd"}
                        strokeWidth={isSelectedRegion ? 3 / scale : 2 / scale}
                        fill={hasOverlay ? undefined : "rgba(147,197,253,0.12)"}
                        dash={[8 / scale, 6 / scale]}
                        onClick={() => {
                          if (tool === "move") onSelectRegion(region.id);
                        }}
                        onTap={() => {
                          if (tool === "move") onSelectRegion(region.id);
                        }}
                      />
                    );

              return outline;
            })}

            {/* productOption overlays（仅当有 selectedVariant）*/}
            {image.regions.map((region) => {
              const po = optionsByRegion[region.id];
              if (!po) return null;
              const bounds = rectBoundsFromPoints(region.points);
              if (bounds.w === 0 || bounds.h === 0) return null;

              const transform: VisualizerProductOptionTransform = po.transform ?? {
                offsetX: 0,
                offsetY: 0,
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
              };

              const isSelectedPO = selectedProductOptionId === po.id;

              return (
                <Group
                  key={po.id}
                  clipFunc={clipForRegion(region)}
                  listening
                >
                  <Rect
                    ref={(node) => {
                      overlayRefs.current[po.id] = node;
                    }}
                    x={bounds.x + transform.offsetX}
                    y={bounds.y + transform.offsetY}
                    width={bounds.w}
                    height={bounds.h}
                    fill={po.colorHex ?? "#888888"}
                    opacity={po.opacity}
                    scaleX={transform.scaleX}
                    scaleY={transform.scaleY}
                    rotation={transform.rotation}
                    stroke={isSelectedPO ? "#fbbf24" : undefined}
                    strokeWidth={isSelectedPO ? 2 / scale : 0}
                    draggable={tool === "move"}
                    onClick={() => {
                      if (tool === "move") {
                        onSelectProductOption(po.id);
                        onSelectRegion(region.id);
                      }
                    }}
                    onTap={() => {
                      if (tool === "move") {
                        onSelectProductOption(po.id);
                        onSelectRegion(region.id);
                      }
                    }}
                    onDragEnd={(e) => {
                      const node = e.target;
                      const newOffsetX = node.x() - bounds.x;
                      const newOffsetY = node.y() - bounds.y;
                      onUpdateProductOptionTransform({
                        id: po.id,
                        transform: {
                          ...transform,
                          offsetX: newOffsetX,
                          offsetY: newOffsetY,
                        },
                      });
                    }}
                    onTransformEnd={(e) => {
                      const node = e.target;
                      const newOffsetX = node.x() - bounds.x;
                      const newOffsetY = node.y() - bounds.y;
                      onUpdateProductOptionTransform({
                        id: po.id,
                        transform: {
                          offsetX: newOffsetX,
                          offsetY: newOffsetY,
                          scaleX: node.scaleX(),
                          scaleY: node.scaleY(),
                          rotation: node.rotation(),
                        },
                      });
                    }}
                  />
                </Group>
              );
            })}

            {/* 绘制中的 rect 草图 */}
            {tool === "rect" && rectStart && rectCurrent && (
              <Rect
                x={Math.min(rectStart.x, rectCurrent.x)}
                y={Math.min(rectStart.y, rectCurrent.y)}
                width={Math.abs(rectStart.x - rectCurrent.x)}
                height={Math.abs(rectStart.y - rectCurrent.y)}
                stroke="#f59e0b"
                strokeWidth={2 / scale}
                dash={[6 / scale, 4 / scale]}
                listening={false}
              />
            )}

            {/* 绘制中的 polygon 草图 */}
            {tool === "polygon" && polyPoints.length > 0 && (
              <>
                <Line
                  points={(polyHover
                    ? [...polyPoints, polyHover]
                    : polyPoints
                  ).flat()}
                  stroke="#f59e0b"
                  strokeWidth={2 / scale}
                  dash={[6 / scale, 4 / scale]}
                  listening={false}
                />
                {polyPoints.map((p, idx) => (
                  <Circle
                    key={idx}
                    x={p[0]}
                    y={p[1]}
                    radius={4 / scale}
                    fill="#f59e0b"
                    listening={false}
                  />
                ))}
              </>
            )}
          </Group>

          {/* Transformer 放在 unscaled layer 上，对 overlay 节点引用直接生效 */}
          <Transformer
            ref={transformerRef}
            rotateEnabled
            borderStroke="#fbbf24"
            anchorStroke="#fbbf24"
            anchorFill="#fffbeb"
            anchorSize={8}
            ignoreStroke
          />
        </Layer>
      </Stage>

      {/* 底部提示 */}
      {tool === "polygon" && (
        <div className="pointer-events-none absolute left-2 bottom-2 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white">
          {polyPoints.length === 0
            ? "点击画布开始标记多边形"
            : `已标 ${polyPoints.length} 个点，双击或按 Enter 完成，Esc 取消`}
        </div>
      )}
      {tool === "rect" && (
        <div className="pointer-events-none absolute left-2 bottom-2 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white">
          按住鼠标拖拽画出矩形窗户区域
        </div>
      )}
    </div>
  );
}
