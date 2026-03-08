import { PDFDocument } from 'pdf-lib';

export async function canvasToBlob(fabricCanvas) {
  return new Promise((resolve) => {
    // Canvas-ı data URL-ə çevir (base64 PNG)
    const dataURL = fabricCanvas.toDataURL({
      format: 'png',
      quality: 1.0,
      multiplier: 2, 
    });

    fetch(dataURL)
      .then(res => res.blob())
      .then(blob => resolve(blob));
  });
}

export async function savePdfWithAnnotations(originalPdfData, annotationsByPage) {
  try {
    console.log('PDF saxlanılır...');


    const pdfDoc = await PDFDocument.load(originalPdfData);
    const pages = pdfDoc.getPages();

    console.log('Səhifə sayı:', pages.length);


    for (let pageNum = 1; pageNum <= pages.length; pageNum++) {
      const canvas = annotationsByPage[pageNum];

      if (!canvas) {
        console.log(`Səhifə ${pageNum}: Annotation yoxdur`);
        continue;
      }

      console.log(`Səhifə ${pageNum}: Annotationlar əlavə edilir...`);

    
      const blob = await canvasToBlob(canvas);
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      const pngImage = await pdfDoc.embedPng(uint8Array);
      const page = pages[pageNum - 1]; 


      const { width, height } = page.getSize();

      page.drawImage(pngImage, {
        x: 0,
        y: 0,
        width: width,
        height: height,
        opacity: 1.0, // Tam görünən
      });

      console.log(`Səhifə ${pageNum}: ✓ Tamamlandı`);
    }

 
    const pdfBytes = await pdfDoc.save();
    console.log('PDF saxlanıldı! Ölçü:', pdfBytes.length, 'bytes');

    return pdfBytes;
  } catch (error) {
    console.error('PDF saxlama xətası:', error);
    throw error;
  }
}


export async function downloadPdf(pdfBytes, fileName) {
  try {
    // Tauri v2 dialog və fs
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');

    // Fayl saxlama dialoqu
    const savePath = await save({
      defaultPath: fileName.replace('.pdf', '_annotated.pdf'),
      filters: [{
        name: 'PDF Files',
        extensions: ['pdf']
      }]
    });

    if (savePath) {
      // Faylı yaz
      await writeFile(savePath, pdfBytes);
      console.log('Fayl saxlanıldı:', savePath);
      return true;
    }

    return false;
  } catch (error) {
    console.error('Fayl saxlama xətası:', error);
    throw error;
  }
}

