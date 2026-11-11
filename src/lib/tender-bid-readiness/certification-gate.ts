/**
 * TI-3b 强制认证闸（纯函数）
 *
 * 带认证要求的价格表行，六个条件全部满足才通过：品牌型号已填、证书已核验、未过期、
 * 发证机构在加拿大受认可、覆盖整机、型号一致。只覆盖部件的证书、供应商的声称、
 * 计划中的认证或预留的认证费用都不算。
 *
 * 比供应商情报里的认证规则严（那里「整个供应商」范围的已核验证书即可通过）：
 * 两处回答的问题不同——「这家供应商有没有这类资质」对「这个型号的整机有没有证」。
 * 「已核验」「受认可」「覆盖整机」是上游人工确认后的输入；未确认即不通过。本模块不核验真伪。
 */

export const CERTIFICATE_STATUSES = ["CLAIMED", "VERIFIED", "REJECTED", "EXPIRED"] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];
export const CERTIFICATE_COVERAGE = ["WHOLE_UNIT", "COMPONENT", "UNKNOWN"] as const;
export type CertificateCoverage = (typeof CERTIFICATE_COVERAGE)[number];

export type ProposedProduct = { make?: string | null; model?: string | null };

export type CertificateEvidence = {
  id: string;
  status: CertificateStatus;
  coverage: CertificateCoverage;
  issuer?: string | null;
  /** 发证机构是否已确认在加拿大受认可；null = 未确认 */
  issuerAccreditedInCanada: boolean | null;
  coveredModels: string[];
  /** ISO 日期或时间；空 = 证书未载明到期日 */
  expiresAt?: string | null;
};

export type GateReasonCode =
  | "MAKE_MISSING" | "MODEL_MISSING" | "NO_VERIFIED_WHOLE_UNIT_CERT" | "CERT_NOT_VERIFIED" | "CERT_COMPONENT_ONLY"
  | "CERT_COVERAGE_UNKNOWN" | "CERT_EXPIRED" | "ISSUER_NOT_ACCREDITED" | "ISSUER_ACCREDITATION_UNCONFIRMED" | "MODEL_MISMATCH" | "PLANNED_CERTIFICATION_ONLY";
export type GateReason = { code: GateReasonCode; messageZh: string };

export type CertificationGateResult = {
  lineNo: number;
  verdict: "PASS" | "BLOCKED" | "NOT_APPLICABLE";
  reasons: GateReason[];
  passingCertificateId: string | null;
};

const blank = (v: string | null | undefined) => !v || !v.trim() || v.trim().toUpperCase() === "UNKNOWN";
const normModel = (v: string) => v.trim().toUpperCase().replace(/[\s\-_/]+/g, "");

function expired(cert: CertificateEvidence, now: Date): boolean {
  if (cert.status === "EXPIRED") return true;
  if (!cert.expiresAt || !cert.expiresAt.trim()) return false;
  const t = new Date(cert.expiresAt.trim()).getTime();
  return Number.isNaN(t) ? true : t < now.getTime();
}

/** 单张证书对拟投型号的失败原因；空数组 = 这张证书满足全部条件。 */
function failuresOf(cert: CertificateEvidence, model: string | null, now: Date): GateReason[] {
  const out: GateReason[] = [];
  if (cert.status !== "VERIFIED" && cert.status !== "EXPIRED") {
    out.push({ code: "CERT_NOT_VERIFIED", messageZh: `证书 ${cert.id} ${cert.status === "CLAIMED" ? "只是供应商声称，未经核验" : "核验未通过"}` });
  }
  if (expired(cert, now)) out.push({ code: "CERT_EXPIRED", messageZh: `证书 ${cert.id} 已过期或到期日无法解析` });
  if (cert.coverage === "COMPONENT") out.push({ code: "CERT_COMPONENT_ONLY", messageZh: `证书 ${cert.id} 只覆盖部件，不是整机` });
  if (cert.coverage === "UNKNOWN") out.push({ code: "CERT_COVERAGE_UNKNOWN", messageZh: `证书 ${cert.id} 覆盖范围未确认（整机还是部件）` });
  if (cert.issuerAccreditedInCanada === false) out.push({ code: "ISSUER_NOT_ACCREDITED", messageZh: `证书 ${cert.id} 的发证机构在加拿大不受认可` });
  if (cert.issuerAccreditedInCanada === null) out.push({ code: "ISSUER_ACCREDITATION_UNCONFIRMED", messageZh: `证书 ${cert.id} 的发证机构是否在加拿大受认可尚未确认` });
  if (model && !cert.coveredModels.map(normModel).includes(normModel(model))) {
    out.push({ code: "MODEL_MISMATCH", messageZh: `证书 ${cert.id} 所列型号与拟投型号 ${model.trim()} 不一致` });
  }
  return out;
}

export function evaluateCertificationGate(input: {
  lineNo: number;
  certificationGate?: string | null;
  product?: ProposedProduct | null;
  certificates?: readonly CertificateEvidence[] | null;
  /** 只留了认证预算、还没有证书：记一条原因，但永远不使闸通过 */
  hasPlannedCertificationOnly?: boolean;
  now: Date;
}): CertificationGateResult {
  if (!input.certificationGate || !input.certificationGate.trim()) {
    return { lineNo: input.lineNo, verdict: "NOT_APPLICABLE", reasons: [], passingCertificateId: null };
  }
  const reasons: GateReason[] = [];
  const makeMissing = blank(input.product?.make);
  const modelMissing = blank(input.product?.model);
  if (makeMissing) reasons.push({ code: "MAKE_MISSING", messageZh: "品牌未填" });
  if (modelMissing) reasons.push({ code: "MODEL_MISSING", messageZh: "型号未填" });
  const model = modelMissing ? null : (input.product?.model as string);
  const certs = input.certificates ?? [];
  // 型号未填时没有任何证书能对上型号，所以不可能通过
  const passing = model ? certs.find((c) => failuresOf(c, model, input.now).length === 0) : undefined;
  if (!passing) {
    reasons.push({ code: "NO_VERIFIED_WHOLE_UNIT_CERT", messageZh: "没有已核验的整机认证" });
    for (const c of certs) reasons.push(...failuresOf(c, model, input.now));
    if (input.hasPlannedCertificationOnly) reasons.push({ code: "PLANNED_CERTIFICATION_ONLY", messageZh: "只预留了认证费用或计划送检，不等于证书" });
  }
  const pass = !!passing && !makeMissing && !modelMissing;
  return { lineNo: input.lineNo, verdict: pass ? "PASS" : "BLOCKED", reasons: pass ? [] : reasons, passingCertificateId: pass ? passing!.id : null };
}
