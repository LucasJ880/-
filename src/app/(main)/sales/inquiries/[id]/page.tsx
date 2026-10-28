"use client";

/**
 * 商机询问（TASKFLOW S2）：管理者经助理发来的问题；负责人在这里回复。
 * 没有绑定助理的负责人从站内通知进入本页；回复与 Muse reply_inquiry 走同一服务。
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Need = "material" | "meeting" | "sample" | "quote_revision" | "other";
const NEEDS: Array<{ value: Need; label: string }> = [
  { value: "material", label: "资料" },
  { value: "meeting", label: "会议" },
  { value: "sample", label: "样板" },
  { value: "quote_revision", label: "报价修订" },
  { value: "other", label: "其他" },
];

type Inquiry = {
  id: string;
  status: string;
  canReply: boolean;
  dueAt: string | null;
  opportunity: { id: string; title: string; customerName: string };
  askedBy: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  questions: string[];
  note: string | null;
  reply: { at: string; channel: string; nextStep: string; customerFeedback: string | null } | null;
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "—");
const toIso = (date: string) => (date ? new Date(`${date}T00:00:00`).toISOString() : undefined);

export default function SalesInquiryPage() {
  const { id } = useParams<{ id: string }>();
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nextStep, setNextStep] = useState("");
  const [nextStepDue, setNextStepDue] = useState("");
  const [lastContact, setLastContact] = useState("");
  const [feedback, setFeedback] = useState("");
  const [needs, setNeeds] = useState<Need[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/sales/inquiries/${encodeURIComponent(id)}`);
    if (!res.ok) {
      setLoadError(res.status === 404 ? "没找到这条询问，或你不是它的收件人或发起人。" : "加载失败，请稍后再试。");
      return;
    }
    setInquiry((await res.json()) as Inquiry);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!nextStep.trim()) {
      setSubmitError("请填写下一步。");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const res = await apiFetch(`/api/sales/inquiries/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nextStep: nextStep.trim(),
        customerFeedback: feedback.trim() || undefined,
        lastContactAt: toIso(lastContact),
        nextStepDueAt: toIso(nextStepDue),
        needs: needs.length > 0 ? needs : undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setSubmitError(body.error ?? "提交失败，请稍后再试。");
      return;
    }
    await load();
  };

  if (loadError) {
    return <div className="mx-auto max-w-2xl p-6 text-sm text-danger">{loadError}</div>;
  }
  if (!inquiry) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-1">
        <p className="text-xs text-muted-foreground">商机询问</p>
        <h1 className="text-lg font-semibold">
          {inquiry.opportunity.title}
          <span className="ml-2 text-sm font-normal text-muted-foreground">{inquiry.opportunity.customerName}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          {inquiry.askedBy.name} 发起 · 期望 {fmt(inquiry.dueAt)} 前回复
        </p>
      </header>

      <section className="space-y-2 rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium">问题</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {inquiry.questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
        {inquiry.note && <p className="text-xs text-muted-foreground">备注：{inquiry.note}</p>}
      </section>

      {inquiry.reply ? (
        <section className="space-y-1 rounded-lg border border-border p-4 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="h-4 w-4 text-success" />
            已回复（{fmt(inquiry.reply.at)}，{inquiry.reply.channel === "web" ? "青砚网页" : "助理"}）
          </p>
          <p>下一步：{inquiry.reply.nextStep}</p>
          {inquiry.reply.customerFeedback && <p>客户反馈：{inquiry.reply.customerFeedback}</p>}
        </section>
      ) : inquiry.canReply ? (
        <section className="space-y-4 rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium">回复</h2>
          <div className="space-y-1.5">
            <Label htmlFor="next-step">下一步（必填）</Label>
            <Input id="next-step" value={nextStep} maxLength={300} onChange={(e) => setNextStep(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="next-step-due">下一步计划日期</Label>
              <Input id="next-step-due" type="date" value={nextStepDue} onChange={(e) => setNextStepDue(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last-contact">最近一次联系客户</Label>
              <Input id="last-contact" type="date" value={lastContact} onChange={(e) => setLastContact(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="feedback">客户反馈</Label>
            <textarea
              id="feedback"
              className="min-h-20 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
              value={feedback}
              maxLength={1000}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">需要的支持</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {NEEDS.map((n) => (
                <label key={n.value} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={needs.includes(n.value)}
                    onChange={(e) =>
                      setNeeds((cur) => (e.target.checked ? [...cur, n.value] : cur.filter((v) => v !== n.value)))
                    }
                  />
                  {n.label}
                </label>
              ))}
            </div>
          </fieldset>
          {submitError && <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{submitError}</p>}
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            提交回复
          </Button>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">等待 {inquiry.assignee?.name ?? "负责人"} 回复。</p>
      )}
    </div>
  );
}
