/**
 * AI 服务配置说明 — 单一文案源（波次 B · E5）
 */

export const AI_CONFIG_ENV_SNIPPET = `# OpenAI
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.openai.com/v1"
OPENAI_MODEL="gpt-5.2"
OPENAI_MODEL_MINI="gpt-5-mini"
OPENAI_IMAGE_MODEL="gpt-image-2"

# 或 DeepSeek
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.deepseek.com/v1"
OPENAI_MODEL="deepseek-chat"

# 或通义千问 Qwen
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
OPENAI_MODEL="qwen-plus"`;

export const AI_CONFIG_INTRO =
  "青砚 AI 需要调用大模型 API。请按你的运行环境选择配置方式：";
