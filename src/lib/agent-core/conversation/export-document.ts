/**
 * FB-11 — 会话文档导出（builtin tool 支撑）
 *
 * 把会话结论（Markdown）渲染为自包含 HTML（系统中文字体栈，打印即 PDF），
 * 存私有 Blob 并返回下载链接。不引入 PDF 字体依赖（jsPDF 无 CJK，会乱码）。
 */

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 极简 Markdown → HTML（标题/列表/段落/粗体；不执行任何脚本内容） */
export function miniMarkdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bold = (s: string) =>
      esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    if (/^###\s+/.test(line)) {
      closeList();
      out.push(`<h3>${bold(line.replace(/^###\s+/, ""))}</h3>`);
    } else if (/^##\s+/.test(line)) {
      closeList();
      out.push(`<h2>${bold(line.replace(/^##\s+/, ""))}</h2>`);
    } else if (/^#\s+/.test(line)) {
      closeList();
      out.push(`<h1>${bold(line.replace(/^#\s+/, ""))}</h1>`);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${bold(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p>${bold(line)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

export function buildExportHtml(title: string, contentMarkdown: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;color:#1c1c1c;max-width:800px;margin:0 auto;padding:32px 28px;line-height:1.7;font-size:14px}
h1{font-size:20px}h2{font-size:16px;border-left:4px solid #2e6b57;padding-left:10px}h3{font-size:14px}
.muted{color:#666;font-size:12px}
@media print{body{padding:0}}
</style>
<h1>${esc(title)}</h1>
${miniMarkdownToHtml(contentMarkdown)}
<p class="muted">由青砚会话导出 · ${esc(new Date().toISOString().slice(0, 10))} · 浏览器可直接打印为 PDF</p>`;
}
