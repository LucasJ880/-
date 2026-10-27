/**
 * PERM-1：岗位绑定脚本的纯逻辑（解析 / 校验 / 差异计划）
 *
 * 不读库、不读环境；脚本 scripts/bind-positions.ts 只做 IO 与落库。
 * 规格：openspec/changes/perm-1-positions/specs/authorization/position-binding/spec.md
 */

export const TODO_PREFIX = "TODO:";

export type BindingFile = {
  /** 邮箱（小写）→ 岗位 key 列表（去重、保序） */
  bindings: Record<string, string[]>;
};

export type ParseResult =
  | { ok: true; value: BindingFile }
  | { ok: false; errors: string[] };

/** 解析绑定文件文本：JSON、顶层 bindings 对象、重复邮箱（大小写不敏感）、岗位数组 */
export function parseBindingFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`JSON 解析失败：${e instanceof Error ? e.message : String(e)}`] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["顶层必须是对象"] };
  }
  const bindingsRaw = (raw as { bindings?: unknown }).bindings;
  if (!bindingsRaw || typeof bindingsRaw !== "object" || Array.isArray(bindingsRaw)) {
    return { ok: false, errors: ["缺少顶层 bindings 对象（邮箱 → 岗位 key 数组）"] };
  }

  const errors: string[] = [];
  const bindings: Record<string, string[]> = {};
  const seen = new Map<string, string>();
  for (const [emailRaw, keysRaw] of Object.entries(bindingsRaw as Record<string, unknown>)) {
    const email = emailRaw.trim();
    const lower = email.toLowerCase();
    if (!email) {
      errors.push("存在空邮箱键");
      continue;
    }
    if (seen.has(lower)) {
      errors.push(`邮箱重复：${seen.get(lower)} 与 ${email}`);
      continue;
    }
    seen.set(lower, email);
    if (!Array.isArray(keysRaw) || keysRaw.some((k) => typeof k !== "string")) {
      errors.push(`${email}：岗位必须是字符串数组`);
      continue;
    }
    const keys = [...new Set((keysRaw as string[]).map((k) => k.trim()).filter(Boolean))];
    bindings[email.startsWith(TODO_PREFIX) ? email : lower] = keys;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { bindings } };
}

export type MemberInfo = { userId: string; status: string };

export type ValidateInput = {
  file: BindingFile;
  /** 该企业已落地的岗位模板 key */
  knownProfileKeys: readonly string[];
  /** 邮箱（小写）→ 成员信息；不在表里 = 不是本企业成员 */
  membersByEmail: Record<string, MemberInfo>;
};

export type ValidateResult =
  | { ok: true; resolved: Array<{ email: string; userId: string; keys: string[] }> }
  | { ok: false; errors: string[] };

/** 校验：TODO 占位 / 未知岗位 key / 非 active 成员。返回全部错误而非首个。 */
export function validateBindings(input: ValidateInput): ValidateResult {
  const errors: string[] = [];
  const known = new Set(input.knownProfileKeys);
  const resolved: Array<{ email: string; userId: string; keys: string[] }> = [];

  const placeholders = Object.keys(input.file.bindings).filter((e) => e.startsWith(TODO_PREFIX));
  if (placeholders.length) {
    errors.push(`存在未填邮箱的占位：${placeholders.join("、")}`);
  }

  for (const [email, keys] of Object.entries(input.file.bindings)) {
    if (email.startsWith(TODO_PREFIX)) continue;
    const unknown = keys.filter((k) => !known.has(k));
    if (unknown.length) {
      errors.push(`${email}：未知岗位 key ${unknown.join("、")}`);
    }
    const member = input.membersByEmail[email.toLowerCase()];
    if (!member) {
      errors.push(`${email}：不是本企业成员`);
      continue;
    }
    if (member.status !== "active") {
      errors.push(`${email}：成员状态为 ${member.status}，不是 active`);
      continue;
    }
    if (!unknown.length) resolved.push({ email, userId: member.userId, keys });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, resolved };
}

export type ExistingBinding = { userId: string; profileKey: string; status: string };

export type PlanInput = {
  desired: Array<{ email: string; userId: string; keys: string[] }>;
  existing: ExistingBinding[];
  prune: boolean;
  /** 允许被 prune 停用的岗位 key（行业包模板集），系统模板绑定不动 */
  prunableKeys: readonly string[];
};

export type BindingPlan = {
  create: Array<{ email: string; userId: string; profileKey: string }>;
  keep: Array<{ email: string; userId: string; profileKey: string }>;
  deactivate: Array<{ email: string; userId: string; profileKey: string }>;
};

/** 差异计划：已存在 active 不重复创建；文件列出的创建；仅 prune 时停用可 prune 集内未列出的 active 绑定 */
export function planBindingDiff(input: PlanInput): BindingPlan {
  const plan: BindingPlan = { create: [], keep: [], deactivate: [] };
  const prunable = new Set(input.prunableKeys);
  const activeByUser = new Map<string, Set<string>>();
  for (const b of input.existing) {
    if (b.status !== "active") continue;
    if (!activeByUser.has(b.userId)) activeByUser.set(b.userId, new Set());
    activeByUser.get(b.userId)!.add(b.profileKey);
  }

  for (const d of input.desired) {
    const have = activeByUser.get(d.userId) ?? new Set<string>();
    for (const key of d.keys) {
      if (have.has(key)) plan.keep.push({ email: d.email, userId: d.userId, profileKey: key });
      else plan.create.push({ email: d.email, userId: d.userId, profileKey: key });
    }
    if (input.prune) {
      const wanted = new Set(d.keys);
      for (const key of have) {
        if (!wanted.has(key) && prunable.has(key)) {
          plan.deactivate.push({ email: d.email, userId: d.userId, profileKey: key });
        }
      }
    }
  }
  return plan;
}

/** 输出用：把计划压成每人一行（邮箱 + 岗位列表）与计数 */
export function summarizePlan(plan: BindingPlan): { lines: string[]; created: number; deactivated: number } {
  const byEmail = new Map<string, Set<string>>();
  for (const x of [...plan.create, ...plan.keep]) {
    if (!byEmail.has(x.email)) byEmail.set(x.email, new Set());
    byEmail.get(x.email)!.add(x.profileKey);
  }
  const lines = [...byEmail.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([email, keys]) => `${email}: ${[...keys].join(", ")}`);
  return { lines, created: plan.create.length, deactivated: plan.deactivate.length };
}
