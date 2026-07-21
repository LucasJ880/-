export interface PdfDocInput {
  title: string;
  productName: string;
  sections: Array<{ heading: string; lines: string[] }>;
  draftBanner?: string;
}

export async function generatePdfDocument(input: PdfDocInput): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  let y = margin;

  doc.setFontSize(18);
  doc.text(input.title, margin, y);
  y += 28;

  if (input.draftBanner) {
    doc.setFontSize(10);
    doc.setTextColor(200, 0, 0);
    doc.text(input.draftBanner, margin, y);
    doc.setTextColor(0, 0, 0);
    y += 20;
  }

  doc.setFontSize(12);
  doc.text(`Product: ${input.productName}`, margin, y);
  y += 24;

  for (const section of input.sections.slice(0, 8)) {
    if (y > 720) {
      doc.addPage();
      y = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.text(section.heading, margin, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    for (const line of section.lines) {
      const wrapped = doc.splitTextToSize(line, 500);
      if (y + wrapped.length * 14 > 780) {
        doc.addPage();
        y = margin;
      }
      doc.text(wrapped, margin, y);
      y += wrapped.length * 14 + 4;
    }
    y += 8;
  }

  return Buffer.from(doc.output("arraybuffer"));
}
