export interface ExcelDocInput {
  productInfo: Record<string, string>;
  specifications: Record<string, string>;
  packaging: Record<string, string>;
  marketingCopy: Record<string, string>;
  missingInformation: string[];
  assetManifest: Array<{ fileName: string; role: string; path: string }>;
}

export async function generateExcelDocument(input: ExcelDocInput): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  function addKeyValueSheet(name: string, data: Record<string, string>) {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = [
      { header: "Field", key: "field", width: 30 },
      { header: "Value", key: "value", width: 60 },
    ];
    for (const [field, value] of Object.entries(data)) {
      sheet.addRow({ field, value });
    }
  }

  addKeyValueSheet("Product Information", input.productInfo);
  addKeyValueSheet("Specifications", input.specifications);
  addKeyValueSheet("Packaging", input.packaging);
  addKeyValueSheet("Marketing Copy", input.marketingCopy);

  const missingSheet = workbook.addWorksheet("Missing Information");
  missingSheet.columns = [{ header: "Field", key: "field", width: 40 }];
  for (const field of input.missingInformation) {
    missingSheet.addRow({ field });
  }

  const manifestSheet = workbook.addWorksheet("Asset Manifest");
  manifestSheet.columns = [
    { header: "File Name", key: "fileName", width: 30 },
    { header: "Role", key: "role", width: 20 },
    { header: "Path", key: "path", width: 50 },
  ];
  for (const row of input.assetManifest) {
    manifestSheet.addRow(row);
  }

  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}
