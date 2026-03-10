import { useState, useRef, useCallback } from "react";
import "./App.css";
import { readFile } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import ContinuousPDFViewer from "./ContinuousPDFViewer";
import { savePdfWithAnnotations, downloadPdf } from "./pdfSaver";

function App() {
  const [pdfData, setPdfData] = useState(null);
  const [fileName, setFileName] = useState("");
  const [scale, setScale] = useState(1.5);
  const canvasMapRef = useRef({});

  const handleCanvasMapReady = useCallback((map) => {
    canvasMapRef.current = map;
  }, []);

  const handleOpenPDF = async () => {
    try {
      const selected = await open({
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (selected && typeof selected === "string") {
        const contents = await readFile(selected, { dir: null });
        setPdfData(contents);
        setFileName(selected.split("/").pop() || "Unnamed");
        canvasMapRef.current = {};
      }
    } catch (error) {
      console.error("Error opening PDF:", error);
    }
  };

  const handleClosePDF = () => {
    setPdfData(null);
    setFileName("");
    canvasMapRef.current = {};
  };

  const handleSavePDF = async () => {
    if (!pdfData) return;
    try {
      const newPdfBytes = await savePdfWithAnnotations(
        pdfData,
        canvasMapRef.current
      );
      await downloadPdf(newPdfBytes, fileName);
    } catch (error) {
      console.error("Save error:", error);
      alert("Save failed: " + error.message);
    }
  };

  const zoomIn = () => setScale((prev) => Math.min(prev + 0.25, 4));
  const zoomOut = () => setScale((prev) => Math.max(prev - 0.25, 0.5));

  return (
    <div className="app-container">
      <div className="topbar">
        <div className="topbar-brand">
          <div className="brand-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <span className="brand-name">mypdf</span>
        </div>

        <div className="topbar-divider" />

        <div className="topbar-actions">
          <button className="topbar-btn primary" onClick={handleOpenPDF}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            Open PDF
          </button>

          {fileName && (
            <>
              <div className="file-chip">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12, flexShrink: 0 }}>
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="file-chip-name">{fileName}</span>
              </div>

              <button className="topbar-btn save" onClick={handleSavePDF}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                Save PDF
              </button>

              <button className="topbar-btn secondary" onClick={handleClosePDF}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Close
              </button>
            </>
          )}
        </div>

        {pdfData && (
          <div className="topbar-zoom">
            <button className="zoom-btn" onClick={zoomOut}>−</button>
            <span className="zoom-level">{Math.round(scale * 100)}%</span>
            <button className="zoom-btn" onClick={zoomIn}>+</button>
          </div>
        )}
      </div>

      <div className="content">
        {pdfData ? (
          <ContinuousPDFViewer
            pdfData={pdfData}
            fileName={fileName}
            scale={scale}
            onCanvasMapReady={handleCanvasMapReady}
          />
        ) : (
          <div className="welcome">
            <div className="welcome-hero">
              <div className="welcome-logo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
              <h1>mypdf</h1>
              <p className="welcome-sub">
                A minimal, fast PDF annotation tool. Open any PDF and annotate with precision.
              </p>
              <button className="welcome-open-btn" onClick={handleOpenPDF}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
                Open a PDF
              </button>
            </div>

            <div className="features-grid">
              <div className="feature-card">
                <div className="feature-card-icon" style={{ background: "rgba(59,130,246,0.15)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
                    <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </div>
                <h3>Draw & Pen</h3>
              </div>
              <div className="feature-card">
                <div className="feature-card-icon" style={{ background: "rgba(234,179,8,0.15)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2">
                    <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
                  </svg>
                </div>
                <h3>Highlight</h3>
              </div>
              <div className="feature-card">
                <div className="feature-card-icon" style={{ background: "rgba(139,92,246,0.15)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2">
                    <polyline points="4 7 4 4 20 4 20 7" />
                    <line x1="9" y1="20" x2="15" y2="20" />
                    <line x1="12" y1="4" x2="12" y2="20" />
                  </svg>
                </div>
                <h3>Text Box</h3>
              </div>
              <div className="feature-card">
                <div className="feature-card-icon" style={{ background: "rgba(34,197,94,0.15)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                    <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                </div>
                <h3>Save PDF</h3>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
