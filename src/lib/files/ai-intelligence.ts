/**
 * 项目 AI 情报分析 — intelligence_report 专属链路
 *
 * 生成链路：读取文档 → 构建 prompt → 主模型调用（含超时） → 失败则 fallback → 解析 JSON → 写 DB
 * 所有调用参数、耗时、异常均记录结构化日志，便于 Vercel 问题排查。
 */

export { generateProjectIntelligence, type ReportMeta } from "./intelligence-extractor";
