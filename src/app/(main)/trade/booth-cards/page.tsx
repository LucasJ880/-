"use client";

/**
 * 展会速记卡 · 夜间录入
 *
 * 1. 下载模板 / 复制 AI 提示词：把当天的卡片照片交给 AI，按模板列名转成表格，人工核对
 * 2. 上传表格 → 预览每张卡的问题
 * 3. 逐张录入（并发 3）：每张卡走网站询盘同一链路，回复草稿进审批，第二天早上审核
 *
 * 卡号就是线索编号：中断后重新上传同一张表即可，已录入的卡只会补齐、不会重复。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FileSpreadsheet,
  Loader2,
  Play,
  RotateCcw,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";

interface Card {
  row: number;
  cardNo: string;
  company: string;
  contactName: string;
  email: string;
  whatsapp: string;
  grade: string;
  styles: string;
  [key: string]: string | number;
}

interface ParsedRow {
  card: Card;
  errors: string[];
}

type RowState =
  | { state: "queued" }
  | { state: "running"; startedAt: number }
  | { state: "done"; label: string; tone: "ok" | "warn"; opportunityId: string | null }
  | { state: "failed"; error: string };

const CONCURRENCY = 3;

const AI_PROMPT = `你会收到若干张广交会「买家速记卡」的照片，每张卡左上角订着买家名片。请每张卡输出一行，做成 CSV（第一行是列名，用英文逗号分隔，含逗号的内容用双引号括起来）。列名和顺序必须是：
卡号,日期,业务员,公司,联系人,职位,邮箱,WhatsApp,国家,买家类型,感兴趣款号,规格/认证,采购规模,时间,下一步,等级,备注,语音备注

规则：
1. 卡号照卡片右上角印的抄，如 CF140-0001。看不清就写 ?，不要猜。
2. 公司、联系人、职位、邮箱、电话从名片读；名片和手写都有时以名片为准。没有名片时读框内手写。
3. WhatsApp 列填卡上手写的 WhatsApp / 微信，没有就填名片上的手机号，保留国家区号。
4. 勾选项只写勾了的选项原文（如「零售/自有品牌」「1-5柜」「3个月内」），多选用顿号分隔；日期写勾选的那天，如 10/31。
5. 等级只写 A、B 或 C。
6. 备注和语音备注翻成简洁的英文（会被引用进给买家的跟进邮件草稿），不要添加卡上没有的内容。
7. 任何看不清或不确定的格子留空，并在备注末尾加「[待核：字段名]」。绝对不要编造邮箱、电话或公司名。
8. 邮箱逐字符核对：常见混淆 0/o、1/l、rn/m。
最后只输出 CSV，不要其它说明。`;

function storageKey(orgId: string) {
  return `qy.boothCards.event.${orgId}`;
}

export default function BoothCardsPage() {
  const router = useRouter();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [event, setEvent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [unknownColumns, setUnknownColumns] = useState<string[]>([]);
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!orgId) return;
    try {
      setEvent(localStorage.getItem(storageKey(orgId)) ?? "");
    } catch {
      /* 存储不可用时用空值 */
    }
  }, [orgId]);

  const saveEvent = (v: string) => {
    setEvent(v);
    try {
      if (orgId) localStorage.setItem(storageKey(orgId), v);
    } catch {
      /* ignore */
    }
  };

  // 录入进行中关闭页面会中断：提醒一下（中断了重新上传同一表即可补齐）
  useEffect(() => {
    if (!running) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [running]);

  const valid = useMemo(() => rows.filter((r) => r.errors.length === 0), [rows]);

  const counts = useMemo(() => {
    const c = { queued: 0, running: 0, done: 0, failed: 0 };
    for (const r of valid) {
      const s = states[r.card.cardNo];
      if (s) c[s.state]++;
    }
    return c;
  }, [states, valid]);

  const handleParse = async (f: File) => {
    setFile(f);
    setParsing(true);
    setParseError(null);
    setRows([]);
    setStates({});
    setUnknownColumns([]);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await apiFetch("/api/trade/booth-cards/parse", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setParseError(data.error ?? "解析失败");
        return;
      }
      setRows(data.cards as ParsedRow[]);
      setUnknownColumns(data.unknownColumns ?? []);
    } catch {
      setParseError("上传失败，请检查网络后重试");
    } finally {
      setParsing(false);
    }
  };

  const ingestOne = useCallback(
    async (card: Card): Promise<RowState> => {
      try {
        const res = await apiFetch("/api/trade/booth-cards/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, event, card }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { state: "failed", error: data.error ?? `HTTP ${res.status}` };
        if (data.busy) return { state: "failed", error: "这张卡正在被另一次录入处理，稍后重试" };
        if (!data.opportunityId) {
          return { state: "failed", error: `线索已存，商机未建好：${data.spineError ?? "请重试"}` };
        }
        const pending = data.fde?.pendingActionId;
        const status = data.fde?.status as string | undefined;
        if (pending) {
          return { state: "done", tone: "ok", label: data.replay ? "已录入过 · 草稿待审批" : "草稿待审批", opportunityId: data.opportunityId };
        }
        if (!card.email) {
          return { state: "done", tone: "warn", label: "无邮箱，没有邮件草稿：用 WhatsApp 跟进", opportunityId: data.opportunityId };
        }
        if (status && ["failed", "run_blocked", "stale_running", "queued", "not_run"].includes(status)) {
          return { state: "done", tone: "warn", label: `商机已建，AI 草稿未完成（${status}），稍后重试可补齐`, opportunityId: data.opportunityId };
        }
        return { state: "done", tone: "ok", label: data.replay ? "已录入过" : "已建商机", opportunityId: data.opportunityId };
      } catch {
        return { state: "failed", error: "网络中断，重试即可（不会重复）" };
      }
    },
    [orgId, event],
  );

  const run = async (targets: Card[]) => {
    if (!orgId || targets.length === 0) return;
    cancelled.current = false;
    setRunning(true);
    setStates((prev) => {
      const next = { ...prev };
      for (const c of targets) next[c.cardNo] = { state: "queued" };
      return next;
    });
    const queue = [...targets];
    const worker = async () => {
      while (queue.length && !cancelled.current) {
        const card = queue.shift()!;
        setStates((prev) => ({ ...prev, [card.cardNo]: { state: "running", startedAt: Date.now() } }));
        const result = await ingestOne(card);
        setStates((prev) => ({ ...prev, [card.cardNo]: result }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    setRunning(false);
  };

  const failedCards = valid.filter((r) => states[r.card.cardNo]?.state === "failed").map((r) => r.card);
  const notStarted = valid.filter((r) => !states[r.card.cardNo]).map((r) => r.card);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AI_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 剪贴板不可用时用户可手动选中 */
    }
  };

  if (orgLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }
  if (!orgId || ambiguous) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted">请先选择当前组织后再录入。</p>
        <button type="button" onClick={() => router.push("/organizations")} className="text-sm text-accent underline-offset-2 hover:underline">
          前往组织
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="展会速记卡 · 夜间录入"
        description="每张卡生成客户和商机，AI 评分并起草跟进邮件，草稿进审批；第二天早上审核后发出。卡号就是线索编号，重复上传不会多出线索。"
      />

      <section className="space-y-3 rounded-xl border border-border/60 bg-card-bg p-5">
        <h2 className="text-sm font-semibold text-foreground">1. 准备表格</h2>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
          <li>把当天的速记卡照片（名片朝上、整张卡入镜）发给 AI，附上下面的提示词，得到 CSV。</li>
          <li>对照卡片核对邮箱、WhatsApp、等级和英文备注；带「[待核]」的格子补全后删掉标记（备注会进邮件草稿）。</li>
          <li>把 CSV 存成 .csv 文件直接上传，或粘贴进模板后上传。</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/trade/booth-cards/template"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition hover:border-blue-500/40"
          >
            <Download size={14} /> 下载模板
          </a>
          <button
            type="button"
            onClick={copyPrompt}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition hover:border-blue-500/40"
          >
            <ClipboardCopy size={14} /> {copied ? "已复制" : "复制 AI 提示词"}
          </button>
        </div>
        <details className="text-xs text-muted">
          <summary className="cursor-pointer select-none">查看提示词</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-background p-3 font-sans text-[11px] leading-relaxed">{AI_PROMPT}</pre>
        </details>
      </section>

      <section className="space-y-3 rounded-xl border border-border/60 bg-card-bg p-5">
        <h2 className="text-sm font-semibold text-foreground">2. 上传</h2>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">展会名称（英文，写进跟进邮件开头）</label>
          <input
            value={event}
            onChange={(e) => saveEvent(e.target.value)}
            placeholder="the 140th Canton Fair (Booth 14.3E07)"
            disabled={running}
            className="w-full max-w-lg rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-muted">
            邮件开头：Thank you for visiting the（公司名）booth at <b>{event || "…"}</b> — it was a pleasure meeting you.
          </p>
        </div>
        <label className="flex max-w-lg cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-background px-6 py-6 transition hover:border-blue-500/50">
          {parsing ? <Loader2 className="h-7 w-7 animate-spin text-muted" /> : <FileSpreadsheet className="h-7 w-7 text-muted" />}
          <span className="text-sm text-muted">{file ? file.name : "选择 xlsx / csv 文件"}</span>
          <input
            type="file"
            accept=".csv,.txt,.xlsx,.xls"
            className="hidden"
            disabled={running}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleParse(f);
              e.target.value = "";
            }}
          />
        </label>
        {parseError && (
          <p className="flex items-center gap-1.5 text-xs text-red-400">
            <AlertCircle size={14} /> {parseError}
          </p>
        )}
        {unknownColumns.length > 0 && (
          <p className="text-[11px] text-muted">没认出的列（已忽略）：{unknownColumns.join("、")}</p>
        )}
      </section>

      {rows.length > 0 && (
        <section className="space-y-3 rounded-xl border border-border/60 bg-card-bg p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-foreground">3. 录入</h2>
            <span className="text-xs text-muted">
              共 {rows.length} 张，可录入 {valid.length} 张
              {rows.length > valid.length && `，${rows.length - valid.length} 张有问题需先改表格`}
              {Object.keys(states).length > 0 &&
                ` · 完成 ${counts.done} · 进行中 ${counts.running} · 等待 ${counts.queued} · 失败 ${counts.failed}`}
            </span>
            <div className="ml-auto flex gap-2">
              {failedCards.length > 0 && !running && (
                <button
                  type="button"
                  onClick={() => void run(failedCards)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:border-blue-500/40"
                >
                  <RotateCcw size={14} /> 重试失败的 {failedCards.length} 张
                </button>
              )}
              {running ? (
                <button
                  type="button"
                  onClick={() => (cancelled.current = true)}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground"
                >
                  处理完当前几张后停止
                </button>
              ) : (
                <button
                  type="button"
                  disabled={notStarted.length === 0}
                  onClick={() => void run(notStarted)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
                >
                  <Play size={14} /> 开始录入 {notStarted.length} 张
                </button>
              )}
            </div>
          </div>
          {running && (
            <p className="text-[11px] text-muted">每张约 1 分钟（AI 评分和起草），同时处理 {CONCURRENCY} 张。请不要关闭页面；中断了重新上传同一张表即可，已录入的不会重复。</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="text-muted">
                <tr className="border-b border-border/60">
                  <th className="py-2 pr-3 font-medium">行</th>
                  <th className="py-2 pr-3 font-medium">卡号</th>
                  <th className="py-2 pr-3 font-medium">公司 / 联系人</th>
                  <th className="py-2 pr-3 font-medium">邮箱 / WhatsApp</th>
                  <th className="py-2 pr-3 font-medium">等级</th>
                  <th className="py-2 pr-3 font-medium">款号</th>
                  <th className="py-2 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ card, errors }) => {
                  const s = states[card.cardNo];
                  return (
                    <tr key={`${card.row}-${card.cardNo}`} className="border-b border-border/30 align-top">
                      <td className="py-2 pr-3 text-muted">{card.row}</td>
                      <td className="py-2 pr-3 font-mono">{card.cardNo || "—"}</td>
                      <td className="py-2 pr-3">
                        <div className="text-foreground">{card.company || "—"}</div>
                        <div className="text-muted">{card.contactName}</div>
                      </td>
                      <td className="py-2 pr-3">
                        <div>{card.email}</div>
                        <div className="text-muted">{card.whatsapp}</div>
                      </td>
                      <td className="py-2 pr-3 font-semibold">{card.grade}</td>
                      <td className="py-2 pr-3">{card.styles}</td>
                      <td className="py-2">
                        {errors.length > 0 ? (
                          <span className="text-red-400">{errors.join("；")}</span>
                        ) : !s ? (
                          <span className="text-muted">待录入</span>
                        ) : s.state === "queued" ? (
                          <span className="text-muted">排队中</span>
                        ) : s.state === "running" ? (
                          <span className="inline-flex items-center gap-1 text-blue-400">
                            <Loader2 size={12} className="animate-spin" /> 处理中
                          </span>
                        ) : s.state === "failed" ? (
                          <span className="text-red-400">{s.error}</span>
                        ) : (
                          <span className={`inline-flex flex-wrap items-center gap-1.5 ${s.tone === "ok" ? "text-emerald-400" : "text-amber-400"}`}>
                            {s.tone === "ok" ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                            {s.label}
                            {s.opportunityId && (
                              <Link href={`/revenue/${s.opportunityId}`} className="text-accent underline-offset-2 hover:underline">
                                打开商机
                              </Link>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
