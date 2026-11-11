"use client";

/**
 * VIS-1e 以岗位预览横幅（spec authorization/position-preview「横幅与失效」）：
 * active —「正在以〈企业 · 岗位〉预览（只读）」+ 剩余分钟 + 退出；invalid —「预览已失效 · 退出」。退出后整页回到首页。
 */

import { useEffect, useState } from "react";
import { clearStoredOrgId } from "@/lib/org-selection";
import { apiFetch } from "@/lib/api-fetch";
import { usePreviewInfo } from "@/lib/hooks/use-preview";

function minutesLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));
}

export function PreviewBanner() {
  const preview = usePreviewInfo();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!preview) return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [preview]);

  if (!preview) return null;

  async function exit() {
    setBusy(true);
    await apiFetch("/api/admin/preview", { method: "DELETE" }).catch(() => null);
    // 预览中本地记住的是预览企业；清掉后由服务端的当前企业重新 hydrate
    clearStoredOrgId();
    window.location.assign("/");
  }

  const label = [preview.orgName, preview.positions.map((p) => p.name).join("、")].filter(Boolean).join(" · ");
  return (
    <div
      role="status"
      data-testid="preview-banner"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#e0b44c] bg-[#fff6dd] px-4 py-2 text-xs text-[#6b4e00]"
    >
      {preview.state === "active" ? (
        <span>
          正在以〈{label}〉预览（只读）· 剩余 {minutesLeft(preview.expiresAt, now)} 分钟
        </span>
      ) : (
        <span>预览已失效</span>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={exit}
        className="rounded border border-[#c99a2e] px-2 py-0.5 font-medium hover:bg-[#ffecb3] disabled:opacity-50"
      >
        {preview.state === "active" ? "退出预览" : "退出"}
      </button>
    </div>
  );
}
