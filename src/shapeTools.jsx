export function addShapeDrawing(canvas, shapeType, color, strokeWidth) {
  let isDrawing = false;
  let shape = null;
  let startX, startY;


  const handleMouseDown = (event) => {
    isDrawing = true;
    const pointer = canvas.getPointer(event.e);
    startX = pointer.x;
    startY = pointer.y;


    if (shapeType === 'rectangle') {

      shape = new fabric.Rect({
        left: startX,
        top: startY,
        width: 0,    
        height: 0,  
        fill: 'transparent',       
        stroke: color,           
        strokeWidth: strokeWidth,  
        selectable: false,        
      });
    } else if (shapeType === 'circle') {

      shape = new fabric.Circle({
        left: startX,
        top: startY,
        radius: 0,  
        fill: 'transparent',
        stroke: color,
        strokeWidth: strokeWidth,
        selectable: false,
      });
    }


    canvas.add(shape);
  };


  const handleMouseMove = (event) => {
    if (!isDrawing || !shape) return;

    const pointer = canvas.getPointer(event.e);
    
    if (shapeType === 'rectangle') {
      
      const width = pointer.x - startX;
      const height = pointer.y - startY;

      shape.set({
        width: Math.abs(width),
        height: Math.abs(height),
        left: width > 0 ? startX : pointer.x,
        top: height > 0 ? startY : pointer.y,
      });
    } else if (shapeType === 'circle') {

      const radius = Math.sqrt(
        Math.pow(pointer.x - startX, 2) + 
        Math.pow(pointer.y - startY, 2)
      ) / 2;
      
      shape.set({
        radius: radius,
        left: startX - radius,
        top: startY - radius,
      });
    }

    canvas.renderAll();
  };


  const handleMouseUp = () => {
    if (!isDrawing) return;
    
    isDrawing = false;
    
    if (shape) {
      shape.selectable = true; 
      canvas.setActiveObject(shape); 
    }
    
    shape = null;
  };

  
  canvas.on('mouse:down', handleMouseDown);
  canvas.on('mouse:move', handleMouseMove);
  canvas.on('mouse:up', handleMouseUp);

 
  return () => {
    canvas.off('mouse:down', handleMouseDown);
    canvas.off('mouse:move', handleMouseMove);
    canvas.off('mouse:up', handleMouseUp);
  };
}