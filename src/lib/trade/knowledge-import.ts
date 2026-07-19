/**
 * 将 Markdown vault 文档写入 TradeKnowledge（org 隔离）
 */

import { createKnowledge } from "./knowledge-service";
import {
  extractTextFilesFromZip,
  parseVaultFiles,
  type ParsedVaultDocument,
  type VaultFileInput,
} from "@/lib/knowledge/markdown-vault-import";

export async function importVaultDocumentsToTradeKnowledge(input: {
  orgId: string;
  userId: string;
  files: VaultFileInput[];
  defaultCategory?: string;
}): Promise<{
  created: number;
  documents: Array<{ id: string; title: string; category: string; sourcePath: string }>;
  skipped: string[];
}> {
  const { documents, skipped } = parseVaultFiles(input.files, {
    defaultCategory: input.defaultCategory || "product",
    maxFiles: 200,
  });

  const created: Array<{ id: string; title: string; category: string; sourcePath: string }> = [];
  for (const doc of documents) {
    const row = await createKnowledge({
      orgId: input.orgId,
      category: doc.category,
      title: doc.title,
      content: appendSourceFooter(doc),
      tags: mergeTags(doc.tags, "vault-import"),
      language: doc.language,
      createdById: input.userId,
    });
    created.push({
      id: row.id,
      title: row.title,
      category: row.category,
      sourcePath: doc.sourcePath,
    });
  }

  return { created: created.length, documents: created, skipped };
}

export async function importZipToTradeKnowledge(input: {
  orgId: string;
  userId: string;
  zip: Uint8Array;
  defaultCategory?: string;
}) {
  const files = extractTextFilesFromZip(input.zip);
  if (files.length === 0) {
    throw new Error("ZIP 中未找到 .md / .txt 文本文件（已忽略 .obsidian 等目录）");
  }
  return importVaultDocumentsToTradeKnowledge({
    orgId: input.orgId,
    userId: input.userId,
    files,
    defaultCategory: input.defaultCategory,
  });
}

function appendSourceFooter(doc: ParsedVaultDocument): string {
  return `${doc.content}\n\n<!-- source: ${doc.sourcePath} -->`;
}

function mergeTags(tags: string, extra: string): string {
  const set = new Set(
    [...tags.split(","), extra]
      .map((t) => t.trim())
      .filter(Boolean),
  );
  return [...set].join(",");
}
