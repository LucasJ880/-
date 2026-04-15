import { FileQuestion } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
        <FileQuestion className="h-8 w-8 text-gray-400" />
      </div>
      <h1 className="text-2xl font-bold text-foreground">404</h1>
      <p className="max-w-sm text-sm text-muted">
        你访问的页面不存在或已被移除。
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-800 transition-colors"
      >
        返回首页
      </Link>
    </div>
  );
}
