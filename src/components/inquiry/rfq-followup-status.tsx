"use client";

/**
 * RFQ-AUTO-1 一轮询价的自动跟进状态（生效中 / 已停止 / 未生效：原因）+「停止自动跟进」。
 *
 * 只显示与停止，不发信、不批准。停止不可恢复——之后这一轮的催单与追问退回逐张待批。
 */

import { useState } from "react";
import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import type { RfqFollowUpRoundView } from "./rfq-web-entry-types";

type Props = {
  projectId: string;
  inquiryId: string;
  view: RfqFollowUpRoundView;
  canManage: boolean;
  /** 停止成功后让父组件重新取入口状态 */
  onChanged: () => void;
};

const STATE_LABEL: Record<RfqFollowUpRoundView["state"], string> = { active: "生效中", stopped: "已停止", inactive: "未生效" };
const STATE_TONE: Record<RfqFollowUpRoundView["state"], string> = {
  active: "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]",
  stopped: "bg-border/60 text-muted",
  inactive: "bg-[#9a6a2f]/10 text-[#9a6a2f]",
};

export function RfqFollowUpStatus({ projectId, inquiryId, view, canManage, onChanged }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/tender-rfq/rounds/${inquiryId}/follow-up/stop`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) setError(data?.error ?? "没有停成功，请重试。");
      else onChanged();
    } catch {
      setError("网络出错了，请重试。");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-1.5 rounded-md border border-border bg-background p-3 text-xs" data-testid="rfq-followup-status">
      <div className="flex flex-wrap items-center gap-2">
        <Repeat size={13} className="text-accent/70" />
        <span className="font-medium text-foreground">自动跟进</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_TONE[view.state]}`}>{STATE_LABEL[view.state]}</span>
        <span className="text-muted">已自动发出 {view.autoSentCount} 封</span>
        {canManage && view.state === "active" && !confirming && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setConfirming(true)} data-testid="rfq-followup-stop">
            停止自动跟进
          </Button>
        )}
      </div>
      <p className="text-muted">{view.summaryZh}</p>
      {view.state === "inactive" && view.reasonZh && <p className="text-[#9a6a2f]">现在不会自动发：{view.reasonZh}。到点的催单和追问会照旧出现在这里等你批。</p>}
      {view.state === "stopped" && <p className="text-muted">这一轮之后的催单和追问会照旧出现在这里等你批。</p>}
      {confirming && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-danger/30 bg-danger/[0.04] p-2">
          <span className="text-foreground">停止后不能恢复，这一轮之后的催单和追问要逐封批。确定停止？</span>
          <Button variant="outline" size="sm" onClick={stop} loading={busy} loadingText="正在停止…" data-testid="rfq-followup-stop-confirm">
            确定停止
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
            不停了
          </Button>
        </div>
      )}
      {error && <p className="text-danger" role="alert">{error}</p>}
    </div>
  );
}
