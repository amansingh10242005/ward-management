import React, { useState, useEffect } from 'react';
import { olService } from '../lib/openlayers';
import {
  IconChevronLeft,
  IconGrip,
  IconLine,
  IconRing,
  IconNetwork,
  IconSquare,
  IconHexagon,
  IconEye,
  IconEyeOff,
  IconEdit,
  IconVertexEdit,
  IconMove,
  IconTrash,
  IconCirclePlus,
  IconMapPin,
  IconSun,
  IconMoon,
} from './Icons';
import { getFeatureTelemetry } from '../utils/geoMetrics';
import FeatureForm from './FeatureForm';

export type ActiveLayerType = 'streetlights' | 'roads' | 'zones' | 'states' | 'districts' | null;

interface TechSidebarProps {
  activeLayer: ActiveLayerType;
  setActiveLayer: (layer: ActiveLayerType) => void;
  selectedFeature: any | null;
  mode: 'idle' | 'create' | 'edit' | 'move';
  onDrawPoint: () => void;
  onDrawLine: () => void;
  onDrawPolygon: () => void;
  onMoveStart: () => void;
  onSuccess: (action?: 'create' | 'update' | 'delete', featureId?: string) => void;
  onCancel: () => void;
  selectedZoneFeature?: any;
  selectedRoadFeature?: any;
  isDarkMode?: boolean;
  toggleTheme?: () => void;
}

export default function TechSidebar({
  activeLayer,
  setActiveLayer,
  selectedFeature,
  mode,
  onDrawPoint,
  onDrawLine,
  onDrawPolygon,
  onMoveStart,
  onSuccess,
  onCancel,
  selectedZoneFeature,
  selectedRoadFeature,
  isDarkMode,
  toggleTheme,
}: TechSidebarProps) {
  // Track layer visibility
  const [layers, setLayers] = useState({
    streetlights: true,
    roads: true,
    zones: true,
    states: false,
    districts: false,
  });

  // State for toggling inline property editing form
  const [isEditingForm, setIsEditingForm] = useState(false);
  const [isVertexEditActive, setIsVertexEditActive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset states when selected feature changes
  useEffect(() => {
    setIsEditingForm(false);
    setIsVertexEditActive(false);
    setConfirmDelete(false);
  }, [selectedFeature]);

  // When mode is create, show form
  useEffect(() => {
    if (mode === 'create') {
      setIsEditingForm(true);
    }
  }, [mode]);

  const toggleLayer = (e: React.MouseEvent, layerName: keyof typeof layers) => {
    e.stopPropagation();
    const isVisible = !layers[layerName];
    setLayers((prev) => ({ ...prev, [layerName]: isVisible }));
    olService.toggleLayer(layerName, isVisible);
  };

  const handleSelectLayer = (layerName: ActiveLayerType) => {
    if (activeLayer === layerName) {
      // Toggle off or keep selected
      setActiveLayer(null);
    } else {
      setActiveLayer(layerName);
    }
  };

  // Header display info based on active layer
  const getHeaderInfo = () => {
    switch (activeLayer) {
      case 'roads':
        return { title: 'ROADS', badge: 'LineString' };
      case 'streetlights':
        return { title: 'STREETLIGHTS', badge: 'Point' };
      case 'zones':
        return { title: 'ZONES', badge: 'Polygon' };
      case 'districts':
        return { title: 'DISTRICTS', badge: 'Polygon' };
      case 'states':
        return { title: 'STATES', badge: 'Polygon' };
      default:
        return { title: 'INFRASTRUCTURE', badge: 'HUD Active' };
    }
  };

  const { title: headerTitle, badge: headerBadge } = getHeaderInfo();

  // Handle Primary CTA click
  const handleCreateClick = () => {
    if (activeLayer === 'streetlights') {
      onDrawPoint();
    } else if (activeLayer === 'zones') {
      onDrawPolygon();
    } else {
      // Default to Roads
      onDrawLine();
    }
  };

  const getCreateBtnLabel = () => {
    switch (activeLayer) {
      case 'streetlights':
        return 'Create Streetlight';
      case 'zones':
        return 'Create Zone';
      case 'roads':
      default:
        return 'Create Road';
    }
  };

  // Telemetry info for currently selected feature
  const telemetry = selectedFeature
    ? getFeatureTelemetry(selectedFeature, activeLayer || 'roads')
    : null;

  // Toggle Vertex Edit
  const handleToggleVertexEdit = () => {
    setIsVertexEditActive((prev) => !prev);
    // In OpenLayers, modify vertex mode is active when in edit mode
    if (selectedFeature && activeLayer) {
      olService.centerOnFeature(activeLayer, selectedFeature.id);
    }
  };

  // Handle Delete
  const handleDeleteClick = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    // Perform delete through FeatureForm onSuccess or custom deletion
    setIsEditingForm(true);
  };

  // Count active infrastructure layers
  const activeInfraCount = [layers.roads, layers.streetlights, layers.zones].filter(Boolean).length;
  const adminHidden = !layers.districts && !layers.states;

  return (
    <div className="hud-sidebar-container">
      {/* ── SIDEBAR BRAND HEADER ───────────────────────────────────────── */}
      <div className="hud-brand-header">
        <div className="hud-brand-left">
          <div className="header-brand-icon">
            <IconMapPin />
          </div>
          <div className="hud-brand-text">
            <h1 className="hud-brand-title">Ward Infrastructure Manager</h1>
            <div className="hud-brand-subtitle">Infrastructure &amp; Asset Management</div>
          </div>
        </div>
        <div className="hud-brand-actions">
          {toggleTheme && (
            <button
              className="hud-theme-toggle-btn"
              onClick={toggleTheme}
              title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle theme"
            >
              {isDarkMode ? <IconSun width={15} height={15} /> : <IconMoon width={15} height={15} />}
            </button>
          )}
        </div>
      </div>

      <div className="hud-scroll-body">
        {/* ── ACTIVE FEATURE CARD OR EDIT FORM ─────────────────────────── */}
        {selectedFeature && !isEditingForm && mode !== 'move' && (
          <div className="hud-feature-card">
            {/* Feature Subheader: < ROADS [LineString] */}
            <div className="hud-card-topbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  className="hud-nav-btn"
                  onClick={() => {
                    if (selectedFeature) onCancel();
                    else setActiveLayer(null);
                  }}
                  title="Deselect feature"
                  aria-label="Back"
                  style={{ width: '22px', height: '22px' }}
                >
                  <IconChevronLeft width={15} height={15} />
                </button>
                <span className="hud-card-layer-name">{headerTitle}</span>
              </div>
              <span className="hud-geom-badge">{headerBadge}</span>
            </div>

            {/* Card Header */}
            <div className="hud-card-header">
              <span className="hud-card-badge-label">ACTIVE FEATURE</span>
              <span className="hud-fid-pill">{telemetry?.fid}</span>
            </div>

            {/* Feature Name */}
            <div className="hud-feature-title" title={telemetry?.title}>
              {telemetry?.title}
            </div>

            {/* 2x2 Telemetry Grid */}
            <div className="hud-telemetry-grid">
              {telemetry?.cells.map((cell, idx) => (
                <div key={idx} className="hud-telemetry-cell">
                  <div className="hud-cell-label">{cell.label}</div>
                  <div className={`hud-cell-value ${cell.isTeal ? 'teal-highlight' : ''}`}>
                    {cell.value}
                  </div>
                </div>
              ))}
            </div>

            {/* 2x2 Action Buttons */}
            <div className="hud-actions-grid">
              <button
                type="button"
                className="hud-action-btn"
                onClick={() => setIsEditingForm(true)}
              >
                <IconEdit width={14} height={14} />
                <span>Edit Feature</span>
              </button>

              <button
                type="button"
                className={`hud-action-btn ${isVertexEditActive ? 'active-vertex' : ''}`}
                onClick={handleToggleVertexEdit}
              >
                <IconVertexEdit width={15} height={15} />
                <span>Vertex Edit</span>
              </button>

              <button
                type="button"
                className="hud-action-btn"
                onClick={onMoveStart}
              >
                <IconMove width={14} height={14} />
                <span>Move Feature</span>
              </button>

              <button
                type="button"
                className={`hud-action-btn delete-btn ${confirmDelete ? 'confirm' : ''}`}
                onClick={handleDeleteClick}
              >
                <IconTrash width={14} height={14} />
                <span>{confirmDelete ? 'Confirm Del' : 'Delete'}</span>
              </button>
            </div>

            {/* Primary CTA Button for creating next asset */}
            <button
              type="button"
              className="hud-primary-cta-btn"
              style={{ marginTop: '10px' }}
              onClick={handleCreateClick}
            >
              <IconCirclePlus width={18} height={18} />
              <span>+ {getCreateBtnLabel()}</span>
            </button>
          </div>
        )}

        {/* ── EDIT / CREATE / MOVE FORM ─────────────────────────────────── */}
        {(isEditingForm || mode === 'create' || mode === 'move') && (
          <div className="hud-feature-card hud-form-card">
            <div className="hud-card-header" style={{ marginBottom: '12px' }}>
              <span className="hud-card-badge-label">
                {mode === 'create' ? 'NEW ASSET' : mode === 'move' ? 'REPOSITION' : 'MODIFY ATTRIBUTES'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsEditingForm(false);
                  if (mode === 'create' || mode === 'move') onCancel();
                }}
                className="hud-cancel-x"
                title="Cancel"
              >
                &times;
              </button>
            </div>

            <FeatureForm
              feature={selectedFeature}
              mode={mode}
              activeLayer={activeLayer}
              onSuccess={(action, id) => {
                setIsEditingForm(false);
                onSuccess(action, id);
              }}
              onCancel={() => {
                setIsEditingForm(false);
                onCancel();
              }}
              onMoveStart={onMoveStart}
              selectedZoneFeature={selectedZoneFeature}
              selectedRoadFeature={selectedRoadFeature}
            />
          </div>
        )}

        {/* ── SECTION: INFRASTRUCTURE ────────────────────────────────────── */}
        <div className="hud-group-section">
          <div className="hud-group-header">
            <span className="hud-group-title">INFRASTRUCTURE</span>
            <span className="hud-group-status">{activeInfraCount} Active</span>
          </div>

          <div className="hud-layer-list">
            {/* Roads */}
            <div
              className={`hud-layer-row ${activeLayer === 'roads' ? 'selected' : ''}`}
              onClick={() => handleSelectLayer('roads')}
            >
              <div className="hud-grip" title="Drag to reorder">
                <IconGrip />
              </div>
              <div className="hud-layer-icon road-icon">
                <IconLine width={15} height={15} />
              </div>
              <div className="hud-layer-name">Roads</div>
              <div className="hud-row-badge linestring-badge">LineString</div>
              <button
                type="button"
                className={`hud-eye-btn ${!layers.roads ? 'hidden' : ''}`}
                onClick={(e) => toggleLayer(e, 'roads')}
                title={layers.roads ? 'Hide Roads' : 'Show Roads'}
              >
                {layers.roads ? <IconEye width={15} height={15} /> : <IconEyeOff width={15} height={15} />}
              </button>
            </div>

            {/* Streetlights */}
            <div
              className={`hud-layer-row ${activeLayer === 'streetlights' ? 'selected' : ''}`}
              onClick={() => handleSelectLayer('streetlights')}
            >
              <div className="hud-grip" title="Drag to reorder">
                <IconGrip />
              </div>
              <div className="hud-layer-icon streetlight-icon">
                <IconRing width={15} height={15} />
              </div>
              <div className="hud-layer-name">Streetlights</div>
              <div className="hud-row-badge point-badge">Point</div>
              <button
                type="button"
                className={`hud-eye-btn ${!layers.streetlights ? 'hidden' : ''}`}
                onClick={(e) => toggleLayer(e, 'streetlights')}
                title={layers.streetlights ? 'Hide Streetlights' : 'Show Streetlights'}
              >
                {layers.streetlights ? <IconEye width={15} height={15} /> : <IconEyeOff width={15} height={15} />}
              </button>
            </div>

            {/* Zones */}
            <div
              className={`hud-layer-row ${activeLayer === 'zones' ? 'selected' : ''}`}
              onClick={() => handleSelectLayer('zones')}
            >
              <div className="hud-grip" title="Drag to reorder">
                <IconGrip />
              </div>
              <div className="hud-layer-icon zone-icon">
                <IconNetwork width={15} height={15} />
              </div>
              <div className="hud-layer-name">Zones</div>
              <div className="hud-row-badge polygon-badge">Polygon</div>
              <button
                type="button"
                className={`hud-eye-btn ${!layers.zones ? 'hidden' : ''}`}
                onClick={(e) => toggleLayer(e, 'zones')}
                title={layers.zones ? 'Hide Zones' : 'Show Zones'}
              >
                {layers.zones ? <IconEye width={15} height={15} /> : <IconEyeOff width={15} height={15} />}
              </button>
            </div>
          </div>
        </div>

        {/* ── SECTION: ADMINISTRATIVE ──────────────────────────────────── */}
        <div className="hud-group-section">
          <div className="hud-group-header">
            <span className="hud-group-title">ADMINISTRATIVE</span>
            <span className="hud-group-status">{adminHidden ? 'Hidden' : 'Visible'}</span>
          </div>

          <div className="hud-layer-list">
            {/* Districts */}
            <div
              className={`hud-layer-row ${activeLayer === 'districts' ? 'selected' : ''}`}
              onClick={() => handleSelectLayer('districts')}
            >
              <div className="hud-grip" title="Drag to reorder">
                <IconGrip />
              </div>
              <div className="hud-layer-icon admin-icon">
                <IconSquare width={15} height={15} />
              </div>
              <div className="hud-layer-name">Districts</div>
              <div className="hud-row-badge polygon-badge">Polygon</div>
              <button
                type="button"
                className={`hud-eye-btn ${!layers.districts ? 'hidden' : ''}`}
                onClick={(e) => toggleLayer(e, 'districts')}
                title={layers.districts ? 'Hide Districts' : 'Show Districts'}
              >
                {layers.districts ? <IconEye width={15} height={15} /> : <IconEyeOff width={15} height={15} />}
              </button>
            </div>

            {/* States */}
            <div
              className={`hud-layer-row ${activeLayer === 'states' ? 'selected' : ''}`}
              onClick={() => handleSelectLayer('states')}
            >
              <div className="hud-grip" title="Drag to reorder">
                <IconGrip />
              </div>
              <div className="hud-layer-icon admin-icon">
                <IconHexagon width={15} height={15} />
              </div>
              <div className="hud-layer-name">States</div>
              <div className="hud-row-badge polygon-badge">Polygon</div>
              <button
                type="button"
                className={`hud-eye-btn ${!layers.states ? 'hidden' : ''}`}
                onClick={(e) => toggleLayer(e, 'states')}
                title={layers.states ? 'Hide States' : 'Show States'}
              >
                {layers.states ? <IconEye width={15} height={15} /> : <IconEyeOff width={15} height={15} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
