/**
 * 企业数字员工技能 — 结构与安全基线
 * 运行：npx tsx src/lib/agent-core/skills/__tests__/enterprise-skills.test.ts
 */

import { ENTERPRISE_SKILLS } from "../enterprise-index";
import { DIGITAL_EMPLOYEE_ROLES } from "../digital-employee-roles";
import { OPERATIONS_SKILLS } from "../operations-seed";

let total = 0;
let failed = 0;

function expect(condition: boolean, message: string) {
  total += 1;
  if (condition) {
    console.log(`✓ ${message}`);
    return;
  }
  failed += 1;
  console.error(`✗ ${message}`);
}

const slugs = ENTERPRISE_SKILLS.map((s) => s.slug);
const unique = new Set(slugs);
const opsSlugs = new Set(OPERATIONS_SKILLS.map((s) => s.slug));

expect(ENTERPRISE_SKILLS.length >= 10, `至少 10 个企业技能（实际 ${ENTERPRISE_SKILLS.length}）`);
expect(unique.size === slugs.length, "企业技能 slug 全局唯一");

for (const slug of slugs) {
  expect(!opsSlugs.has(slug), `不与运营技能冲突: ${slug}`);
}

const FORBIDDEN_DIRECT = [
  "直接发送邮件",
  "直接调整预算",
  "直接发布",
  "直接修改销售阶段",
  "自动提交投标",
  "sales_send_quote_email",
  "marketing_publish",
];

const TEMPLATE_VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

for (const skill of ENTERPRISE_SKILLS) {
  expect(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.slug), `slug 合法: ${skill.slug}`);
  expect(skill.name.trim().length > 0, `名称非空: ${skill.slug}`);
  expect(Boolean(skill.inputSchema), `inputSchema 存在: ${skill.slug}`);
  expect(skill.systemPrompt.trim().length > 50, `systemPrompt 非空: ${skill.slug}`);
  expect(skill.userPromptTemplate.includes("{{"), `userPromptTemplate 含变量: ${skill.slug}`);
  expect(skill.maxTokens >= 1000 && skill.maxTokens <= 16000, `maxTokens 合理: ${skill.slug}`);
  expect(
    ["foundation", "analysis", "execution"].includes(skill.tier),
    `tier 合法: ${skill.slug}`,
  );
  expect(
    skill.systemPrompt.includes("已观察事实") ||
      skill.systemPrompt.includes("事实") &&
        skill.systemPrompt.includes("推断") &&
        skill.systemPrompt.includes("建议"),
    `区分事实/推断/建议: ${skill.slug}`,
  );
  expect(
    skill.systemPrompt.includes("PendingAction") ||
      skill.systemPrompt.includes("pendingActionProposal") ||
      skill.systemPrompt.includes("人工确认") ||
      skill.systemPrompt.includes("不得直接"),
    `副作用审批约束: ${skill.slug}`,
  );

  if (skill.outputFormat === "json") {
    expect(Boolean(skill.outputSchema), `JSON 技能有 outputSchema: ${skill.slug}`);
  }

  if (skill.requiredTools) {
    const tools = skill.requiredTools.split(",").map((t) => t.trim()).filter(Boolean);
    expect(tools.every((t) => /^[a-z][a-z0-9_]*$/.test(t)), `requiredTools 格式: ${skill.slug}`);
    expect(
      !tools.some((t) =>
        ["sales_send_quote_email", "sales_advance_stage", "secretary_execute_action"].includes(t),
      ),
      `不绑定高危直写工具: ${skill.slug}`,
    );
  }

  const props =
    skill.inputSchema &&
    typeof skill.inputSchema === "object" &&
    "properties" in skill.inputSchema &&
    skill.inputSchema.properties &&
    typeof skill.inputSchema.properties === "object"
      ? Object.keys(skill.inputSchema.properties as object)
      : [];
  const vars = [...skill.userPromptTemplate.matchAll(TEMPLATE_VAR_RE)].map((m) => m[1]);
  for (const v of vars) {
    expect(
      props.includes(v) || v === "brandContext",
      `模板变量在 schema 中: ${skill.slug}.${v}`,
    );
  }

  const blob = `${skill.systemPrompt}\n${skill.userPromptTemplate}`;
  for (const phrase of FORBIDDEN_DIRECT) {
    expect(!blob.includes(`允许${phrase}`), `无放行危险表述(${phrase}): ${skill.slug}`);
  }
}

const roleSlugs = DIGITAL_EMPLOYEE_ROLES.flatMap((r) => r.skillSlugs);
for (const slug of roleSlugs) {
  expect(unique.has(slug), `角色推荐技能存在: ${slug}`);
}
expect(DIGITAL_EMPLOYEE_ROLES.length === 4, "四个数字员工角色分组");

console.log(
  `\n${failed === 0 ? "✅" : "❌"} enterprise-skills: ${total - failed}/${total} 通过`,
);
if (failed > 0) process.exit(1);
