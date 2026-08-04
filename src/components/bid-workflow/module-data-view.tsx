"use client";

import { useState } from "react";
import {
  fieldLabel,
  formatDisplayValue,
} from "@/lib/bid-workflow/display-labels";

const KNOWN_KEYS_BY_MODULE: Record<string, string[]> = {
  project_understanding: [
    "projectName",
    "tenderNumber",
    "procuringAgency",
    "endUser",
    "product",
    "quantity",
    "contractTerm",
    "deliveryLocation",
    "submissionPlatform",
    "closeDate",
    "questionCloseDate",
    "mandatoryHighlights",
  ],
  contract_value: [
    "initialAwardAmount",
    "amendmentAmount",
    "finalContractCeiling",
    "currency",
    "contractTerm",
    "estimatedAnnualVolume",
    "guaranteedPurchase",
    "aiExplanation",
    "officialSource",
  ],
  commercial_judgment: [
    "humanDecision",
    "aiSuggestion",
    "note",
    "decidedAt",
  ],
  deliverables: ["items"],
  historical_awards: ["awards"],
};

type Props = {
  moduleKey: string;
  dataJson: unknown;
};

function asRecord(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

export function ModuleDataView({ moduleKey, dataJson }: Props) {
  const [openOther, setOpenOther] = useState(false);
  const data = asRecord(dataJson);
  const known = KNOWN_KEYS_BY_MODULE[moduleKey] || Object.keys(data);
  const knownEntries = known
    .map((k) => [k, data[k]] as const)
    .filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0));

  const otherKeys = Object.keys(data).filter((k) => !known.includes(k));
  const otherEntries = otherKeys
    .map((k) => [k, data[k]] as const)
    .filter(([, v]) => v != null && v !== "");

  if (knownEntries.length === 0 && otherEntries.length === 0) {
    return (
      <p className="text-xs text-[var(--muted)]">
        暂无结构化内容。可通过下方「建议保存」补充事实，或在项目 AI 工作台继续调查。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <dl className="space-y-1.5">
        {knownEntries.map(([key, value]) => (
          <div key={key} className="grid grid-cols-[7rem_1fr] gap-2 text-xs">
            <dt className="text-[var(--muted)]">{fieldLabel(key)}</dt>
            <dd className="font-medium text-[var(--foreground)] break-words">
              {key === "items" && Array.isArray(value) ? (
                <ul className="list-disc pl-4 space-y-0.5">
                  {value.map((item, idx) => {
                    const row =
                      item && typeof item === "object"
                        ? (item as { title?: string; ready?: boolean })
                        : null;
                    return (
                      <li key={idx}>
                        {row?.title || formatDisplayValue(item)}
                        {row?.ready === true
                          ? "（已就绪）"
                          : row?.ready === false
                            ? "（待准备）"
                            : ""}
                      </li>
                    );
                  })}
                </ul>
              ) : key === "awards" && Array.isArray(value) ? (
                value.length === 0 ? (
                  "暂无中标记录"
                ) : (
                  `${value.length} 条记录`
                )
              ) : (
                formatDisplayValue(value)
              )}
            </dd>
          </div>
        ))}
      </dl>

      {moduleKey === "contract_value" && (
        <p className="text-[11px] text-amber-800 bg-amber-50 rounded px-2 py-1">
          注意：最终合同上限 ≠ 单年保证采购额；请分别核实。
        </p>
      )}

      {otherEntries.length > 0 && (
        <div className="border-t border-[var(--border)] pt-2">
          <button
            type="button"
            className="text-[11px] underline text-[var(--muted)]"
            onClick={() => setOpenOther((v) => !v)}
          >
            {openOther ? "收起其他信息" : `其他信息（${otherEntries.length}）`}
          </button>
          {openOther && (
            <dl className="mt-2 space-y-1">
              {otherEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="grid grid-cols-[7rem_1fr] gap-2 text-[11px]"
                >
                  <dt className="text-[var(--muted)]">{fieldLabel(key)}</dt>
                  <dd className="break-words">{formatDisplayValue(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
