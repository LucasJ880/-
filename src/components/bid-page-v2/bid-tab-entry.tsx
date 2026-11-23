"use client";

/**
 * BIDPAGE-1「标书与报价」页签入口（项目页渲染它，代替直接渲染 BidTab）
 *
 * 第一次渲染就是改版前的 BidTab（同一组件、同样的属性、不加包裹元素）；随后请求汇总接口，响应是「已开启」才换成新页面。
 * 还没进新页面时：404 / 500 / 请求失败 / 字段不对 → 一直是 BidTab，不显示任何报错。
 * 已经在新页面上（回到标签页时刷新）：只有明确 404 才回到 BidTab；其余出错保留当前这份汇总。
 * 不在浏览器里记「开过」：开关开过再关时，记号会让第一次渲染变成新页面（任务书验收第 9 条）。代价是开关开着时
 * 每次进页签先看到一下旧页面再换成新页面。
 * 这里不用 apiJson：它在 401 时会跳登录页，入口的这次请求不该有任何副作用。
 */
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { BidTab } from "@/components/project-detail/tabs/bid-tab";
import type { BidPageView } from "@/lib/bid-page-v2/next-step";
import { BidPageV2 } from "./bid-page-v2";
import { fetchSummary, nextView } from "./entry-mode";

export type BidTabEntryProps = ComponentProps<typeof BidTab>;

export function BidTabEntry(props: BidTabEntryProps) {
  const { projectId } = props;
  // 只有收到「已开启」才有 view；没有 view 就是改版前的页面
  const [view, setView] = useState<BidPageView | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const outcome = await fetchSummary(projectId, (input, init) => fetch(input, init));
    if (mine !== seq.current) return; // 项目换了 / 又发了一次：旧的作废
    setView((prev) => nextView(prev, outcome));
  }, [projectId]);

  useEffect(() => {
    void load();
    return () => {
      seq.current += 1;
    };
  }, [load]);

  // 新页面上，回到这个标签页时刷新一次各分区的一句状态（改版前的页面上不挂这个监听）
  const onV2 = view !== null;
  useEffect(() => {
    if (!onV2) return;
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [onV2, load]);

  if (view) return <BidPageV2 {...props} view={view} onRefresh={() => void load()} />;
  return <BidTab {...props} />;
}
