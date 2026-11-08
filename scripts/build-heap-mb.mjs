// next build 与 npm run typecheck（tsc --noEmit）共用的堆上限（MB）。16GB 级构建机（生产 Enhanced）保持已验证的 7168；
// 32GB 及以上（qingyan-staging 的 60GB Turbo 机器在 7168 下 webpack 编译阶段 OOM）放到 16384。
// tsc 全量检查实测峰值约 4.4GB（2026-11-08，--extendedDiagnostics），Node 默认堆约 2GB 的机器上不提堆即 OOM。
import os from "node:os";
import { pathToFileURL } from "node:url";

const GIB = 1024 ** 3;

export function buildHeapMb(totalMemBytes) {
  return totalMemBytes >= 32 * GIB ? 16384 : 7168;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.log(buildHeapMb(os.totalmem()));
}
