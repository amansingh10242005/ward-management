import { useState, useEffect, useCallback } from 'react';
import { historyService, HistoryEntry } from '../services/historyService';

export function useHistory() {
  const [canUndo, setCanUndo] = useState(historyService.canUndo());
  const [canRedo, setCanRedo] = useState(historyService.canRedo());
  const [isBusy, setIsBusy] = useState(historyService.isBusy());
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>(historyService.getUndoStack());
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>(historyService.getRedoStack());

  useEffect(() => {
    const unsubscribe = historyService.subscribe(() => {
      setCanUndo(historyService.canUndo());
      setCanRedo(historyService.canRedo());
      setIsBusy(historyService.isBusy());
      setUndoStack(historyService.getUndoStack());
      setRedoStack(historyService.getRedoStack());
    });
    return unsubscribe;
  }, []);

  const handleUndo = useCallback(async (callbacks?: {
    onSelectionChange?: (feature: any | null, layerName: string | null) => void;
    onError?: (error: string) => void;
  }) => {
    return await historyService.undo(callbacks);
  }, []);

  const handleRedo = useCallback(async (callbacks?: {
    onSelectionChange?: (feature: any | null, layerName: string | null) => void;
    onError?: (error: string) => void;
  }) => {
    return await historyService.redo(callbacks);
  }, []);

  return {
    canUndo,
    canRedo,
    isBusy,
    undoStack,
    redoStack,
    handleUndo,
    handleRedo,
  };
}
