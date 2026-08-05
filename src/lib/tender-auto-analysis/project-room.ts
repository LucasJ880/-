/**
 * Phase E 将填充：投影到 BidIntelligenceRoom。
 */

export type ProjectRoomInput = {
  runId: string;
  projectId: string;
  orgId: string;
  roomId?: string | null;
};

export type ProjectRoomResult = {
  projected: boolean;
  roomId: string | null;
  stub: true;
};

/** TODO(Phase E): 真实投影 */
export async function projectAnalysisToRoom(
  input: ProjectRoomInput,
): Promise<ProjectRoomResult> {
  return {
    projected: false,
    roomId: input.roomId ?? null,
    stub: true,
  };
}
