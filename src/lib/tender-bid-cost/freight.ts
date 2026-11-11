/**
 * TI-2 运费方案互斥与整票费用分摊（纯函数，定点）
 *
 * - 一个情景只采用一个运费方案；两个及以上须声明混合并附说明，否则拒绝。
 * - 分摊方法四种：按体积、重量、货值、数量。各行分摊额舍入到分，余数归参与分摊的最后一行，
 *   保证各行之和与整票金额相等。
 * - 所选方法需要的依据在某一行缺失 → 拒绝并指出该行，不改用其它方法。
 * - 国际段方案（整柜 / 拼柜 / 空运）只分摊到进口行；本地方案分摊到全部行。
 */
import { Prisma } from "@prisma/client";
import { dec, roundMoney, ZERO } from "@/lib/project-finance/money";
import { toDecimalOrNull } from "@/lib/tender-price-schedule/contract";
import { ALLOCATION_LABELS_ZH, type AllocationMethod, type FreightPlan, type FreightSelection, type Rejection, type SourcingType } from "./contract";

type D = Prisma.Decimal;

export function validateFreightSelection(selection: FreightSelection | null | undefined): { ok: true; plans: FreightPlan[]; blendNote: string | null } | Rejection {
  const plans = selection?.plans ?? [];
  const blendNote = selection?.blendNote?.trim() || null;
  if (plans.length > 1 && !blendNote) {
    return { ok: false, code: "MULTIPLE_FREIGHT_PLANS", lineNo: null, messageZh: "运费方案只能选一个；确需混合请声明并写明说明" };
  }
  return { ok: true, plans, blendNote };
}

export type AllocationLine = {
  lineNo: number;
  sourcing: SourcingType;
  /** 件数（按数量分摊的依据） */
  pieces: D | null;
  goodsCad: D | null;
  volumeCbm: D | null;
  weightKg: D | null;
};

function basisOf(line: AllocationLine, method: AllocationMethod): D | null {
  const v = method === "BY_VOLUME" ? line.volumeCbm : method === "BY_WEIGHT" ? line.weightKg : method === "BY_VALUE" ? line.goodsCad : line.pieces;
  return v && v.gt(ZERO) ? v : null;
}

/** 把一笔整票费用分摊到给定的行；返回 行号 → 分摊额。 */
export function allocateCharge(
  amountCad: Prisma.Decimal.Value,
  method: AllocationMethod,
  lines: readonly AllocationLine[],
): { ok: true; shares: Map<number, D> } | Rejection {
  const amount = roundMoney(toDecimalOrNull(amountCad) ?? ZERO);
  const shares = new Map<number, D>();
  if (lines.length === 0 || amount.isZero()) {
    lines.forEach((l) => shares.set(l.lineNo, ZERO));
    return { ok: true, shares };
  }
  const bases: D[] = [];
  for (const l of lines) {
    const b = basisOf(l, method);
    if (!b) {
      return { ok: false, code: "ALLOCATION_BASIS_MISSING", lineNo: l.lineNo, messageZh: `${ALLOCATION_LABELS_ZH[method]}分摊：第 ${l.lineNo} 行缺少依据` };
    }
    bases.push(b);
  }
  const totalBasis = bases.reduce((a, b) => a.plus(b), ZERO);
  let allocated = ZERO;
  lines.forEach((l, i) => {
    const share = roundMoney(amount.times(bases[i]).div(totalBasis));
    shares.set(l.lineNo, share);
    allocated = allocated.plus(share);
  });
  const last = lines[lines.length - 1].lineNo;
  shares.set(last, (shares.get(last) ?? ZERO).plus(amount.minus(allocated)));
  return { ok: true, shares };
}

/** 把所选方案的全部整票费用分摊到行，返回 行号 → 分摊额合计。 */
export function allocateFreight(
  plans: readonly FreightPlan[],
  lines: readonly AllocationLine[],
): { ok: true; byLine: Map<number, D> } | Rejection {
  const byLine = new Map<number, D>(lines.map((l) => [l.lineNo, ZERO] as const));
  for (const plan of plans) {
    const targets = plan.mode === "LOCAL" ? lines : lines.filter((l) => l.sourcing === "IMPORT");
    for (const charge of plan.charges) {
      const r = allocateCharge(dec(charge.amountCad), charge.allocation, targets);
      if (!r.ok) return r;
      r.shares.forEach((v, lineNo) => byLine.set(lineNo, (byLine.get(lineNo) ?? ZERO).plus(v)));
    }
  }
  return { ok: true, byLine };
}
