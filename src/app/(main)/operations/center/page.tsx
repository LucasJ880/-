"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import {
  ORG_MODULES,
  parseOrgModulesJson,
  type OrgModule,
  type OrgModulesConfig,
} from "@/lib/tenancy/modules";

const MODULE_CARDS: Array<{
  module: OrgModule;
  title: string;
  description: string;
  href: string;
}> = [
  {
    module: "sales",
    title: "销售",
    description: "客户、商机、报价与跟进",
    href: "/sales",
  },
  {
    module: "bids",
    title: "招投标",
    description: "项目受理、投标与供应商协同",
    href: "/projects",
  },
  {
    module: "projects",
    title: "项目执行",
    description: "项目推进与交付协作",
    href: "/projects",
  },
  {
    module: "trade",
    title: "外贸",
    description: "线索、外贸报价与履约",
    href: "/trade",
  },
  {
    module: "product_content",
    title: "产品内容",
    description: "套图模版与产品内容生成",
    href: "/product-content",
  },
  {
    module: "marketing",
    title: "营销",
    description: "品牌与内容运营",
    href: "/operations",
  },
  {
    module: "supply_chain",
    title: "供应链",
    description: "履约与库存相关能力",
    href: "/trade/fulfillment",
  },
  {
    module: "operations",
    title: "运营",
    description: "客服收件箱与发布运营",
    href: "/service-inbox",
  },
];

type ConfigIssue = {
  ruleKey: string;
  status: string;
  message: string;
  version: number | null;
};

export default function OperationsCenterPage() {
  const [modules, setModules] = useState<OrgModulesConfig | null>(null);
  const [orgName, setOrgName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [issues, setIssues] = useState<ConfigIssue[]>([]);
  const [packLabel, setPackLabel] = useState<string>("");
  const [metricStatus, setMetricStatus] = useState<"ok" | "missing" | "">("");
  const [metricNames, setMetricNames] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/auth/active-org");
        if (!res.ok) return;
        const data = (await res.json()) as {
          modules?: unknown;
          organizations?: Array<{ id: string; name: string }>;
          activeOrgId?: string | null;
        };
        if (cancelled) return;
        setModules(
          data.modules
            ? parseOrgModulesJson(data.modules)
            : parseOrgModulesJson(null),
        );
        const active = data.organizations?.find(
          (o) => o.id === data.activeOrgId,
        );
        setOrgName(active?.name ?? "");

        const [healthRes, metricsRes] = await Promise.all([
          apiFetch("/api/operations/config-health"),
          apiFetch("/api/operations/metrics"),
        ]);
        if (healthRes.ok) {
          const health = (await healthRes.json()) as {
            issues?: ConfigIssue[];
            industryPack?: { id?: string | null; name?: string; status?: string };
          };
          if (!cancelled) {
            setIssues(health.issues ?? []);
            const pack = health.industryPack;
            setPackLabel(
              pack?.status === "ok" && pack.name
                ? pack.name
                : pack?.id
                  ? String(pack.id)
                  : "未配置",
            );
          }
        }
        if (metricsRes.ok) {
          const metrics = (await metricsRes.json()) as {
            configStatus?: "ok" | "missing";
            metrics?: Array<{ name: string }>;
          };
          if (!cancelled) {
            setMetricStatus(metrics.configStatus ?? "missing");
            setMetricNames((metrics.metrics ?? []).map((m) => m.name));
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enabled = modules?.enabled?.length
    ? modules.enabled
    : ([...ORG_MODULES] as OrgModule[]);

  const cards = MODULE_CARDS.filter((c) => enabled.includes(c.module));

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="经营中心"
        description={
          orgName
            ? `${orgName} 的企业经营管理入口（按已启用模块展示）`
            : "当前企业的经营管理入口（按已启用模块展示）"
        }
      />

      {!loading && packLabel ? (
        <p className="text-sm text-muted-foreground">
          Industry Pack：{packLabel}
        </p>
      ) : null}

      {!loading && issues.length > 0 ? (
        <div className="rounded-xl border border-amber-300/80 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/40">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
            配置问题（不会静默使用其他企业规则）
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-200">
            {issues.map((issue) => (
              <li key={`${issue.ruleKey}-${issue.status}`}>
                [{issue.status}] {issue.ruleKey}：{issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!loading && metricStatus ? (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-sm font-medium">经营指标定义</p>
          {metricStatus === "missing" ? (
            <p className="mt-1 text-sm text-muted-foreground">
              配置状态：missing — 请运行{" "}
              <code className="text-xs">npm run seed:org:semantics-phase2b</code>{" "}
              或在企业配置中添加指标定义（本阶段不做复杂图表）。
            </p>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {metricNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          当前企业尚未配置启用模块。请联系组织管理员或运行租户 seed。
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.module}
              href={card.href}
              className="rounded-xl border border-border bg-card p-4 transition hover:border-primary/40 hover:shadow-sm"
            >
              <h2 className="text-base font-semibold">{card.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {card.description}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
