"use client";

import { WifiOff, RefreshCw } from "lucide-react";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAF8F4] p-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-amber-100">
          <WifiOff className="h-10 w-10 text-amber-600" />
        </div>
        <h1 className="mb-2 text-2xl font-bold text-gray-900">
          当前处于离线状态
        </h1>
        <p className="mb-6 text-gray-500">
          网络连接不可用。已保存的数据不受影响，联网后将自动同步。
        </p>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white shadow hover:bg-teal-800 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          重试连接
        </button>
      </div>
    </div>
  );
}
