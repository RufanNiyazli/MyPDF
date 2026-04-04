import { useEffect, useRef } from "react";
import * as fabric from "fabric";

function AnnotationCanvas({
  width,
  height,
  activeTool,
  toolSettings,
  onCanvasReady,
  pageNumber,
}) {
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const isInitializedRef = useRef(false);
  const cleanupRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || isInitializedRef.current) return;

    try {
      const canvas = new fabric.Canvas(canvasRef.current, {
        width: width,
        height: height,
        backgroundColor: "transparent",
        isDrawingMode: false,
      });

      fabricCanvasRef.current = canvas;
      isInitializedRef.current = true;

      if (onCanvasReady) onCanvasReady(canvas, pageNumber);
    } catch (error) {
      console.error(`Canvas init error (page ${pageNumber}):`, error);
    }

    return () => {
      if (fabricCanvasRef.current) {
        try {
          fabricCanvasRef.current.dispose();
          fabricCanvasRef.current = null;
          isInitializedRef.current = false;
        } catch (e) {}
      }
    };
  }, []);

  useEffect(() => {
    if (!fabricCanvasRef.current) return;
    try {
      if (typeof fabricCanvasRef.current.setWidth === "function") {
        fabricCanvasRef.current.setWidth(width);
        fabricCanvasRef.current.setHeight(height);
        fabricCanvasRef.current.renderAll();
      }
    } catch (e) {}
  }, [width, height]);

  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !toolSettings) return;

    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    const { color, brushWidth } = toolSettings;

    canvas.isDrawingMode = false;
    canvas.selection = true;
    canvas.off("mouse:down");

    if (activeTool === "select") {
      canvas.selection = true;
    } else if (activeTool === "pen") {
      canvas.isDrawingMode = true;
      const brush = new fabric.PencilBrush(canvas);
      brush.color = color;
      brush.width = brushWidth;
      canvas.freeDrawingBrush = brush;
    } else if (activeTool === "highlighter") {
      canvas.isDrawingMode = true;
      const brush = new fabric.PencilBrush(canvas);
      brush.color = color + "4D";
      brush.width = 20;
      canvas.freeDrawingBrush = brush;
    } else if (activeTool === "text") {
      canvas.selection = false;
      const handleTextClick = (event) => {
        const pointer = canvas.getScenePoint(event.e);
        const textbox = new fabric.Textbox("Type here...", {
          left: pointer.x,
          top: pointer.y,
          width: 200,
          fontSize: 18,
          fill: color,
          editable: true,
          fontFamily: "Inter, sans-serif",
        });
        canvas.add(textbox);
        canvas.setActiveObject(textbox);
        textbox.enterEditing();
        canvas.renderAll();
        if (onCanvasReady) onCanvasReady(canvas, pageNumber);
      };
      canvas.on("mouse:down", handleTextClick);
      cleanupRef.current = () => {
        canvas.off("mouse:down", handleTextClick);
        canvas.selection = true;
      };
    } else if (activeTool === "eraser") {
      canvas.selection = false;
      const handleErase = (e) => {
        if (e.target) {
          canvas.remove(e.target);
          canvas.renderAll();
        }
      };
      canvas.on("mouse:down", handleErase);
      cleanupRef.current = () => {
        canvas.off("mouse:down", handleErase);
        canvas.selection = true;
      };
    }
  }, [activeTool, toolSettings]);

  return (
    <div className="annotation-canvas-wrapper">
      <canvas ref={canvasRef} />
    </div>
  );
}

export default AnnotationCanvas;