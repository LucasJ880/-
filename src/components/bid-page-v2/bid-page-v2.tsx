"use client";

/**
 * BIDPAGE-1 改版后的「标书与报价」页：「更多」（版本历史）→「下一步」→ ① 找供应商、询价 → ② 定报价 → ③ 出文件。
 *
 * - 三个分区先挂既有组件（不改它们），由 BIDPAGE-2 / 3 / 4 / 6 / 7 替换；② 已由 BIDPAGE-3 换成新的报价区（`quote-step.tsx`），
 *   不再挂投标工作区面板与改版前的报价区。
 * - 金额（任务书附录 C 决定 C）：带金额的区块（询价轮次里的供应商报价、我方报价卡、报价区、旧版报价单、
 *   「更多」里的版本历史）只给看得到金额的人挂；其余人在那里看到一句说明。新页面自己写的字只用汇总接口给的金额。
 *   这只是「不挂组件」，不是数据保护：旧接口的口径照旧（决定 C 留给 CHAIN-2e）。
 * - 收起的分区仍挂在页面上、只加 hidden：组件取数照常，页内位置（rfq-section、bid-quote-area）一直在；改版前投标工作区的位置（bid-workspace）落到 ②。
 * - 打开时展开哪个分区：地址里的 #位置 落在哪个分区就展开哪个（优先）；否则展开「下一步」指向的那个。
 * - 「下一步」按钮只导航：展开分区并滚过去，或切到「招标要求」页签。不起草、不批准、不发送、不保存、不生成。
 * - 不放国内供应商简报面板（去向以 #544 为准）。
 */
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, Compass, History, Lock, MoreHorizontal } from "lucide-react";
import { ProjectInquirySection } from "@/components/inquiry/project-inquiry-section";
import { TenderOurBidCard } from "@/components/quote-engine/tender-our-bid";
import { ProjectGenerateMenu } from "@/components/project-generate/project-generate-menu";
import { ProjectSupplierLinks } from "@/components/bid-workflow/project-supplier-links";
import { TenderSourcingEntry } from "@/components/supplier-intel/tender-sourcing-entry";
import { VersionHistoryDrawer } from "@/components/project-detail/version-history-drawer";
import { ProjectQuoteSection } from "@/components/quote/project-quote-section";
import type { BidTab } from "@/components/project-detail/tabs/bid-tab";
import { BID_PAGE_SECTIONS, BID_PAGE_SECTION_TITLES_ZH, type BidPageSection, type BidPageTarget, type BidPageView } from "@/lib/bid-page-v2/next-step";
import { cn } from "@/lib/utils";
import { SECTION_ANCHOR, sectionForAnchor } from "./entry-mode";
import { QuoteStep } from "./quote-step";

export type BidPageV2Props = ComponentProps<typeof BidTab> & { view: BidPageView };

/** 看不到金额的人在 ① 询价、② 报价的位置看到的说明；没有编辑权限的人在 ③ 看到的说明 */
export const SOURCING_AMOUNTS_HIDDEN_ZH = "询价里会有供应商报价，所以询价区只给项目负责人和有财务查看权的同事看。要起草或查看询价，请找他们。";
export const QUOTE_AMOUNTS_HIDDEN_ZH = "报价的金额与成本只给项目负责人和有财务查看权的同事看。要做报价或查看金额，请找他们。";
export const DOCUMENTS_NO_EDIT_ZH = "生成文件需要项目编辑权限，请找项目负责人。";

/** 打开时展开哪个：#位置 落在某个分区 → 它；否则「下一步」指向的那个 */
export function initialOpenSection(hash: string | null | undefined, view: BidPageView): BidPageSection {
  return sectionForAnchor(hash) ?? view.expanded;
}

export function BidPageV2({ projectId, orgId, canManage, view }: BidPageV2Props) {
  const router = useRouter();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [open, setOpen] = useState<Record<BidPageSection, boolean>>(() =>
    openOnly(initialOpenSection(typeof window === "undefined" ? null : window.location.hash, view)),
  );
  const userTouched = useRef(false);
  const showAmounts = view.viewer.canViewAmounts;

  // 「下一步」换了指向（如回到页面时刷新了状态），人还没自己开合过、地址里也没有 #位置 → 跟着展开
  useEffect(() => {
    if (userTouched.current || sectionForAnchor(window.location.hash)) return;
    setOpen(openOnly(view.expanded));
  }, [view.expanded]);

  // 地址里的 #位置 落在收起的分区里 → 展开那个分区，并自己滚过去一次（项目页「下一步」卡的重滚有时间窗）
  useEffect(() => {
    const expandForHash = () => {
      const hash = window.location.hash;
      const section = sectionForAnchor(hash);
      if (!section) return;
      userTouched.current = true;
      setOpen((prev) => (prev[section] ? prev : { ...prev, [section]: true }));
      const id = hash.replace(/^#/, "");
      window.setTimeout(() => {
        let el: HTMLElement | null = null;
        try {
          el = document.getElementById(decodeURIComponent(id));
        } catch {
          el = document.getElementById(id);
        }
        (el ?? document.getElementById(SECTION_ANCHOR[section]))?.scrollIntoView({ behavior: "auto", block: "start" });
      }, 60);
    };
    expandForHash();
    window.addEventListener("hashchange", expandForHash);
    return () => window.removeEventListener("hashchange", expandForHash);
  }, []);

  const toggle = useCallback((section: BidPageSection) => {
    userTouched.current = true;
    setOpen((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // 「下一步」按钮：只导航。切页签只换地址里的 ?tab=，用 router.replace（与项目页自己切页签同一做法；
  // 项目页跟着 ?tab= 切页签）。原生 history.replaceState 在这个版本的 Next 里不会同步 useSearchParams（浏览器实测）
  const go = useCallback(
    (target: BidPageTarget) => {
      if (target.kind === "tab") {
        router.replace(tabHref(window.location.href, target.tab), { scroll: false });
        return;
      }
      userTouched.current = true;
      setOpen((prev) => ({ ...prev, [target.section]: true }));
      window.setTimeout(() => document.getElementById(SECTION_ANCHOR[target.section])?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    },
    [router],
  );

  const content: Record<BidPageSection, ReactNode> = {
    sourcing: (
      <div className="space-y-6">
        <TenderSourcingEntry projectId={projectId} />
        {showAmounts ? <ProjectInquirySection projectId={projectId} orgId={orgId} canManage={canManage} /> : <AmountsHiddenNote textZh={SOURCING_AMOUNTS_HIDDEN_ZH} testId="bid-page-sourcing-hidden" />}
        <ProjectSupplierLinks projectId={projectId} orgId={orgId} />
      </div>
    ),
    quote: showAmounts ? (
      <div className="space-y-6">
        {/* 我方报价卡到 BIDPAGE-6 并入分区标题；投标工作区面板与改版前的报价区不进新页面（BIDPAGE-3 design D10） */}
        <TenderOurBidCard projectId={projectId} />
        {/* 项目页「下一步」卡滚动到投标价的位置 */}
        <div id="bid-quote-area" className="scroll-mt-4">
          <QuoteStep projectId={projectId} />
        </div>
        <details className="rounded-xl border border-border/60 bg-card-bg/60" data-testid="bid-page-legacy-quote">
          <summary className="cursor-pointer px-4 py-2 text-xs text-muted">旧版报价单（外贸标准报价，点开查看）</summary>
          <div className="px-1 pb-2">
            <ProjectQuoteSection projectId={projectId} />
          </div>
        </details>
      </div>
    ) : (
      // 位置照样留着，项目页「下一步」卡跳过来落在这句说明上
      <div id="bid-quote-area" className="scroll-mt-4">
        <AmountsHiddenNote textZh={QUOTE_AMOUNTS_HIDDEN_ZH} testId="bid-page-quote-hidden" />
      </div>
    ),
    documents: view.viewer.canGenerate ? (
      <ProjectGenerateMenu projectId={projectId} canManage={canManage} />
    ) : (
      <AmountsHiddenNote textZh={DOCUMENTS_NO_EDIT_ZH} testId="bid-page-documents-no-edit" />
    ),
  };

  return (
    <div className="space-y-4" data-testid="bid-page-v2">
      {/* 「更多」里的版本历史会带出报价金额与毛利率（旧接口）：只给看得到金额的人 */}
      {showAmounts ? (
        <div className="flex items-center justify-end">
          <MoreMenu onOpenVersions={() => setVersionsOpen(true)} />
        </div>
      ) : null}

      <NextStepBanner view={view} onGo={go} />

      {BID_PAGE_SECTIONS.map((section) => (
        <StepSection key={section} section={section} statusZh={view.sections[section].statusZh} open={open[section]} onToggle={() => toggle(section)}>
          {content[section]}
        </StepSection>
      ))}

      {showAmounts ? <VersionHistoryDrawer projectId={projectId} open={versionsOpen} onClose={() => setVersionsOpen(false)} /> : null}
    </div>
  );
}

function AmountsHiddenNote({ textZh, testId }: { textZh: string; testId: string }) {
  return (
    <p className="flex items-start gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs leading-5 text-muted" data-testid={testId}>
      <Lock size={12} className="mt-0.5 shrink-0" />
      {textZh}
    </p>
  );
}

/** 当前地址换成另一个页签：保留其它参数，去掉 #位置 与动态深链（与项目页切页签同一做法） */
export function tabHref(href: string, tab: string): string {
  const url = new URL(href);
  url.searchParams.set("tab", tab);
  url.searchParams.delete("activity");
  url.hash = "";
  return `${url.pathname}${url.search}`;
}

function openOnly(section: BidPageSection): Record<BidPageSection, boolean> {
  return { sourcing: section === "sourcing", quote: section === "quote", documents: section === "documents" };
}

/** 右上角「更多」：目前只有「版本历史」 */
export function MoreMenu({ onOpenVersions, initialOpen = false }: { onOpenVersions: () => void; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-accent-soft hover:text-foreground"
        data-testid="bid-page-more"
      >
        <MoreHorizontal size={12} />
        更多
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 min-w-[9rem] rounded-lg border border-border bg-card-bg p-1 shadow-lg" data-testid="bid-page-more-menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenVersions();
            }}
            className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-accent-soft"
            data-testid="open-version-history"
          >
            <History size={12} />
            版本历史
          </button>
        </div>
      )}
    </div>
  );
}

/** 顶部「下一步」横条：一句结论、至多一句原因、一个只导航的按钮 */
export function NextStepBanner({ view, onGo }: { view: BidPageView | null; onGo: (target: BidPageTarget) => void }) {
  return (
    <section
      className="rounded-[var(--radius-xl)] border border-accent/30 bg-accent-soft/40 p-4"
      aria-labelledby="bid-page-next-step-title"
      data-testid="bid-page-next-step"
      data-rule={view?.rule ?? ""}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-accent">
            <Compass size={13} /> 下一步
          </p>
          <h2 id="bid-page-next-step-title" className="mt-1 text-base font-semibold text-foreground" data-testid="bid-page-next-step-headline">
            {view ? view.headlineZh : "正在读取…"}
          </h2>
          {view?.reasonZh ? (
            <p className="mt-1 text-xs leading-5 text-muted" data-testid="bid-page-next-step-reason">
              {view.reasonZh}
            </p>
          ) : null}
          {view?.alsoZh ? (
            <p className="mt-0.5 text-xs leading-5 text-muted" data-testid="bid-page-next-step-also">
              另外：{view.alsoZh}
            </p>
          ) : null}
        </div>
        {view ? (
          <button
            type="button"
            onClick={() => onGo(view.action.target)}
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90 sm:self-auto"
            data-testid="bid-page-next-step-action"
          >
            {view.action.labelZh} <ArrowRight size={13} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** 一个可折叠的步骤分区：标题 + 一句状态；收起时内容仍挂着、只隐藏 */
export function StepSection({
  section,
  statusZh,
  open,
  onToggle,
  children,
}: {
  section: BidPageSection;
  statusZh: string | null;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = `${SECTION_ANCHOR[section]}-body`;
  return (
    <section id={SECTION_ANCHOR[section]} className="scroll-mt-4 rounded-xl border border-border bg-card-bg" data-testid={`bid-page-section-${section}`} data-open={open ? "1" : "0"}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        data-testid={`bid-page-section-toggle-${section}`}
      >
        <span className="text-sm font-semibold text-foreground">{BID_PAGE_SECTION_TITLES_ZH[section]}</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs text-muted" data-testid={`bid-page-section-status-${section}`}>
            {statusZh ?? "正在读取…"}
          </span>
          <ChevronDown size={14} className={cn("shrink-0 text-muted transition-transform", open ? "rotate-180" : "")} />
        </span>
      </button>
      <div id={bodyId} hidden={!open} className="border-t border-border px-4 pb-4 pt-4">
        {children}
      </div>
    </section>
  );
}
