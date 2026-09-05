import { useState, useEffect, useCallback, useRef } from 'react';
import { olService } from '../lib/openlayers';
import { apiClient } from '../lib/api';
import { parseFeatureId } from '../utils/featureUtils';
import { validateGeometry } from '../utils/geometryValidation';

export type Mode = 'idle' | 'create' | 'edit' | 'move' | 'vertex_edit';
export type ActiveLayer = 'streetlights' | 'roads' | 'zones' | 'states' | 'districts' | null;

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
        setMode('idle');
      }
    }
  }, [selectedFeature, mode]);

  const handleSelectFeatureList = useCallback((feature: any) => {
    if (mode === 'vertex_edit') {
      olService.cancelVertexEdit();
    }
    setUiError(null);
    setSelectedFeature(feature);
    setMode('edit');
    if (activeLayer) {
      olService.setSelectedFeature(activeLayer, feature.id, feature);
      olService.centerOnFeature(activeLayer, feature.id, feature);
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
      olService.setSelectedFeature(layerName, geojsonFeature.id);

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

  const handleFormSuccess = useCallback((action?: 'create' | 'update' | 'delete', featureId?: string) => {
    olService.cancelInteraction();
    olService.setSelectedFeature(null, null);
    setSelectedFeature(null);
    setMode('idle');

    if (action === 'delete' && featureId && activeLayer) {
      olService.removeWFSFeature(activeLayer, featureId);
    }
    if (activeLayer) {
      olService.refreshLayer(activeLayer);
    }
    setActiveLayer(null);
  }, [activeLayer]);

  const handleMoveStart = useCallback(() => {
    if (!activeLayer) return;
    setMode('move');
    const fid = selectedFeature ? selectedFeature.id : null;
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

      let updatedFeature: any = null;
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

    // Vertex Edit exports
    startVertexEdit,
    finishVertexEdit,
    cancelVertexEdit,
    isSavingVertex,
    vertexEditError,
    currentVertexGeometry,
  };
}
