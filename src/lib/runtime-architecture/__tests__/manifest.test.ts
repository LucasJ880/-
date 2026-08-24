/**
 * R1 guard 1 — architecture manifest validity.
 * 运行：npx tsx src/lib/runtime-architecture/__tests__/manifest.test.ts
 */
import { existsSync } from "fs";
import { join } from "path";
import {
  FROZEN_CENSUS_AREAS,
  RUNTIME_ARCHITECTURE_MANIFEST,
} from "../manifest";
import { finish, ok } from "./helpers";

const areas = RUNTIME_ARCHITECTURE_MANIFEST.map((e) => e.area);
ok(new Set(areas).size === areas.length, "area 唯一");
ok(areas.length === 12, `覆盖全部 12 个 RuntimeArchitectureArea（实际 ${areas.length}）`);

for (const entry of RUNTIME_ARCHITECTURE_MANIFEST) {
  ok(entry.paths.length > 0, `${entry.area}: 声明了 paths`);
  for (const p of entry.paths) {
    ok(existsSync(join(process.cwd(), p)), `${entry.area}: 路径存在 ${p}`);
  }
  if (entry.status === "frozen" || entry.status === "legacy_active") {
    ok(
      Boolean(entry.canonicalReplacement),
      `${entry.area}: frozen/legacy 必须声明 canonicalReplacement`,
    );
    ok(
      entry.newFeaturesAllowed === false,
      `${entry.area}: frozen/legacy 必须 newFeaturesAllowed=false`,
    );
    ok(
      (entry.allowedChanges?.length ?? 0) > 0,
      `${entry.area}: frozen/legacy 必须列出 allowedChanges`,
    );
  }
  if (entry.status === "canonical" || entry.status === "substrate") {
    ok(entry.newFeaturesAllowed === true, `${entry.area}: canonical/substrate 允许（受限的）新功能`);
  }
}

const frozenAreas = RUNTIME_ARCHITECTURE_MANIFEST.filter((e) => e.status === "frozen").map((e) => e.area);
ok(
  frozenAreas.includes("agent-supervisor") && frozenAreas.includes("agent-task-legacy"),
  "agent-supervisor 与 agent-task-legacy 处于 frozen",
);

for (const dirs of Object.values(FROZEN_CENSUS_AREAS)) {
  for (const d of dirs) ok(existsSync(join(process.cwd(), d)), `census 目录存在 ${d}`);
}

finish("runtime-architecture manifest");
