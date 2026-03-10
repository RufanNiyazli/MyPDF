import * as fabric from "fabric";

export function addShapeDrawing(canvas, shapeType, color, strokeWidth) {
  let isDrawing = false;
  let shape = null;
  let startX = 0;
  let startY = 0;

  canvas.selection = false;
  canvas.isDrawingMode = false;

  const handleMouseDown = (event) => {
    isDrawing = true;
    const pointer = canvas.getScenePoint(event.e);
    startX = pointer.x;
    startY = pointer.y;

    if (shapeType === "rectangle") {
      shape = new fabric.Rect({
        left: startX,
        top: startY,
        width: 0,
        height: 0,
        fill: "transparent",
        stroke: color,
        strokeWidth: strokeWidth,
        selectable: false,
        evented: false,
      });
    } else if (shapeType === "circle") {
      shape = new fabric.Circle({
        left: startX,
        top: startY,
        radius: 0,
        fill: "transparent",
        stroke: color,
        strokeWidth: strokeWidth,
        selectable: false,
        evented: false,
      });
    }

    if (shape) canvas.add(shape);
  };

  const handleMouseMove = (event) => {
    if (!isDrawing || !shape) return;
    const pointer = canvas.getScenePoint(event.e);

    if (shapeType === "rectangle") {
      const w = pointer.x - startX;
      const h = pointer.y - startY;
      shape.set({
        width: Math.abs(w),
        height: Math.abs(h),
        left: w < 0 ? pointer.x : startX,
        top: h < 0 ? pointer.y : startY,
      });
    } else if (shapeType === "circle") {
      const radius = Math.sqrt(
        Math.pow(pointer.x - startX, 2) + Math.pow(pointer.y - startY, 2)
      ) / 2;
      shape.set({
        radius: Math.abs(radius),
        left: Math.min(pointer.x, startX),
        top: Math.min(pointer.y, startY),
      });
    }
    
    canvas.renderAll();
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    isDrawing = false;

    if (shape) {
      shape.set({ selectable: true, evented: true });
      canvas.setActiveObject(shape);
      canvas.renderAll();
    }
    shape = null;
  };

  canvas.on("mouse:down", handleMouseDown);
  canvas.on("mouse:move", handleMouseMove);
  canvas.on("mouse:up", handleMouseUp);

  return () => {
    canvas.off("mouse:down", handleMouseDown);
    canvas.off("mouse:move", handleMouseMove);
    canvas.off("mouse:up", handleMouseUp);
    canvas.selection = true;
    if (isDrawing && shape) {
      canvas.remove(shape);
    }
  };
}