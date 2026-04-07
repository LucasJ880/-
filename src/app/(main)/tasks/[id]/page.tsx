"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function TaskDetailRedirect() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  useEffect(() => {
    if (taskId) {
      router.replace(`/tasks?open=${taskId}`);
    }
  }, [taskId, router]);

  return (
    <div className="flex h-40 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-accent" />
    </div>
  );
}
