/**
 * 新建项目「方案 B」：创建后立刻跳转详情页，
 * 用模块内存队列把待上传 File 交给详情页（刷新后丢失，可接受）。
 */

import type { PendingImportFile } from "@/components/project-create/folder-import-zone";

const queue = new Map<string, PendingImportFile[]>();

/** 详情页导入横幅正在跑上传/解析时，避免 FileManager 并行抢 process-next */
const activePipelines = new Set<string>();

export function enqueuePendingFolderImport(
  projectId: string,
  files: PendingImportFile[],
) {
  if (!projectId || files.length === 0) return;
  queue.set(projectId, files);
  activePipelines.add(projectId);
}

export function takePendingFolderImport(
  projectId: string,
): PendingImportFile[] | null {
  const files = queue.get(projectId) ?? null;
  if (files) {
    queue.delete(projectId);
    // 取出即锁定流水线，避免跳转瞬间 FileManager 抢跑
    activePipelines.add(projectId);
  }
  return files;
}

export function peekPendingFolderImport(projectId: string): boolean {
  return queue.has(projectId);
}

export function setFolderImportPipelineActive(
  projectId: string,
  active: boolean,
) {
  if (active) activePipelines.add(projectId);
  else activePipelines.delete(projectId);
}

export function isFolderImportPipelineActive(projectId: string): boolean {
  return activePipelines.has(projectId) || queue.has(projectId);
}
