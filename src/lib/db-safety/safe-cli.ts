/**
 * B0 — 受守卫的 Prisma 命令执行核心（scripts/db-safe.ts 的实现体）。
 *
 * 关键点：守卫评估的目标必须与 Prisma 子进程实际使用的目标 100% 一致——
 * 因此本模块（a）按 Prisma CLI 的语义合并 .env（进程 env 优先、.env 补缺），
 * （b）放行时把合并后的 DATABASE_URL/DIRECT_URL 显式注入子进程 env，
 * 使「守卫看到的」与「Prisma 用到的」不可能分叉（2026-08-24 事故的根因
 * 正是 shell 覆盖了 DATABASE_URL 而 CLI 实际走了 .env 的 DIRECT_URL）。
 *
 * 子进程注入点可测：spawnImpl 由调用方注入，阻断路径断言 spawnCount===0。
 */

import { readFileSync } from "fs";
import { join } from "path";
import {
  evaluateDbCommandPolicy,
  formatTargetLine,
  type DbPolicyDecision,
  type DbSafeCommand,
} from "./command-policy";

export type SpawnLike = (
  command: string,
  args: string[],
  options: { stdio: "inherit"; env: NodeJS.ProcessEnv },
) => { status: number | null };

export interface DbSafeCliResult {
  exitCode: number;
  decision: DbPolicyDecision | null;
  spawned: boolean;
}

const SUBCOMMANDS: Record<string, { command: DbSafeCommand; prismaArgs: string[] }> = {
  "target-check": { command: "target_check", prismaArgs: [] },
  push: { command: "db_push", prismaArgs: ["db", "push"] },
  "migrate-dev": { command: "migrate_dev", prismaArgs: ["migrate", "dev"] },
  "migrate-reset": { command: "migrate_reset", prismaArgs: ["migrate", "reset"] },
};

/** 极简 .env 解析（KEY=VALUE，支持引号；无展开）——与 Prisma 的 dotenv 行为对齐即可 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

function loadEffectiveEnvVar(
  name: string,
  processEnv: NodeJS.ProcessEnv,
  dotEnvFiles: Record<string, string>[],
): string | undefined {
  const fromProcess = processEnv[name]?.trim();
  if (fromProcess) return fromProcess; // 进程 env 优先（Prisma 语义）
  for (const file of dotEnvFiles) {
    const v = file[name]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function runDbSafeCli(input: {
  argv: string[]; // e.g. ["push", "--accept-data-loss"]
  env: NodeJS.ProcessEnv;
  spawnImpl: SpawnLike;
  cwd?: string;
  log?: (line: string) => void;
}): DbSafeCliResult {
  const log = input.log ?? ((l: string) => console.log(l));
  const [sub, ...rest] = input.argv;
  const spec = sub ? SUBCOMMANDS[sub] : undefined;
  if (!spec) {
    log(`用法: db-safe <${Object.keys(SUBCOMMANDS).join("|")}> [--accept-data-loss] [-- <额外 prisma 参数>]`);
    return { exitCode: 2, decision: null, spawned: false };
  }

  // 与 Prisma CLI 一致的 env 合并：process.env 优先，.env / prisma/.env 补缺
  const cwd = input.cwd ?? process.cwd();
  const dotEnvFiles: Record<string, string>[] = [];
  for (const rel of [".env", join("prisma", ".env")]) {
    try {
      dotEnvFiles.push(parseDotEnv(readFileSync(join(cwd, rel), "utf8")));
    } catch {
      /* 文件不存在即跳过 */
    }
  }
  const databaseUrl = loadEffectiveEnvVar("DATABASE_URL", input.env, dotEnvFiles);
  const directUrl = loadEffectiveEnvVar("DIRECT_URL", input.env, dotEnvFiles);
  const acceptDataLoss = rest.includes("--accept-data-loss");

  const decision = evaluateDbCommandPolicy({
    command: spec.command,
    acceptDataLoss,
    databaseUrl,
    directUrl,
    breakGlassToken: input.env.ALLOW_PRODUCTION_DB_MUTATION,
    env: input.env,
  });

  log("═══ DB TARGET CHECK（脱敏） ═══");
  log(formatTargetLine("DATABASE_URL", decision.databaseTarget));
  log(formatTargetLine("DIRECT_URL", decision.directTarget));
  log(`DB_COMMAND = ${spec.command}${acceptDataLoss ? " --accept-data-loss" : ""}`);
  log(`RESULT = ${decision.allowed ? "ALLOWED" : "BLOCKED"}`);
  log(`CODE = ${decision.code}`);
  log(`REASON = ${decision.reason}`);

  if (!decision.allowed) {
    return { exitCode: 1, decision, spawned: false };
  }
  if (spec.command === "target_check") {
    return { exitCode: 0, decision, spawned: false };
  }

  // 放行：显式钉住两条 URL，杜绝子进程读到与守卫不同的目标
  const passthrough = rest.filter((a) => a !== "--");
  const child = input.spawnImpl("npx", ["prisma", ...spec.prismaArgs, ...passthrough], {
    stdio: "inherit",
    env: {
      ...input.env,
      DATABASE_URL: databaseUrl,
      DIRECT_URL: directUrl,
    },
  });
  return { exitCode: child.status ?? 1, decision, spawned: true };
}
