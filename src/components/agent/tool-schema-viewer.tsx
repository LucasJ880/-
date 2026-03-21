"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

function formatJson(raw: string | null | undefined): string {
  if (!raw) return "—";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function ToolSchemaViewer({
  label,
  schema,
}: {
  label: string;
  schema: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);

  if (!schema) {
    return (
      <div className="text-xs text-muted">
        <span className="font-medium">{label}:</span> 未定义
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {label}
      </button>
      {open && (
        <pre className="mt-1 max-h-48 overflow-auto rounded border border-border bg-background p-2 text-[11px]">
          {formatJson(schema)}
        </pre>
      )}
    </div>
  );
}
