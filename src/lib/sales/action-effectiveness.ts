export type EffectivenessActionInput = {
  id: string;
  signalKey: string;
  status: string;
  createdAt: Date | string;
  startedAt: Date | string | null;
  dueAt: Date | string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  opportunityId: string | null;
  opportunityStage: string | null;
  opportunityWonAt: Date | string | null;
};

const WON_STAGES = new Set(["signed", "completed"]);

function isAssistedWin(action: EffectivenessActionInput) {
  return Boolean(
    action.opportunityId &&
    action.opportunityStage &&
    WON_STAGES.has(action.opportunityStage) &&
    action.opportunityWonAt &&
    new Date(action.opportunityWonAt).getTime() >= new Date(action.createdAt).getTime(),
  );
}

function roundedRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10) / 10;
}

export function summarizeSalesActionEffectiveness(
  actions: EffectivenessActionInput[],
  now = new Date(),
) {
  const terminal = actions.filter(
    (action) => action.status === "completed" || action.status === "dismissed",
  );
  const completed = actions.filter((action) => action.status === "completed");
  const active = actions.filter(
    (action) => action.status === "open" || action.status === "in_progress",
  );
  const overdue = active.filter(
    (action) => action.dueAt && new Date(action.dueAt).getTime() < now.getTime(),
  );
  const responseHours = actions.flatMap((action) =>
    action.startedAt
      ? [Math.max(0, (new Date(action.startedAt).getTime() - new Date(action.createdAt).getTime()) / 3_600_000)]
      : [],
  );
  const wonOpportunityIds = new Set(
    actions.filter(isAssistedWin).map((action) => action.opportunityId as string),
  );

  function groupBy(keyFor: (action: EffectivenessActionInput) => string | null) {
    const groups = new Map<string, EffectivenessActionInput[]>();
    for (const action of actions) {
      const key = keyFor(action);
      if (!key) continue;
      groups.set(key, [...(groups.get(key) ?? []), action]);
    }
    return [...groups.entries()].map(([key, rows]) => {
      const resolved = rows.filter(
        (row) => row.status === "completed" || row.status === "dismissed",
      );
      const done = rows.filter((row) => row.status === "completed");
      const won = new Set(
        rows.filter(isAssistedWin).map((row) => row.opportunityId as string),
      );
      const opportunities = new Set(
        rows.flatMap((row) => (row.opportunityId ? [row.opportunityId] : [])),
      );
      const response = rows.flatMap((row) =>
        row.startedAt
          ? [Math.max(0, (new Date(row.startedAt).getTime() - new Date(row.createdAt).getTime()) / 3_600_000)]
          : [],
      );
      return {
        key,
        created: rows.length,
        completed: done.length,
        completionRate: roundedRate(done.length, resolved.length),
        assistedWins: won.size,
        assistedWinRate: roundedRate(won.size, opportunities.size),
        medianResponseHours: median(response),
      };
    }).sort((a, b) => b.created - a.created);
  }

  return {
    overview: {
      created: actions.length,
      active: active.length,
      overdue: overdue.length,
      completed: completed.length,
      autoResolved: actions.filter((action) => action.status === "auto_resolved").length,
      completionRate: roundedRate(completed.length, terminal.length),
      medianResponseHours: median(responseHours),
      assistedWins: wonOpportunityIds.size,
    },
    signals: groupBy((action) => action.signalKey),
    team: groupBy((action) => action.assignedToId ? `${action.assignedToId}|${action.assignedToName ?? "未命名"}` : null)
      .map((row) => {
        const [userId, name] = row.key.split("|");
        return { ...row, key: userId, name };
      }),
  };
}
