/**
 * 「开启状态」编码表的持久层
 *
 * 引擎侧 (panel-codes.ts) 是纯函数 + 内置默认表；这里把车间自定义的码
 * 从 VinylPanelCode 读出来，转成引擎认的 PanelCodeRule[] 传进去。
 *
 * 分工：
 *   内置默认表 = V15 誊录，代码里冻结，**不可编辑**（改它要走发版 + 评审）
 *   DB 自定义   = 车间自己加/改，同名同尺寸时覆盖内置项
 * 这样车间能随时加码，同时保留一份可追溯的原始基线。
 */

import { db } from "@/lib/db";
import {
  DEFAULT_PANEL_CODES,
  LOUVER_SIZES_FOR_CODES,
  normalizePanelCode,
  type PanelCodeRule,
} from "./panel-codes";

/** 一条对外展示的编码（内置 + 自定义合并后的视图） */
export interface PanelCodeView extends PanelCodeRule {
  /** 内置项没有 id */
  id: string | null;
  source: "builtin" | "custom";
  /** 自定义项覆盖了同名内置项 */
  overridesBuiltin: boolean;
  note: string | null;
}

export interface PanelCodeInput {
  code: string;
  /** null = 两种百叶尺寸都适用 */
  louverSize: number | null;
  strips: number;
  caps: number;
  note?: string | null;
}

export type PanelCodeValidation =
  | { ok: true; value: PanelCodeInput }
  | { ok: false; error: string };

export function validatePanelCodeInput(raw: unknown): PanelCodeValidation {
  const b = (raw ?? {}) as Record<string, unknown>;

  const code = normalizePanelCode(String(b.code ?? ""));
  if (!code) return { ok: false, error: "方向码不能为空" };
  if (!/^[A-Z]+$/.test(code)) {
    return { ok: false, error: "方向码只能是字母（如 LLRR、LTLTRTR）" };
  }
  if (code.length > 16) return { ok: false, error: "方向码过长（最多 16 位）" };

  let louverSize: number | null = null;
  if (b.louverSize !== null && b.louverSize !== undefined && b.louverSize !== "") {
    const n = Number(b.louverSize);
    if (!LOUVER_SIZES_FOR_CODES.includes(n as never)) {
      return { ok: false, error: `百叶尺寸只能是 ${LOUVER_SIZES_FOR_CODES.join(" / ")} 或留空（通用）` };
    }
    louverSize = n;
  }

  const strips = Number(b.strips);
  const caps = Number(b.caps);
  for (const [label, v] of [["条", strips], ["盖", caps]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 99) {
      return { ok: false, error: `${label}数必须是 0~99 的整数` };
    }
  }

  const noteRaw = b.note;
  const note =
    typeof noteRaw === "string" && noteRaw.trim() ? noteRaw.trim().slice(0, 200) : null;

  return { ok: true, value: { code, louverSize, strips, caps, note } };
}

/** Prisma P2021 = 表不存在（该环境尚未 apply 迁移） */
function isTableMissing(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2021";
}

/**
 * 读某组织的自定义码，转成引擎认的覆盖表。
 *
 * 表尚未迁移时降级为「无自定义码」——此时任何组织都不可能有自定义码，
 * 退回内置默认表是正确结果，不该让整个试算/导出挂掉。
 * 但**只对 P2021 降级**：连接超时之类的错误必须抛出去，
 * 否则会静默丢掉车间加的码，算出错误的条/盖用量。
 */
export async function loadPanelCodeOverrides(orgId: string): Promise<PanelCodeRule[]> {
  try {
    const rows = await db.vinylPanelCode.findMany({
      where: { orgId },
      select: { code: true, louverSize: true, strips: true, caps: true },
    });
    return rows.map((r) => ({
      code: r.code,
      louverSize: r.louverSize,
      strips: r.strips,
      caps: r.caps,
    }));
  } catch (e) {
    if (isTableMissing(e)) {
      console.warn(
        "[vinyl] VinylPanelCode 表不存在（迁移未 apply），本次仅使用内置默认编码表",
      );
      return [];
    }
    throw e;
  }
}

/** 内置 + 自定义合并视图（管理页用） */
export async function listPanelCodeViews(orgId: string): Promise<PanelCodeView[]> {
  let custom: Awaited<ReturnType<typeof db.vinylPanelCode.findMany>> = [];
  try {
    custom = await db.vinylPanelCode.findMany({
      where: { orgId },
      orderBy: [{ code: "asc" }, { louverSize: "asc" }],
    });
  } catch (e) {
    if (!isTableMissing(e)) throw e;
    console.warn("[vinyl] VinylPanelCode 表不存在（迁移未 apply），仅列出内置默认编码表");
  }

  const key = (code: string, size: number | null) => `${normalizePanelCode(code)}|${size ?? "*"}`;
  const customKeys = new Set(custom.map((c) => key(c.code, c.louverSize)));

  const builtin: PanelCodeView[] = DEFAULT_PANEL_CODES.map((r) => ({
    ...r,
    id: null,
    source: "builtin",
    overridesBuiltin: false,
    note: null,
  }));

  const customViews: PanelCodeView[] = custom.map((c) => ({
    code: c.code,
    louverSize: c.louverSize,
    strips: c.strips,
    caps: c.caps,
    id: c.id,
    source: "custom",
    overridesBuiltin: DEFAULT_PANEL_CODES.some(
      (d) => key(d.code, d.louverSize) === key(c.code, c.louverSize),
    ),
    note: c.note,
  }));

  // 被自定义项覆盖的内置项标出来，但仍列出——让人看得见"原本是什么"
  const merged = [
    ...customViews,
    ...builtin.filter((b) => !customKeys.has(key(b.code, b.louverSize))),
  ];
  return merged.sort(
    (a, b) =>
      a.code.localeCompare(b.code) ||
      (a.louverSize ?? 0) - (b.louverSize ?? 0),
  );
}
