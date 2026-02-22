import React, { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import "./PdfViewer.css"

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
const Pdfviewer = ({ pdfData, fileName }) => {
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [scale, setScale] = useState(1.5);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pdf, setPdf] = useState(null);

  useEffect(() => {
    if (!pdfData) return;

    const loadPdf = async () => {
      try {
        setLoading(true);
        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
        const pdfDoc = await loadingTask.promise;
        setPdf(pdfDoc);
        setTotalPages(pdfDoc.numPages);
        setCurrentPage(1);
        console.log("PDF downloaded:", pdfDoc.numPages, "page");
      } catch (error) {
        console.error("PDF download error:", error);
        alert("PDF download error!");
      } finally {
        setLoading(false);
      }
    };
    loadPdf();
  }, [pdfData]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;

    const renderPage = async () => {
      try {
        const page = await pdf.getPage(currentPage);
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        await page.render(renderContext).promise;
        console.log("Page rendered", currentPage);
      } catch (error) {
        console.error("Render error", error);
      }
    };

    renderPage();
  }, [pdf, currentPage, scale]);
  // Növbəti səhifə
  const nextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  // Əvvəlki səhifə
  const prevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  // Zoom in
  const zoomIn = () => {
    setScale((prevScale) => Math.min(prevScale + 0.25, 3));
  };

  // Zoom out
  const zoomOut = () => {
    setScale((prevScale) => Math.max(prevScale - 0.25, 0.5));
  };
  if (loading) {
    return (
      <div className="pdf-loading">
        <div className="spinner"></div>
        <p>PDF loading...</p>
      </div>
    );
  }

  return (
    <div className="pdf-viewer-container">
      
      <div className="pdf-controls">
        <div className="page-controls">
          <button
            onClick={prevPage}
            disabled={currentPage === 1}
            className="control-btn"
          >
            ←Previous
          </button>

          <span className="page-info">
            Page {currentPage} / {totalPages}
          </span>

          <button
            onClick={nextPage}
            disabled={currentPage === totalPages}
            className="control-btn"
          >
            Next→
          </button>
        </div>

        <div className="zoom-controls">
          <button onClick={zoomOut} className="control-btn">
            🔍-
          </button>
          <span className="zoom-info">{Math.round(scale * 100)}%</span>
          <button onClick={zoomIn} className="control-btn">
            🔍+
          </button>
        </div>
      </div>

      {/* PDF Canvas */}
      <div className="pdf-canvas-wrapper">
        <canvas ref={canvasRef} className="pdf-canvas"></canvas>
      </div>
    </div>
  );
};

export default Pdfviewer;
