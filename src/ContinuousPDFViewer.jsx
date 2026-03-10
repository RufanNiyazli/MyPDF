import { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import * as fabric from "fabric";
import AnnotationCanvas from "./AnnotationCanvas";
import AnnotationToolbar from "./AnnotationToolbar";
import { addShapeDrawing } from "./shapeTools";
import { addArrowDrawing } from "./arrowTools";
import "./ContinuousPDFViewer.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

function ContinuousPDFViewer({ pdfData, scale = 1.5, onCanvasMapReady }) {
  const containerRef = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pages, setPages] = useState([]);

  const [activeTool, setActiveTool] = useState("select");
  const [toolSettings, setToolSettings] = useState({
    color: "#3B82F6",
    brushWidth: 3,
  });

  const canvasesRef = useRef({});
  const cleanupFnsRef = useRef({});
  const undoStacksRef = useRef({});
  const redoStacksRef = useRef({});

  useEffect(() => {
    if (!pdfData) return;
    let isMounted = true;

    const loadPDF = async () => {
      try {
        setIsLoading(true);
        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
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

  const saveCanvasState = useCallback((canvas, pageNumber) => {
    if (!canvas) return;
    const state = JSON.stringify(canvas.toJSON());
    if (!undoStacksRef.current[pageNumber]) undoStacksRef.current[pageNumber] = [];
    undoStacksRef.current[pageNumber].push(state);
    redoStacksRef.current[pageNumber] = [];
  }, []);

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

      if (activeTool === "pen") {
        canvas.isDrawingMode = true;
        const brush = new fabric.PencilBrush(canvas);
        brush.color = toolSettings.color;
        brush.width = toolSettings.brushWidth;
        canvas.freeDrawingBrush = brush;

        const handlePathCreated = () => saveCanvasState(canvas, pageNumber);
        canvas.on("path:created", handlePathCreated);
        cleanupFnsRef.current[pageNumber] = () => {
          canvas.off("path:created", handlePathCreated);
        };
      } else if (activeTool === "highlighter") {
        canvas.isDrawingMode = true;
        const brush = new fabric.PencilBrush(canvas);
        brush.color = toolSettings.color + "4D";
        brush.width = 20;
        canvas.freeDrawingBrush = brush;

        const handlePathCreated = () => saveCanvasState(canvas, pageNumber);
        canvas.on("path:created", handlePathCreated);
        cleanupFnsRef.current[pageNumber] = () => {
          canvas.off("path:created", handlePathCreated);
        };
      } else if (activeTool === "rectangle" || activeTool === "circle") {
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
      } else if (activeTool === "arrow") {
        const cleanup = addArrowDrawing(
          canvas,
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
        canvas.on("mouse:down", handleTextClick);
        cleanupFnsRef.current[pageNumber] = () => {
          canvas.off("mouse:down", handleTextClick);
          canvas.selection = true;
        };
      } else if (activeTool === "eraser") {
        canvas.selection = false;
        const handleErase = (e) => {
          if (e.target) {
            saveCanvasState(canvas, pageNumber);
            canvas.remove(e.target);
            canvas.renderAll();
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

  const handleCanvasReady = useCallback(
    (canvas, pageNumber) => {
      if (!canvas) return;
      canvasesRef.current[pageNumber] = canvas;
      undoStacksRef.current[pageNumber] = [];
      redoStacksRef.current[pageNumber] = [];
      if (onCanvasMapReady) onCanvasMapReady(canvasesRef.current);
      setupCanvasTool(canvas, pageNumber);
    },
    [setupCanvasTool, onCanvasMapReady]
  );

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

  const handleUndo = useCallback(() => {
    Object.entries(canvasesRef.current).forEach(([pageNum, canvas]) => {
      const pn = parseInt(pageNum);
      const stack = undoStacksRef.current[pn] || [];
      if (stack.length === 0) return;

      const currentState = JSON.stringify(canvas.toJSON());
      if (!redoStacksRef.current[pn]) redoStacksRef.current[pn] = [];
      redoStacksRef.current[pn].push(currentState);

      const previousState = stack.pop();
      canvas.loadFromJSON(JSON.parse(previousState)).then(() => {
        canvas.requestRenderAll();
      });
    });
  }, []);

  const handleRedo = useCallback(() => {
    Object.entries(canvasesRef.current).forEach(([pageNum, canvas]) => {
      const pn = parseInt(pageNum);
      const stack = redoStacksRef.current[pn] || [];
      if (stack.length === 0) return;

      const currentState = JSON.stringify(canvas.toJSON());
      if (!undoStacksRef.current[pn]) undoStacksRef.current[pn] = [];
      undoStacksRef.current[pn].push(currentState);

      const nextState = stack.pop();
      canvas.loadFromJSON(JSON.parse(nextState)).then(() => {
        canvas.requestRenderAll();
      });
    });
  }, []);

  const handleClear = useCallback(() => {
    Object.values(canvasesRef.current).forEach((canvas) => {
      canvas.clear();
      canvas.backgroundColor = "transparent";
      canvas.renderAll();
    });
    undoStacksRef.current = {};
    redoStacksRef.current = {};
  }, []);

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
          {pages.map((page) => (
            <PageRenderer
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

function PageRenderer({ pdf, pageNumber, scale, activeTool, toolSettings, onCanvasReady }) {
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [isRendered, setIsRendered] = useState(false);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let isMounted = true;

    const renderPage = async () => {
      try {
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
          renderTaskRef.current = null;
        }

        const page = await pdf.getPage(pageNumber);
        if (!isMounted) return;

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.height = viewport.height;
        canvas.width = viewport.width;
        setCanvasSize({ width: viewport.width, height: viewport.height });

        renderTaskRef.current = page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
        });

        await renderTaskRef.current.promise;

        if (isMounted) {
          setIsRendered(true);
          renderTaskRef.current = null;
        }
      } catch (error) {
        if (error.name !== "RenderingCancelledException") {
          console.error(`Page ${pageNumber} render error:`, error);
        }
      }
    };

    renderPage();

    return () => {
      isMounted = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [pdf, pageNumber, scale]);

  return (
    <div className="page-wrapper">
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

export default ContinuousPDFViewer;