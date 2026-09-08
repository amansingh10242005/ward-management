import React, { useState, useEffect } from "react";
import { olService } from "../lib/openlayers";
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
  IconMapPin,
  IconSun,
  IconMoon,
  IconFocus,
  IconZoomLayer,
} from "./Icons";
import { getFeatureTelemetry, calculateGeometryMetric } from "../utils/geoMetrics";
import FeatureForm from "./FeatureForm";
import InlineFeatureList from "./InlineFeatureList";
import { apiClient } from "../lib/api";
import { parseFeatureId } from "../utils/featureUtils";

export type ActiveLayerType = "streetlights" | "roads" | "zones" | "states" | "districts" | null;

interface TechSidebarProps {
  activeLayer: ActiveLayerType;
  setActiveLayer: (layer: ActiveLayerType) => void;
  selectedFeature: any | null;
  onSelectFeature: (feature: any) => void;
  mode: "idle" | "create" | "edit" | "move" | "vertex_edit";
  onDrawPoint: () => void;
  onDrawLine: () => void;
  onDrawPolygon: () => void;
  onMoveStart: () => void;
  onSuccess: (action?: "create" | "update" | "delete", featureId?: string) => void;
  onCancel: () => void;
  selectedZoneFeature?: any;
  selectedRoadFeature?: any;
  isDarkMode?: boolean;
  toggleTheme?: () => void;

  // Spatial Navigation Props
  onZoomToFeature?: () => void;
  onZoomToLayer?: (layerName: string) => void;

  // Vertex Edit Props
  onStartVertexEdit?: () => void;
  onFinishVertexEdit?: () => void;
  onCancelVertexEdit?: () => void;
  isSavingVertex?: boolean;
  vertexEditError?: string | null;
  currentVertexGeometry?: any;
  onError?: (error: string) => void;
}

export default function TechSidebar({
  activeLayer,
  setActiveLayer,
  selectedFeature,
  onSelectFeature,
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
  onZoomToFeature,
  onZoomToLayer,
  onStartVertexEdit,
  onFinishVertexEdit,
  onCancelVertexEdit,
  isSavingVertex = false,
  vertexEditError = null,
  currentVertexGeometry = null,
  onError,
}: TechSidebarProps) {
  const [layers, setLayers] = useState({
    streetlights: true,
    roads: true,
    zones: true,
    states: true,
    districts: true,
  });

  const [isEditingForm, setIsEditingForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setIsEditingForm(false);
    setConfirmDelete(false);
    setDeleteError(null);
  }, [selectedFeature]);

  useEffect(() => {
    if (mode === "create") {
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
      setActiveLayer(null);
    } else {
      setActiveLayer(layerName);
    }
  };

  const getLayerMeta = (layer: ActiveLayerType) => {
    switch (layer) {
      case "roads":        return { title: "ROADS",        badge: "LineString" };
      case "streetlights": return { title: "STREETLIGHTS", badge: "Point"      };
      case "zones":        return { title: "ZONES",         badge: "Polygon"    };
      case "districts":    return { title: "DISTRICTS",     badge: "Polygon"    };
      case "states":       return { title: "STATES",        badge: "Polygon"    };
      default:             return { title: "INFRASTRUCTURE",badge: "HUD Active" };
    }
  };

  const { title: headerTitle, badge: headerBadge } = getLayerMeta(activeLayer);

  const handleCreateClick = () => {
    if (activeLayer === "streetlights") {
      onDrawPoint();
    } else if (activeLayer === "zones") {
      onDrawPolygon();
    } else {
      onDrawLine();
    }
  };


  const telemetry = selectedFeature
    ? getFeatureTelemetry(selectedFeature, activeLayer || "roads")
    : null;

  const handleStartVertexEdit = () => {
    if (onStartVertexEdit) {
      onStartVertexEdit();
    }
  };

  const handleDeleteClick = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setDeleteError(null);
      return;
    }
    if (!selectedFeature || !activeLayer) return;
    try {
      setDeleteError(null);
      const rawId = parseFeatureId(selectedFeature.id);
      if (activeLayer === 'streetlights') {
        await apiClient.streetlights.delete(rawId as string);
      } else if (activeLayer === 'roads') {
        await apiClient.roads.delete(rawId as string);
      } else if (activeLayer === 'zones') {
        await apiClient.zones.delete(rawId as string);
      } else if (activeLayer === 'states') {
        await apiClient.states.delete(rawId as string);
      } else if (activeLayer === 'districts') {
        await apiClient.districts.delete(rawId as string);
      }
      onSuccess('delete', selectedFeature.id);
    } catch (err: any) {
      console.error('Failed to delete feature:', err);
      const msg = err.message || 'Failed to delete feature.';
      setDeleteError(msg);
      if (onError) {
        onError(msg);
      }
    } finally {
      setConfirmDelete(false);
    }
  };

  const activeInfraCount = [layers.roads, layers.streetlights, layers.zones].filter(Boolean).length;
  const activeAdminCount = [layers.districts, layers.states].filter(Boolean).length;

  // Drill-down: layer active, no feature selected, not editing
  const isDrillDown = !!activeLayer && !selectedFeature && !isEditingForm && mode === "idle";

  return (
    <div className="hud-sidebar-container">
      {/* BRAND HEADER */}
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
              title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
              aria-label="Toggle theme"
            >
              {isDarkMode ? <IconSun width={15} height={15} /> : <IconMoon width={15} height={15} />}
            </button>
          )}
        </div>
      </div>

      <div className={`hud-scroll-body${isDrillDown ? ' hud-scroll-body--drilldown' : ''}`}>

        {/* DEDICATED VERTEX EDIT CARD */}
        {selectedFeature && mode === "vertex_edit" && (
          <div className="hud-feature-card hud-vertex-edit-card">
            <div className="hud-card-topbar">
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button
                  type="button"
                  className="hud-nav-btn"
                  onClick={onCancelVertexEdit}
                  title="Cancel vertex editing"
                  aria-label="Back"
                  style={{ width: "22px", height: "22px" }}
                >
                  <IconChevronLeft width={15} height={15} />
                </button>
                <span className="hud-card-layer-name">EDIT GEOMETRY</span>
              </div>
              <span className="hud-geom-badge">{headerBadge}</span>
            </div>

            <div className="hud-card-header">
              <span className="hud-card-badge-label">VERTEX EDIT MODE</span>
              <span className="hud-fid-pill">{telemetry?.fid}</span>
            </div>

            <div className="hud-feature-title" title={telemetry?.title}>
              {telemetry?.title}
            </div>

            {/* Live Metric Bar */}
            {(() => {
              const metric = calculateGeometryMetric(currentVertexGeometry || selectedFeature?.geometry);
              if (!metric) return null;
              return (
                <div className="hud-vertex-metric-bar">
                  <span className="hud-metric-label">{metric.label}:</span>
                  <span className="hud-metric-value">{metric.value}</span>
                </div>
              );
            })()}

            {/* Instructions */}
            <div className="hud-vertex-instructions">
              {headerBadge === "Point" || activeLayer === "streetlights" ? (
                <>
                  <div className="hud-instruction-item">• Drag marker to reposition asset.</div>
                  <div className="hud-instruction-item">• Release at desired coordinates.</div>
                </>
              ) : headerBadge === "Polygon" || activeLayer === "zones" || activeLayer === "states" || activeLayer === "districts" ? (
                <>
                  <div className="hud-instruction-item">• Drag vertices to reshape boundary.</div>
                  <div className="hud-instruction-item">• Click edge segment to insert vertex.</div>
                  <div className="hud-instruction-item">• Click vertex and press Delete to remove.</div>
                </>
              ) : (
                <>
                  <div className="hud-instruction-item">• Drag vertices to reshape geometry.</div>
                  <div className="hud-instruction-item">• Click line segment to add vertex.</div>
                  <div className="hud-instruction-item">• Click vertex and press Delete to remove.</div>
                </>
              )}
              <div className="hud-vertex-tip">Tip: Press Esc to cancel, Del to remove vertex.</div>
            </div>

            {/* Error Message */}
            {vertexEditError && (
              <div className="hud-vertex-error-box">
                <div className="hud-vertex-error-msg">{vertexEditError}</div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="hud-vertex-actions">
              <button
                type="button"
                className="hud-vertex-btn hud-finish-btn"
                onClick={onFinishVertexEdit}
                disabled={isSavingVertex}
              >
                {isSavingVertex ? "Saving geometry…" : "✓ Finish Editing"}
              </button>
              <button
                type="button"
                className="hud-vertex-btn hud-cancel-btn"
                onClick={onCancelVertexEdit}
                disabled={isSavingVertex}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ACTIVE FEATURE CARD */}
        {selectedFeature && !isEditingForm && mode !== "move" && mode !== "vertex_edit" && (
          <div className="hud-feature-card">
            <div className="hud-card-topbar">
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button
                  type="button"
                  className="hud-nav-btn"
                  onClick={() => { if (selectedFeature) onCancel(); else setActiveLayer(null); }}
                  title="Deselect feature"
                  aria-label="Back"
                  style={{ width: "22px", height: "22px" }}
                >
                  <IconChevronLeft width={15} height={15} />
                </button>
                <span className="hud-card-layer-name">{headerTitle}</span>
              </div>
              <span className="hud-geom-badge">{headerBadge}</span>
            </div>

            <div className="hud-card-header">
              <span className="hud-card-badge-label">ACTIVE FEATURE</span>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {onZoomToFeature && (
                  <button
                    type="button"
                    className="hud-nav-btn"
                    onClick={onZoomToFeature}
                    title="Zoom to feature"
                    aria-label="Zoom to feature"
                    style={{ width: "22px", height: "22px" }}
                  >
                    <IconFocus width={13} height={13} />
                  </button>
                )}
                <span className="hud-fid-pill">{telemetry?.fid}</span>
              </div>
            </div>

            <div className="hud-feature-title" title={telemetry?.title}>
              {telemetry?.title}
            </div>

            <div className="hud-telemetry-grid">
              {telemetry?.cells.map((cell, idx) => (
                <div key={idx} className="hud-telemetry-cell">
                  <div className="hud-cell-label">{cell.label}</div>
                  <div className={`hud-cell-value ${cell.isTeal ? "teal-highlight" : ""}`}>
                    {cell.value}
                  </div>
                </div>
              ))}
            </div>

            <div className="hud-actions-grid">
              <button type="button" className="hud-action-btn" onClick={() => setIsEditingForm(true)}>
                <IconEdit width={14} height={14} />
                <span>Edit Feature</span>
              </button>
              <button type="button" className="hud-action-btn" onClick={handleStartVertexEdit}>
                <IconVertexEdit width={15} height={15} />
                <span>Vertex Edit</span>
              </button>
              <button type="button" className="hud-action-btn" onClick={onMoveStart}>
                <IconMove width={14} height={14} />
                <span>Move Feature</span>
              </button>
              <button type="button" className={`hud-action-btn delete-btn ${confirmDelete ? "confirm" : ""}`} onClick={handleDeleteClick}>
                <IconTrash width={14} height={14} />
                <span>{confirmDelete ? "Confirm Del" : "Delete"}</span>
              </button>
            </div>

            {deleteError && (
              <div className="hud-vertex-error-box" style={{ marginTop: '10px' }}>
                <div className="hud-vertex-error-msg">{deleteError}</div>
              </div>
            )}


          </div>
        )}

        {/* EDIT / CREATE / MOVE FORM */}
        {(isEditingForm || mode === "create" || mode === "move") && (
          <div className="hud-feature-card hud-form-card">
            <div className="hud-card-header" style={{ marginBottom: "12px" }}>
              <span className="hud-card-badge-label">
                {mode === "create" ? "NEW ASSET" : mode === "move" ? "REPOSITION" : "MODIFY ATTRIBUTES"}
              </span>
              <button
                type="button"
                onClick={() => { setIsEditingForm(false); if (mode === "create" || mode === "move") onCancel(); }}
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
              onSuccess={(action, id) => { setIsEditingForm(false); onSuccess(action, id); }}
              onCancel={() => { setIsEditingForm(false); onCancel(); }}
              onMoveStart={onMoveStart}
              selectedZoneFeature={selectedZoneFeature}
              selectedRoadFeature={selectedRoadFeature}
            />
          </div>
        )}

        {/* LAYER DRILL-DOWN PANEL */}
        {isDrillDown && (
          <div className="hud-drilldown-panel">
            <div className="hud-drilldown-topbar">
              <div className="hud-drilldown-left">
                <button
                  type="button"
                  className="hud-nav-btn"
                  onClick={() => setActiveLayer(null)}
                  title="Back to layers"
                  aria-label="Back"
                >
                  <IconChevronLeft width={15} height={15} />
                </button>
                <span className="hud-drilldown-title">{headerTitle}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="hud-geom-badge">{headerBadge}</span>
                {onZoomToLayer && (
                  <button
                    type="button"
                    className="hud-eye-btn"
                    onClick={() => onZoomToLayer(activeLayer!)}
                    title={`Zoom to ${headerTitle} extent`}
                    aria-label={`Zoom to ${headerTitle} extent`}
                    style={{ width: "26px", height: "26px" }}
                  >
                    <IconZoomLayer width={14} height={14} />
                  </button>
                )}
                <button
                  type="button"
                  className={`hud-eye-btn ${!layers[activeLayer!] ? "hidden" : ""}`}
                  onClick={(e) => toggleLayer(e, activeLayer!)}
                  title={layers[activeLayer!] ? `Hide ${headerTitle}` : `Show ${headerTitle}`}
                  style={{ width: "26px", height: "26px" }}
                >
                  {layers[activeLayer!] ? <IconEye width={15} height={15} /> : <IconEyeOff width={15} height={15} />}
                </button>
              </div>
            </div>

            <InlineFeatureList
              activeLayer={activeLayer!}
              selectedFeature={selectedFeature}
              onSelectFeature={onSelectFeature}
              onCreateClick={["streetlights", "roads", "zones"].includes(activeLayer!) ? handleCreateClick : undefined}
            />
          </div>
        )}

        {/* LAYER SECTIONS (only shown when no layer is active) */}
        {!activeLayer && (
          <>
            {/* INFRASTRUCTURE */}
            <div className="hud-group-section">
              <div className="hud-group-header">
                <span className="hud-group-title">INFRASTRUCTURE</span>
                <span className="hud-group-status">{activeInfraCount} Active</span>
              </div>
              <div className="hud-layer-list">
                <div className="hud-layer-row" onClick={() => handleSelectLayer("roads")}>
                  <div className="hud-grip" title="Drag to reorder"><IconGrip /></div>
                  <div className="hud-layer-icon road-icon"><IconLine width={15} height={15} /></div>
                  <div className="hud-layer-name">Roads</div>
                  <div className="hud-row-badge linestring-badge">LineString</div>
                  <button type="button" className={`hud-eye-btn ${!layers.roads ? "hidden" : ""}`} onClick={(e) => toggleLayer(e, "roads")} title={layers.roads ? "Hide Roads" : "Show Roads"}>
                    {layers.roads ? <IconEye width={15} height={15} /> : <IconEyeOff width={15} height={15} />}
                  </button>
                </div>

                <div className="hud-layer-row" onClick={() => handleSelectLayer("streetlights")}>
                  <div className="hud-grip" title="Drag to reorder"><IconGrip /></div>
                  <div className="hud-layer-icon streetlight-icon"><IconRing width={15} height={15} /></div>
                  <div className="hud-layer-name">Streetlights</div>
                  <div className="hud-row-badge point-badge">Point</div>
                  <button type="button" className={`hud-eye-btn ${!layers.streetlights ? "hidden" : ""}`} onClick={(e) => toggleLayer(e, "streetlights")} title={layers.streetlights ? "Hide Streetlights" : "Show Streetlights"}>
                    {layers.streetlights ? <IconEye width={15} height={15} /> : <IconEyeOff width={15} height={15} />}
                  </button>
                </div>

                <div className="hud-layer-row" onClick={() => handleSelectLayer("zones")}>
                  <div className="hud-grip" title="Drag to reorder"><IconGrip /></div>
                  <div className="hud-layer-icon zone-icon"><IconNetwork width={15} height={15} /></div>
                  <div className="hud-layer-name">Zones</div>
                  <div className="hud-row-badge polygon-badge">Polygon</div>
                  <button type="button" className={`hud-eye-btn ${!layers.zones ? "hidden" : ""}`} onClick={(e) => toggleLayer(e, "zones")} title={layers.zones ? "Hide Zones" : "Show Zones"}>
                    {layers.zones ? <IconEye width={15} height={15} /> : <IconEyeOff width={15} height={15} />}
                  </button>
                </div>
              </div>
            </div>

            {/* ADMINISTRATIVE */}
            <div className="hud-group-section">
              <div className="hud-group-header">
                <span className="hud-group-title">ADMINISTRATIVE</span>
                <span className="hud-group-status">{activeAdminCount > 0 ? `${activeAdminCount} Active` : "Hidden"}</span>
              </div>
              <div className="hud-layer-list">
                <div className="hud-layer-row" onClick={() => handleSelectLayer("districts")}>
                  <div className="hud-grip" title="Drag to reorder"><IconGrip /></div>
                  <div className="hud-layer-icon admin-icon"><IconSquare width={15} height={15} /></div>
                  <div className="hud-layer-name">Districts</div>
                  <div className="hud-row-badge polygon-badge">Polygon</div>
                  <button type="button" className={`hud-eye-btn ${!layers.districts ? "hidden" : ""}`} onClick={(e) => toggleLayer(e, "districts")} title={layers.districts ? "Hide Districts" : "Show Districts"}>
                    {layers.districts ? <IconEye width={15} height={15} /> : <IconEyeOff width={15} height={15} />}
                  </button>
                </div>

                <div className="hud-layer-row" onClick={() => handleSelectLayer("states")}>
                  <div className="hud-grip" title="Drag to reorder"><IconGrip /></div>
                  <div className="hud-layer-icon admin-icon"><IconHexagon width={15} height={15} /></div>
                  <div className="hud-layer-name">States</div>
                  <div className="hud-row-badge polygon-badge">Polygon</div>
                  <button type="button" className={`hud-eye-btn ${!layers.states ? "hidden" : ""}`} onClick={(e) => toggleLayer(e, "states")} title={layers.states ? "Hide States" : "Show States"}>
                    {layers.states ? <IconEye width={15} height={15} /> : <IconEyeOff width={15} height={15} />}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
