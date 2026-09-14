/**
 * 外部依赖清单探测（默认不发真实 API，避免 OpenAI / Firecrawl 费用）。
 *
 *   npx tsx scripts/performance/benchmark-external.ts
 *
 * 只报告「是否配置了密钥」，不打印密钥，不调用 completions / crawl。
 */
function configured(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function row(service: string, envName: string, criticalPath: string) {
  const on = configured(envName);
  console.log(
    `${service.padEnd(18)}${(on ? "configured" : "absent").padEnd(14)}${criticalPath}`,
  );
}

function main() {
  console.log("perf:external — inventory only (no network, no LLM, no crawl)");
  console.log(`${"Service".padEnd(18)}${"Status".padEnd(14)}Typical critical path`);
  row("OpenAI", "OPENAI_API_KEY", "chat / tender analyze / agents");
  row("Firecrawl", "FIRECRAWL_API_KEY", "trade research / intel scrape");
  row("Serper", "SERPER_API_KEY", "trade research search");
  row("Tavily", "TAVILY_API_KEY", "tender intel / supplier intel");
  row("Resend", "RESEND_API_KEY", "outbound email");
  row("Upstash", "UPSTASH_REDIS_REST_URL", "rate limit only");
  row("Vercel Blob", "BLOB_READ_WRITE_TOKEN", "media / brochures");
  row("Sentry", "SENTRY_DSN", "errors (tracesSampleRate=0)");
  console.log("");
  console.log("Apify: not integrated (confirmed absent in source).");
  console.log("No --probe-network: this script never calls paid APIs.");
}

main();
