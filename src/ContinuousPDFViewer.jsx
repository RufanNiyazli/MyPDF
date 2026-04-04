import { useEffect, useRef, useState, useCallback, useMemo, memo } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import * as fabric from "fabric";
import AnnotationCanvas from "./AnnotationCanvas";
import AnnotationToolbar from "./AnnotationToolbar";
import { addShapeDrawing } from "./shapeTools";
import "./ContinuousPDFViewer.css";

// Must match the installed pdfjs-dist version or decoding (especially images / JPX / JBIG2) can fail.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

function getDocumentParams(dataCopy) {
  const v = pdfjsLib.version;
  return {
    data: dataCopy,
    useSystemFonts: true,
    useWorkerFetch: true,
    cMapUrl: `https://unpkg.com/pdfjs-dist@${v}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${v}/standard_fonts/`,
    wasmUrl: `https://unpkg.com/pdfjs-dist@${v}/wasm/`,
  };
}

function ContinuousPDFViewer({ pdfData, scale = 1.5, onCanvasMapReady, savedAnnotations, onAnnotationChange }) {
  const containerRef = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pages, setPages] = useState([]);

  const [activeTool, setActiveTool] = useState("select");
  const [toolSettings, setToolSettings] = useState({
    color: "#3B82F6",
    brushWidth: 3,
  });

  const canvasesRef    = useRef({});
  const cleanupFnsRef  = useRef({});
  const latestStatesRef    = useRef({});
  const globalUndoStackRef = useRef([]);
  const globalRedoStackRef = useRef([]);

  // ── Load PDF ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!pdfData) return;
    let isMounted = true;

    const loadPDF = async () => {
      try {
        setIsLoading(true);
        // slice(0) gives pdf.js a fully independent copy of the buffer.
        // Without this, pdf.js transfers the underlying ArrayBuffer to its
        // Web Worker (making it detached / zeroed), which breaks pdfSaver
        // later when it tries to read the same pristine bytes.
        const loadingTask = pdfjsLib.getDocument(getDocumentParams(pdfData.slice(0)));
        const pdfDoc = await loadingTask.promise;
        if (!isMounted) return;
        setPdf(pdfDoc);
        const pageArray = [];
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          pageArray.push({ pageNumber: i });
        }
        setPages(pageArray);
      } catch (error) {
        if (isMounted) alert("PDF load error: " + error.message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadPDF();
    return () => { isMounted = false; };
  }, [pdfData]);

  // ── Canvas state helpers ────────────────────────────────────────────────────

  const saveCanvasState = useCallback((canvas, pageNumber) => {
    if (!canvas) return;
    const currentState  = JSON.stringify(canvas.toJSON());
    const previousState = latestStatesRef.current[pageNumber]
      || JSON.stringify(new fabric.Canvas().toJSON());

    if (currentState !== previousState) {
      globalUndoStackRef.current.push({ pageNumber, state: previousState });
      globalRedoStackRef.current = [];
      latestStatesRef.current[pageNumber] = currentState;
      if (onAnnotationChange) onAnnotationChange();
    }
  }, [onAnnotationChange]);

  // ── Tool setup ──────────────────────────────────────────────────────────────

  const setupCanvasTool = useCallback(
    (canvas, pageNumber) => {
      if (!canvas) return;

      if (cleanupFnsRef.current[pageNumber]) {
        cleanupFnsRef.current[pageNumber]();
        cleanupFnsRef.current[pageNumber] = null;
      }

      canvas.isDrawingMode = false;
      canvas.selection = true;
      canvas.off("mouse:down");

      if (activeTool === "pen" || activeTool === "highlighter") {
        canvas.isDrawingMode = true;
        const brush = new fabric.PencilBrush(canvas);
        if (activeTool === "highlighter") {
          brush.color = toolSettings.color + "4D";
          brush.width = 20;
        } else {
          brush.color = toolSettings.color;
          brush.width = toolSettings.brushWidth;
        }
        canvas.freeDrawingBrush = brush;

        const handlePathCreated = () => saveCanvasState(canvas, pageNumber);
        canvas.on("path:created", handlePathCreated);
        cleanupFnsRef.current[pageNumber] = () => {
          canvas.off("path:created", handlePathCreated);
        };
      } else if (["rectangle", "circle", "arrow"].includes(activeTool)) {
        const cleanup = addShapeDrawing(
          canvas,
          activeTool,
          toolSettings.color,
          toolSettings.brushWidth
        );
        const handleMouseUp = () => saveCanvasState(canvas, pageNumber);
        canvas.on("mouse:up", handleMouseUp);
        cleanupFnsRef.current[pageNumber] = () => {
          cleanup();
          canvas.off("mouse:up", handleMouseUp);
        };
      } else if (activeTool === "text") {
        canvas.selection = false;
        const handleTextClick = (event) => {
          const pointer = canvas.getScenePoint(event.e);
          const textbox = new fabric.Textbox("Type here...", {
            left: pointer.x,
            top: pointer.y,
            width: 200,
            fontSize: 18,
            fill: toolSettings.color,
            editable: true,
            fontFamily: "Inter, sans-serif",
          });
          canvas.add(textbox);
          canvas.setActiveObject(textbox);
          textbox.enterEditing();
          canvas.renderAll();
          saveCanvasState(canvas, pageNumber);
        };
        const handleChange = () => saveCanvasState(canvas, pageNumber);

        canvas.on("mouse:down", handleTextClick);
        canvas.on("text:changed", handleChange);
        canvas.on("object:modified", handleChange);

        cleanupFnsRef.current[pageNumber] = () => {
          canvas.off("mouse:down", handleTextClick);
          canvas.off("text:changed", handleChange);
          canvas.off("object:modified", handleChange);
          canvas.selection = true;
        };
      } else if (activeTool === "eraser") {
        canvas.selection = false;
        const handleErase = (e) => {
          if (e.target) {
            canvas.remove(e.target);
            canvas.renderAll();
            saveCanvasState(canvas, pageNumber);
          }
        };
        canvas.on("mouse:down", handleErase);
        cleanupFnsRef.current[pageNumber] = () => {
          canvas.off("mouse:down", handleErase);
          canvas.selection = true;
        };
      }
    },
    [activeTool, toolSettings, saveCanvasState]
  );

  // ── Canvas ready callback ───────────────────────────────────────────────────

  const handleCanvasReady = useCallback(
    (canvas, pageNumber) => {
      if (!canvas) return;
      canvasesRef.current[pageNumber] = canvas;

      if (onCanvasMapReady) onCanvasMapReady(canvasesRef.current);

      const savedJson = savedAnnotations && savedAnnotations[pageNumber];
      if (savedJson) {
        try {
          canvas.loadFromJSON(JSON.parse(savedJson)).then(() => {
            canvas.requestRenderAll();
            latestStatesRef.current[pageNumber] = savedJson;
            setupCanvasTool(canvas, pageNumber);
          });
        } catch (e) {
          console.warn(`Failed to restore annotations for page ${pageNumber}:`, e);
          latestStatesRef.current[pageNumber] = JSON.stringify(canvas.toJSON());
          setupCanvasTool(canvas, pageNumber);
        }
      } else {
        if (!latestStatesRef.current[pageNumber]) {
          latestStatesRef.current[pageNumber] = JSON.stringify(canvas.toJSON());
        }
        setupCanvasTool(canvas, pageNumber);
      }
    },
    [setupCanvasTool, onCanvasMapReady, savedAnnotations]
  );

  // ── Tool change ─────────────────────────────────────────────────────────────

  const handleToolChange = useCallback(
    (tool, settings) => {
      setActiveTool(tool);
      setToolSettings(settings);
      Object.entries(canvasesRef.current).forEach(([pageNum, canvas]) => {
        setupCanvasTool(canvas, parseInt(pageNum));
      });
    },
    [setupCanvasTool]
  );

  useEffect(() => {
    Object.entries(canvasesRef.current).forEach(([pageNum, canvas]) => {
      setupCanvasTool(canvas, parseInt(pageNum));
    });
  }, [activeTool, toolSettings, setupCanvasTool]);

  // ── Undo / Redo / Clear ─────────────────────────────────────────────────────

  const handleUndo = useCallback(() => {
    if (globalUndoStackRef.current.length === 0) return;
    const entry = globalUndoStackRef.current.pop();
    const { pageNumber, state: previousState } = entry;
    const canvas = canvasesRef.current[pageNumber];
    if (!canvas) return;
    const currentState = latestStatesRef.current[pageNumber];
    globalRedoStackRef.current.push({ pageNumber, state: currentState });
    latestStatesRef.current[pageNumber] = previousState;
    canvas.loadFromJSON(JSON.parse(previousState)).then(() => {
      canvas.requestRenderAll();
      setupCanvasTool(canvas, pageNumber);
    });
  }, [setupCanvasTool]);

  const handleRedo = useCallback(() => {
    if (globalRedoStackRef.current.length === 0) return;
    const entry = globalRedoStackRef.current.pop();
    const { pageNumber, state: nextState } = entry;
    const canvas = canvasesRef.current[pageNumber];
    if (!canvas) return;
    const currentState = latestStatesRef.current[pageNumber];
    globalUndoStackRef.current.push({ pageNumber, state: currentState });
    latestStatesRef.current[pageNumber] = nextState;
    canvas.loadFromJSON(JSON.parse(nextState)).then(() => {
      canvas.requestRenderAll();
      setupCanvasTool(canvas, pageNumber);
    });
  }, [setupCanvasTool]);

  const handleClear = useCallback(() => {
    Object.entries(canvasesRef.current).forEach(([pageNum, canvas]) => {
      const pn = parseInt(pageNum);
      const currentState = JSON.stringify(canvas.toJSON());
      canvas.clear();
      canvas.backgroundColor = "transparent";
      canvas.renderAll();
      const clearedState = JSON.stringify(canvas.toJSON());
      if (currentState !== clearedState) {
        globalUndoStackRef.current.push({ pageNumber: pn, state: currentState });
        latestStatesRef.current[pn] = clearedState;
      }
    });
    globalRedoStackRef.current = [];
  }, []);

  // ── Memoised page list ──────────────────────────────────────────────────────

  const pageList = useMemo(() => pages, [pages]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="pdf-loading">
        <div className="spinner" />
        <p>Loading PDF...</p>
      </div>
    );
  }

  if (!pdf) {
    return (
      <div className="pdf-loading">
        <p>Could not load PDF.</p>
      </div>
    );
  }

  return (
    <div className="continuous-pdf-viewer">
      <AnnotationToolbar
        onToolChange={handleToolChange}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClear={handleClear}
      />

      <div className="pdf-main">
        <div className="pages-container" ref={containerRef}>
          {pageList.map((page) => (
            <PageRendererMemo
              key={page.pageNumber}
              pdf={pdf}
              pageNumber={page.pageNumber}
              scale={scale}
              activeTool={activeTool}
              toolSettings={toolSettings}
              onCanvasReady={handleCanvasReady}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── PageRenderer ─────────────────────────────────────────────────────────────
//
// Uses an IntersectionObserver so a page is only rasterised when it enters the
// viewport. Once rendered the canvas is kept alive (not torn down) so scrolling
// back to an already-rendered page is instant.
//
// Scale changes are debounced 120 ms to prevent simultaneous re-render storms
// when the user clicks zoom repeatedly.

const RENDER_DEBOUNCE_MS = 120;

function PageRenderer({ pdf, pageNumber, scale, activeTool, toolSettings, onCanvasReady }) {
  const wrapperRef      = useRef(null);
  const canvasRef       = useRef(null);
  const renderTaskRef   = useRef(null);
  const debounceRef     = useRef(null);
  const isVisibleRef    = useRef(false);
  const pendingScaleRef = useRef(scale);

  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isRendered, setIsRendered] = useState(false);

  // Actual render function — cancels any in-flight task before starting.
  const doRender = useCallback(async (currentScale) => {
    if (!pdf || !canvasRef.current) return;
    try {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const page     = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: currentScale });
      const canvas   = canvasRef.current;
      if (!canvas) return;

      canvas.height = viewport.height;
      canvas.width  = viewport.width;
      setCanvasSize({ width: viewport.width, height: viewport.height });

      renderTaskRef.current = page.render({
        canvasContext: canvas.getContext("2d", { alpha: false }),
        viewport,
        background: "white",
        intent: "display",
      });

      await renderTaskRef.current.promise;
      renderTaskRef.current = null;
      setIsRendered(true);
    } catch (error) {
      if (error.name !== "RenderingCancelledException") {
        console.error(`Page ${pageNumber} render error:`, error);
      }
    }
  }, [pdf, pageNumber]);

  // Debounced wrapper — absorbs rapid scale changes.
  const scheduleRender = useCallback((currentScale) => {
    pendingScaleRef.current = currentScale;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (isVisibleRef.current) {
        doRender(pendingScaleRef.current);
      }
    }, RENDER_DEBOUNCE_MS);
  }, [doRender]);

  // IntersectionObserver — triggers the first render when the page scrolls in.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const wasVisible = isVisibleRef.current;
        isVisibleRef.current = entry.isIntersecting;
        // Render on first visibility or if scale changed while off-screen.
        if (entry.isIntersecting && !wasVisible) {
          scheduleRender(pendingScaleRef.current);
        }
      },
      { rootMargin: "200px" }   // start loading 200 px before the page enters view
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [scheduleRender]);

  // Re-render when scale changes (debounced).
  useEffect(() => {
    scheduleRender(scale);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [scale, scheduleRender]);

  // Cancel render task on unmount.
  useEffect(() => {
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="page-wrapper" ref={wrapperRef}>
      <div className="page-number-badge">Page {pageNumber}</div>
      <div className="page-content">
        <canvas ref={canvasRef} className="pdf-canvas" />
        {isRendered && canvasSize.width > 0 && (
          <div
            className="annotation-overlay"
            style={{ width: canvasSize.width, height: canvasSize.height }}
          >
            <AnnotationCanvas
              width={canvasSize.width}
              height={canvasSize.height}
              activeTool={activeTool}
              toolSettings={toolSettings}
              onCanvasReady={onCanvasReady}
              pageNumber={pageNumber}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const PageRendererMemo = memo(PageRenderer);

export default ContinuousPDFViewer;