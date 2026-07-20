"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { Loader2 } from "lucide-react";

interface Playbook {
  id: string;
  name: string;
  description: string;
  version: number;
  status: string;
  department: string;
  roleScope: string;
  approvedAt?: string | null;
}

export default function PlaybooksPage() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = () =>
    apiJson<{ playbooks: Playbook[] }>("/api/team/playbooks")
      .then((d) => setPlaybooks(d.playbooks || []))
      .finally(() => setLoading(false));

  useEffect(() => {
    void reload();
  }, []);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-2 text-[12px]">
        <Link href="/settings/digital-employees" className="text-[#68706c] hover:underline">
          ← 数字员工学习
        </Link>
      </div>
      <PageHeader
        title="部门 Playbook"
        description="版本化正式工作方法。发布不覆盖历史；支持回滚。数字员工仅加载 active 版本。"
      />

      <div className="mt-6 space-y-3">
        {playbooks.map((p) => (
          <div
            key={p.id}
            className="rounded-xl border border-black/[0.06] bg-white p-4 text-[13px]"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-[#171a19]">
                  {p.name}{" "}
                  <span className="text-[12px] font-normal text-[#68706c]">
                    v{p.version}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-[#68706c]">
                  {p.department} · {p.roleScope} · {p.status}
                </div>
              </div>
              <span className="rounded-md bg-[#f4f5f5] px-2 py-0.5 text-[11px]">
                {p.status}
              </span>
            </div>
            <p className="mt-2 text-[12px] text-[#68706c]">{p.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {p.status === "draft" && (
                <button
                  type="button"
                  className="rounded-md bg-[#202422] px-3 py-1.5 text-[12px] text-white"
                  onClick={async () => {
                    await apiFetch(`/api/team/playbooks/${p.id}/publish`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({}),
                    });
                    void reload();
                  }}
                >
                  发布
                </button>
              )}
              {p.status === "active" && (
                <button
                  type="button"
                  className="rounded-md border px-3 py-1.5 text-[12px]"
                  onClick={async () => {
                    await apiFetch(`/api/team/playbooks/${p.id}/retire`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({}),
                    });
                    void reload();
                  }}
                >
                  停用
                </button>
              )}
              {(p.status === "retired" || p.status === "active") && (
                <button
                  type="button"
                  className="rounded-md border px-3 py-1.5 text-[12px]"
                  onClick={async () => {
                    await apiFetch(`/api/team/playbooks/${p.id}/retire`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "rollback" }),
                    });
                    void reload();
                  }}
                >
                  回滚为此版本（发新版）
                </button>
              )}
            </div>
          </div>
        ))}
        {playbooks.length === 0 && (
          <p className="text-[12px] text-[#68706c]">暂无 Playbook</p>
        )}
      </div>
    </div>
  );
}
