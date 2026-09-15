import { useState, useEffect, useCallback } from 'react';
import MapContainer from './components/MapContainer';
import TechSidebar from './components/TechSidebar';
import BasemapModal from './components/BasemapModal';
import CoordinateBar from './components/CoordinateBar';
import {
  IconLayers,
  IconMap,
  IconFullscreen,
  IconShare,
  IconCompass,
  IconUndo,
  IconRedo,
  IconTable,
} from './components/Icons';
import { olService, BasemapId } from './lib/openlayers';
import { useMapInteractions } from './hooks/useMapInteractions';
import UnifiedLegend from './components/UnifiedLegend';
import { DynamicLayer } from './components/DynamicLegend';
import { apiClient } from './lib/api';
import { useHistory } from './hooks/useHistory';
import { useEditSessionHistory } from './hooks/useEditSessionHistory';
import AttributeTable from './components/AttributeTable';

function App() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [mapRotation, setMapRotation] = useState(0);
  const [isBasemapModalOpen, setIsBasemapModalOpen] = useState(false);
  const [currentBasemap, setCurrentBasemap] = useState<BasemapId>('carto_dark');
  const [isAttributeTableOpen, setIsAttributeTableOpen] = useState(false);


  useEffect(() => {
    return olService.onBasemapChange((id) => {
      setCurrentBasemap(id);
    });
  }, []);

  const handleSelectBasemap = (id: BasemapId) => {
    olService.setBasemap(id);
    setCurrentBasemap(id);
  };

  const [dynamicLayers, setDynamicLayers] = useState<DynamicLayer[]>([]);
  const [dynamicVisibility, setDynamicVisibility] = useState<Record<string, boolean>>({});
  const [coreVisibility, setCoreVisibility] = useState<Record<string, boolean>>({
    streetlights: false,
    roads: false,
    zones: false,
    states: false,
    districts: false,
  });

  const handleToggleCoreLayer = useCallback((layerName: string, isVisible: boolean) => {
    setCoreVisibility((prev) => ({ ...prev, [layerName]: isVisible }));
    olService.toggleLayer(layerName, isVisible);
  }, []);

  // Synchronize React visibility state with OpenLayers layer visibility
  useEffect(() => {
    return olService.onLayerVisibilityChange((layerName, isVisible) => {
      if (['streetlights', 'roads', 'zones', 'states', 'districts'].includes(layerName)) {
        setCoreVisibility((prev) => prev[layerName] === isVisible ? prev : ({ ...prev, [layerName]: isVisible }));
      } else {
        setDynamicVisibility((prev) => prev[layerName] === isVisible ? prev : ({ ...prev, [layerName]: isVisible }));
      }
    });
  }, []);

  const refreshDynamicLayers = useCallback(async (force = true) => {
    try {
      const layers = await apiClient.geoserver.getLayers(force);
      const coreLayerNames = ['states', 'districts', 'zones', 'roads', 'streetlights'];
      const discovered = (layers || []).filter((l: any) => !coreLayerNames.includes(l.name));
      setDynamicLayers(discovered);
      discovered.forEach((l: any) => {
        olService.addDynamicLayer(l.name, l.qualifiedName, l.workspace, l.latLonBoundingBox);
      });
      return discovered;
    } catch (err) {
      console.warn('Failed to load dynamic layers from GeoServer:', err);
      return [];
    }
  }, []);

  useEffect(() => {
    refreshDynamicLayers();
    if (typeof window !== 'undefined') {
      (window as any).__refreshDynamicLayers = refreshDynamicLayers;
    }
  }, [refreshDynamicLayers]);

  const handleToggleDynamicLayer = useCallback((layerName: string, isVisible: boolean) => {
    setDynamicVisibility((prev) => ({ ...prev, [layerName]: isVisible }));
    olService.toggleDynamicLayer(layerName, isVisible);
  }, []);

  const {
    mode,
    activeLayer,
    setActiveLayer,
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
    handleSelectFeature,
    onSelectFeature,
    deselectFeature,
    zoomToFeature,
    startVertexEdit,
    finishVertexEdit,
    cancelVertexEdit,
    isSavingVertex,
    vertexEditError,
    currentVertexGeometry,
    handleUndo,
    handleRedo,
  } = useMapInteractions();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__openAttributeTable = (layerName?: string) => {
        if (layerName) setActiveLayer(layerName);
        setIsAttributeTableOpen(true);
      };
      (window as any).__closeAttributeTable = () => setIsAttributeTableOpen(false);
      (window as any).__isAttributeTableOpen = () => isAttributeTableOpen;
      (window as any).__selectFeature = (feature: any, layerName: string) => {
        onSelectFeature(feature, layerName);
      };
    }
  }, [isAttributeTableOpen, onSelectFeature, setActiveLayer]);

  const { canUndo: serverCanUndo, canRedo: serverCanRedo, isBusy } = useHistory();
  const editSession = useEditSessionHistory();

  const isEditingSessionActive = mode === 'vertex_edit' || mode === 'create' || mode === 'move' || editSession.isActive;
  const effectiveCanUndo = isEditingSessionActive ? editSession.canUndo : serverCanUndo;
  const effectiveCanRedo = isEditingSessionActive ? editSession.canRedo : serverCanRedo;

  // Stage E4: Global keyboard shortcuts (Ctrl+Z -> Undo, Ctrl+Y / Ctrl+Shift+Z -> Redo)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key === 'z' || e.key === 'Z') {
          if (e.shiftKey) {
            e.preventDefault();
            handleRedo();
          } else {
            e.preventDefault();
            handleUndo();
          }
        } else if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          handleRedo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    return olService.onRotationChange(setMapRotation);
  }, []);

  // Apply theme to <html> element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(prev => !prev);

  // Map control handlers
  const handleZoomIn = useCallback(() => {
    const map = olService.getMap();
    if (map) {
      const view = map.getView();
      view.animate({ zoom: (view.getZoom() ?? 12) + 1, duration: 200 });
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    const map = olService.getMap();
    if (map) {
      const view = map.getView();
      view.animate({ zoom: (view.getZoom() ?? 12) - 1, duration: 200 });
    }
  }, []);

  const handleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { });
    } else {
      document.exitFullscreen().catch(() => { });
    }
  }, []);

  const handleNorthReset = useCallback(() => {
    const map = olService.getMap();
    if (map) {
      map.getView().animate({ rotation: 0, duration: 300 });
    }
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarOpen(prev => {
      const next = !prev;
      setTimeout(() => {
        olService.getMap()?.updateSize();
      }, 300); // Wait for the transition to finish before snapping map size
      return next;
    });
  }, []);

  const handleShare = useCallback(() => {
    navigator.clipboard.writeText(window.location.href)
      .then(() => alert('Link copied to clipboard!'))
      .catch(() => alert('Failed to copy link.'));
  }, []);

  const openSidebar = useCallback(() => {
    setIsSidebarOpen(prev => {
      if (!prev) {
        setTimeout(() => olService.getMap()?.updateSize(), 300);
        return true;
      }
      return prev;
    });
  }, []);

  const handleDrawPoint = useCallback(() => {
    openSidebar();
    startDrawingStreetlight();
  }, [openSidebar, startDrawingStreetlight]);

  const handleDrawLine = useCallback(() => {
    openSidebar();
    startDrawingRoad();
  }, [openSidebar, startDrawingRoad]);

  const handleDrawPolygon = useCallback(() => {
    openSidebar();
    startDrawingZone();
  }, [openSidebar, startDrawingZone]);

  return (
    <div className="app-layout">
      {/* ── BODY ────────────────────────────────────────────────────────── */}
      <div className="app-body">
        {uiError && (
          <div className="error-banner" style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 9999, minWidth: '400px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ flex: 1 }}>{uiError}</span>
            <button onClick={() => setUiError(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '20px', padding: '0 8px', display: 'flex', alignItems: 'center', lineHeight: 1 }}>&times;</button>
          </div>
        )}
        {/* ── SIDEBAR ─────────────────────────────────────────────────── */}
        <aside className="sidebar hud-sidebar" style={{ marginLeft: isSidebarOpen ? '0px' : 'calc(-1 * var(--sidebar-width, 270px))' }}>
          <TechSidebar
            activeLayer={activeLayer}
            setActiveLayer={setActiveLayer}
            selectedFeature={selectedFeature}
            onSelectFeature={handleSelectFeature}
            mode={mode}
            onDrawPoint={handleDrawPoint}
            onDrawLine={handleDrawLine}
            onDrawPolygon={handleDrawPolygon}
            onMoveStart={handleMoveStart}
            onSuccess={handleFormSuccess}
            onCancel={cancelAction}
            onDeselectFeature={deselectFeature}
            selectedZoneFeature={selectedZoneFeature}
            selectedRoadFeature={selectedRoadFeature}
            isDarkMode={isDarkMode}
            toggleTheme={toggleTheme}
            onZoomToFeature={zoomToFeature}
            onStartVertexEdit={startVertexEdit}
            onFinishVertexEdit={finishVertexEdit}
            onCancelVertexEdit={cancelVertexEdit}
            isSavingVertex={isSavingVertex}
            vertexEditError={vertexEditError}
            currentVertexGeometry={currentVertexGeometry}
            onError={setUiError}
            dynamicLayers={dynamicLayers}
            dynamicVisibility={dynamicVisibility}
            onToggleDynamicLayer={handleToggleDynamicLayer}
            coreVisibility={coreVisibility}
            onToggleCoreLayer={handleToggleCoreLayer}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onOpenAttributeTable={(layerName) => {
              if (layerName) setActiveLayer(layerName);
              setIsAttributeTableOpen(true);
            }}
          />
        </aside>

        {/* ── MAP AREA ─────────────────────────────────────────────────── */}
        <main className="map-wrapper">
          {/* Basemap selector popover */}
          <BasemapModal
            isOpen={isBasemapModalOpen}
            onClose={() => setIsBasemapModalOpen(false)}
            currentBasemap={currentBasemap}
            onSelectBasemap={handleSelectBasemap}
          />

          {/* Map controls cluster — top-right */}
          <div className="map-controls-cluster">
            {/* Group 1: view controls & basemap selector & undo/redo */}
            <div className="map-control-group">
              <button
                className="map-ctrl-btn"
                onClick={handleToggleSidebar}
                title="Toggle sidebar"
                aria-label="Toggle sidebar"
              >
                <IconLayers />
              </button>
              <button
                className={`map-ctrl-btn ${isBasemapModalOpen ? 'active' : ''}`}
                onClick={() => setIsBasemapModalOpen((prev) => !prev)}
                title="Base Maps & Terrain"
                aria-label="Base Maps & Terrain"
              >
                <IconMap />
              </button>
              <button
                className="map-ctrl-btn"
                onClick={handleFullscreen}
                title="Fullscreen"
                aria-label="Fullscreen"
              >
                <IconFullscreen />
              </button>
              <button
                className="map-ctrl-btn"
                onClick={handleShare}
                title="Share / Export"
                aria-label="Share"
              >
                <IconShare />
              </button>
              <button
                id="btn-map-table"
                data-testid="map-table-btn"
                className={`map-ctrl-btn ${isAttributeTableOpen ? 'active' : ''}`}
                onClick={() => setIsAttributeTableOpen((prev) => !prev)}
                title="Attribute Table"
                aria-label="Attribute Table"
              >
                <IconTable width={16} height={16} />
              </button>
              <div
                className="map-ctrl-divider"
                id="map-undo-redo-divider"
                style={{ display: isEditingSessionActive ? 'block' : 'none' }}
              />
              <button
                id="btn-map-undo"
                data-testid="map-undo-btn"
                className="map-ctrl-btn"
                onClick={() => handleUndo()}
                disabled={!effectiveCanUndo || isBusy}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
                style={{ display: isEditingSessionActive ? 'flex' : 'none' }}
              >
                <IconUndo width={16} height={16} />
              </button>
              <button
                id="btn-map-redo"
                data-testid="map-redo-btn"
                className="map-ctrl-btn"
                onClick={() => handleRedo()}
                disabled={!effectiveCanRedo || isBusy}
                title="Redo (Ctrl+Y)"
                aria-label="Redo"
                style={{ display: isEditingSessionActive ? 'flex' : 'none' }}
              >
                <IconRedo width={16} height={16} />
              </button>
            </div>

            {/* Group 2: zoom + compass */}
            <div className="map-control-group">
              <button
                className="map-ctrl-btn"
                onClick={handleZoomIn}
                title="Zoom in"
                aria-label="Zoom in"
                style={{ fontSize: '18px', fontWeight: 700 }}
              >
                +
              </button>
              <div className="map-ctrl-divider" />
              <button
                className="map-ctrl-btn"
                onClick={handleZoomOut}
                title="Zoom out"
                aria-label="Zoom out"
                style={{ fontSize: '18px', fontWeight: 700 }}
              >
                −
              </button>
              <div className="map-ctrl-divider" />
              <button
                className="map-ctrl-btn"
                onClick={handleNorthReset}
                title="Reset north"
                aria-label="Reset north"
              >
                <div style={{ transform: `rotate(${mapRotation}rad)`, display: 'flex', transition: 'transform 0.1s ease-out' }}>
                  <IconCompass />
                </div>
              </button>
            </div>
          </div>

          <CoordinateBar />

          <MapContainer />

          <UnifiedLegend
            coreVisibility={coreVisibility}
            dynamicLayers={dynamicLayers}
            dynamicVisibility={dynamicVisibility}
          />

          {/* Generic GIS Attribute Table Dock */}
          <AttributeTable
            isOpen={isAttributeTableOpen}
            onClose={() => setIsAttributeTableOpen(false)}
            activeLayer={activeLayer}
            setActiveLayer={setActiveLayer}
            dynamicLayers={dynamicLayers}
            coreVisibility={coreVisibility}
            onSelectFeature={handleSelectFeature}
            onZoomToFeature={zoomToFeature}
            onError={setUiError}
          />
        </main>


      </div>
    </div>
  );
}

export default App;
