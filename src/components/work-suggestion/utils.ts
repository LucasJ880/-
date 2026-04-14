export function formatTime(iso: string) {
  if (!iso) return "";
  const idx = iso.indexOf("T");
  return idx !== -1 ? iso.substring(idx + 1, idx + 6) : "";
}

export function formatDateLabel(iso: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short", timeZone: "America/Toronto" });
  } catch {
    return iso.split("T")[0];
  }
}
