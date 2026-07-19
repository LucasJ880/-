/**
 * 快速 ACK — 不调用大模型
 */

import { appendAgentRunEvent, updateAgentRunStatus } from "./run";

export function buildAckText(input: {
  content: string;
  messageType?: string;
}): string {
  const text = (input.content || "").trim();
  if (input.messageType === "image" || /文件|附件|pdf|文档/.test(text)) {
    return "收到，我先读取文件并检查重点。";
  }
  if (/邮件|gmail|inbox|发信/.test(text)) {
    return "收到，我正在查找邮件并整理内容。";
  }
  if (/项目|任务|进度|deadline|健康/.test(text)) {
    return "收到，我正在检查相关项目。";
  }
  if (/报价|客户|跟进|商机/.test(text)) {
    return "收到，我正在核对相关业务数据。";
  }
  if (text.length > 80 || /分析|整理|总结|帮我/.test(text)) {
    return "已开始处理，你可以继续补充要求。";
  }
  return "收到，我正在处理。";
}

export async function markAckSent(input: {
  orgId: string;
  runId: string;
  ackText: string;
}) {
  await updateAgentRunStatus(input.orgId, input.runId, "acknowledged");
  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: input.runId,
    eventType: "ack.sent",
    title: "已发送确认",
    payload: { preview: input.ackText.slice(0, 80) },
    visibleToUser: true,
  });
}
