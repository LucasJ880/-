/**
 * T5 Segment 2.5 — workDomain 兼容闭环（纯平面，零 DB / 零 LLM）
 *
 * DOMAIN-01..12：显式域必填、缺失不再落 system、旧 run 只能由 durable server facts
 * 证明为 sales、canonical 项目域优先于工具推断、歧义与 admin 一律 fail-closed。
 *
 * 运行：npx tsx src/lib/workforce-runtime/__tests__/t5-seg25-work-domain.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  toolDomainForWorkDomain,
  allowRolesForToolDomain,
} from "../execution-policy";
import {
  classifyLegacyToolEvidence,
  normalizeWorkDomain,
  toolDomainClass,
  WORK_DOMAINS,
} from "../work-domain";
import { RUNTIME_V2_TOOL_CATALOG } from "@/lib/agent-runtime-v2/tool-catalog";
import { TENDER_WORKFORCE_TOOL_DESCRIPTORS } from "@/lib/tender-workforce/tools";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
}

const ROOT = join(process.cwd(), "src", "lib");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const SALES_TOOL = RUNTIME_V2_TOOL_CATALOG[0]!.name;
const SALES_TOOL_2 = RUNTIME_V2_TOOL_CATALOG[1]!.name;
const TENDER_TOOL = TENDER_WORKFORCE_TOOL_DESCRIPTORS[0]!.name;

console.log("T5 Segment 2.5 — workDomain 兼容闭环");

/* ── DOMAIN-01..04：显式域映射 ── */
ok(
  toolDomainForWorkDomain("sales") === "sales" &&
    allowRolesForToolDomain("sales").includes("sales"),
  "DOMAIN-01: 显式 sales → sales 域（允许 sales 角色）",
);
ok(
  toolDomainForWorkDomain("tender") === "project" &&
    allowRolesForToolDomain("project").includes("sales"),
  "DOMAIN-02: 显式 tender → project 域",
);
ok(
  toolDomainForWorkDomain("delivery") === "project",
  "DOMAIN-03: 显式 delivery → project 域",
);
ok(
  toolDomainForWorkDomain("general") === "system" &&
    JSON.stringify(allowRolesForToolDomain("system")) === '["admin"]',
  "DOMAIN-04: 显式 general → system 域（且仅 admin）",
);

/* ── system 只能来自显式 general ── */
{
  const nonGeneral = [
    undefined,
    null,
    "",
    "   ",
    "unknown",
    "SALES_LEGACY",
    "system",
    "project",
  ];
  ok(
    nonGeneral.every((v) => toolDomainForWorkDomain(v) !== "system"),
    "DOMAIN-04b: 缺失/未知**绝不**映射为 system（system 只来自显式 general）",
    nonGeneral.map((v) => [v, toolDomainForWorkDomain(v)]),
  );
  ok(
    [undefined, null, "", "unknown", "system"].every(
      (v) => toolDomainForWorkDomain(v) === null,
    ),
    "DOMAIN-04c: 缺失/未知返回 null（无兜底域，由取证层决定）",
  );
}

/* ── DOMAIN-05：新建 Job 必须显式域，且在任何 DB 写之前拒绝 ── */
{
  // 在**去注释后的代码**上比位置：文件头说明里同样会出现 createAgentRun 等字样
  const jobSrc = read("workforce-runtime/job.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const guardAt = jobSrc.indexOf('return { ok: false, error: "WORK_DOMAIN_REQUIRED" };');
  const firstWrite = Math.min(
    ...["db.agentSession", "db.agentRun.create(", "createAgentRun({", "db.$transaction("]
      .map((m) => {
        const i = jobSrc.indexOf(m);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      }),
  );
  ok(
    guardAt > 0 && guardAt < firstWrite,
    "DOMAIN-05: createWorkforceJob 缺 workDomain → WORK_DOMAIN_REQUIRED（早于任何 DB 写）",
    { guardAt, firstWrite },
  );
  ok(
    /workDomain: WorkDomain;/.test(read("workforce-runtime/job.ts")),
    "DOMAIN-05b: CreateWorkforceJobInput.workDomain 已改为必填类型",
  );
  ok(
    !/workDomain\s*\?\?\s*["']sales["']/.test(jobSrc) &&
      !/input\.workDomain\s*\|\|\s*["']sales["']/.test(jobSrc),
    "DOMAIN-05c: 新建路径没有 missing → sales 的宽松默认",
  );
}

/* ── DOMAIN-06：旧 run + 已知销售工具 → LEGACY_SALES_COMPAT ── */
{
  const r = classifyLegacyToolEvidence([SALES_TOOL, SALES_TOOL_2, null]);
  ok(
    r.ok && r.workDomain === "sales",
    "DOMAIN-06: 旧 run 的持久化工具全属销售执行集合 → sales（窄兼容）",
    r,
  );
}

/* ── DOMAIN-08：未知工具 → fail closed ── */
{
  const r = classifyLegacyToolEvidence([SALES_TOOL, "some_future_tool"]);
  ok(
    !r.ok && r.code === "work_domain_ambiguous",
    "DOMAIN-08: 出现无法归类的工具 → 歧义 fail-closed（不按多数派猜）",
    r,
  );
  const empty = classifyLegacyToolEvidence([null, undefined, ""]);
  ok(
    !empty.ok && empty.code === "work_domain_missing",
    "DOMAIN-08b: 零工具证据 → missing（绝不当成 sales）",
    empty,
  );
}

/* ── DOMAIN-09：混合域证据 → fail closed ── */
{
  const r = classifyLegacyToolEvidence([SALES_TOOL, TENDER_TOOL]);
  ok(
    !r.ok && r.code === "work_domain_ambiguous",
    "DOMAIN-09: 销售域与项目域工具混合 → 歧义 fail-closed",
    r,
  );
  const projectOnly = classifyLegacyToolEvidence([TENDER_TOOL]);
  ok(
    !projectOnly.ok && projectOnly.code === "work_domain_ambiguous",
    "DOMAIN-09b: 纯项目域工具但无 workDomain/项目归属 → 歧义（不擅自归 sales）",
    projectOnly,
  );
}

/* ── §7：工具域归属从既有 registry 派生，不新建名单 ── */
{
  const wdSrc = read("workforce-runtime/work-domain.ts");
  ok(
    wdSrc.includes("getRuntimeV2Tool") &&
      wdSrc.includes("TENDER_WORKFORCE_TOOL_DESCRIPTORS") &&
      !/LEGACY_SALES_TOOL_NAMES|const\s+SALES_TOOLS\s*=\s*\[/.test(wdSrc),
    "DOMAIN-07: 工具域归属派生自既有 registry（零第二份工具名单）",
  );
  ok(
    RUNTIME_V2_TOOL_CATALOG.every((t) => toolDomainClass(t.name) === "sales") &&
      TENDER_WORKFORCE_TOOL_DESCRIPTORS.every(
        (t) => toolDomainClass(t.name) === "project",
      ),
    "DOMAIN-07b: 两个 registry 的每个工具都被正确归类",
  );
}

/* ── DOMAIN-10 / §8：显式域不可被工具证据降级 ── */
{
  const wdSrc = read("workforce-runtime/work-domain.ts");
  const explicitAt = wdSrc.indexOf('source: "EXPLICIT"');
  const projectAt = wdSrc.indexOf('source: "PROJECT_CANONICAL"');
  const legacyAt = wdSrc.indexOf('source: "LEGACY_SALES_COMPAT"');
  ok(
    explicitAt > 0 && explicitAt < projectAt && projectAt < legacyAt,
    "DOMAIN-10: 解析顺序 EXPLICIT → PROJECT_CANONICAL → LEGACY_SALES_COMPAT",
    { explicitAt, projectAt, legacyAt },
  );
  // 显式 tender 的 run 永远解析为 tender：工具证据分支在其之后且不可达
  ok(
    normalizeWorkDomain("tender") === "tender" &&
      toolDomainForWorkDomain("tender") === "project",
    "DOMAIN-10b: 显式 tender 恒为 project 域——销售工具只会被 project 策略拒绝，不会把 run 降级为 sales",
  );
}

/* ── DOMAIN-11：用户角色不是业务域 ── */
{
  const wdSrc = read("workforce-runtime/work-domain.ts");
  const polSrc = read("workforce-runtime/execution-policy.ts");
  const roleInference =
    /role\s*===\s*["']sales["']\s*\)?\s*(\?|&&|\|\|)?\s*.{0,40}workDomain/s.test(
      wdSrc + polSrc,
    ) || /workDomain\s*=\s*.*\brole\b/.test(wdSrc);
  ok(
    !roleInference && !wdSrc.includes("input.role"),
    "DOMAIN-11: 域解析完全不读用户角色（ROLE_BASED_DOMAIN_INFERENCE = 0）",
  );
  // 只看代码：文件头的设计说明本来就要写明"不用 goal / 时间戳猜域"
  const wdCode = wdSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  ok(
    !wdCode.includes("goal") &&
      !wdCode.includes("createdAt") &&
      !wdCode.includes("cutoff"),
    "DOMAIN-11b: 不用 goal 自然语言 / 时间戳 cutoff 猜域",
    wdCode.match(/goal|createdAt|cutoff/g),
  );
}

/* ── DOMAIN-12：admin 不能因 system 兜底绕过缺失域 ── */
{
  const polSrc = read("workforce-runtime/execution-policy.ts");
  // 域解析失败在租户解析之前返回，且返回体不含任何 policy
  const domainFailAt = polSrc.indexOf("if (!domain.ok)");
  const tenantAt = polSrc.indexOf("resolveAgentTenant(");
  ok(
    domainFailAt > 0 && domainFailAt < tenantAt,
    "DOMAIN-12: 域不可证明时在解析租户/管理员身份之前就 fail-closed",
    { domainFailAt, tenantAt },
  );
  ok(
    !/isPlatformAdmin[\s\S]{0,200}workDomain\s*=/.test(polSrc),
    "DOMAIN-12b: 没有任何 admin 专属的域兜底分支",
  );
  // system 域只允许 admin —— 但这条路只能由显式 general 进入
  ok(
    toolDomainForWorkDomain(undefined) === null &&
      JSON.stringify(allowRolesForToolDomain("system")) === '["admin"]',
    "DOMAIN-12c: 缺失域拿不到 system，admin 的 system 通道对旧 run 不可达",
  );
}

/* ── §10 缓存正确性 ── */
{
  const polSrc = read("workforce-runtime/execution-policy.ts");
  const cacheSetAt = polSrc.indexOf("cache.set(key,");
  const domainFailAt = polSrc.indexOf("if (!domain.ok)");
  ok(
    domainFailAt > 0 && domainFailAt < cacheSetAt,
    "DOMAIN-13: 歧义/缺失永不入缓存（只缓存最终 server 解析成功的有效域）",
  );
  ok(
    polSrc.includes("workDomainResolutionSource") &&
      polSrc.includes("workDomain: domain.workDomain"),
    "DOMAIN-13b: 缓存的是解析后的有效域与来源，而非原始 metadata",
  );
}

/* ── §11 可观测性：仅服务端，不参与授权 ── */
{
  const polSrc = read("workforce-runtime/execution-policy.ts");
  ok(
    /workDomainResolutionSource: WorkDomainResolutionSource/.test(polSrc),
    "DOMAIN-14: policy 暴露 workDomainResolutionSource（EXPLICIT / PROJECT_CANONICAL / LEGACY_SALES_COMPAT）",
  );
  const execSrc = read("agent-runtime-v2/executor.ts");
  ok(
    !execSrc.includes("workDomainResolutionSource"),
    "DOMAIN-14b: 解析来源不参与任何授权判定（executor 不读它）",
  );
  const wdSrc = read("workforce-runtime/work-domain.ts");
  ok(
    wdSrc.includes('"work_domain_missing"') &&
      wdSrc.includes('"work_domain_ambiguous"') &&
      execSrc.includes("errorCode: policyResult.code"),
    "DOMAIN-14c: 失败落 durable 错误码 work_domain_missing / work_domain_ambiguous",
  );
}

/* ── §14：非 tender 域的 planner 工具投影不再被剥空 ── */
{
  const procSrc = read("workforce-runtime/processor.ts");
  ok(
    procSrc.includes("scopedTools ?? plannerVisibleRuntimeV2Tools()") &&
      !procSrc.includes("scopedTools ?? []"),
    "DOMAIN-15: SALES_PLANNER_TOOL_STRIPPING = 0（回落 canonical planner 投影，未撤销）",
  );
}

/* ── 词表完整性 ── */
ok(
  WORK_DOMAINS.every((d) => toolDomainForWorkDomain(d) !== null) &&
    WORK_DOMAINS.every((d) => normalizeWorkDomain(d) === d),
  "DOMAIN-16: 四个已知域全部可规范化且有 ToolDomain 映射",
);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
