/**
 * 用户级 AI 长期记忆 — 借鉴 MemPalace 4 层架构
 *
 * L0 (identity / preference): ~100 tokens, 始终加载
 * L1 (core): ~500 tokens, 每次对话加载 top N
 * L2 (on-demand): 向量语义检索 + 关键词兜底
 *
 * 向量检索: OpenAI text-embedding-3-small (1536维)
 * 冲突检测: 相似度 > 0.88 的同类记忆自动覆盖
 */

export {
  type MemoryType,
  type MemoryEntry,
  saveMemory,
  saveMemories,
  listMemories,
  getMemoryById,
  updateMemory,
  deleteMemory,
  backfillEmbeddings,
} from "./memory-storage";

export {
  getWakeUpMemories,
  recallMemories,
  buildUserMemoryBlock,
  type ExtractedMemory,
  extractMemoriesFromConversation,
} from "./memory-search";
