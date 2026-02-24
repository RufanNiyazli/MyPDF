import React, { useEffect, useRef, useState } from "react";
import * as fabric from "fabric";
import "./Annotationlayer.css";

const Annotationlayer = ({ width, height, onAnnotationsChange }) => {
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null); // ✅ useRef, not useState
  const [activeTool, setActiveTool] = useState("select");
  const [selectedColor, setSelectedColor] = useState("#FF0000");
  const [brushWidth, setBrushWidth] = useState(3);

  // Initialize Fabric canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      width: width,
      height: height,
      backgroundColor: "",
      isDrawingMode: false,
    });

    fabricCanvasRef.current = canvas;

    return () => canvas.dispose();
  }, []); // ✅ only run once on mount

  // Resize canvas when width/height changes
  useEffect(() => {
    if (!fabricCanvasRef.current) return;
    fabricCanvasRef.current.setDimensions({ width, height });
    fabricCanvasRef.current.renderAll();
  }, [width, height]);

  // Handle tool changes
  useEffect(() => {
    if (!fabricCanvasRef.current) return;
    const canvas = fabricCanvasRef.current;

    // Reset mode
    canvas.isDrawingMode = false;
    canvas.selection = true;
    canvas.off("mouse:down"); // ✅ clear previous listeners

    if (activeTool === "pen") {
      canvas.isDrawingMode = true;
      const brush = new fabric.PencilBrush(canvas);
      brush.color = selectedColor;
      brush.width = brushWidth;
      canvas.freeDrawingBrush = brush;
    } else if (activeTool === "highlighter") {
      canvas.isDrawingMode = true;
      const brush = new fabric.PencilBrush(canvas);
      brush.color = selectedColor + "4D";
      brush.width = 20;
      canvas.freeDrawingBrush = brush;
    } else if (activeTool === "eraser") { // ✅ consistent name
      canvas.selection = false;

      // ✅ handler defined and registered correctly
      const handleMouseDown = (e) => {
        if (e.target) {
          canvas.remove(e.target);
          canvas.renderAll();
          if (onAnnotationsChange) {
            onAnnotationsChange(canvas.toJSON());
          }
        }
      };

      canvas.on("mouse:down", handleMouseDown);

      return () => {
        canvas.off("mouse:down", handleMouseDown);
      };
    } else if (activeTool === "select") {
      canvas.selection = true;
      canvas.isDrawingMode = false;
    }
  }, [activeTool, selectedColor, brushWidth, onAnnotationsChange]);

  const addTextBox = () => {
    if (!fabricCanvasRef.current) return; // ✅ .current check

    const textBox = new fabric.Textbox("Write Text", {
      left: 100,
      top: 100,
      width: 200,
      fontSize: 20,
      fill: selectedColor,
      editable: true,
    });

    fabricCanvasRef.current.add(textBox);
    fabricCanvasRef.current.setActiveObject(textBox);
    fabricCanvasRef.current.renderAll();

    if (onAnnotationsChange) {
      onAnnotationsChange(fabricCanvasRef.current.toJSON()); // ✅ toJSON()
    }
  };

  const clearAll = () => {
    if (!fabricCanvasRef.current) return;
    fabricCanvasRef.current.clear();
    fabricCanvasRef.current.backgroundColor = "";
    fabricCanvasRef.current.renderAll();

    if (onAnnotationsChange) {
      onAnnotationsChange(fabricCanvasRef.current.toJSON()); // ✅ toJSON()
    }
  };

  const undo = () => {
    if (!fabricCanvasRef.current) return;

    const objects = fabricCanvasRef.current.getObjects();
    if (objects.length > 0) {
      fabricCanvasRef.current.remove(objects[objects.length - 1]);
      fabricCanvasRef.current.renderAll();

      if (onAnnotationsChange) {
        onAnnotationsChange(fabricCanvasRef.current.toJSON());
      }
    }
  };

  const colors = [
    "#FF0000",
    "#00FF00",
    "#0000FF",
    "#FFFF00",
    "#FF00FF",
    "#00FFFF",
    "#000000",
    "#FFFFFF",
  ];

  return (
    <div className="annotation-layer-container">
      <div className="annotation-toolbar">
        <div className="tool-group">
          <button
            className={`tool-btn ${activeTool === "select" ? "active" : ""}`}
            onClick={() => setActiveTool("select")}
            title="Seç"
          >
            👆
          </button>

          <button
            className={`tool-btn ${activeTool === "pen" ? "active" : ""}`}
            onClick={() => setActiveTool("pen")}
            title="Qələm"
          >
            ✏️
          </button>

          <button
            className={`tool-btn ${activeTool === "highlighter" ? "active" : ""}`}
            onClick={() => setActiveTool("highlighter")}
            title="Highlight"
          >
            🖍️
          </button>

          <button
            className={`tool-btn ${activeTool === "text" ? "active" : ""}`}
            onClick={() => {
              setActiveTool("text");
              addTextBox(); // ✅ consistent casing: addTextBox
            }}
            title="Mətn"
          >
            📝
          </button>

          <button
            className={`tool-btn ${activeTool === "eraser" ? "active" : ""}`}
            onClick={() => setActiveTool("eraser")} // ✅ "eraser" everywhere
            title="Silgi"
          >
            🗑️
          </button>
        </div>

        <div className="tool-group">
          {colors.map((color) => (
            <button
              key={color}
              className={`color-btn ${selectedColor === color ? "active" : ""}`}
              style={{ backgroundColor: color }}
              onClick={() => setSelectedColor(color)}
              title={color}
            />
          ))}
        </div>

        {(activeTool === "pen" || activeTool === "highlighter") && (
          <div className="tool-group">
            <label>Qalınlıq:</label>
            <input
              type="range"
              min="1"
              max="20"
              value={brushWidth}
              onChange={(e) => setBrushWidth(Number(e.target.value))}
            />
            <span>{brushWidth}px</span>
          </div>
        )}

        <div className="tool-group">
          <button className="action-btn" onClick={undo} title="Geri al">
            ↶ Undo
          </button>
          <button
            className="action-btn danger"
            onClick={clearAll}
            title="Hamısını sil"
          >
            🗑️ Təmizlə
          </button>
        </div>
      </div>

      <div className="canvas-wrapper">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};

export default Annotationlayer;