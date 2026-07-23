"use client";

import { useEffect } from "react";
import { lockAppScroll } from "@/lib/mobile/scroll-lock";

/** 在 open=true 时持有滚动锁；卸载 / 关闭时释放（引用计数安全） */
export function useAppScrollLock(active: boolean, reason: string) {
  useEffect(() => {
    if (!active) return;
    return lockAppScroll(reason);
  }, [active, reason]);
}
