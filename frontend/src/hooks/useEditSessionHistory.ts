import { useState, useEffect, useCallback } from 'react';
import { editSessionHistory, EditSessionType } from '../services/editSessionHistory';

export function useEditSessionHistory() {
  const [isActive, setIsActive] = useState(editSessionHistory.isActive());
  const [sessionType, setSessionType] = useState<EditSessionType>(editSessionHistory.getSessionType());
  const [canUndo, setCanUndo] = useState(editSessionHistory.canUndo());
  const [canRedo, setCanRedo] = useState(editSessionHistory.canRedo());
  const [undoCount, setUndoCount] = useState(editSessionHistory.getUndoCount());
  const [redoCount, setRedoCount] = useState(editSessionHistory.getRedoCount());

  useEffect(() => {
    const unsubscribe = editSessionHistory.subscribe(() => {
      setIsActive(editSessionHistory.isActive());
      setSessionType(editSessionHistory.getSessionType());
      setCanUndo(editSessionHistory.canUndo());
      setCanRedo(editSessionHistory.canRedo());
      setUndoCount(editSessionHistory.getUndoCount());
      setRedoCount(editSessionHistory.getRedoCount());
    });
    return unsubscribe;
  }, []);

  const handleSessionUndo = useCallback(() => {
    return editSessionHistory.undo();
  }, []);

  const handleSessionRedo = useCallback(() => {
    return editSessionHistory.redo();
  }, []);

  return {
    isActive,
    sessionType,
    canUndo,
    canRedo,
    undoCount,
    redoCount,
    handleSessionUndo,
    handleSessionRedo,
  };
}
