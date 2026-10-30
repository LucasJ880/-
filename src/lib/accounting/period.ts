/**
 * PERM-5a：会计视图的时间窗口（服务器本地时间，与业绩页 / 本人提成一致）
 *   月：[本月 1 日, 下月 1 日)；季度：[季初, 下季初)
 */

export type Period = { label: string; start: Date; end: Date };

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM`；缺省 = now 所在月；格式非法返回 null */
export function parseMonth(raw: string | null | undefined, now = new Date()): Period | null {
  let y: number;
  let m: number;
  if (raw == null || raw === "") {
    y = now.getFullYear();
    m = now.getMonth() + 1;
  } else {
    const hit = /^(\d{4})-(\d{2})$/.exec(raw.trim());
    if (!hit) return null;
    y = Number(hit[1]);
    m = Number(hit[2]);
    if (m < 1 || m > 12) return null;
  }
  return { label: `${y}-${pad2(m)}`, start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

/** `YYYY-Qn`；缺省 null（不限季度）；格式非法返回 "invalid" */
export function parseQuarter(raw: string | null | undefined): Period | null | "invalid" {
  if (raw == null || raw === "") return null;
  const hit = /^(\d{4})-Q([1-4])$/i.exec(raw.trim());
  if (!hit) return "invalid";
  const y = Number(hit[1]);
  const q = Number(hit[2]);
  return { label: `${y}-Q${q}`, start: new Date(y, (q - 1) * 3, 1), end: new Date(y, q * 3, 1) };
}
