import { useCallback, useRef } from "react";

const useHistory = () => {
  const undoStack = useRef([]);
  const redoStack = useRef([]);

  const saveState = useCallback((canvas) => {
    if (!canvas) return;
    undoStack.current.push(JSON.stringify(canvas.toJSON()));
    redoStack.current = [];
  }, []);

  const undo = useCallback((canvas) => {
    if (!canvas || undoStack.current.length === 0) return;
    const currentState = JSON.stringify(canvas.toJSON());
    const previousState = undoStack.current.pop();
    redoStack.current.push(currentState);
    canvas.loadFromJSON(previousState, () => canvas.renderAll());
  }, []);

  const redo = useCallback((canvas) => {
    if (!canvas || redoStack.current.length === 0) return;
    const currentState = JSON.stringify(canvas.toJSON());
    const nextState = redoStack.current.pop();
    undoStack.current.push(currentState);
    canvas.loadFromJSON(nextState, () => canvas.renderAll());
  }, []);

  const canUndo = () => undoStack.current.length > 0;
  const canRedo = () => redoStack.current.length > 0;

  return { saveState, undo, redo, canUndo, canRedo };
};

export default useHistory;