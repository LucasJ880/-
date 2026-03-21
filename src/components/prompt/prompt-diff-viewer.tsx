"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface DiffLine {
  type: "same" | "add" | "remove";
  lineOld?: number;
  lineNew?: number;
  text: string;
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  const m = oldLines.length;
  const n = newLines.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = m,
    j = n;
  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: "same", lineOld: i, lineNew: j, text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: "add", lineNew: j, text: newLines[j - 1] });
      j--;
    } else {
      stack.push({ type: "remove", lineOld: i, text: oldLines[i - 1] });
      i--;
    }
  }

  while (stack.length > 0) {
    result.push(stack.pop()!);
  }

  return result;
}

export function PromptDiffViewer({
  oldContent,
  newContent,
  oldLabel = "旧版本",
  newLabel = "新版本",
  className,
}: {
  oldContent: string;
  newContent: string;
  oldLabel?: string;
  newLabel?: string;
  className?: string;
}) {
  const lines = useMemo(
    () => computeDiff(oldContent, newContent),
    [oldContent, newContent]
  );

  const hasChanges = lines.some((l) => l.type !== "same");

  if (!hasChanges) {
    return (
      <div className={cn("rounded-lg border border-border p-4 text-center text-sm text-muted", className)}>
        两个版本内容完全一致
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border", className)}>
      <div className="flex border-b border-border bg-card-bg text-xs font-medium text-muted">
        <div className="w-1/2 border-r border-border px-3 py-2">
          {oldLabel}
        </div>
        <div className="w-1/2 px-3 py-2">{newLabel}</div>
      </div>
      <div className="max-h-[600px] overflow-auto font-mono text-xs">
        {lines.map((line, idx) => (
          <div
            key={idx}
            className={cn(
              "flex min-h-[1.5rem]",
              line.type === "remove" && "bg-[rgba(166,61,61,0.04)]",
              line.type === "add" && "bg-[rgba(46,122,86,0.04)]"
            )}
          >
            <div
              className={cn(
                "w-1/2 border-r border-border/50 px-3 py-0.5",
                line.type === "add" && "opacity-30"
              )}
            >
              {line.type !== "add" && (
                <span>
                  <span className="mr-2 inline-block w-6 text-right text-muted/50">
                    {line.lineOld}
                  </span>
                  <span
                    className={cn(
                      line.type === "remove" && "text-[#a63d3d]"
                    )}
                  >
                    {line.type === "remove" && "- "}
                    {line.text}
                  </span>
                </span>
              )}
            </div>
            <div
              className={cn(
                "w-1/2 px-3 py-0.5",
                line.type === "remove" && "opacity-30"
              )}
            >
              {line.type !== "remove" && (
                <span>
                  <span className="mr-2 inline-block w-6 text-right text-muted/50">
                    {line.lineNew}
                  </span>
                  <span
                    className={cn(
                      line.type === "add" && "text-[#2e7a56]"
                    )}
                  >
                    {line.type === "add" && "+ "}
                    {line.text}
                  </span>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
