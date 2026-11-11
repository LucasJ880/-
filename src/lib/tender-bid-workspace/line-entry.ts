/**
 * TI-4c 行明细与补遗的录入（纯函数）
 *
 * 界面上的草稿（全是字符串）与保存内容互转并校验；把一行的明细合并进整块明细
 *（保存接口按块替换，所以要带上其它行）；解析「影响的行」；补遗列表的增删。
 * 「已核验」必须有出处——这里先拦一道，保存接口再拦一道。
 */
import type { LineDetail, StoredAddendum, StoredCertificate } from "./contract";

export type CertDraft = {
  id: string;
  status: StoredCertificate["status"];
  coverage: StoredCertificate["coverage"];
  issuer: string;
  /** 发证机构是否在加拿大受认可 */
  accredited: "YES" | "NO" | "UNKNOWN";
  /** 所列型号，逗号或顿号分隔 */
  coveredModels: string;
  /** YYYY-MM-DD；空 = 证书未载明到期日 */
  expiresAt: string;
  /** 出处：证书文件名、链接或查询记录 */
  evidenceRef: string;
};

export type LineEntryDraft = { make: string; model: string; offeredDimensions: string; certificates: CertDraft[] };

export const CERT_STATUS_ZH: Record<StoredCertificate["status"], string> = { CLAIMED: "供应商声称", VERIFIED: "已核验", REJECTED: "核验未通过", EXPIRED: "已过期" };
export const CERT_COVERAGE_ZH: Record<StoredCertificate["coverage"], string> = { WHOLE_UNIT: "整机", COMPONENT: "部件", UNKNOWN: "未确认" };
export const ACCREDITED_ZH: Record<CertDraft["accredited"], string> = { YES: "是", NO: "否", UNKNOWN: "未确认" };
export const VERIFIED_IS_MANUAL_ZH = "「已核验」是人工确认后的录入，系统不核验证书真伪；标为已核验必须填出处，保存会留审计记录。";

export function emptyCertDraft(): CertDraft {
  return { id: "", status: "CLAIMED", coverage: "UNKNOWN", issuer: "", accredited: "UNKNOWN", coveredModels: "", expiresAt: "", evidenceRef: "" };
}

export function draftFromDetail(detail: LineDetail | null | undefined): LineEntryDraft {
  return {
    make: detail?.product?.make ?? "",
    model: detail?.product?.model ?? "",
    offeredDimensions: detail?.offeredDimensions ?? "",
    certificates: (detail?.certificates ?? []).map((c) => ({
      id: c.id, status: c.status, coverage: c.coverage, issuer: c.issuer ?? "",
      accredited: c.issuerAccreditedInCanada === true ? "YES" : c.issuerAccreditedInCanada === false ? "NO" : "UNKNOWN",
      coveredModels: c.coveredModels.join(", "), expiresAt: c.expiresAt ?? "", evidenceRef: c.evidenceRef ?? "",
    })),
  };
}

const t = (s: string | null | undefined) => (s ?? "").trim();
const orNull = (s: string) => t(s) || null;
const certIsBlank = (c: CertDraft) => !t(c.id) && !t(c.issuer) && !t(c.coveredModels) && !t(c.expiresAt) && !t(c.evidenceRef);

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export type DetailResult = { ok: true; detail: LineDetail | null } | { ok: false; issuesZh: string[] };

/**
 * 草稿 → 保存内容。三项都空且没有证书 → detail 为 null（这一行的明细应被移除）。
 * basedOnAddendum：保存这一行即表示按当时影响该行的最新补遗核对过。
 */
export function detailFromDraft(draft: LineEntryDraft, opts: { basedOnAddendum: number }): DetailResult {
  const issuesZh: string[] = [];
  const certificates: StoredCertificate[] = [];
  const seen = new Set<string>();
  draft.certificates.forEach((c, i) => {
    if (certIsBlank(c)) return;
    const n = i + 1;
    const id = t(c.id);
    if (!id) { issuesZh.push(`第 ${n} 张证书缺少编号`); return; }
    if (seen.has(id.toUpperCase())) { issuesZh.push(`证书编号 ${id} 重复`); return; }
    seen.add(id.toUpperCase());
    const expiresAt = t(c.expiresAt);
    if (expiresAt && !validDate(expiresAt)) issuesZh.push(`证书 ${id} 的到期日「${expiresAt}」不是 YYYY-MM-DD 格式的有效日期`);
    if (c.status === "VERIFIED" && !t(c.evidenceRef)) issuesZh.push(`证书 ${id} 标为「已核验」必须填出处`);
    certificates.push({
      id, status: c.status, coverage: c.coverage, issuer: orNull(c.issuer),
      issuerAccreditedInCanada: c.accredited === "YES" ? true : c.accredited === "NO" ? false : null,
      coveredModels: c.coveredModels.split(/[,，、;；\n]/).map((m) => m.trim()).filter(Boolean),
      expiresAt: expiresAt || null, evidenceRef: orNull(c.evidenceRef),
    });
  });
  if (issuesZh.length > 0) return { ok: false, issuesZh };
  const make = orNull(draft.make), model = orNull(draft.model), offeredDimensions = orNull(draft.offeredDimensions);
  if (!make && !model && !offeredDimensions && certificates.length === 0) return { ok: true, detail: null };
  return {
    ok: true,
    detail: {
      product: make || model ? { make, model } : null,
      offeredDimensions,
      certificates,
      basedOnAddendum: Math.max(0, Math.trunc(opts.basedOnAddendum) || 0),
    },
  };
}

/** 把一行的明细放进整块明细（不改其它行）；detail 为 null 时移除该行。返回新对象。 */
export function withLineDetail(all: Readonly<Record<string, LineDetail>> | null | undefined, lineNo: number, detail: LineDetail | null): Record<string, LineDetail> {
  const next: Record<string, LineDetail> = { ...(all ?? {}) };
  if (detail) next[String(lineNo)] = detail;
  else delete next[String(lineNo)];
  return next;
}

export type AffectedLinesResult = { lineNos: number[]; issuesZh: string[] };

/**
 * 解析「影响的行」：逗号 / 顿号 / 空白分隔的行号与区间，如 `13-15, 18`。
 * 给了 validLineNos 时，不在价格表里的行号会被指出。结果去重并升序。
 */
export function parseAffectedLines(text: string, validLineNos?: readonly number[]): AffectedLinesResult {
  const issuesZh: string[] = [];
  const set = new Set<number>();
  for (const part of text.split(/[,，、;；\s]+/).map((p) => p.trim()).filter(Boolean)) {
    const single = /^(\d{1,4})$/.exec(part);
    const range = /^(\d{1,4})\s*[-–—~至到]\s*(\d{1,4})$/.exec(part);
    if (single) set.add(Number(single[1]));
    else if (range) {
      const a = Number(range[1]), b = Number(range[2]);
      if (a > b) { issuesZh.push(`区间「${part}」起点大于终点`); continue; }
      for (let n = a; n <= b; n += 1) set.add(n);
    } else issuesZh.push(`「${part}」不是行号或区间`);
  }
  const lineNos = [...set].filter((n) => n >= 1).sort((a, b) => a - b);
  if (set.has(0)) issuesZh.push("行号从 1 开始");
  if (validLineNos) {
    const missing = lineNos.filter((n) => !validLineNos.includes(n));
    if (missing.length > 0) issuesZh.push(`价格表里没有第 ${missing.join("、")} 行`);
  }
  return { lineNos, issuesZh };
}

export type AddendumDraft = { number: string; issuedOn: string; affected: string; effect: string };
export type AddendumResult = { ok: true; addendum: StoredAddendum } | { ok: false; issuesZh: string[] };

export function addendumFromDraft(draft: AddendumDraft, validLineNos?: readonly number[]): AddendumResult {
  const issuesZh: string[] = [];
  const numberRaw = t(draft.number);
  if (!/^[1-9]\d{0,2}$/.test(numberRaw)) issuesZh.push("补遗号须为 1–999 的整数");
  const issuedOn = t(draft.issuedOn);
  if (issuedOn && !validDate(issuedOn)) issuesZh.push(`日期「${issuedOn}」不是 YYYY-MM-DD 格式的有效日期`);
  const affected = parseAffectedLines(draft.affected, validLineNos);
  issuesZh.push(...affected.issuesZh);
  if (issuesZh.length > 0) return { ok: false, issuesZh };
  return { ok: true, addendum: { number: Number(numberRaw), issuedOn: issuedOn || null, affectedLineNos: affected.lineNos, effect: orNull(draft.effect) } };
}

/** 新增或替换同号补遗；按号升序。返回新数组。 */
export function upsertAddendum(addenda: readonly StoredAddendum[], addendum: StoredAddendum): StoredAddendum[] {
  return [...addenda.filter((a) => a.number !== addendum.number), addendum].sort((a, b) => a.number - b.number);
}

export function removeAddendum(addenda: readonly StoredAddendum[], number: number): StoredAddendum[] {
  return addenda.filter((a) => a.number !== number);
}

/** 行号列表压成易读的区间：13、14、15、18 → 「13–15、18」。 */
export function formatLineNos(lineNos: readonly number[]): string {
  const sorted = [...new Set(lineNos)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return parts.join("、");
}
