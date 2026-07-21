import { zipSync } from "fflate";

export interface ZipPackageInput {
  sourceFiles: Array<{ path: string; buffer: Buffer }>;
  approvedImages: Array<{ path: string; buffer: Buffer }>;
  wordBuffer: Buffer;
  pdfBuffer: Buffer;
  excelBuffer: Buffer;
  webFiles?: Array<{ path: string; buffer: Buffer }>;
  manifest: Record<string, unknown>;
}

export function buildZipPackage(input: ZipPackageInput): Buffer {
  const files: Record<string, Uint8Array> = {};

  for (const f of input.sourceFiles) {
    files[`01_Source/${f.path}`] = new Uint8Array(f.buffer);
  }
  for (const f of input.approvedImages) {
    files[`02_Approved_Images/${f.path}`] = new Uint8Array(f.buffer);
  }
  files["03_Word/product-sheet.docx"] = new Uint8Array(input.wordBuffer);
  files["04_PDF/product-sheet.pdf"] = new Uint8Array(input.pdfBuffer);
  files["05_Excel/product-data.xlsx"] = new Uint8Array(input.excelBuffer);
  for (const f of input.webFiles ?? []) {
    files[`06_Web/${f.path}`] = new Uint8Array(f.buffer);
  }
  files["manifest.json"] = new Uint8Array(
    Buffer.from(JSON.stringify(input.manifest, null, 2), "utf-8"),
  );

  return Buffer.from(zipSync(files));
}

export async function generateZipDocument(input: ZipPackageInput): Promise<Buffer> {
  return buildZipPackage(input);
}
