"use client";

/**
 * 外贸新手指引 — 第一次进外贸工作台的销售看的四步卡
 *
 * 每步三句话：怎么做 / 为什么 / 好处，像给小朋友的提示一样简单。
 * 点「我知道了」后按用户本地记忆收起（localStorage），右上角可随时再展开。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BookOpenCheck,
  ChevronDown,
  ChevronUp,
  FileText,
  MessageCircle,
  Sparkles,
  UserPlus,
} from "lucide-react";

const DISMISS_KEY = "qingyan-trade-onboarding-v1";

const STEPS = [
  {
    icon: UserPlus,
    title: "第 1 步：把你的买家录进「线索资产」",
    how: "点左边「线索资产」→ 新建，填上公司名和联系人。有名单就用「展会导入」整批传。",
    why: "客户都写在一个本子上，才不会东一个微信、西一张名片。",
    gain: "好处：系统替你记住每个买家聊到哪一步了，永远不会忘。",
  },
  {
    icon: MessageCircle,
    title: "第 2 步：每次聊完，顺手记一条跟进",
    how: "在线索里记一句“今天聊了什么、约了什么时候回”。10 秒钟的事。",
    why: "只有记下来，系统才知道你聊过了。",
    gain: "好处：每天早上系统自动提醒“今天该找谁”，你不用自己记。",
  },
  {
    icon: FileText,
    title: "第 3 步：报价用系统开，别只发微信",
    how: "进「外贸报价」→ 新建，填产品、数量、单价，发给买家后把状态改成“已发送”。",
    why: "报价留了底，规格和价格才有据可查。",
    gain: "好处：买家砍价、改单都有记录；成交一键转正式订单。",
  },
  {
    icon: Sparkles,
    title: "第 4 步：不会做的，直接问 AI",
    how: "点「AI 对话」，像发微信一样问它：“今天该跟进谁？”“给 XX 公司写封开发信”。",
    why: "它认识这个系统，也认识你的买家。",
    gain: "好处：开发信它来写、买家它来研究，你只管改两句然后发送。",
  },
] as const;

export function TradeOnboardingGuide() {
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(DISMISS_KEY) !== "dismissed");
    } catch {
      setOpen(true);
    }
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "dismissed");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };
  const reopen = () => {
    try {
      window.localStorage.removeItem(DISMISS_KEY);
    } catch {
      /* ignore */
    }
    setOpen(true);
  };

  // 本地记忆读出前不渲染，避免闪烁
  if (open === null) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={reopen}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted transition hover:border-accent/50 hover:text-foreground"
      >
        <BookOpenCheck size={13} />
        新手指引
        <ChevronDown size={13} />
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-accent/25 bg-card-bg p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            第一次用？照这四步走，30 分钟上手
          </p>
          <p className="mt-0.5 text-xs text-muted">
            每步都写了怎么做、为什么、有什么好处。卡住了就走第 4 步问 AI。
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted transition hover:text-foreground"
        >
          <ChevronUp size={13} />
          收起
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {STEPS.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.title}
              className="rounded-lg border border-border/70 bg-background/60 p-3.5"
            >
              <div className="mb-1.5 flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Icon size={15} />
                </span>
                <p className="text-[13px] font-semibold leading-snug text-foreground">
                  {s.title}
                </p>
              </div>
              <p className="text-xs leading-relaxed text-foreground/90">{s.how}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{s.why}</p>
              <p className="mt-1 text-xs font-medium leading-relaxed text-accent">
                {s.gain}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          铁律就一条：<span className="font-semibold text-foreground">聊过就记，询盘当天回。</span>
        </p>
        <div className="flex items-center gap-2">
          <Link
            href="/trade/prospects"
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-accent/50 hover:text-accent"
          >
            去录第一个买家
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)] transition hover:bg-accent-hover"
          >
            我知道了，开始干活
          </button>
        </div>
      </div>
    </div>
  );
}
