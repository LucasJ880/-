"use client";

import { useEffect, useState } from "react";

export type VisualViewportState = {
  /** 可视高度（含软键盘收缩后的高度） */
  height: number;
  offsetTop: number;
  keyboardOpen: boolean;
};

/**
 * 订阅 visualViewport（软键盘 / Safari 工具栏）。
 * 使用 rAF 合并更新；passive；严格 cleanup。
 * 默认不挂载全局副作用——仅在调用方需要时使用。
 */
export function useVisualViewport(enabled = true): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(() => ({
    height: typeof window !== "undefined" ? window.innerHeight : 0,
    offsetTop: 0,
    keyboardOpen: false,
  }));

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const height = vv.height;
        const offsetTop = vv.offsetTop;
        const keyboardOpen = window.innerHeight - height > 120;
        setState((prev) => {
          if (
            prev.height === height &&
            prev.offsetTop === offsetTop &&
            prev.keyboardOpen === keyboardOpen
          ) {
            return prev;
          }
          return { height, offsetTop, keyboardOpen };
        });
      });
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [enabled]);

  return state;
}
