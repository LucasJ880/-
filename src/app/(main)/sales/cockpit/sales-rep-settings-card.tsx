"use client";

import { useEffect, useState } from "react";
import { UserCog, Check, Loader2 } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

/**
 * 销售个人设置卡片 — 驾驶舱顶部
 *
 * 目前只包含 Sales Rep 代号（1-4 个字母/数字）。
 * 保存时弹确认框提示"确认后之后的报价自动带入代号"。
 * 后续可在此卡片继续堆叠其他销售个人配置。
 */
export function SalesRepSettingsCard() {
  const [loaded, setLoaded] = useState(false);
  const [current, setCurrent] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<"saved" | null>(null);

  useEffect(() => {
    apiJson<{ salesRepInitials?: string }>("/api/users/me/sales-settings")
      .then((d) => {
        const v = d.salesRepInitials ?? "";
        setCurrent(v);
        setDraft(v);
        // 首次进来没设置 → 直接进入编辑态提示用户
        if (!v) setEditing(true);
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => setLoaded(true));
  }, []);

  const normalized = draft.trim().toUpperCase().slice(0, 4);
  const valid = /^[A-Z0-9]{1,4}$/.test(normalized);

  const handleRequestSave = () => {
    if (!valid) return;
    setConfirmOpen(true);
  };

  const doSave = async () => {
    setSaving(true);
    try {
      const res = await apiFetch("/api/users/me/sales-settings", {
        method: "PUT",
        body: JSON.stringify({ salesRepInitials: normalized }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "保存失败");
      setCurrent(data.salesRepInitials ?? normalized);
      setEditing(false);
      setConfirmOpen(false);
      setFlash("saved");
      setTimeout(() => setFlash(null), 2500);
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-white/60 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载销售个人设置中...
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "rounded-xl border p-4 md:p-5 transition-colors",
          !current && editing
            ? "border-amber-300 bg-amber-50/60"
            : "border-border bg-white/60",
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "rounded-lg p-2",
                !current ? "bg-amber-100 text-amber-700" : "bg-teal-100 text-teal-700",
              )}
            >
              <UserCog className="h-5 w-5" />
            </div>
            <div className="space-y-0.5">
              <h3 className="text-sm font-semibold">销售个人设置</h3>
              <p className="text-xs text-muted-foreground">
                设置你的 Sales Rep 代号（1-4 个字母/数字，如 LJ、AA1），之后所有报价单会自动带入。
              </p>
            </div>
          </div>
          {flash === "saved" && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
              <Check className="h-3.5 w-3.5" />
              已保存
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Sales Rep 代号
            </label>
            {editing ? (
              <input
                type="text"
                value={draft}
                onChange={(e) =>
                  setDraft(e.target.value.toUpperCase().slice(0, 4))
                }
                placeholder="如 LJ"
                autoFocus
                className="mt-1 block w-32 rounded-lg border border-border bg-white px-3 py-2 font-mono text-base tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            ) : (
              <div className="mt-1 w-32 rounded-lg border border-border bg-muted/20 px-3 py-2 font-mono text-base tracking-widest">
                {current || <span className="text-muted-foreground text-sm normal-case">未设置</span>}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={handleRequestSave}
                  disabled={!valid || saving}
                  className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  保存
                </button>
                {current && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(current);
                      setEditing(false);
                    }}
                    className="rounded-lg border border-border bg-white px-4 py-2 text-sm text-muted-foreground hover:bg-muted/20"
                  >
                    取消
                  </button>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-lg border border-border bg-white px-4 py-2 text-sm text-muted-foreground hover:bg-muted/20"
              >
                编辑
              </button>
            )}
          </div>
          {!valid && editing && draft && (
            <span className="text-xs text-red-500">只能用 1-4 个字母或数字</span>
          )}
        </div>
      </div>

      {/* 确认弹框 */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !saving && setConfirmOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-base font-semibold">确认 Sales Rep 代号</h4>
            <p className="mt-2 text-sm text-muted-foreground">
              将设置为{" "}
              <span className="font-mono font-bold text-teal-700 text-base">
                {normalized}
              </span>
              ，确认后所有新建报价单都会自动填入这个代号，订单号也会用它。确认保存吗？
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={saving}
                className="rounded-lg border border-border bg-white px-4 py-2 text-sm text-muted-foreground hover:bg-muted/20 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={doSave}
                disabled={saving}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {saving ? (
                  <span className="flex items-center gap-1">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    保存中...
                  </span>
                ) : (
                  "确认"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
