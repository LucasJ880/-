"use client";

import { useState, useRef } from "react";
import { Loader2, FileSpreadsheet } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ImportResult } from "./types";

export function CsvImportDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch("/api/sales/import-csv", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "导入失败");
      }
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>CSV 客户导入</DialogTitle>
          <DialogDescription>
            从简道云导出 CSV 文件后上传。支持的列名：客户名称 / 电话 / 邮箱 / 地址 / 来源 / 备注 / 机会标题 / 阶段 / 预估金额 / 产品类型 / 优先级
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <>
            <div
              className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-border bg-white/50 py-8 transition-colors hover:border-foreground/30"
              onClick={() => inputRef.current?.click()}
            >
              <FileSpreadsheet className="h-8 w-8 text-muted/50" />
              <p className="mt-2 text-sm text-muted">
                {file ? file.name : "点击选择 .csv 文件"}
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>

            {error && (
              <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button onClick={handleImport} disabled={!file || importing}>
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                开始导入
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <div className="rounded-lg bg-success-bg px-4 py-3 text-sm text-success">
                导入完成！创建了 {result.customersCreated} 位客户，
                {result.opportunitiesCreated} 个销售机会。
                {result.skipped > 0 && ` 跳过 ${result.skipped} 行。`}
              </div>
              {result.errors.length > 0 && (
                <div className="rounded-lg bg-warning-bg px-4 py-3 text-sm text-warning">
                  {result.errors.length} 行出错：
                  <ul className="mt-1 list-disc pl-4 text-xs">
                    {result.errors.slice(0, 5).map((e, i) => (
                      <li key={i}>第 {e.row} 行: {e.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={onSuccess}>完成</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
