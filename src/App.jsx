import { useState, useRef, useCallback } from "react";
import "./App.css";
import { readFile } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import ContinuousPDFViewer from "./ContinuousPDFViewer";
import { savePdfWithAnnotations, downloadPdf } from "./pdfSaver";
import {
  saveAnnotations,
  loadAnnotations,
  savePristineBytes,
  loadPristineBytes,
} from "./annotationStore";

// ─── Unsaved-changes confirmation dialog ─────────────────────────────────────

/**
 * Modal dialog shown when the user tries to close or open a new file
 * while there are unsaved annotations.
 *
 * @param {{ onSave: fn, onDiscard: fn, onCancel: fn }} props
 */
function UnsavedDialog({ onSave, onDiscard, onCancel }) {
  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <p className="dialog-title">You have unsaved changes</p>
        <p className="dialog-desc">
          Do you want to save your annotations before continuing? Unsaved
          changes will be permanently lost if you discard them.
        </p>
        <div className="dialog-actions">
          <button className="dialog-btn save"    onClick={onSave}>Save changes</button>
          <button className="dialog-btn discard" onClick={onDiscard}>Discard changes</button>
          <button className="dialog-btn cancel"  onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

function App() {
  const [pdfData, setPdfData]                       = useState(null);
  const [fileName, setFileName]                     = useState("");
  const [filePath, setFilePath]                     = useState("");
  const [scale, setScale]                           = useState(1.5);
  const [savedAnnotations, setSavedAnnotations]     = useState(null);
  const [toastMessage, setToastMessage]             = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges]   = useState(false);

  // Stores the action to resume after the user responds to the dialog.
  // null = dialog not shown.
  // { type: 'close' }              → user clicked Close
  // { type: 'open', execute: fn }  → user clicked Open (with a callback to
  //                                   perform the actual file-open after resolving)
  const [pendingAction, setPendingAction]           = useState(null);

  const pristinePdfRef = useRef(null);
  const toastTimerRef  = useRef(null);
  const canvasMapRef   = useRef({});

  // ── Helpers ────────────────────────────────────────────────────────────────

  const handleCanvasMapReady = useCallback((map) => {
    canvasMapRef.current = map;
  }, []);

  const handleAnnotationChange = useCallback(() => {
    setHasUnsavedChanges(true);
  }, []);

  const showToast = useCallback((message) => {
    setToastMessage(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(""), 3000);
  }, []);

  // ── Core save logic (also called by the dialog) ───────────────────────────

  const performSave = useCallback(async () => {
    if (!pdfData || !pristinePdfRef.current) return;

    const newPdfBytes = await savePdfWithAnnotations(
      pristinePdfRef.current,
      canvasMapRef.current,
    );
    await downloadPdf(newPdfBytes, filePath);

    const pageStates = {};
    Object.entries(canvasMapRef.current).forEach(([pageNum, canvas]) => {
      if (canvas) pageStates[pageNum] = JSON.stringify(canvas.toJSON());
    });
    await saveAnnotations(filePath, pageStates);

    setHasUnsavedChanges(false);
    showToast("Changes saved successfully");
  }, [pdfData, filePath, showToast]);

  // ── Core close logic ──────────────────────────────────────────────────────

  const performClose = useCallback(() => {
    setPdfData(null);
    setFileName("");
    setFilePath("");
    setSavedAnnotations(null);
    setHasUnsavedChanges(false);
    pristinePdfRef.current = null;
    canvasMapRef.current   = {};
  }, []);

  // ── Core open-file logic ──────────────────────────────────────────────────

  const performOpen = useCallback(async (selected) => {
    const contents = await readFile(selected, { dir: null });

    let safeContents;
    if (contents instanceof Uint8Array)       safeContents = contents;
    else if (contents instanceof ArrayBuffer) safeContents = new Uint8Array(contents);
    else if (ArrayBuffer.isView(contents))    safeContents = new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength);
    else if (Array.isArray(contents))         safeContents = new Uint8Array(contents);
    else if (typeof contents === "object")    safeContents = new Uint8Array(Object.values(contents));
    else safeContents = contents;

    // Pristine bytes
    let pristine = await loadPristineBytes(selected);
    if (!pristine) {
      await savePristineBytes(selected, safeContents);
      pristine = safeContents;
    }
    pristinePdfRef.current = pristine;

    const stored = await loadAnnotations(selected);

    setPdfData(safeContents);
    setFileName(selected.split("/").pop() || "Unnamed");
    setFilePath(selected);
    setSavedAnnotations(stored);
    setHasUnsavedChanges(false);
    canvasMapRef.current = {};
  }, []);

  // ── Dialog resolution handlers ────────────────────────────────────────────

  const handleDialogSave = useCallback(async () => {
    setPendingAction(null);
    try {
      await performSave();
      // After saving, execute the originally-requested action
      if (pendingAction?.type === "close") {
        performClose();
      } else if (pendingAction?.type === "open") {
        await pendingAction.execute();
      }
    } catch (err) {
      console.error("Save error:", err);
      alert("Save failed: " + err.message);
    }
  }, [pendingAction, performSave, performClose]);

  const handleDialogDiscard = useCallback(async () => {
    const action = pendingAction;
    setPendingAction(null);
    setHasUnsavedChanges(false);

    if (action?.type === "close") {
      performClose();
    } else if (action?.type === "open") {
      await action.execute();
    }
  }, [pendingAction, performClose]);

  const handleDialogCancel = useCallback(() => {
    setPendingAction(null);
  }, []);

  // ── Public handlers wired to UI buttons ──────────────────────────────────

  const handleOpenPDF = useCallback(async () => {
    try {
      const selected = await open({
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!selected || typeof selected !== "string") return;

      // Capture selected in a closure so it can be used by the dialog's execute
      const doOpen = () => performOpen(selected);

      if (pdfData && hasUnsavedChanges) {
        // Show dialog; store the open action as pending
        setPendingAction({ type: "open", execute: doOpen });
      } else {
        await doOpen();
      }
    } catch (error) {
      console.error("Error opening PDF:", error);
    }
  }, [pdfData, hasUnsavedChanges, performOpen]);

  const handleClosePDF = useCallback(() => {
    if (hasUnsavedChanges) {
      setPendingAction({ type: "close" });
    } else {
      performClose();
    }
  }, [hasUnsavedChanges, performClose]);

  const handleSavePDF = useCallback(async () => {
    if (!pdfData) return;
    try {
      await performSave();
    } catch (error) {
      console.error("Save error:", error);
      alert("Save failed: " + error.message);
    }
  }, [pdfData, performSave]);

  const zoomIn  = () => setScale((p) => Math.min(p + 0.25, 4));
  const zoomOut = () => setScale((p) => Math.max(p - 0.25, 0.5));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="app-container">
      {/* ── Unsaved-changes dialog ── */}
      {pendingAction && (
        <UnsavedDialog
          onSave={handleDialogSave}
          onDiscard={handleDialogDiscard}
          onCancel={handleDialogCancel}
        />
      )}

      {/* ── Save toast ── */}
      {toastMessage && (
        <div className="toast" key={toastMessage}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {toastMessage}
        </div>
      )}

      {/* ── Top bar ── */}
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
              {/* Unsaved-changes dot indicator */}
              <div className="file-chip">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  style={{ width: 12, height: 12, flexShrink: 0 }}>
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="file-chip-name">{fileName}</span>
                {hasUnsavedChanges && (
                  <span className="unsaved-dot" title="Unsaved changes" />
                )}
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

      {/* ── Content ── */}
      <div className="content">
        {pdfData ? (
          <ContinuousPDFViewer
            pdfData={pdfData}
            fileName={fileName}
            scale={scale}
            onCanvasMapReady={handleCanvasMapReady}
            savedAnnotations={savedAnnotations}
            onAnnotationChange={handleAnnotationChange}
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
                <h3>Draw &amp; Pen</h3>
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
