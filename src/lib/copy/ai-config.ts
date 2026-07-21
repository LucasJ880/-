/**
 * AI 服务配置说明 — 单一文案源（波次 B · E5）
 *
 * 示例中的默认模型 ID 来自 OPENAI_BUILTIN（Model Registry），禁止在此手写。
 */

import { OPENAI_BUILTIN } from "@/lib/ai/model-registry";

export const AI_CONFIG_ENV_SNIPPET = `# OpenAI（ModelRegistry）
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.openai.com/v1"
OPENAI_CHAT_MODEL="${OPENAI_BUILTIN.chat}"
OPENAI_REASONING_MODEL="${OPENAI_BUILTIN.reasoning}"
OPENAI_IMAGE_MODEL="${OPENAI_BUILTIN.image}"
OPENAI_IMAGE_MODEL_PINNED="${OPENAI_BUILTIN.imagePinned}"

# 或 DeepSeek
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.deepseek.com/v1"
OPENAI_CHAT_MODEL="deepseek-chat"

# 或通义千问 Qwen
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
OPENAI_CHAT_MODEL="qwen-plus"`;

export const AI_CONFIG_INTRO =
  "青砚 AI 需要调用大模型 API。请按你的运行环境选择配置方式：";
