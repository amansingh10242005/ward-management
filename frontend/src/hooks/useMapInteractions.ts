import { useState, useEffect, useCallback, useRef } from 'react';
import { olService } from '../lib/openlayers';
import { apiClient } from '../lib/api';
import { parseFeatureId } from '../utils/featureUtils';
import { validateGeometry } from '../utils/geometryValidation';
import { historyService } from '../services/historyService';

export type Mode = 'idle' | 'create' | 'edit' | 'move' | 'vertex_edit';
export type ActiveLayer = 'streetlights' | 'roads' | 'zones' | 'states' | 'districts' | string | null;

export function useMapInteractions() {
  const [mode, setMode] = useState<Mode>('idle');
  const [selectedFeature, setSelectedFeature] = useState<any | null>(null);
  const [activeLayer, setActiveLayer] = useState<ActiveLayer>(null);
  const [selectedZoneFeature, setSelectedZoneFeature] = useState<any | null>(null);
  const [selectedRoadFeature, setSelectedRoadFeature] = useState<any | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);

  // Vertex Edit State
  const [isSavingVertex, setIsSavingVertex] = useState(false);
  const [vertexEditError, setVertexEditError] = useState<string | null>(null);
  const [currentVertexGeometry, setCurrentVertexGeometry] = useState<any | null>(null);

  // Auto-dismiss error toaster after 5 seconds
  useEffect(() => {
    if (uiError) {
      const timer = setTimeout(() => setUiError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [uiError]);

  const handleSetActiveLayer = useCallback((layer: ActiveLayer) => {
    setActiveLayer(layer);
    if (!layer) {
      if (mode === 'vertex_edit') {
        olService.cancelVertexEdit();
      } else {
        olService.cancelInteraction();
      }
      setSelectedFeature(null);
      olService.setSelectedFeature(null, null);
      olService.clearDynamicFeatures();
      setMode('idle');
    } else {
      let shouldCancel = false;
      if (selectedFeature) {
        let currentLayer = 'streetlights';
        const featureId = String(selectedFeature.id || '');
        if (featureId.startsWith('roads')) currentLayer = 'roads';
        if (featureId.startsWith('zones')) currentLayer = 'zones';
        if (featureId.startsWith('states')) currentLayer = 'states';
        if (featureId.startsWith('districts')) currentLayer = 'districts';
        
        if (currentLayer !== layer) shouldCancel = true;
      } else if (mode === 'create' || mode === 'vertex_edit') {
        shouldCancel = true;
      }

      if (shouldCancel) {
        if (mode === 'vertex_edit') {
          olService.cancelVertexEdit();
        } else {
          olService.cancelInteraction();
        }
        setSelectedFeature(null);
        olService.setSelectedFeature(null, null);
        olService.clearDynamicFeatures();
        setMode('idle');
      }
    }
  }, [selectedFeature, mode]);

  const handleSelectFeatureList = useCallback(async (feature: any) => {
    if (mode === 'vertex_edit') {
      olService.cancelVertexEdit();
    }
    setUiError(null);
    setSelectedFeature(feature);
    setMode('edit');

    if (activeLayer) {
      // Infer hierarchy state for list selection matching map selection
      if (activeLayer === 'zones') {
        setSelectedZoneFeature(feature);
        setSelectedRoadFeature(null);
      } else if (activeLayer === 'roads') {
        setSelectedRoadFeature(feature);
        const zoneId = feature.properties?.zone_id;
        if (zoneId != null) {
          const zoneProps = olService.getFeatureProperties('zones', zoneId);
          setSelectedZoneFeature({ id: zoneId, properties: { name: zoneProps?.name || `Zone ${zoneId}` } });
        }
      } else if (activeLayer === 'streetlights') {
        const roadId = feature.properties?.road_id;
        const zoneId = feature.properties?.zone_id;
        if (roadId != null) {
          const roadProps = olService.getFeatureProperties('roads', roadId);
          setSelectedRoadFeature({ id: roadId, properties: { name: roadProps?.name || `Road ${roadId}` } });
        }
        if (zoneId != null) {
          const zoneProps = olService.getFeatureProperties('zones', zoneId);
          setSelectedZoneFeature({ id: zoneId, properties: { name: zoneProps?.name || `Zone ${zoneId}` } });
        }
      }

      olService.setSelectedFeature(activeLayer, feature.id, feature);
      try {
        const resolved = await olService.centerOnFeature(activeLayer, feature.id, feature);
        if (resolved && resolved.geometry) {
          setSelectedFeature((prev: any) => {
            if (!prev || String(prev.id) === String(feature.id)) {
              return {
                ...prev,
                ...resolved,
                geometry: resolved.geometry,
                properties: { ...(prev?.properties || {}), ...(resolved.properties || {}) },
              };
            }
            return prev;
          });
        }
      } catch (err) {
        console.warn('centerOnFeature error:', err);
      }
    }
  }, [activeLayer, mode]);

  const selectedZoneRef = useRef<any>(selectedZoneFeature);
  selectedZoneRef.current = selectedZoneFeature;

  const selectedRoadRef = useRef<any>(selectedRoadFeature);
  selectedRoadRef.current = selectedRoadFeature;

  const onSelectFeatureCallback = useCallback((feature: any, layerName: string) => {
    setUiError(null);
    if (feature) {
      const geojsonFeature = typeof feature === 'string' ? JSON.parse(feature) : feature;
      setSelectedFeature(geojsonFeature);
      setActiveLayer(layerName as ActiveLayer);
      setMode('edit');
      olService.setSelectedFeature(layerName, geojsonFeature.id, geojsonFeature);

      // Infer hierarchy state
      if (layerName === 'zones') {
        setSelectedZoneFeature(geojsonFeature);
        setSelectedRoadFeature(null);
      } else if (layerName === 'roads') {
        setSelectedRoadFeature(geojsonFeature);
        if (!selectedZoneRef.current || selectedZoneRef.current.id !== geojsonFeature.properties?.zone_id) {
          const zoneId = geojsonFeature.properties?.zone_id;
          const zoneProps = olService.getFeatureProperties('zones', zoneId);
          setSelectedZoneFeature({ id: zoneId, properties: { name: zoneProps?.name || `Zone ${zoneId}` } });
        }
      } else if (layerName === 'streetlights') {
        const roadId = geojsonFeature.properties?.road_id;
        const zoneId = geojsonFeature.properties?.zone_id;
        if (!selectedRoadRef.current || selectedRoadRef.current.id !== roadId) {
          const roadProps = olService.getFeatureProperties('roads', roadId);
          setSelectedRoadFeature({ id: roadId, properties: { name: roadProps?.name || `Road ${roadId}` } });
        }
        if (!selectedZoneRef.current || selectedZoneRef.current.id !== zoneId) {
          const zoneProps = olService.getFeatureProperties('zones', zoneId);
          setSelectedZoneFeature({ id: zoneId, properties: { name: zoneProps?.name || `Zone ${zoneId}` } });
        }
      }
    } else {
      setSelectedFeature(null);
      setActiveLayer(null);
      setMode('idle');
      olService.setSelectedFeature(null, null);
    }
  }, []);

  const onSelectRef = useRef(onSelectFeatureCallback);
  onSelectRef.current = onSelectFeatureCallback;

  // Activate select when idle or normal inspecting/editing; stable interaction across hierarchy changes
  const isSelectMode = mode === 'idle' || mode === 'edit';
  useEffect(() => {
    if (isSelectMode) {
      olService.activateSelect((feature, layerName) => {
        onSelectRef.current(feature, layerName);
      });
    }
  }, [isSelectMode]);

  const cancelAction = useCallback(() => {
    if (mode === 'vertex_edit') {
      olService.cancelVertexEdit();
    } else {
      olService.cancelInteraction();
    }
    olService.setSelectedFeature(null, null);
    olService.clearDynamicFeatures();
    setSelectedFeature(null);
    setActiveLayer(null);
    setMode('idle');
  }, [mode]);

  const startDrawingStreetlight = useCallback(() => {
    if (!selectedRoadFeature) {
      setUiError('Please map a Road in a Zone before creating a Streetlight.');
      return cancelAction();
    }
    setUiError(null);
    if (mode === 'create' && activeLayer === 'streetlights') return cancelAction();
    setMode('create');
    setActiveLayer('streetlights');
    setSelectedFeature(null);
    olService.setSelectedFeature(null, null);
    olService.activateDraw('Point', 'streetlights', (feature) => {
      const geojsonFeature = typeof feature === 'string' ? JSON.parse(feature) : feature;
      setSelectedFeature(geojsonFeature);
    });
  }, [selectedRoadFeature, mode, activeLayer, cancelAction]);

  const startDrawingRoad = useCallback(() => {
    if (!selectedZoneFeature) {
      setUiError('Please select a Zone before mapping a Road.');
      return cancelAction();
    }
    setUiError(null);
    if (mode === 'create' && activeLayer === 'roads') return cancelAction();
    setMode('create');
    setActiveLayer('roads');
    setSelectedFeature(null);
    olService.setSelectedFeature(null, null);
    olService.activateDraw('LineString', 'roads', (feature) => {
      const geojsonFeature = typeof feature === 'string' ? JSON.parse(feature) : feature;
      setSelectedFeature(geojsonFeature);
    });
  }, [selectedZoneFeature, mode, activeLayer, cancelAction]);

  const startDrawingZone = useCallback(() => {
    setUiError(null);
    if (mode === 'create' && activeLayer === 'zones') return cancelAction();
    setMode('create');
    setActiveLayer('zones');
    setSelectedFeature(null);
    olService.setSelectedFeature(null, null);
    olService.activateDraw('Polygon', 'zones', (feature) => {
      const geojsonFeature = typeof feature === 'string' ? JSON.parse(feature) : feature;
      setSelectedFeature(geojsonFeature);
    });
  }, [mode, activeLayer, cancelAction]);

  const handleFormSuccess = useCallback((action?: 'create' | 'update' | 'delete', featureId?: string, layerName?: string) => {
    olService.cancelInteraction();
    olService.setSelectedFeature(null, null);
    olService.clearDynamicFeatures();
    setSelectedFeature(null);
    setMode('idle');

    const targetLayer = layerName || activeLayer;
    if (action === 'delete' && featureId && targetLayer) {
      olService.removeWFSFeature(targetLayer, featureId);
    }
    if (targetLayer) {
      olService.refreshLayer(targetLayer);
    }
    setActiveLayer(null);
  }, [activeLayer]);

  const handleMoveStart = useCallback(() => {
    if (!activeLayer) return;
    setMode('move');
    const fid = selectedFeature ? selectedFeature.id : null;
    const beforeGeom = selectedFeature?.geometry ? JSON.parse(JSON.stringify(selectedFeature.geometry)) : null;
    const beforeProps = selectedFeature?.properties ? JSON.parse(JSON.stringify(selectedFeature.properties)) : {};
    olService.activateTranslate(
      activeLayer,
      async (translatedFeature, rollback) => {
        try {
          const rawId = parseFeatureId(translatedFeature.id);
          const payload = {
            type: 'Feature',
            geometry: translatedFeature.geometry,
            properties: translatedFeature.properties,
          };
          
          const isCoreLayer = ['streetlights', 'roads', 'zones', 'states', 'districts'].includes(activeLayer);

          if (isCoreLayer) {
            if (activeLayer === 'streetlights') {
              await apiClient.streetlights.update(rawId as string, payload as any);
            } else if (activeLayer === 'roads') {
              await apiClient.roads.update(rawId as string, payload as any);
            } else if (activeLayer === 'zones') {
              await apiClient.zones.update(rawId as string, payload as any);
            } else if (activeLayer === 'states') {
              await apiClient.states.update(rawId as string, payload as any);
            } else if (activeLayer === 'districts') {
              await apiClient.districts.update(rawId as string, payload as any);
            }
          } else {
            // Dynamic WFS-T Update
            await apiClient.geoserver.transaction({
              layerName: activeLayer,
              featureId: translatedFeature.id,
              action: 'update',
              feature: payload,
            });
          }

          historyService.recordSuccess({
            operationType: 'move',
            layerName: activeLayer,
            isCore: isCoreLayer,
            originalFeatureId: translatedFeature.id,
            currentFeatureId: translatedFeature.id,
            before: {
              geometry: beforeGeom,
              properties: beforeProps,
            },
            after: {
              geometry: translatedFeature.geometry,
              properties: translatedFeature.properties,
            },
          });
          
          // Refresh and switch back to normal feature state
          olService.refreshLayer(activeLayer);
          setSelectedFeature(translatedFeature);
          setMode('edit');
        } catch (err: any) {
          console.error('Failed to move feature:', err);
          rollback();
          setUiError(err.message || 'An unexpected error occurred while moving the feature.');
          setMode('edit');
        }
      },
      fid
    );
  }, [activeLayer, selectedFeature]);

  // ── Dedicated Vertex Editing Handlers ───────────────────────────────────────

  const startVertexEdit = useCallback(() => {
    if (!selectedFeature || !activeLayer) return;
    setUiError(null);
    setVertexEditError(null);
    setIsSavingVertex(false);
    setCurrentVertexGeometry(selectedFeature.geometry);

    const ok = olService.activateVertexEdit(
      activeLayer,
      selectedFeature.id,
      selectedFeature,
      (currentGeomGeoJson) => {
        // Real-time local geometry update as vertices are moved
        setCurrentVertexGeometry(currentGeomGeoJson);
      },
      () => {
        // Cancelled via Escape key or internal trigger
        setMode('idle');
        setVertexEditError(null);
        setCurrentVertexGeometry(null);
      }
    );

    if (ok) {
      setMode('vertex_edit');
    } else {
      setUiError('Could not initialize vertex editing for this feature.');
    }
  }, [selectedFeature, activeLayer]);

  const finishVertexEdit = useCallback(async () => {
    if (!selectedFeature || !activeLayer) return;
    setIsSavingVertex(true);
    setVertexEditError(null);

    const beforeGeom = selectedFeature?.geometry ? JSON.parse(JSON.stringify(selectedFeature.geometry)) : null;
    const beforeProps = selectedFeature?.properties ? JSON.parse(JSON.stringify(selectedFeature.properties)) : {};

    try {
      const finalGeom =
        olService.getVertexEditCurrentGeometry() ||
        currentVertexGeometry ||
        selectedFeature.geometry;

      if (!finalGeom) {
        throw new Error('No geometry available to save.');
      }

      // Pre-save client validation
      const validation = validateGeometry(finalGeom, activeLayer);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const rawId = parseFeatureId(selectedFeature.id);
      const payload = {
        type: 'Feature',
        geometry: finalGeom,
        properties: selectedFeature.properties || {},
      };

      const isCoreLayer = ['streetlights', 'roads', 'zones', 'states', 'districts'].includes(activeLayer);
      let updatedFeature: any = null;

      if (isCoreLayer) {
        if (activeLayer === 'streetlights') {
          updatedFeature = await apiClient.streetlights.update(rawId as string, payload as any);
        } else if (activeLayer === 'roads') {
          updatedFeature = await apiClient.roads.update(rawId as string, payload as any);
        } else if (activeLayer === 'zones') {
          updatedFeature = await apiClient.zones.update(rawId as string, payload as any);
        } else if (activeLayer === 'states') {
          updatedFeature = await apiClient.states.update(rawId as string, payload as any);
        } else if (activeLayer === 'districts') {
          updatedFeature = await apiClient.districts.update(rawId as string, payload as any);
        }
      } else {
        // Dynamic WFS-T Update
        await apiClient.geoserver.transaction({
          layerName: activeLayer,
          featureId: selectedFeature.id,
          action: 'update',
          feature: payload,
        });
        // We simulate the updated feature so UI can reflect it immediately
        updatedFeature = payload;
        updatedFeature.id = selectedFeature.id;
      }

      historyService.recordSuccess({
        operationType: 'vertex',
        layerName: activeLayer,
        isCore: isCoreLayer,
        originalFeatureId: selectedFeature.id,
        currentFeatureId: selectedFeature.id,
        before: {
          geometry: beforeGeom,
          properties: beforeProps,
        },
        after: {
          geometry: finalGeom,
          properties: selectedFeature.properties || {},
        },
      });

      // Finish OpenLayers editing session in-place; keep vector features intact
      olService.finishVertexEdit();
      // Refresh layer deterministically so GeoServer and vector sources render the new saved shape
      olService.refreshLayer(activeLayer);

      if (updatedFeature) {
        setSelectedFeature(updatedFeature);
      } else {
        setSelectedFeature((prev: any) => ({ ...prev, geometry: finalGeom }));
      }

      setMode('idle');
      setCurrentVertexGeometry(null);
    } catch (err: any) {
      console.error('Failed to finish vertex edit:', err);
      setVertexEditError(err.message || 'An unexpected error occurred while saving.');
      // User stays in vertex_edit mode so edits are not lost
    } finally {
      setIsSavingVertex(false);
    }
  }, [selectedFeature, activeLayer, currentVertexGeometry]);

  const cancelVertexEdit = useCallback(() => {
    olService.cancelVertexEdit();
    setMode('idle');
    setVertexEditError(null);
    setCurrentVertexGeometry(null);
    setIsSavingVertex(false);
  }, []);

  const zoomToFeature = useCallback(() => {
    if (selectedFeature && activeLayer) {
      olService.centerOnFeature(activeLayer, selectedFeature.id, selectedFeature);
    }
  }, [selectedFeature, activeLayer]);

  const zoomToLayer = useCallback((layerName?: string) => {
    const target = layerName || activeLayer;
    if (target) {
      olService.zoomToLayer(target);
    }
  }, [activeLayer]);

  const handleUndo = useCallback(async () => {
    return await historyService.undo({
      onSelectionChange: (feature, layerName) => {
        setSelectedFeature(feature);
        if (layerName) setActiveLayer(layerName);
      },
      onError: (err) => {
        setUiError(err);
      },
    });
  }, []);

  const handleRedo = useCallback(async () => {
    return await historyService.redo({
      onSelectionChange: (feature, layerName) => {
        setSelectedFeature(feature);
        if (layerName) setActiveLayer(layerName);
      },
      onError: (err) => {
        setUiError(err);
      },
    });
  }, []);

  return {
    mode,
    activeLayer,
    setActiveLayer: handleSetActiveLayer,
    selectedFeature,
    selectedZoneFeature,
    selectedRoadFeature,
    uiError,
    setUiError,
    startDrawingStreetlight,
    startDrawingRoad,
    startDrawingZone,
    cancelAction,
    handleFormSuccess,
    handleMoveStart,
    handleSelectFeature: handleSelectFeatureList,

    // Spatial Navigation exports
    zoomToFeature,
    zoomToLayer,

    // Vertex Edit exports
    startVertexEdit,
    finishVertexEdit,
    cancelVertexEdit,
    isSavingVertex,
    vertexEditError,
    currentVertexGeometry,

    // Undo / Redo exports
    handleUndo,
    handleRedo,
  };
}
