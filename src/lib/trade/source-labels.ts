export const TRADE_PROSPECT_SOURCE_LABELS: Record<string, string> = {
  website: "官网",
  website_form: "官网",
  trade_intelligence: "情报",
  google: "搜索",
  exhibition: "展会",
  "1688": "1688",
  linkedin: "LinkedIn",
  manual: "手工",
};

export const TRADE_PROSPECT_SOURCE_TONES: Record<string, string> = {
  website: "bg-sky-500/20 text-sky-200",
  website_form: "bg-sky-500/20 text-sky-200",
  trade_intelligence: "bg-violet-500/20 text-violet-200",
  google: "bg-emerald-500/20 text-emerald-200",
  exhibition: "bg-amber-500/20 text-amber-200",
  "1688": "bg-orange-500/20 text-orange-200",
  linkedin: "bg-blue-500/20 text-blue-200",
  manual: "bg-zinc-500/20 text-zinc-200",
};

export function tradeProspectSourceLabel(source?: string | null): string {
  if (!source) return "未知";
  return TRADE_PROSPECT_SOURCE_LABELS[source] ?? source;
}

export function tradeProspectSourceTone(source?: string | null): string {
  if (!source) return "bg-zinc-500/20 text-zinc-200";
  return TRADE_PROSPECT_SOURCE_TONES[source] ?? "bg-zinc-500/20 text-zinc-200";
}
