import { Loader2 } from "lucide-react";

export default function MainLoading() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
        <p className="text-sm text-muted">加载中…</p>
      </div>
    </div>
  );
}
