-- 外贸 AI 对话：用户消息可携带附件（浏览器解析后的文本 [{ name, size, text }]），
-- 供模型当轮分析、后续追问引用。纯追加：仅新增可空列，不动既有表/列/行。
ALTER TABLE "TradeChatMessage" ADD COLUMN "attachments" JSONB;
