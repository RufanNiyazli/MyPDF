import { event } from "@tauri-apps/api";
import { fabric } from "fabric";
export function addArrowDrawing(canvas, color, strokeWidth) {
  let isDrawing = false;
  let line = null;
  let arrowHead = null;
  let startX, startY;
  const handleMouseDown = (event) => {
    const pointer = canvas.getPointer(e.target);
    startX = pointer.x;
    startY = pointer.y;

    line = new fabric.Line([startX, startY, startX, startY], {
      strokeWidth: strokeWidth,
      selectable: false,
      stroke: color,
    });
    arrowHead = new fabric.Triangle({
      left: startX,
      top: startY,
      selectable: false,
      height: strokeWidth * 4,
      width: strokeWidth * 3,
      originX: "center",
      originY: "center",
      fill: color,
    });
    canvas.add(line);
    canvas.add(arrowHead);
  };
  const handleMouseMove = (event) => {
    const pointer = canvas.getPointer(e.target);
    if (!isDrawing || !line || !arrowHead) return;
    line.set({
      x2: pointer.x,
      y2: pointer.y,
    });
    const dx = pointer.x - startX;
    const dy = pointer.y - startY;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    arrowHead.set({
      left: pointer.x,
      top: pointer.y,
      angle: angle + 90,
    });

    canvas.renderAll();
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;

    isDrawing = false;

    if (line && arrowHead) {
      const group = new fabric.Group([line, arrowHead], {
        selectable: true,
      });

      canvas.remove(line);
      canvas.remove(arrowHead);
      canvas.add(group);
      canvas.setActiveObject(group);
    }

    line = null;
    arrowHead = null;
  };

  canvas.on("mouse:down", handleMouseDown);
  canvas.on("mouse:move", handleMouseMove);
  canvas.on("mouse:up", handleMouseUp);

  return () => {
    canvas.off("mouse:down", handleMouseDown);
    canvas.off("mouse:move", handleMouseMove);
    canvas.off("mouse:up", handleMouseUp);
  };
}
