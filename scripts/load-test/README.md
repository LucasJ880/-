# 青砚压力测试脚本

## 安装 k6

```bash
# macOS
brew install k6

# 或下载二进制
# https://github.com/grafana/k6/releases
```

## 使用方式

```bash
# 设置环境变量
export BASE_URL="http://localhost:3000"  # 本地测试
# export BASE_URL="https://your-app.vercel.app"  # 线上测试（谨慎）

# Phase 1: 基础读接口
k6 run scripts/load-test/phase1-read.js

# Phase 2: 写接口 + 数据一致性
k6 run scripts/load-test/phase2-write.js

# Phase 3: AI 接口（低并发，独立测）
k6 run scripts/load-test/phase3-ai.js

# Phase 4: 登录限流验证
k6 run scripts/load-test/phase4-auth.js
```

## 注意事项

- 线上压测前通知团队
- AI 压测会消耗 OpenAI token，控制好并发
- 压测后清理测试数据
