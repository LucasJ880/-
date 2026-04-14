"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Monitor, Smartphone } from "lucide-react";

export interface ConflictData {
  localRecord: Record<string, unknown>;
  serverRecord: Record<string, unknown>;
  table: string;
  localId: string;
}

export function SyncConflictDialog({
  open,
  conflict,
  onResolve,
}: {
  open: boolean;
  conflict: ConflictData | null;
  onResolve: (choice: "local" | "server") => void;
}) {
  const [selected, setSelected] = useState<"local" | "server">("local");

  if (!conflict) return null;

  const fields = new Set([
    ...Object.keys(conflict.localRecord),
    ...Object.keys(conflict.serverRecord),
  ]);

  const diffFields = Array.from(fields).filter((f) => {
    if (f.startsWith("_") || f === "syncStatus" || f === "localId") return false;
    return JSON.stringify(conflict.localRecord[f]) !== JSON.stringify(conflict.serverRecord[f]);
  });

  return (
    <Dialog open={open} onOpenChange={() => onResolve(selected)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            数据冲突
          </DialogTitle>
          <DialogDescription>
            本地修改和服务端数据有差异，请选择保留哪个版本
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {diffFields.length > 0 && (
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                差异字段
              </p>
              <div className="space-y-1.5 text-sm">
                {diffFields.map((f) => (
                  <div key={f} className="grid grid-cols-3 gap-2">
                    <span className="text-xs font-medium text-muted-foreground truncate">
                      {f}
                    </span>
                    <span className="text-xs truncate text-amber-700">
                      {String(conflict.localRecord[f] ?? "—")}
                    </span>
                    <span className="text-xs truncate text-blue-700">
                      {String(conflict.serverRecord[f] ?? "—")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setSelected("local")}
              className={`rounded-lg border p-3 text-left transition-colors ${
                selected === "local"
                  ? "border-amber-400 bg-amber-50"
                  : "border-border hover:border-amber-200"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Smartphone className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-medium">本地版本</span>
              </div>
              <p className="text-xs text-muted-foreground">
                保留你在离线时的修改
              </p>
            </button>
            <button
              onClick={() => setSelected("server")}
              className={`rounded-lg border p-3 text-left transition-colors ${
                selected === "server"
                  ? "border-blue-400 bg-blue-50"
                  : "border-border hover:border-blue-200"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Monitor className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium">服务端版本</span>
              </div>
              <p className="text-xs text-muted-foreground">
                使用服务器上最新的数据
              </p>
            </button>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onResolve(selected)}>
            确认使用{selected === "local" ? "本地" : "服务端"}版本
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
