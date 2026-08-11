// ============================================================
// Corporate Memory Foundation（T3）— 统一出口
//
// 企业事实层 canonical service。生产写入统一走此处：
//   Buyer:  createBuyer / getBuyer / findBuyerMatch / mergeBuyers(NOT_IMPLEMENTED)
//   Claim:  createMemoryClaim / supersedeMemoryClaim / retractMemoryClaim /
//           confirmMemoryClaim / updateMemoryClaimGovernance / attachMemoryClaimEvidence
//   Read:   searchMemoryClaims / getMemoryClaim
//
// 硬闸：AI_AUTO_MEMORY_WRITE = NO；MEMORY_WRITE_PERMISSION = CONSERVATIVE_ADMIN_ONLY。
// 禁止业务代码直连 prisma.memoryClaim.* / prisma.buyer.*。
// ============================================================

export * from "./types";
export { normalizeBuyerName, normalizeWebsiteDomain } from "./normalize";
export {
  requireMemoryReadAccess,
  requireMemoryWriteAccess,
  type MemoryAccessContext,
} from "./access";
export {
  createBuyer,
  getBuyer,
  findBuyerMatch,
  mergeBuyers,
  type BuyerMatch,
  type BuyerMatchedBy,
  type CreateBuyerInput,
  type CreateBuyerResult,
} from "./buyer-service";
export {
  createMemoryClaim,
  supersedeMemoryClaim,
  retractMemoryClaim,
  confirmMemoryClaim,
  updateMemoryClaimGovernance,
  attachMemoryClaimEvidence,
  type CreateMemoryClaimInput,
  type MemoryClaimEvidenceInput,
  type MemoryClaimGovernancePatch,
  type MemoryClaimWithEvidence,
  type ReplacementClaimInput,
  type SupersedeMemoryClaimResult,
  type RetractMemoryClaimResult,
} from "./claim-service";
export {
  searchMemoryClaims,
  getMemoryClaim,
  compareClaimTrustFreshness,
  type SearchMemoryClaimsParams,
  type MemoryClaimResult,
  type EvidenceSummary,
} from "./retrieval";
export {
  memorySemanticSearchAdapter,
  type MemorySemanticSearchAdapter,
} from "./semantic-retrieval-design";
