import { createHash } from "crypto";
import { db } from "@/lib/db";

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

/** 记录 Skill 运行所用版本快照（不自动改正式 Prompt） */
export async function recordSkillVersionSnapshot(input: {
  orgId: string;
  skillId: string;
  version: number;
  systemPrompt: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  playbookVersionRefs?: Array<{ id: string; version: number }>;
  changeReason?: string;
  createdBy?: string;
}) {
  const existing = await db.agentSkillVersion.findUnique({
    where: {
      skillId_version: { skillId: input.skillId, version: input.version },
    },
  });
  if (existing) {
    if (input.playbookVersionRefs) {
      return db.agentSkillVersion.update({
        where: { id: existing.id },
        data: { playbookVersionRefs: input.playbookVersionRefs as object },
      });
    }
    return existing;
  }

  return db.agentSkillVersion.create({
    data: {
      orgId: input.orgId,
      skillId: input.skillId,
      version: input.version,
      systemPromptHash: sha(input.systemPrompt),
      inputSchemaHash: input.inputSchema
        ? sha(JSON.stringify(input.inputSchema))
        : null,
      outputSchemaHash: input.outputSchema
        ? sha(JSON.stringify(input.outputSchema))
        : null,
      playbookVersionRefs: input.playbookVersionRefs as object | undefined,
      changeReason: input.changeReason ?? "runtime_snapshot",
      status: "active",
      createdBy: input.createdBy,
    },
  });
}
