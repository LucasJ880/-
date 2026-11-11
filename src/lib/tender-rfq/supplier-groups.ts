/**
 * RFQ-AUTO-5 供应商分组 — 纯逻辑（零依赖，前后端共用）
 *
 * 一个人把自己的供应商按品类分成几组；一个项目用哪一组，按项目名称里有没有某组的关键词来定。
 * 比对是确定性的文字比对：恰好一组对上才算，零组或多组都不选——不猜、不调模型。
 * 分组只决定「先勾选谁 / 起草给谁」；名字与关键词不进发给供应商的任何内容。
 */

export const SUPPLIER_GROUP_LIMITS = {
  groups: 10,
  suppliers: 8,
  keywords: 10,
  nameMax: 30,
  keywordMin: 2,
  keywordMax: 40,
  /** 只含 ASCII 字符（英文字母、数字、空格、标点）的关键词至少这么长：太短的英文片段到处都能对上 */
  asciiKeywordMin: 3,
} as const;

export const SUPPLIER_GROUPS_AUDIT_ACTION = "tender.rfq.supplier_groups_saved" as const;
/** 记录的对象类型；对象 id = 这个人的用户 id（一个人在一个组织里一份分组） */
export const SUPPLIER_GROUPS_TARGET = "rfq_supplier_groups" as const;

export type SupplierGroup = { name: string; supplierIds: string[]; keywords: string[] };
export type SupplierGroupsDoc = { groups: SupplierGroup[] };
export const EMPTY_SUPPLIER_GROUPS: SupplierGroupsDoc = { groups: [] };

/* ---------------------------------- 规整 ---------------------------------- */

/** 比对用的规整：全半角统一、不分大小写、连续空白并成一个、去首尾空白 */
export function normalizeForMatch(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** 保存用的规整：只收拾空白（保留人写的大小写与全半角，显示时原样） */
const tidy = (text: string): string => text.replace(/\s+/g, " ").trim();
const charCount = (text: string): number => [...text].length;
const isAsciiOnly = (text: string): boolean => /^[\x20-\x7e]+$/.test(text);

/** 输入框里的关键词：逗号、顿号、分号或换行分隔 */
export function parseKeywordsInput(text: string): string[] {
  return text.split(/[,，、;；\n]/).map(tidy).filter(Boolean);
}

/* ---------------------------------- 校验 ---------------------------------- */

export type ValidateGroupsResult = { ok: true; doc: SupplierGroupsDoc } | { ok: false; error: string };

/**
 * 校验并规整一份分组。任何一项不对就整体拒绝，说明是哪一项。
 * 供应商是否属于本组织不在这里查（要查库，由服务负责）。
 */
export function validateSupplierGroups(raw: unknown): ValidateGroupsResult {
  const L = SUPPLIER_GROUP_LIMITS;
  const fail = (error: string): ValidateGroupsResult => ({ ok: false, error });
  if (!Array.isArray(raw)) return fail("分组需要是一个列表。");
  if (raw.length > L.groups) return fail(`最多 ${L.groups} 个分组。`);

  const groups: SupplierGroup[] = [];
  const seenNames = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail("分组的格式不对。");
    const g = item as Record<string, unknown>;
    if (typeof g.name !== "string") return fail("每个分组都要有名字。");
    const name = tidy(g.name);
    if (!name) return fail("分组的名字不能为空。");
    if (charCount(name) > L.nameMax) return fail(`分组的名字最多 ${L.nameMax} 个字：「${name.slice(0, 20)}…」。`);
    const nameKey = normalizeForMatch(name);
    if (seenNames.has(nameKey)) return fail(`有两个分组都叫「${name}」（不分大小写），请改一个。`);
    seenNames.add(nameKey);

    if (!Array.isArray(g.supplierIds)) return fail(`分组「${name}」的供应商格式不对。`);
    if (!g.supplierIds.every((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64)) return fail(`分组「${name}」里有无效的供应商。`);
    const supplierIds = g.supplierIds as string[];
    if (supplierIds.length < 1) return fail(`分组「${name}」里至少要有 1 家供应商。`);
    if (supplierIds.length > L.suppliers) return fail(`分组「${name}」里最多 ${L.suppliers} 家供应商。`);
    if (new Set(supplierIds).size !== supplierIds.length) return fail(`分组「${name}」里有重复的供应商。`);

    const rawKeywords = g.keywords === undefined || g.keywords === null ? [] : g.keywords;
    if (!Array.isArray(rawKeywords) || !rawKeywords.every((x): x is string => typeof x === "string")) return fail(`分组「${name}」的关键词格式不对。`);
    const keywords: string[] = [];
    const seenKeywords = new Set<string>();
    for (const k of rawKeywords as string[]) {
      const keyword = tidy(k);
      const key = normalizeForMatch(keyword);
      if (!key) return fail(`分组「${name}」里有空的关键词。`);
      const len = charCount(key);
      if (len < L.keywordMin || len > L.keywordMax) return fail(`关键词要 ${L.keywordMin}–${L.keywordMax} 个字：「${keyword.slice(0, 20)}」。`);
      if (isAsciiOnly(key) && len < L.asciiKeywordMin) return fail(`英文关键词至少 ${L.asciiKeywordMin} 个字符：「${keyword}」太短，容易对上不相干的项目。`);
      if (seenKeywords.has(key)) continue; // 同一组里重复的关键词只留一个
      seenKeywords.add(key);
      keywords.push(keyword);
    }
    if (keywords.length > L.keywords) return fail(`分组「${name}」最多 ${L.keywords} 个关键词。`);
    groups.push({ name, supplierIds: [...supplierIds], keywords });
  }
  return { ok: true, doc: { groups } };
}

/** 读库里存的那份（记录里是 JSON 文本）：只认能通过校验的；坏数据当作没有分组 */
export function parseSupplierGroupsDoc(stored: unknown): SupplierGroupsDoc {
  let raw: unknown = stored;
  if (typeof stored === "string") {
    try {
      raw = JSON.parse(stored);
    } catch {
      return EMPTY_SUPPLIER_GROUPS;
    }
  }
  const groups = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { groups?: unknown }).groups : undefined;
  const v = validateSupplierGroups(groups);
  return v.ok ? v.doc : EMPTY_SUPPLIER_GROUPS;
}

export function sameSupplierGroups(a: SupplierGroupsDoc, b: SupplierGroupsDoc): boolean {
  return JSON.stringify(a.groups) === JSON.stringify(b.groups);
}

/** 一份分组里用到的全部供应商（去重，保持出现顺序） */
export function supplierIdsInGroups(doc: SupplierGroupsDoc): string[] {
  return [...new Set(doc.groups.flatMap((g) => g.supplierIds))];
}

/* ---------------------------------- 项目用哪一组 ---------------------------------- */

export type SupplierGroupMatch =
  | { kind: "one"; group: string; keyword: string }
  | { kind: "none" }
  | { kind: "many"; groups: string[] };

/**
 * 按项目名称确定用哪一组：某组有任一关键词出现在项目名称里即为对上。
 * 恰好一组对上才给出这一组（连同第一个对上的关键词）；零组或多组都不选。没有关键词的组不会被对上。
 */
export function matchSupplierGroup(doc: SupplierGroupsDoc, projectName: string | null | undefined): SupplierGroupMatch {
  const haystack = normalizeForMatch(projectName ?? "");
  if (!haystack) return { kind: "none" };
  const hits: Array<{ group: string; keyword: string }> = [];
  for (const g of doc.groups) {
    const keyword = g.keywords.find((k) => {
      const needle = normalizeForMatch(k);
      return needle.length > 0 && haystack.includes(needle);
    });
    if (keyword !== undefined) hits.push({ group: g.name, keyword });
  }
  if (hits.length === 1) return { kind: "one", group: hits[0].group, keyword: hits[0].keyword };
  if (hits.length === 0) return { kind: "none" };
  return { kind: "many", groups: hits.map((h) => h.group) };
}

export function findGroup(doc: SupplierGroupsDoc, name: string): SupplierGroup | null {
  const key = normalizeForMatch(name);
  return doc.groups.find((g) => normalizeForMatch(g.name) === key) ?? null;
}

/* ---------------------------------- 询价入口 / 抽屉 ---------------------------------- */

/** 询价入口响应里的 supplierGroups（功能关闭时没有这个字段） */
export type SupplierGroupsEntry = {
  groups: Array<SupplierGroup & { readyCount: number }>;
  /** 这个项目按名称对上了哪一组 */
  match: SupplierGroupMatch;
  /** 当前这一版的标识：保存时原样带回；从没保存过为 null */
  version: string | null;
  limits: typeof SUPPLIER_GROUP_LIMITS;
};

export function buildSupplierGroupsEntry(input: {
  doc: SupplierGroupsDoc;
  version: string | null;
  projectName: string | null | undefined;
  readySupplierIds: ReadonlySet<string>;
}): SupplierGroupsEntry {
  return {
    groups: input.doc.groups.map((g) => ({ ...g, readyCount: g.supplierIds.filter((id) => input.readySupplierIds.has(id)).length })),
    match: matchSupplierGroup(input.doc, input.projectName),
    version: input.version,
    limits: SUPPLIER_GROUP_LIMITS,
  };
}

type PickableSupplier = { id: string; ready: boolean; isDefault: boolean };

/** 点一个分组：勾选换成该组里现在可选的供应商（按组内顺序，不超过上限） */
export function selectionForGroup(group: Pick<SupplierGroup, "supplierIds">, suppliers: readonly PickableSupplier[], max: number): string[] {
  const ready = new Set(suppliers.filter((s) => s.ready).map((s) => s.id));
  return group.supplierIds.filter((id) => ready.has(id)).slice(0, Math.max(0, max));
}

export type GroupPreselection = {
  selected: string[];
  /** 预选用的那一组；没有按分组预选为 null */
  activeGroup: string | null;
  /** 抽屉里那一行说明；没有分组时为 null（界面与本功能之前相同） */
  hint: { tone: "matched" | "undetermined"; textZh: string } | null;
};

/**
 * 打开抽屉时预先勾选谁。
 * 没有分组（或功能关闭）：可选的常用供应商——与本功能之前相同。
 * 有分组：恰好一组对上 → 这一组里可选的；否则不预先勾选（常用供应商也不勾）——对不上最可能就是另一个品类的标。
 */
export function groupPreselection(input: {
  groups: Pick<SupplierGroupsEntry, "groups" | "match"> | null | undefined;
  suppliers: readonly PickableSupplier[];
  max: number;
}): GroupPreselection {
  const { groups, suppliers, max } = input;
  if (!groups || groups.groups.length === 0) {
    return { selected: suppliers.filter((s) => s.isDefault && s.ready).slice(0, Math.max(0, max)).map((s) => s.id), activeGroup: null, hint: null };
  }
  const m = groups.match;
  if (m.kind === "one") {
    const group = groups.groups.find((g) => g.name === m.group);
    if (group) {
      const selected = selectionForGroup(group, suppliers, max);
      const notReady = group.supplierIds.length - selected.length;
      const tail = selected.length === 0 ? "，但这一组里现在没有能发询价的供应商" : notReady > 0 ? `（组里另有 ${notReady} 家现在不能选）` : "";
      return { selected, activeGroup: group.name, hint: { tone: "matched", textZh: `项目名称里有「${m.keyword}」，选了分组「${group.name}」${tail}。可以改选别的组或手动增减。` } };
    }
  }
  const textZh =
    m.kind === "many"
      ? `项目名称同时对上了 ${m.groups.map((g) => `「${g}」`).join("")} ${m.groups.length} 个分组，没有替你选。请点一个分组，或手动勾选。`
      : "项目名称没有对上任何分组的关键词，没有预先勾选。请点一个分组，或手动勾选。";
  return { selected: [], activeGroup: null, hint: { tone: "undetermined", textZh } };
}

/* ---------------------------------- 在一份分组上改一处（返回新的一份，不改原对象） ---------------------------------- */

export function addGroup(doc: SupplierGroupsDoc, group: SupplierGroup): SupplierGroupsDoc {
  return { groups: [...doc.groups, { name: group.name, supplierIds: [...group.supplierIds], keywords: [...group.keywords] }] };
}

/** 用新的供应商覆盖某一组（名字与关键词不变）；找不到这一组则原样返回 */
export function replaceGroupSuppliers(doc: SupplierGroupsDoc, name: string, supplierIds: readonly string[]): SupplierGroupsDoc {
  const key = normalizeForMatch(name);
  return { groups: doc.groups.map((g) => (normalizeForMatch(g.name) === key ? { ...g, supplierIds: [...supplierIds] } : g)) };
}

/** 改某一组的名字与关键词（供应商不变） */
export function updateGroupMeta(doc: SupplierGroupsDoc, name: string, meta: { name: string; keywords: readonly string[] }): SupplierGroupsDoc {
  const key = normalizeForMatch(name);
  return { groups: doc.groups.map((g) => (normalizeForMatch(g.name) === key ? { ...g, name: meta.name, keywords: [...meta.keywords] } : g)) };
}

export function removeGroup(doc: SupplierGroupsDoc, name: string): SupplierGroupsDoc {
  const key = normalizeForMatch(name);
  return { groups: doc.groups.filter((g) => normalizeForMatch(g.name) !== key) };
}

/** 没有关键词的组不会被自动选中：保存前后提示用 */
export function groupsWithoutKeywords(doc: SupplierGroupsDoc): string[] {
  return doc.groups.filter((g) => g.keywords.length === 0).map((g) => g.name);
}

/* ---------------------------------- 保存接口的响应 → 界面该怎么办 ---------------------------------- */

export type GroupsSaveOutcome =
  /** 保存成功：换成返回的这一份 */
  | { kind: "saved"; view: SupplierGroupsEntry }
  /** 别处先改过了：换成最新的这一份，并提示再操作一次（这次的修改没有保存） */
  | { kind: "conflict"; view: SupplierGroupsEntry; messageZh: string }
  /** 没保存：界面上的分组与勾选都保持原样 */
  | { kind: "error"; messageZh: string };

function asSupplierGroupsEntry(raw: unknown): SupplierGroupsEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const v = validateSupplierGroups(o.groups);
  if (!v.ok) return null;
  if (o.version !== null && typeof o.version !== "string") return null;
  const rawGroups = o.groups as Array<{ readyCount?: unknown }>;
  const m = o.match as { kind?: unknown; group?: unknown; keyword?: unknown; groups?: unknown } | null | undefined;
  const match: SupplierGroupMatch | null =
    m?.kind === "one" && typeof m.group === "string" && typeof m.keyword === "string"
      ? { kind: "one", group: m.group, keyword: m.keyword }
      : m?.kind === "many" && Array.isArray(m.groups) && m.groups.every((g): g is string => typeof g === "string")
        ? { kind: "many", groups: m.groups }
        : m?.kind === "none"
          ? { kind: "none" }
          : null;
  if (!match) return null;
  return {
    groups: v.doc.groups.map((g, i) => {
      const n = rawGroups[i]?.readyCount;
      return { ...g, readyCount: typeof n === "number" && Number.isInteger(n) && n >= 0 ? Math.min(n, g.supplierIds.length) : 0 };
    }),
    match,
    version: o.version as string | null,
    limits: SUPPLIER_GROUP_LIMITS,
  };
}

/**
 * 把保存接口的一次响应变成界面动作。成功的状态码但内容看不懂 → 按没保存处理（不假装成功）。
 * 抽成纯函数是为了能用假的响应测到每一条路。
 */
export function interpretGroupsSaveResponse(res: { ok: boolean; status: number; json: unknown }): GroupsSaveOutcome {
  const body = res.json && typeof res.json === "object" && !Array.isArray(res.json) ? (res.json as Record<string, unknown>) : null;
  const serverError = typeof body?.error === "string" && body.error.trim() ? body.error.trim() : null;
  const view = asSupplierGroupsEntry(body?.supplierGroups);
  if (res.ok && body?.ok === true) {
    return view ? { kind: "saved", view } : { kind: "error", messageZh: "保存的结果没有看懂，请关掉抽屉重新打开确认一下。" };
  }
  if (res.status === 409 && view) {
    return { kind: "conflict", view, messageZh: serverError ?? "分组在别处被改过了，已换成最新的。请再操作一次。" };
  }
  if (res.status === 404) return { kind: "error", messageZh: serverError ?? "供应商分组现在不可用。" };
  return { kind: "error", messageZh: serverError ?? "没有保存成功，请重试。" };
}
