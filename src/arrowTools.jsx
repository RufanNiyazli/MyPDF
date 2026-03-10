import * as fabric from "fabric";

function createArrowPath(x1, y1, x2, y2, color, strokeWidth) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 2) return null;

  const angle = Math.atan2(dy, dx);
  const headLen = Math.max(strokeWidth * 5, 18);

  const aX1 = x2 - headLen * Math.cos(angle - Math.PI / 6);
  const aY1 = y2 - headLen * Math.sin(angle - Math.PI / 6);
  const aX2 = x2 - headLen * Math.cos(angle + Math.PI / 6);
  const aY2 = y2 - headLen * Math.sin(angle + Math.PI / 6);

  const d = `M ${x1} ${y1} L ${x2} ${y2} M ${aX1} ${aY1} L ${x2} ${y2} L ${aX2} ${aY2}`;

  return new fabric.Path(d, {
    stroke: color,
    strokeWidth: strokeWidth,
    fill: "transparent",
    strokeLineCap: "round",
    strokeLineJoin: "round",
    selectable: true,
    evented: true,
    objectCaching: false,
  });
}

export function addArrowDrawing(canvas, color, strokeWidth) {
  let isDrawing = false;
  let startX = 0;
  let startY = 0;
  let currentArrow = null;

  canvas.selection = false;
  canvas.isDrawingMode = false;

  const handleMouseDown = (event) => {
    isDrawing = true;
    const pointer = canvas.getScenePoint(event.e);
    startX = pointer.x;
    startY = pointer.y;
  };

  const handleMouseMove = (event) => {
    if (!isDrawing) return;
    const pointer = canvas.getScenePoint(event.e);

    if (currentArrow) {
      canvas.remove(currentArrow);
      currentArrow = null;
    }

    const arrow = createArrowPath(startX, startY, pointer.x, pointer.y, color, strokeWidth);
    if (arrow) {
      arrow.selectable = false;
      arrow.evented = false;
      canvas.add(arrow);
      currentArrow = arrow;
      canvas.renderAll();
    }
  };

  const handleMouseUp = (event) => {
    if (!isDrawing) return;
    isDrawing = false;

    const pointer = canvas.getScenePoint(event.e);

    if (currentArrow) {
      canvas.remove(currentArrow);
      currentArrow = null;
    }

    const finalArrow = createArrowPath(startX, startY, pointer.x, pointer.y, color, strokeWidth);
    if (finalArrow) {
      finalArrow.selectable = true;
      finalArrow.evented = true;
      canvas.add(finalArrow);
      canvas.setActiveObject(finalArrow);
      canvas.renderAll();
    }
  };

  canvas.on("mouse:down", handleMouseDown);
  canvas.on("mouse:move", handleMouseMove);
  canvas.on("mouse:up", handleMouseUp);

  return () => {
    canvas.off("mouse:down", handleMouseDown);
    canvas.off("mouse:move", handleMouseMove);
    canvas.off("mouse:up", handleMouseUp);
    canvas.selection = true;
    if (currentArrow) {
      canvas.remove(currentArrow);
      currentArrow = null;
    }
  };
}
