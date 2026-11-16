/**
 * 投标调查室 BidIntelligenceRoom.summaryJson 的写入入口（FIX-10）
 *
 * summaryJson 是好几个功能共用的一个 JSON 位：分析投影（项目理解等）、报价表助手（pricingInputs / pricingModel）、
 * 报价引擎镜像的我方报价（pricingInputs.ourPrice*）、投标工作区（bidWorkspace）、跟标（tenderWatch）、外部情报等。
 * 谁写都只改自己的键：
 *   1. 与报价引擎拿同一把项目行锁（lockProject，`SELECT … FROM "Project" … FOR UPDATE`）；
 *   2. 锁住之后重读库里最新的 summaryJson；
 *   3. 只设 / 只去掉自己的键，其余原样保留，同一事务写回。
 * 锁里只有一读一写：模型调用、外部请求、别的取数都放在调用之前。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { lockProject } from "@/lib/quote-engine/tender-bid";

type Tx = Prisma.TransactionClient;
export type JsonRec = Record<string, unknown>;

/** 一次写入要改的键：set 里的键覆盖（值为 undefined 视为去掉），unset 里的键去掉。不能整块替换。 */
export type RoomSummaryPatch = { set?: JsonRec; unset?: readonly string[] };

export function asJsonRec(v: unknown): JsonRec {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonRec) : {};
}

/** 纯函数：在最新值上应用一次 patch（先去掉、再设），返回新对象，不改入参 */
export function applyRoomSummaryPatch(latest: JsonRec, patch: RoomSummaryPatch): JsonRec {
  const next: JsonRec = { ...latest };
  for (const k of patch.unset ?? []) delete next[k];
  for (const [k, v] of Object.entries(patch.set ?? {})) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return next;
}

export type PatchRoomSummaryInput = {
  projectId: string;
  /** 已知房间 id 时传入；不属于该项目时按项目重新找 */
  roomId?: string | null;
  /** 在锁住后重读到的最新 summaryJson 上算出要改的键 */
  patch: (latest: JsonRec) => RoomSummaryPatch;
  /** 同一次写入里一起改的房间其它列（不得含 summaryJson） */
  data?: Omit<Prisma.BidIntelligenceRoomUpdateInput, "summaryJson">;
};

export type PatchRoomSummaryResult = { roomId: string; summaryJson: JsonRec } | null;

/** 在调用方的事务里写：先锁项目行，再重读、合并、写回。房间不存在时返回 null、什么都不写。 */
export async function patchRoomSummaryTx(tx: Tx, input: PatchRoomSummaryInput): Promise<PatchRoomSummaryResult> {
  await lockProject(tx, input.projectId);
  let room = input.roomId
    ? await tx.bidIntelligenceRoom.findUnique({ where: { id: input.roomId }, select: { id: true, projectId: true, summaryJson: true } })
    : null;
  if (!room || room.projectId !== input.projectId) {
    room = await tx.bidIntelligenceRoom.findUnique({ where: { projectId: input.projectId }, select: { id: true, projectId: true, summaryJson: true } });
  }
  if (!room) return null;
  const next = applyRoomSummaryPatch(asJsonRec(room.summaryJson), input.patch(asJsonRec(room.summaryJson)));
  const summaryJson = JSON.parse(JSON.stringify(next)) as JsonRec;
  await tx.bidIntelligenceRoom.update({
    where: { id: room.id },
    data: { ...(input.data ?? {}), summaryJson: summaryJson as Prisma.InputJsonValue },
  });
  return { roomId: room.id, summaryJson };
}

/** 自带事务的版本 */
export async function patchRoomSummary(input: PatchRoomSummaryInput): Promise<PatchRoomSummaryResult> {
  return db.$transaction((tx) => patchRoomSummaryTx(tx, input));
}
