import { useState, useEffect, useCallback } from 'react';
import MapContainer from './components/MapContainer';
import FeatureList from './components/FeatureList';
import TechSidebar from './components/TechSidebar';
import BasemapModal from './components/BasemapModal';
import CoordinateBar from './components/CoordinateBar';
import {
  IconLayers,
  IconMap,
  IconFullscreen,
  IconShare,
  IconCompass,
} from './components/Icons';
import { olService, BasemapId } from './lib/openlayers';
import { useMapInteractions } from './hooks/useMapInteractions';

function App() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [mapRotation, setMapRotation] = useState(0);
  const [isBasemapModalOpen, setIsBasemapModalOpen] = useState(false);
  const [currentBasemap, setCurrentBasemap] = useState<BasemapId>('carto_dark');

  useEffect(() => {
    return olService.onBasemapChange((id) => {
      setCurrentBasemap(id);
    });
  }, []);

  const handleSelectBasemap = (id: BasemapId) => {
    olService.setBasemap(id);
    setCurrentBasemap(id);
  };

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
  } = useMapInteractions();

  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  useEffect(() => {
    setIsRightSidebarOpen(!!activeLayer);
  }, [activeLayer]);

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
            mode={mode}
            onDrawPoint={handleDrawPoint}
            onDrawLine={handleDrawLine}
            onDrawPolygon={handleDrawPolygon}
            onMoveStart={handleMoveStart}
            onSuccess={handleFormSuccess}
            onCancel={cancelAction}
            selectedZoneFeature={selectedZoneFeature}
            selectedRoadFeature={selectedRoadFeature}
            isDarkMode={isDarkMode}
            toggleTheme={toggleTheme}
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
            {/* Group 1: view controls & basemap selector */}
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
        </main>

        {/* ── RIGHT SIDEBAR ─────────────────────────────────────────────────── */}
        <aside
          className={`sidebar right-sidebar ${isRightSidebarOpen ? 'open' : 'closed'}`}
          style={{
            marginRight: isRightSidebarOpen ? '0px' : 'calc(-1 * var(--sidebar-width, 310px) - 20px)',
            borderLeft: isRightSidebarOpen ? '1px solid var(--border-light)' : 'none',
            visibility: isRightSidebarOpen ? 'visible' : 'hidden',
          }}
        >
          {activeLayer && (
            <div className="sidebar-section" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div className="sidebar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Features</span>
                <button 
                  onClick={() => setActiveLayer(null)} 
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px', padding: '0 4px', lineHeight: 1 }}
                  title="Close feature list"
                >
                  &times;
                </button>
              </div>
              <div className="sidebar-content" style={{ padding: 0, flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
                <FeatureList 
                  activeLayer={activeLayer} 
                  selectedFeature={selectedFeature}
                  onSelectFeature={handleSelectFeature} 
                />
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export default App;
