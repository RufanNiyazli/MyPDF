import React, { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import "./PdfViewer.css";
import AnnotationLayer from "./Annotationlayer";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const Pdfviewer = ({ pdfData, fileName }) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [scale, setScale] = useState(1.5);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pdf, setPdf] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 }); // ✅ height not length
  const [annotations, setAnnotations] = useState({});

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
        console.log("PDF loaded:", pdfDoc.numPages, "pages");
      } catch (error) {
        console.error("PDF load error:", error);
        alert("PDF load error!");
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

        setCanvasSize({ width: viewport.width, height: viewport.height });

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        await page.render(renderContext).promise;
        console.log("Page rendered:", currentPage);
      } catch (error) {
        console.error("Render error:", error);
      }
    };

    renderPage();
  }, [pdf, currentPage, scale]);

  const handleAnnotationsChange = (annotationData) => {
    setAnnotations((prev) => ({
      ...prev,
      [currentPage]: annotationData,
    }));
    console.log(`Page ${currentPage} annotations updated`);
  };

  const nextPage = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  const prevPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const zoomIn = () => {
    setScale((prev) => Math.min(prev + 0.25, 3));
  };

  const zoomOut = () => {
    setScale((prev) => Math.max(prev - 0.25, 0.5));
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
            ← Əvvəlki
          </button>

          <span className="page-info">
            Səhifə {currentPage} / {totalPages}
          </span>

          <button
            onClick={nextPage}
            disabled={currentPage === totalPages}
            className="control-btn"
          >
            Növbəti →
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

      <div className="pdf-canvas-wrapper" ref={containerRef}>
        {/* LAYER 1: PDF Canvas */}
        <canvas ref={canvasRef} className="pdf-canvas" />

        {/* LAYER 2: Annotation Canvas */}
        {canvasSize.width > 0 && (
          <div
            className="annotation-overlay"
            style={{
              width: canvasSize.width,
              height: canvasSize.height,
            }}
          >
            <AnnotationLayer
              width={canvasSize.width}
              height={canvasSize.height}
              onAnnotationsChange={handleAnnotationsChange}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default Pdfviewer;
