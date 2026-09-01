import { useState, useEffect, useCallback } from 'react';
import { olService } from '../lib/openlayers';
import { apiClient } from '../lib/api';
import { parseFeatureId } from '../utils/featureUtils';

type Mode = 'idle' | 'create' | 'edit' | 'move';
export type ActiveLayer = 'streetlights' | 'roads' | 'zones' | 'states' | 'districts' | null;

export function useMapInteractions() {
  const [mode, setMode] = useState<Mode>('idle');
  const [selectedFeature, setSelectedFeature] = useState<any | null>(null);
  const [activeLayer, setActiveLayer] = useState<ActiveLayer>(null);
  const [selectedZoneFeature, setSelectedZoneFeature] = useState<any | null>(null);
  const [selectedRoadFeature, setSelectedRoadFeature] = useState<any | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);

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
      olService.cancelInteraction();
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
      } else if (mode === 'create') {
        shouldCancel = true;
      }

      if (shouldCancel) {
        olService.cancelInteraction();
        setSelectedFeature(null);
        olService.setSelectedFeature(null, null);
        setMode('idle');
      }
    }
  }, [selectedFeature, mode]);

  const handleSelectFeatureList = useCallback((feature: any) => {
    setUiError(null);
    setSelectedFeature(feature);
    setMode('edit');
    if (activeLayer) {
      olService.setSelectedFeature(activeLayer, feature.id);
      olService.centerOnFeature(activeLayer, feature.id);
    }
  }, [activeLayer]);

  // Activate modify/select when idle or editing
  useEffect(() => {
    if (mode === 'idle' || mode === 'edit') {
      olService.activateModify(
        (feature, layerName) => {
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
              if (!selectedZoneFeature || selectedZoneFeature.id !== geojsonFeature.properties?.zone_id) {
                const zoneId = geojsonFeature.properties?.zone_id;
                const zoneProps = olService.getFeatureProperties('zones', zoneId);
                setSelectedZoneFeature({ id: zoneId, properties: { name: zoneProps?.name || `Zone ${zoneId}` } });
              }
            } else if (layerName === 'streetlights') {
              const roadId = geojsonFeature.properties?.road_id;
              const zoneId = geojsonFeature.properties?.zone_id;
              if (!selectedRoadFeature || selectedRoadFeature.id !== roadId) {
                const roadProps = olService.getFeatureProperties('roads', roadId);
                setSelectedRoadFeature({ id: roadId, properties: { name: roadProps?.name || `Road ${roadId}` } });
              }
              if (!selectedZoneFeature || selectedZoneFeature.id !== zoneId) {
                const zoneProps = olService.getFeatureProperties('zones', zoneId);
                setSelectedZoneFeature({ id: zoneId, properties: { name: zoneProps?.name || `Zone ${zoneId}` } });
              }
            }
          } else {
            // Keep hierarchy intact so user can draw
            setSelectedFeature(null);
            setActiveLayer(null);
            setMode('idle');
            olService.setSelectedFeature(null, null);
          }
        },
        (feature) => {
          if (feature) {
            const geojsonFeature = typeof feature === 'string' ? JSON.parse(feature) : feature;
            setSelectedFeature(geojsonFeature);
          }
        }
      );
    }
  }, [mode, activeLayer, selectedZoneFeature, selectedRoadFeature]);

  const cancelAction = useCallback(() => {
    olService.cancelInteraction();
    olService.setSelectedFeature(null, null);
    setSelectedFeature(null);
    setActiveLayer(null);
    setMode('idle');
  }, []);

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
    setMode('move');
    olService.activateTranslate(async (translatedFeature) => {
      // Upon translate end, we automatically update the backend
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
        }
        
        // Refresh and switch back to edit mode
        olService.refreshLayer(activeLayer!);
        setSelectedFeature(translatedFeature);
        setMode('edit');
      } catch (err: any) {
        console.error('Failed to move feature:', err);
        setUiError(err.message || 'An unexpected error occurred while moving the feature.');
        setMode('edit'); // Revert back to edit mode if it failed
      }
    });
  }, [activeLayer]);

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
  };
}
