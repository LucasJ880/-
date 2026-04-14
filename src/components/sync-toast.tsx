"use client";

import { useEffect, useRef, useState } from "react";
import { subscribeSyncState, type SyncState } from "@/lib/offline/sync-engine";
import { CheckCircle2, X } from "lucide-react";

export function SyncToast() {
  const [show, setShow] = useState(false);
  const [count, setCount] = useState(0);
  const prevSyncing = useRef(false);

  useEffect(() => {
    return subscribeSyncState((state: SyncState) => {
      if (prevSyncing.current && !state.isSyncing && state.pendingCount === 0 && !state.lastError) {
        setCount(state.currentIndex);
        setShow(true);
        setTimeout(() => setShow(false), 4000);
      }
      prevSyncing.current = state.isSyncing;
    });
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-lg">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
        <span className="text-sm font-medium text-emerald-800">
          {count} 条数据已同步完成
        </span>
        <button
          onClick={() => setShow(false)}
          className="ml-2 rounded-full p-0.5 text-emerald-400 hover:text-emerald-600 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
