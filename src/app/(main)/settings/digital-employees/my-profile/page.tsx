"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { Loader2 } from "lucide-react";

interface ProfileResp {
  enabled: boolean;
  profile: {
    id: string;
    version: number;
    consentConfirmed: boolean;
    preferredLanguage?: string | null;
    responseDetailLevel?: string | null;
    learnedPreferences?: { inferred?: Record<string, { preference?: string }> };
    manuallyConfirmedPreferences?: { confirmed?: Record<string, unknown> };
    status: string;
  };
  suggestions: Array<{
    preferenceKey: string;
    preference: string;
    confidence: number;
    evidenceCount: number;
  }>;
  metrics: {
    acceptRate: number;
    editRate: number;
    rejectRate: number;
    confirmedPreferenceCount: number;
  };
  privacy: { records: string[]; neverRecords: string[] };
}

export default function MyAiProfilePage() {
  const [data, setData] = useState<ProfileResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState("balanced");
  const [lang, setLang] = useState("zh");
  const [saving, setSaving] = useState(false);

  const reload = () =>
    apiJson<ProfileResp>("/api/me/ai-profile")
      .then((d) => {
        setData(d);
        if (d.profile.responseDetailLevel) setDetail(d.profile.responseDetailLevel);
        if (d.profile.preferredLanguage) setLang(d.profile.preferredLanguage);
      })
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

  if (!data) {
    return <div className="p-6 text-sm text-red-700">加载失败</div>;
  }

  const inferred = data.profile.learnedPreferences?.inferred || {};
  const confirmed = data.profile.manuallyConfirmedPreferences?.confirmed || {};

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-2 text-[12px]">
        <Link href="/settings/digital-employees" className="text-[#68706c] hover:underline">
          ← 数字员工学习
        </Link>
      </div>
      <PageHeader
        title="我的 AI 偏好"
        description={
          data.enabled
            ? "学习功能已对你的账号开启（仍须你确认偏好后才生效）。"
            : "学习功能当前未对你的账号开启（Feature Flag）。仍可查看隐私说明。"
        }
      />

      {!data.profile.consentConfirmed && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-950">
          <p className="font-medium">首次启用知情确认</p>
          <p className="mt-1 text-[12px]">
            我们将记录工作建议的接受/修改/拒绝，用于改进你的个人数字助理；默认不进入部门学习。
          </p>
          <ul className="mt-2 list-disc pl-5 text-[12px]">
            {data.privacy.neverRecords.map((x) => (
              <li key={x}>不会记录：{x}</li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-3 rounded-md bg-[#202422] px-3 py-1.5 text-[12px] text-white"
            onClick={async () => {
              await apiFetch("/api/me/ai-profile", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ consentConfirmed: true }),
              });
              void reload();
            }}
          >
            我已知晓并同意
          </button>
        </div>
      )}

      <section className="mt-6 rounded-xl border border-black/[0.06] bg-white p-4">
        <h2 className="text-[14px] font-semibold">偏好设置</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-[12px]">
            语言
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="mt-1 w-full rounded-md border px-2 py-1.5"
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="text-[12px]">
            详细程度
            <select
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              className="mt-1 w-full rounded-md border px-2 py-1.5"
            >
              <option value="concise">简洁</option>
              <option value="balanced">适中</option>
              <option value="detailed">详细</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          disabled={saving}
          className="mt-3 rounded-md bg-[#202422] px-3 py-1.5 text-[12px] text-white disabled:opacity-50"
          onClick={async () => {
            setSaving(true);
            try {
              await apiFetch("/api/me/ai-profile", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  preferredLanguage: lang,
                  responseDetailLevel: detail,
                }),
              });
              void reload();
            } finally {
              setSaving(false);
            }
          }}
        >
          保存
        </button>
      </section>

      <section className="mt-4 rounded-xl border border-black/[0.06] bg-white p-4">
        <h2 className="text-[14px] font-semibold">待确认的推断偏好</h2>
        <p className="mt-1 text-[12px] text-[#68706c]">
          AI 不会自动确认；须你选择「是 / 否 / 不再学习」。
        </p>
        <div className="mt-3 space-y-3">
          {[...data.suggestions, ...Object.entries(inferred).map(([k, v]) => ({
            preferenceKey: k,
            preference: v?.preference || k,
            confidence: 0,
            evidenceCount: 0,
          }))].map((s) => (
            <div
              key={s.preferenceKey}
              className="rounded-lg border border-black/[0.06] p-3 text-[12px]"
            >
              <div className="font-medium text-[#171a19]">{s.preference}</div>
              {s.confidence > 0 && (
                <div className="mt-0.5 text-[#68706c]">
                  置信度 {(s.confidence * 100).toFixed(0)}% · 样本 {s.evidenceCount}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {(
                  [
                    ["confirm", "是"],
                    ["reject", "否"],
                    ["stop_learning", "不再学习这一项"],
                  ] as const
                ).map(([d, label]) => (
                  <button
                    key={d}
                    type="button"
                    className="rounded-md border px-2 py-1 hover:bg-[#f4f5f5]"
                    onClick={async () => {
                      await apiFetch("/api/me/ai-profile", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          preferenceKey: s.preferenceKey,
                          inferredDecision: d,
                        }),
                      });
                      void reload();
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {data.suggestions.length === 0 && Object.keys(inferred).length === 0 && (
            <p className="text-[12px] text-[#68706c]">暂无待确认项</p>
          )}
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-black/[0.06] bg-white p-4">
        <h2 className="text-[14px] font-semibold">已确认偏好</h2>
        <ul className="mt-2 list-disc pl-5 text-[12px] text-[#202422]">
          {Object.entries(confirmed).map(([k, v]) => (
            <li key={k}>
              {k}: {typeof v === "string" ? v : JSON.stringify(v)}
            </li>
          ))}
          {Object.keys(confirmed).length === 0 && (
            <li className="list-none text-[#68706c]">尚无已确认偏好</li>
          )}
        </ul>
      </section>

      <section className="mt-4 rounded-xl border border-black/[0.06] bg-white p-4">
        <h2 className="text-[14px] font-semibold">我的使用指标（非绩效排名）</h2>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[12px]">
          <div className="rounded-lg bg-[#f4f5f5] p-2">
            接受率 {(data.metrics.acceptRate * 100).toFixed(0)}%
          </div>
          <div className="rounded-lg bg-[#f4f5f5] p-2">
            修改率 {(data.metrics.editRate * 100).toFixed(0)}%
          </div>
          <div className="rounded-lg bg-[#f4f5f5] p-2">
            已确认 {data.metrics.confirmedPreferenceCount}
          </div>
        </div>
      </section>
    </div>
  );
}
