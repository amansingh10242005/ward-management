/**
 * historyService.ts — Centralized Canonical Edit History Model
 *
 * Implements server-backed Undo/Redo for GIS feature editing:
 *  - Dynamic WFS-T transactions (Update ↔ Update, Delete ↔ Insert, Create ↔ Delete)
 *  - Core PostGIS REST CRUD transactions
 *  - Dynamic Feature ID Re-binding (originalFeatureId vs currentFeatureId)
 *  - Strict LIFO stack semantics
 *  - Atomic recording only upon server confirmation
 *  - Transaction lock against concurrent execution & duplicate clicks
 *  - Zero WFS GetFeature overhead
 */

import { apiClient } from '../lib/api';
import { olService } from '../lib/openlayers';
import { parseFeatureId } from '../utils/featureUtils';

export type HistoryOperationType = 'update' | 'move' | 'vertex' | 'delete' | 'create';

export interface HistoryEntry {
  id: string;
  timestamp: number;
  operationType: HistoryOperationType;
  layerName: string;
  isCore: boolean;
  originalFeatureId: string;
  currentFeatureId: string;
  before: {
    geometry?: any;
    properties?: Record<string, any>;
    feature?: any;
  };
  after: {
    geometry?: any;
    properties?: Record<string, any>;
    feature?: any;
  };
  metadata?: Record<string, any>;
}

export type HistoryListener = () => void;

class HistoryService {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private isExecuting = false;
  private maxStackSize = 50;
  private listeners = new Set<HistoryListener>();

  public subscribe(listener: HistoryListener): () => void {
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
        console.error('[HistoryService] Listener error:', err);
      }
    });
  }

  public getUndoStack(): HistoryEntry[] {
    return [...this.undoStack];
  }

  public getRedoStack(): HistoryEntry[] {
    return [...this.redoStack];
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0 && !this.isExecuting;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0 && !this.isExecuting;
  }

  public isBusy(): boolean {
    return this.isExecuting;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  /**
   * Records a confirmed successful operation onto the undo stack and clears redo stack.
   * MUST only be called AFTER server transaction succeeds.
   */
  public recordSuccess(entryData: Omit<HistoryEntry, 'id' | 'timestamp'>): HistoryEntry {
    const entry: HistoryEntry = {
      ...entryData,
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    };

    this.undoStack.push(entry);
    if (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift();
    }

    // New edit invalidates redo stack
    this.redoStack = [];
    this.notify();
    return entry;
  }

  /**
   * Executes inverse transaction for the top operation on the undo stack.
   */
  public async undo(callbacks?: {
    onSelectionChange?: (feature: any | null, layerName: string | null) => void;
    onError?: (error: string) => void;
  }): Promise<{ success: boolean; error?: string; entry?: HistoryEntry }> {
    if (this.undoStack.length === 0) {
      return { success: false, error: 'Undo stack is empty' };
    }
    if (this.isExecuting) {
      return { success: false, error: 'Another history transaction is currently running' };
    }

    this.isExecuting = true;
    this.notify();

    const entry = this.undoStack[this.undoStack.length - 1];

    try {
      if (entry.isCore) {
        const rawId = parseFeatureId(entry.currentFeatureId);

        if (entry.operationType === 'update' || entry.operationType === 'move' || entry.operationType === 'vertex') {
          const payload = {
            type: 'Feature',
            geometry: entry.before.geometry,
            properties: entry.before.properties,
          };
          const client = (apiClient as any)[entry.layerName];
          if (!client?.update) {
            throw new Error(`Core layer '${entry.layerName}' does not support update`);
          }
          await client.update(rawId, payload);
        } else if (entry.operationType === 'delete') {
          // Recreate deleted core feature via create endpoint
          const payload = {
            type: 'Feature',
            geometry: entry.before.geometry,
            properties: entry.before.properties,
          };
          const client = (apiClient as any)[entry.layerName];
          if (!client?.create) {
            throw new Error(`Core layer '${entry.layerName}' does not support create/restore`);
          }
          const res = await client.create(payload);
          if (res?.id) {
            entry.currentFeatureId = String(res.id);
          }
        } else if (entry.operationType === 'create') {
          // Inverse of create is delete
          const client = (apiClient as any)[entry.layerName];
          if (!client?.delete) {
            throw new Error(`Core layer '${entry.layerName}' does not support delete`);
          }
          await client.delete(rawId);
        }
      } else {
        // Dynamic Layer WFS-T inverse operations
        if (entry.operationType === 'update' || entry.operationType === 'move' || entry.operationType === 'vertex') {
          const payload = {
            layerName: entry.layerName,
            featureId: entry.currentFeatureId,
            action: 'update',
            feature: {
              type: 'Feature',
              geometry: entry.before.geometry,
              properties: entry.before.properties,
            },
          };
          await apiClient.geoserver.transaction(payload);
        } else if (entry.operationType === 'delete') {
          // Undo dynamic delete: WFS-T Insert to recreate feature server-side
          const payload = {
            layerName: entry.layerName,
            action: 'insert',
            feature: {
              type: 'Feature',
              geometry: entry.before.geometry,
              properties: entry.before.properties,
            },
          };
          const res = await apiClient.geoserver.transaction(payload);
          // Capture new assigned feature ID from GeoServer
          if (res?.featureId) {
            entry.currentFeatureId = res.featureId;
          }
        } else if (entry.operationType === 'create') {
          // Undo dynamic create: WFS-T Delete
          const payload = {
            layerName: entry.layerName,
            featureId: entry.currentFeatureId,
            action: 'delete',
          };
          await apiClient.geoserver.transaction(payload);
        }
      }

      // Server confirmation succeeded -> Commit stack movement
      this.undoStack.pop();
      this.redoStack.push(entry);

      // Synchronize map & UI via WMS cache-busting and local vector state
      olService.refreshWmsLayer(entry.layerName);

      if (entry.operationType === 'delete') {
        // Deleted feature was recreated
        const restoredFeature = {
          id: entry.currentFeatureId,
          type: 'Feature',
          geometry: entry.before.geometry,
          properties: entry.before.properties,
        };
        olService.setSelectedFeature(entry.layerName, entry.currentFeatureId, restoredFeature);
        callbacks?.onSelectionChange?.(restoredFeature, entry.layerName);
      } else if (entry.operationType === 'create') {
        // Created feature was deleted
        olService.removeWFSFeature(entry.layerName, entry.currentFeatureId);
        olService.setSelectedFeature(null, null);
        callbacks?.onSelectionChange?.(null, null);
      } else {
        // Update/Move/Vertex reverted
        const revertedFeature = {
          id: entry.currentFeatureId,
          type: 'Feature',
          geometry: entry.before.geometry,
          properties: entry.before.properties,
        };
        olService.setSelectedFeature(entry.layerName, entry.currentFeatureId, revertedFeature);
        callbacks?.onSelectionChange?.(revertedFeature, entry.layerName);
      }

      return { success: true, entry };
    } catch (err: any) {
      console.warn('[HistoryService] Undo failed:', err);
      const errMsg = err.message || 'Undo transaction failed on server';
      callbacks?.onError?.(errMsg);
      return { success: false, error: errMsg };
    } finally {
      this.isExecuting = false;
      this.notify();
    }
  }

  /**
   * Re-applies forward transaction for the top operation on the redo stack.
   */
  public async redo(callbacks?: {
    onSelectionChange?: (feature: any | null, layerName: string | null) => void;
    onError?: (error: string) => void;
  }): Promise<{ success: boolean; error?: string; entry?: HistoryEntry }> {
    if (this.redoStack.length === 0) {
      return { success: false, error: 'Redo stack is empty' };
    }
    if (this.isExecuting) {
      return { success: false, error: 'Another history transaction is currently running' };
    }

    this.isExecuting = true;
    this.notify();

    const entry = this.redoStack[this.redoStack.length - 1];

    try {
      if (entry.isCore) {
        const rawId = parseFeatureId(entry.currentFeatureId);

        if (entry.operationType === 'update' || entry.operationType === 'move' || entry.operationType === 'vertex') {
          const payload = {
            type: 'Feature',
            geometry: entry.after.geometry,
            properties: entry.after.properties,
          };
          const client = (apiClient as any)[entry.layerName];
          if (!client?.update) {
            throw new Error(`Core layer '${entry.layerName}' does not support update`);
          }
          await client.update(rawId, payload);
        } else if (entry.operationType === 'delete') {
          // Re-delete the recreated core feature
          const client = (apiClient as any)[entry.layerName];
          if (!client?.delete) {
            throw new Error(`Core layer '${entry.layerName}' does not support delete`);
          }
          await client.delete(rawId);
        } else if (entry.operationType === 'create') {
          // Re-create the feature
          const payload = {
            type: 'Feature',
            geometry: entry.after.geometry,
            properties: entry.after.properties,
          };
          const client = (apiClient as any)[entry.layerName];
          if (!client?.create) {
            throw new Error(`Core layer '${entry.layerName}' does not support create`);
          }
          const res = await client.create(payload);
          if (res?.id) {
            entry.currentFeatureId = String(res.id);
          }
        }
      } else {
        // Dynamic Layer WFS-T forward operations
        if (entry.operationType === 'update' || entry.operationType === 'move' || entry.operationType === 'vertex') {
          const payload = {
            layerName: entry.layerName,
            featureId: entry.currentFeatureId,
            action: 'update',
            feature: {
              type: 'Feature',
              geometry: entry.after.geometry,
              properties: entry.after.properties,
            },
          };
          await apiClient.geoserver.transaction(payload);
        } else if (entry.operationType === 'delete') {
          // Redo dynamic delete: WFS-T Delete on the currentFeatureId (which was assigned during undo insert)
          const payload = {
            layerName: entry.layerName,
            featureId: entry.currentFeatureId,
            action: 'delete',
          };
          await apiClient.geoserver.transaction(payload);
        } else if (entry.operationType === 'create') {
          // Redo dynamic create: WFS-T Insert
          const payload = {
            layerName: entry.layerName,
            action: 'insert',
            feature: {
              type: 'Feature',
              geometry: entry.after.geometry,
              properties: entry.after.properties,
            },
          };
          const res = await apiClient.geoserver.transaction(payload);
          if (res?.featureId) {
            entry.currentFeatureId = res.featureId;
          }
        }
      }

      // Server confirmation succeeded -> Commit stack movement
      this.redoStack.pop();
      this.undoStack.push(entry);

      // Synchronize map & UI via WMS cache-busting and local vector state
      olService.refreshWmsLayer(entry.layerName);

      if (entry.operationType === 'delete') {
        // Re-deleted
        olService.removeWFSFeature(entry.layerName, entry.currentFeatureId);
        olService.setSelectedFeature(null, null);
        callbacks?.onSelectionChange?.(null, null);
      } else {
        // Re-applied update / move / vertex
        const reappliedFeature = {
          id: entry.currentFeatureId,
          type: 'Feature',
          geometry: entry.after.geometry,
          properties: entry.after.properties,
        };
        olService.setSelectedFeature(entry.layerName, entry.currentFeatureId, reappliedFeature);
        callbacks?.onSelectionChange?.(reappliedFeature, entry.layerName);
      }

      return { success: true, entry };
    } catch (err: any) {
      console.warn('[HistoryService] Redo failed:', err);
      const errMsg = err.message || 'Redo transaction failed on server';
      callbacks?.onError?.(errMsg);
      return { success: false, error: errMsg };
    } finally {
      this.isExecuting = false;
      this.notify();
    }
  }
}

export const historyService = new HistoryService();

// Expose globally on window for browser automation and diagnostics
if (typeof window !== 'undefined') {
  (window as any).__historyService = historyService;
}
