/**
 * 夹具对照测试共用：读夹具、计数、数值/文本比对、偏离跳过打印。
 * 夹具由 scripts/sunny-process-oracle/oracle.py 用 LibreOffice 重算 Excel 原件生成。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deviation } from "../deviations";
import { EPS } from "../excel-fns";

export interface Fixture<C> {
  source: { title: string; sha256: string };
  cases: C[];
}

export function loadFixture<C>(name: string): Fixture<C> {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", `${name}.json`), "utf-8")) as Fixture<C>;
}

export type ExcelValue = number | string | null | { error: string };

export function isExcelError(v: unknown): v is { error: string } {
  return typeof v === "object" && v !== null && "error" in v;
}

export class Tally {
  pass = 0;
  fail = 0;
  checks = 0;
  private failures: string[] = [];
  private skipped = new Map<string, number>();

  eq(actual: unknown, expected: unknown, label: string): void {
    this.checks++;
    if (same(actual, expected)) {
      this.pass++;
      return;
    }
    this.fail++;
    if (this.failures.length < 40) {
      this.failures.push(`  ✗ ${label}: 系统=${JSON.stringify(actual)} 原件=${JSON.stringify(expected)}`);
    }
  }

  skip(deviationId: string): void {
    deviation(deviationId); // 未登记编号直接抛错
    this.skipped.set(deviationId, (this.skipped.get(deviationId) ?? 0) + 1);
  }

  ok(cond: boolean, label: string, detail?: unknown): void {
    this.checks++;
    if (cond) {
      this.pass++;
      console.log(`  ✓ ${label}`);
    } else {
      this.fail++;
      console.error(`  ✗ ${label}`, detail ?? "");
    }
  }

  report(title: string): void {
    for (const f of this.failures) console.error(f);
    for (const [id, n] of this.skipped) {
      console.log(`  ↷ 偏离 ${id}（${deviation(id).titleZh}）跳过 ${n} 项，见报告 §3`);
    }
    console.log(`\n${title}：${this.pass} 通过，${this.fail} 失败（共 ${this.checks} 项比对）`);
    if (this.fail > 0) process.exit(1);
  }
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= EPS;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (typeof a === "object" && typeof b === "object" && a && b) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}
