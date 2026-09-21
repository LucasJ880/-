-- 主助手 / 项目问青砚：AiMessage 用户消息可携带附件（浏览器解析后的文本、图片识别文本 + 原图路径），
-- 供模型当轮分析、后续追问引用。纯追加：仅新增可空列，不动既有表/列/行。
ALTER TABLE "AiMessage" ADD COLUMN "attachments" JSONB;
