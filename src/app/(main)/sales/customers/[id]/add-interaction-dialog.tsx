"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Opportunity } from "./types";
import { useSalesCurrentOrgId } from "@/lib/hooks/use-sales-current-org-id";
import {
  isSalesOrgCreateBlocked,
  salesOrgCreateBlockedHint,
  withSalesOrgId,
} from "@/lib/sales/sales-client-org";

export function AddInteractionDialog({
  open,
  onOpenChange,
  customerId,
  opportunities,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  opportunities: Opportunity[];
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    type: "note",
    direction: "",
    summary: "",
    content: "",
    opportunityId: "",
  });
  const [saving, setSaving] = useState(false);
  const { orgId, ambiguous, loading: orgLoading } = useSalesCurrentOrgId();

  async function handleSave() {
    if (!form.summary.trim()) return;
    if (isSalesOrgCreateBlocked(orgLoading, ambiguous, orgId)) return;
    setSaving(true);
    try {
      await apiFetch(`/api/sales/customers/${customerId}/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          withSalesOrgId(orgId!, {
            ...form,
            opportunityId: form.opportunityId || null,
            direction: form.direction || null,
          }),
        ),
      });
      onSuccess();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>记录互动</DialogTitle>
          <DialogDescription>记录与客户的沟通互动</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>类型</Label>
              <ShadSelect
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="phone_call">电话</SelectItem>
                  <SelectItem value="wechat">微信</SelectItem>
                  <SelectItem value="email">邮件</SelectItem>
                  <SelectItem value="in_person">面谈</SelectItem>
                  <SelectItem value="note">备注</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>
            <div className="space-y-1.5">
              <Label>方向</Label>
              <ShadSelect
                value={form.direction || "none"}
                onValueChange={(v) => setForm({ ...form, direction: v === "none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不适用</SelectItem>
                  <SelectItem value="outbound">发出</SelectItem>
                  <SelectItem value="inbound">收到</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>
          </div>

          {opportunities.length > 0 && (
            <div className="space-y-1.5">
              <Label>关联机会</Label>
              <ShadSelect
                value={form.opportunityId || "none"}
                onValueChange={(v) => setForm({ ...form, opportunityId: v === "none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="不关联" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不关联</SelectItem>
                  {opportunities.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>摘要 *</Label>
            <Input
              placeholder="简要描述这次互动…"
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>详细内容</Label>
            <textarea
              className="flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:border-accent/30 h-24 resize-none"
              placeholder="可选：详细内容…"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </div>
        </div>

        {!orgLoading && ambiguous && (
          <p className="text-xs text-amber-800 bg-amber-50 rounded-md px-2 py-1.5">
            {salesOrgCreateBlockedHint(false, true, null)}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            onClick={handleSave}
            disabled={
              saving ||
              !form.summary.trim() ||
              isSalesOrgCreateBlocked(orgLoading, ambiguous, orgId)
            }
            title={salesOrgCreateBlockedHint(orgLoading, ambiguous, orgId) ?? undefined}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
