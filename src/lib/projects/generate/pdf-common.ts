/**
 * 项目 PDF 生成公共工具（jspdf）
 */

import type { jsPDF } from "jspdf";

export async function createProjectPdfDoc(): Promise<jsPDF> {
  const { default: JsPDF } = await import("jspdf");
  return new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
}

export function writeWrappedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight = 5,
): number {
  const lines = doc.splitTextToSize(text || "-", maxWidth) as string[];
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
}
