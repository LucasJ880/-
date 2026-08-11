// ============================================================
// Semantic memory retrieval — DESIGN_ONLY（T3, §30）
//
// RETRIEVAL_SEMANTIC_LAYER = DESIGN_ONLY / SECOND_VECTOR_INFRASTRUCTURE = NO。
//
// 决策：本轮不实现语义排序，也不在 MemoryClaim 上新建 vector 列。理由：
//
// 1. ProjectInsight.embedding 目前是 `Json?` 死字段（零读者/零写者/无 ANN 索引，
//    见 CURRENT_MEMORY_MODEL_MAP）。"复用"它需要 `Json? → Unsupported("vector(1536)")?`
//    的破坏性列类型变更 + HNSW 索引 —— 违反本轮 additive-only migration 纪律。
// 2. 既有真 pgvector 能力（OrgKnowledgeChunk / Sales* / CustomerProfile，6 列）
//    全部无 ANN 索引，语义检索为顺序扫描；直接照搬会把这一债引入 memory 域。
// 3. 任务书 §30 明确：若 ProjectInsight.embedding 过度绑定 ProjectInsight，
//    本轮允许 RETRIEVAL_SEMANTIC_LAYER = DESIGN_ONLY，不为完成 P0 大规模重构。
//
// 因此语义层以「适配器接口 + 未来接线契约」形式冻结，零运行时依赖、零第二套向量基建。
// 结构化确定性检索（retrieval.ts）是本轮唯一可用检索路径。
// ============================================================

import type { MemoryClaimResult, SearchMemoryClaimsParams } from "./retrieval";

/**
 * 未来语义检索适配器契约（NOT IMPLEMENTED）。
 *
 * 关键约束（实施时必须遵守，避免第二套向量基建）：
 * - embedding 生成复用 `src/lib/ai/embedding.ts`（text-embedding-3-small, 1536 维），
 *   不新建 embedding worker/queue/model。
 * - 向量存储决策二选一，均需单独 additive-safe migration + 批准：
 *     Option A：为 MemoryClaim 增加 `embedding Unsupported("vector(1536)")?` + HNSW 索引；
 *     Option B：独立 `MemoryClaimEmbedding` 旁路表（claimId 唯一），避免改动主表列类型。
 *   —— 无论哪种都不复制第二个 pgvector pipeline / 第二个 vector database。
 * - 检索路径复用 `src/lib/knowledge/org-knowledge.ts` 的 org-scoped `WHERE orgId=$ ... ORDER BY embedding <=> $` 模板，
 *   保持强制 org 隔离；语义命中集必须再经 retrieval.ts 的确定性过滤/排序融合，
 *   语义分数只作为候选召回与次级排序，不得凌驾 trust ordering（§32）。
 */
export interface MemorySemanticSearchAdapter {
  /** 是否已接线（本轮恒 false）。 */
  readonly available: boolean;
  /**
   * 语义召回 + 与确定性过滤融合。实现前调用一律抛错，
   * 迫使调用方回退 searchMemoryClaims（纯结构化）。
   */
  semanticSearch(
    params: SearchMemoryClaimsParams & { query: string; semanticLimit?: number },
  ): Promise<MemoryClaimResult[]>;
}

/** 本轮占位实现：available=false，semanticSearch 抛 not-implemented。 */
export const memorySemanticSearchAdapter: MemorySemanticSearchAdapter = {
  available: false,
  async semanticSearch(): Promise<MemoryClaimResult[]> {
    throw new Error(
      "MEMORY_SEMANTIC_RETRIEVAL_NOT_IMPLEMENTED: 本轮 RETRIEVAL_SEMANTIC_LAYER = DESIGN_ONLY；请使用 searchMemoryClaims（结构化确定性检索）",
    );
  },
};
