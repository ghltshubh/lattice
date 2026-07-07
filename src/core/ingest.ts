/**
 * Ingest & parse (BUILD_PLAN §2, M2): pdf.js / mammoth / native text.
 * Parsers are dynamically imported so the main bundle stays lean.
 */

export interface IngestResult {
  title: string;
  text: string;
}

export async function ingestFile(file: File): Promise<IngestResult> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const title = file.name.replace(/\.[^.]+$/, "");
  if (ext === "pdf") return { title, text: await pdfToText(file) };
  if (ext === "docx") return { title, text: await docxToText(file) };
  if (ext === "txt" || ext === "md" || file.type.startsWith("text/")) {
    return { title, text: await file.text() };
  }
  throw new Error(`Unsupported file type: .${ext} (use PDF, DOCX, TXT or MD)`);
}

async function pdfToText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
  await task.destroy();
  return pages.filter(Boolean).join("\n\n");
}

async function docxToText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}
