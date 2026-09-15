/**
 * editSessionHistory.ts — In-Session Local Geometry & Sketch History
 *
 * Manages UNSAVED client-side canvas history during:
 *  - Vertex Editing (Modify interaction)
 *  - Move / Translation
 *  - Feature Creation / Sketching (Draw interaction)
 *
 * CRITICAL INVARIANT:
 *  - Lives purely in browser memory.
 *  - Never issues HTTP / WFS-T requests.
 *  - Completely isolated from committed HistoryService.
 *  - Discarded on Cancel; converted to exactly ONE committed transaction upon Finish.
 */

export type EditSessionType = 'vertex_edit' | 'move' | 'create' | null;

export type EditSessionListener = () => void;

class EditSessionHistory {
  private sessionType: EditSessionType = null;
  private undoStack: any[] = [];
  private redoStack: any[] = [];
  private originalSnapshot: any = null;
  private listeners = new Set<EditSessionListener>();

  public subscribe(listener: EditSessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error('[EditSessionHistory] Listener error:', err);
      }
    });
  }

  public getSessionType(): EditSessionType {
    return this.sessionType;
  }

  public isActive(): boolean {
    return this.sessionType !== null;
  }

  public canUndo(): boolean {
    if (!this.isActive()) return false;
    // For vertex_edit / move: stack must have more than the initial snapshot
    if (this.sessionType === 'vertex_edit' || this.sessionType === 'move') {
      return this.undoStack.length > 1;
    }
    // For create: can undo if there are placed sketch points
    if (this.sessionType === 'create') {
      return this.undoStack.length > 0;
    }
    return false;
  }

  public canRedo(): boolean {
    if (!this.isActive()) return false;
    return this.redoStack.length > 0;
  }

  public getUndoCount(): number {
    return this.undoStack.length;
  }

  public getRedoCount(): number {
    return this.redoStack.length;
  }

  /**
   * Starts an in-session edit history with an initial geometry snapshot.
   */
  public startSession(type: EditSessionType, initialGeometry: any): void {
    this.sessionType = type;
    this.originalSnapshot = initialGeometry ? JSON.parse(JSON.stringify(initialGeometry)) : null;
    this.undoStack = initialGeometry ? [JSON.parse(JSON.stringify(initialGeometry))] : [];
    this.redoStack = [];
    this.notify();
  }

  /**
   * Records an in-session geometry change.
   * Compares with previous snapshot to avoid duplicate entries.
   */
  public pushSnapshot(geometry: any): void {
    if (!this.isActive()) return;
    const cloned = geometry ? JSON.parse(JSON.stringify(geometry)) : null;

    if (this.undoStack.length > 0) {
      const top = this.undoStack[this.undoStack.length - 1];
      if (JSON.stringify(top) === JSON.stringify(cloned)) {
        return; // No meaningful change
      }
    }

    this.undoStack.push(cloned);
    this.redoStack = []; // New modification invalidates redo
    this.notify();
  }

  /**
   * In-session Undo: pops current snapshot onto redo stack and returns previous snapshot.
   */
  public undo(): any | null {
    if (!this.canUndo()) return null;

    if (this.sessionType === 'vertex_edit' || this.sessionType === 'move') {
      const current = this.undoStack.pop();
      this.redoStack.push(current);
      const previous = this.undoStack[this.undoStack.length - 1];
      this.notify();
      return previous ? JSON.parse(JSON.stringify(previous)) : null;
    }

    if (this.sessionType === 'create') {
      const popped = this.undoStack.pop();
      this.redoStack.push(popped);
      this.notify();
      const current = this.undoStack[this.undoStack.length - 1];
      return current ? JSON.parse(JSON.stringify(current)) : null;
    }

    return null;
  }

  /**
   * In-session Redo: pops from redo stack onto undo stack and returns it.
   */
  public redo(): any | null {
    if (!this.canRedo()) return null;

    const next = this.redoStack.pop();
    this.undoStack.push(next);
    this.notify();
    return next ? JSON.parse(JSON.stringify(next)) : null;
  }

  /**
   * Checks if current geometry has net differences from original snapshot.
   */
  public hasNetChanges(): boolean {
    if (!this.originalSnapshot) return this.undoStack.length > 0;
    if (this.undoStack.length === 0) return false;
    const current = this.undoStack[this.undoStack.length - 1];
    return JSON.stringify(current) !== JSON.stringify(this.originalSnapshot);
  }

  public getOriginalSnapshot(): any | null {
    return this.originalSnapshot ? JSON.parse(JSON.stringify(this.originalSnapshot)) : null;
  }

  public getCurrentSnapshot(): any | null {
    if (this.undoStack.length === 0) return null;
    return JSON.parse(JSON.stringify(this.undoStack[this.undoStack.length - 1]));
  }

  /**
   * Clears in-session history on Finish or Cancel.
   */
  public clearSession(): void {
    this.sessionType = null;
    this.undoStack = [];
    this.redoStack = [];
    this.originalSnapshot = null;
    this.notify();
  }
}

export const editSessionHistory = new EditSessionHistory();
if (typeof window !== 'undefined') {
  (window as any).__editSessionHistory = editSessionHistory;
}
