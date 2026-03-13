import { PDFDocument } from "pdf-lib";
import { writeFile } from "@tauri-apps/plugin-fs";

export async function savePdfWithAnnotations(originalPdfData, canvasByPage) {
  // Safely coerce incoming data to Uint8Array for pdf-lib
  let safeData = originalPdfData;
  if (originalPdfData instanceof Uint8Array) {
    safeData = originalPdfData;
  } else if (originalPdfData instanceof ArrayBuffer) {
    safeData = new Uint8Array(originalPdfData);
  } else if (ArrayBuffer.isView(originalPdfData)) {
    safeData = new Uint8Array(originalPdfData.buffer, originalPdfData.byteOffset, originalPdfData.byteLength);
  } else if (Array.isArray(originalPdfData)) {
    safeData = new Uint8Array(originalPdfData);
  } else if (typeof originalPdfData === "object" && originalPdfData !== null) {
      // Tauri sometimes returns a Javascript object with indexed string keys
      safeData = new Uint8Array(Object.values(originalPdfData));
  }

  const pdfDoc = await PDFDocument.load(safeData);
  const pages = pdfDoc.getPages();

  for (let pageNum = 1; pageNum <= pages.length; pageNum++) {
    const fabricCanvas = canvasByPage[pageNum];
    if (!fabricCanvas) continue;
    
    // Skip if there are no annotations on this page
    if (fabricCanvas.getObjects().length === 0) continue;

    const { width: pdfW, height: pdfH } = pages[pageNum - 1].getSize();

    // Export the canvas as a base64 PNG strictly matching its current visual output
    const dataURL = fabricCanvas.toDataURL({ format: "png", multiplier: 1 });
    
    // Use native fetch to decode the base64 string accurately and performantly
    const res = await fetch(dataURL);
    const arrayBuffer = await res.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    const pngImage = await pdfDoc.embedPng(uint8Array);

    // pdf-lib's origin (0,0) is bottom-left. By placing our page-sized image at 0,0,
    // and setting width/height strictly to the PDF points size, it exactly overlays the annotations.
    pages[pageNum - 1].drawImage(pngImage, {
      x: 0,
      y: 0,
      width: pdfW,
      height: pdfH,
    });
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

export async function downloadPdf(pdfBytes, filePath) {
  if (filePath) {
    await writeFile(filePath, pdfBytes);
    return true;
  }
  return false;
}
