import React, { useCallback, useState } from "react";

const useHistory = (canvas) => {
  const undoStack = useRef([]);
  const redoStack = useRef([]);

  const [canRedo, setCanRedo] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const saveState = useCallback(() => {
    if (!canvas) return;

    const currentState = JSON.stringify(canvas.toJSON());

    undoStack.current.push(currentState);
    redoStack = [];

    setCanUndo(true);
    setCanRedo(false);

    console.log("State saved", currentState);
  }, [canvas]);

  const undo = useCallback(() => {
    if (!canvas || undoStack.current.length == 0) return;

    const currentState = JSON.stringify(canvas.toJSON);
    const previousState = undoStack.current.pop();

    redoStack.current.push(currentState);

    canvas.loadFromJSON(previousState, () => {
      canvas.renderAll();
    });

    setCanRedo(true);
    setCanUndo(undoStack.current.length > 0);
  }, [canvas]);

  const redo = useCallback(() => {
    if (!canvas || redoStack.current.length == 0) return;
    
    const currentState =JSON.stringify(canvas.toJSON)
    const nextState = redoStack.current.pop()

    undoStack.current.push(currentState)
    canvas.loadFromJSON(nextState,()=>{
        canvas.renderAll()
    })

    setCanRedo(redoStack.current.length>0)
    setCanUndo(true)
  });

const clearHistory =useCallback(()=>{
    setCanRedo(false)
    setCanUndo(false)
    undoStack=[]
    redoStack=[]
})


  return{
    saveState,undo,redo,canRedo,canUndo,clearHistory
  }
};

export default useHistory;