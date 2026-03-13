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
        originX: "left",
        originY: "top"
      });
    } else if (shapeType === "circle") {
      shape = new fabric.Ellipse({
        left: startX,
        top: startY,
        rx: 0,
        ry: 0,
        fill: "transparent",
        stroke: color,
        strokeWidth: strokeWidth,
        selectable: false,
        evented: false,
        originX: "center",
        originY: "center"
      });
    } else if (shapeType === "arrow") {
      // Arrow is a path, we'll recreate the path on move, so initial shape is empty path
      shape = new fabric.Path("M 0 0", {
        stroke: color,
        strokeWidth: strokeWidth,
        fill: "transparent",
        strokeLineCap: "round",
        strokeLineJoin: "round",
        selectable: false,
        evented: false,
      });
    }

    if (shape) {
      canvas.add(shape);
    }
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
      const rx = Math.abs(pointer.x - startX) / 2;
      const ry = Math.abs(pointer.y - startY) / 2;
      shape.set({
        rx: rx,
        ry: ry,
        left: startX + (pointer.x - startX) / 2,
        top: startY + (pointer.y - startY) / 2,
      });
    } else if (shapeType === "arrow") {
      // Update arrow path calculate
      const dx = pointer.x - startX;
      const dy = pointer.y - startY;
      const angle = Math.atan2(dy, dx);
      const headLen = Math.max(strokeWidth * 5, 12);
      
      const x2 = pointer.x;
      const y2 = pointer.y;

      const aX1 = x2 - headLen * Math.cos(angle - Math.PI / 6);
      const aY1 = y2 - headLen * Math.sin(angle - Math.PI / 6);
      const aX2 = x2 - headLen * Math.cos(angle + Math.PI / 6);
      const aY2 = y2 - headLen * Math.sin(angle + Math.PI / 6);

      const d = `M ${startX} ${startY} L ${x2} ${y2} M ${aX1} ${aY1} L ${x2} ${y2} L ${aX2} ${aY2}`;
      
      // Fabric 6+ way of updating path data if needed, or recreate string
      if (typeof shape.setPathData === 'function') {
         // deprecated in v7
      }
      
      // The most reliable way in fabric to update path dynamically:
      canvas.remove(shape);
      shape = new fabric.Path(d, {
        stroke: color,
        strokeWidth: strokeWidth,
        fill: "transparent",
        strokeLineCap: "round",
        strokeLineJoin: "round",
        selectable: false,
        evented: false,
      });
      canvas.add(shape);
    }

    canvas.renderAll();
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    isDrawing = false;
    
    // Require a minimum size to avoid tiny accidental clicks
    let validSize = true;
    if (shape && shapeType === "rectangle") {
        if (shape.width < 5 && shape.height < 5) validSize = false;
    }

    if (shape && validSize) {
      shape.set({ selectable: true, evented: true });
      canvas.setActiveObject(shape);
      canvas.fire('object:added', { target: shape }); // Manually fire to trigger undo/redo layer
      canvas.renderAll();
    } else if (shape) {
      canvas.remove(shape);
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