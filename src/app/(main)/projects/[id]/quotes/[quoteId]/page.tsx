"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { QuoteEditor } from "@/components/quote/quote-editor";

export default function QuoteEditorPage() {
  const params = useParams<{ id: string; quoteId: string }>();
  const projectId = params.id;
  const quoteId = params.quoteId;

  const [projectName, setProjectName] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((data) => setProjectName(data.name ?? "项目"))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-accent/40" />
      </div>
    );
  }

  return (
    <QuoteEditor
      projectId={projectId}
      projectName={projectName}
      quoteId={quoteId}
    />
  );
}
