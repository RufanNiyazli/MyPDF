import { PDFDocument } from "pdf-lib";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data) || (typeof data === "object" && data !== null)) {
    return new Uint8Array(Object.values(data));
  }
  throw new Error("Cannot convert PDF data to Uint8Array");
}

function base64ToUint8Array(dataURL) {
  const base64 = dataURL.split(",")[1];
  const raw = atob(base64);
  const uint8 = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    uint8[i] = raw.charCodeAt(i);
  }
  return uint8;
}

export async function savePdfWithAnnotations(originalPdfData, canvasByPage) {
  const safeData = toUint8Array(originalPdfData);
  const pdfDoc = await PDFDocument.load(safeData);
  const pages = pdfDoc.getPages();

  for (let pageNum = 1; pageNum <= pages.length; pageNum++) {
    const fabricCanvas = canvasByPage[pageNum];
    if (!fabricCanvas) continue;
    if (fabricCanvas.getObjects().length === 0) continue;

    const { width: pdfW, height: pdfH } = pages[pageNum - 1].getSize();

    const dataURL = fabricCanvas.toDataURL({ format: "png", quality: 1.0 });
    const uint8Array = base64ToUint8Array(dataURL);
    const pngImage = await pdfDoc.embedPng(uint8Array);

    pages[pageNum - 1].drawImage(pngImage, {
      x: 0,
      y: 0,
      width: pdfW,
      height: pdfH,
    });
  }

  return await pdfDoc.save();
}

export async function downloadPdf(pdfBytes, fileName) {
  const savePath = await save({
    defaultPath: fileName.replace(".pdf", "_annotated.pdf"),
    filters: [{ name: "PDF Files", extensions: ["pdf"] }],
  });

  if (savePath) {
    await writeFile(savePath, pdfBytes);
    return true;
  }

  return false;
}
