import React, { useState, useMemo } from 'react';
import { 
  IconEdit, 
  IconVertexEdit, 
  IconMove, 
  IconTrash, 
  IconChevronLeft, 
  IconFocus 
} from './Icons';
import { calculateGeometryMetric } from '../utils/geoMetrics';

export interface FeatureInfoProps {
  feature: any | null;
  layerName: string | null;
  dynamicLayers?: any[];
  onZoomToFeature?: () => void;
  onEditFeature?: () => void;
  onMoveFeature?: () => void;
  onVertexEditFeature?: () => void;
  onDeleteFeature?: () => void;
  onClose?: () => void;
  confirmDelete?: boolean;
  isDeleting?: boolean;
}

export const FeatureInfo: React.FC<FeatureInfoProps> = ({
  feature,
  layerName,
  dynamicLayers = [],
  onZoomToFeature,
  onEditFeature,
  onMoveFeature,
  onVertexEditFeature,
  onDeleteFeature,
  onClose,
  confirmDelete = false,
  isDeleting = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 1. Layer Metadata Resolution
  const layerMeta = useMemo(() => {
    if (!layerName) return { title: 'FEATURE', workspace: 'ward', isCore: false };

    const coreNames = ['states', 'districts', 'zones', 'roads', 'streetlights'];
    const isCore = coreNames.includes(layerName);

    if (isCore) {
      const titles: Record<string, string> = {
        states: 'STATES',
        districts: 'DISTRICTS',
        zones: 'ZONES',
        roads: 'ROADS',
        streetlights: 'STREETLIGHTS',
      };
      return {
        title: titles[layerName] || layerName.toUpperCase(),
        workspace: 'PostGIS / WFS',
        isCore: true,
      };
    }

    // Look up in dynamic layers
    const dynMatch = dynamicLayers.find((l) => l.name === layerName);
    return {
      title: dynMatch?.title || layerName,
      workspace: dynMatch?.workspace || 'ward',
      isCore: false,
    };
  }, [layerName, dynamicLayers]);

  // 2. Geometry Information
  const geometryInfo = useMemo(() => {
    if (!feature?.geometry) {
      return { type: 'No Geometry', metric: null, coordsSummary: null };
    }
    const type = feature.geometry.type || 'Unknown';
    const metric = calculateGeometryMetric(feature.geometry);

    let coordsSummary: string | null = null;
    if (type === 'Point' && Array.isArray(feature.geometry.coordinates)) {
      const [lon, lat] = feature.geometry.coordinates;
      if (typeof lon === 'number' && typeof lat === 'number') {
        coordsSummary = `${lat.toFixed(5)}°N, ${lon.toFixed(5)}°E`;
      }
    }

    return { type, metric, coordsSummary };
  }, [feature]);

  // 3. Properties Extraction & Filtering
  const attributeEntries = useMemo(() => {
    if (!feature?.properties || typeof feature.properties !== 'object') {
      return [];
    }

    const rawProps = feature.properties;
    const isGeometryKey = (key: string, val: any) => {
      const lower = key.toLowerCase();
      if (['geom', 'geometry', 'the_geom', 'bbox', 'boundedby'].includes(lower)) return true;
      if (val && typeof val === 'object' && val.type && (val.coordinates || val.geometries)) return true;
      return false;
    };

    const entries: Array<{ key: string; value: any }> = [];
    for (const [k, v] of Object.entries(rawProps)) {
      if (!isGeometryKey(k, v)) {
        entries.push({ key: k, value: v });
      }
    }

    // Sort: Priority fields first (name, identifier, id), then alphabetical
    const priorityKeys = ['name', 'title', 'identifier', 'id', 'fid', 'state', 'district'];
    entries.sort((a, b) => {
      const aLower = a.key.toLowerCase();
      const bLower = b.key.toLowerCase();
      const aPrio = priorityKeys.indexOf(aLower);
      const bPrio = priorityKeys.indexOf(bLower);

      if (aPrio !== -1 && bPrio !== -1) return aPrio - bPrio;
      if (aPrio !== -1) return -1;
      if (bPrio !== -1) return 1;
      return a.key.localeCompare(b.key);
    });

    return entries;
  }, [feature]);

  // 4. Search filter
  const filteredEntries = useMemo(() => {
    if (!searchQuery.trim()) return attributeEntries;
    const q = searchQuery.toLowerCase().trim();
    return attributeEntries.filter(
      (entry) =>
        entry.key.toLowerCase().includes(q) ||
        (entry.value !== null && entry.value !== undefined && String(entry.value).toLowerCase().includes(q))
    );
  }, [attributeEntries, searchQuery]);

  // Copy attribute value
  const handleCopy = (key: string, val: any) => {
    const text = val === null || val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1400);
    });
  };

  if (!feature) {
    return (
      <div className="hud-feature-info-empty" data-testid="feature-info-empty">
        <div className="hud-info-empty-icon">ℹ</div>
        <div className="hud-info-empty-title">No Feature Selected</div>
        <div className="hud-info-empty-desc">Click any feature on the map to inspect its attributes.</div>
      </div>
    );
  }

  // Determine display title
  const displayTitle =
    feature.properties?.name ||
    feature.properties?.title ||
    feature.properties?.identifier ||
    feature.properties?.STATE ||
    feature.properties?.District ||
    `Feature ${feature.id || ''}`;

  return (
    <div className="hud-feature-info" data-testid="feature-info-panel">
      {/* Top Bar */}
      <div className="hud-card-topbar" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
          {onClose && (
            <button
              type="button"
              className="hud-nav-btn"
              onClick={onClose}
              title="Deselect feature"
              aria-label="Back"
              style={{ width: '22px', height: '22px' }}
            >
              <IconChevronLeft width={15} height={15} />
            </button>
          )}
          <span className="hud-card-layer-name">{layerMeta.title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', paddingLeft: onClose ? '28px' : '0' }}>
          <span className="hud-workspace-pill" title={`Source: ${layerMeta.workspace}`}>
            {layerMeta.workspace}
          </span>
          <span className="hud-geom-badge" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '110px' }} title={geometryInfo.type}>{geometryInfo.type}</span>
        </div>
      </div>

      {/* Feature Identity Header */}
      <div className="hud-card-header">
        <span className="hud-card-badge-label">FEATURE INFO</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {onZoomToFeature && (
            <button
              type="button"
              className="hud-nav-btn"
              onClick={onZoomToFeature}
              title="Zoom to feature"
              aria-label="Zoom to feature"
              style={{ width: '22px', height: '22px' }}
            >
              <IconFocus width={13} height={13} />
            </button>
          )}
          <span className="hud-fid-pill" title={`Feature ID: ${feature.id}`}>
            {feature.id || 'N/A'}
          </span>
        </div>
      </div>

      {/* Feature Title */}
      <div className="hud-feature-title" title={displayTitle}>
        {displayTitle}
      </div>

      {/* Spatial / Geometry Quick Summary */}
      <div className="hud-feature-geom-summary">
        <div className="hud-geom-summary-item">
          <span className="hud-geom-summary-label">GEOMETRY:</span>
          <span className="hud-geom-summary-value">{geometryInfo.type}</span>
        </div>
        {geometryInfo.metric && (
          <div className="hud-geom-summary-item">
            <span className="hud-geom-summary-label">{geometryInfo.metric.label.toUpperCase()}:</span>
            <span className="hud-geom-summary-value teal-highlight">{geometryInfo.metric.value}</span>
          </div>
        )}
        {geometryInfo.coordsSummary && (
          <div className="hud-geom-summary-item">
            <span className="hud-geom-summary-label">POSITION:</span>
            <span className="hud-geom-summary-value">{geometryInfo.coordsSummary}</span>
          </div>
        )}
      </div>

      {/* Action Toolbar */}
      <div className="hud-actions-grid">
        {onEditFeature && (
          <button type="button" className="hud-action-btn" onClick={onEditFeature}>
            <IconEdit width={14} height={14} />
            <span>Edit Feature</span>
          </button>
        )}
        {onVertexEditFeature && (
          <button type="button" className="hud-action-btn" onClick={onVertexEditFeature}>
            <IconVertexEdit width={15} height={15} />
            <span>Vertex Edit</span>
          </button>
        )}
        {onMoveFeature && (
          <button type="button" className="hud-action-btn" onClick={onMoveFeature}>
            <IconMove width={14} height={14} />
            <span>Move Feature</span>
          </button>
        )}
        {onDeleteFeature && (
          <button
            type="button"
            className={`hud-action-btn delete-btn ${confirmDelete ? 'confirm' : ''}`}
            onClick={onDeleteFeature}
            disabled={isDeleting}
          >
            <IconTrash width={14} height={14} />
            <span>{isDeleting ? 'Deleting…' : confirmDelete ? 'Confirm Del' : 'Delete'}</span>
          </button>
        )}
      </div>

      {/* Attributes Inspector Section */}
      <div className="hud-attr-inspector">
        <div className="hud-attr-header">
          <span className="hud-attr-title">FEATURE ATTRIBUTES</span>
          <span className="hud-attr-count-badge">
            {attributeEntries.length} {attributeEntries.length === 1 ? 'property' : 'properties'}
          </span>
        </div>

        {/* Filter Input if more than 5 properties */}
        {attributeEntries.length > 5 && (
          <div className="hud-attr-search-box">
            <input
              type="text"
              className="hud-attr-search-input"
              placeholder={`Filter ${attributeEntries.length} properties...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Filter attributes"
            />
            {searchQuery && (
              <button
                type="button"
                className="hud-attr-search-clear"
                onClick={() => setSearchQuery('')}
                title="Clear filter"
              >
                &times;
              </button>
            )}
          </div>
        )}

        {/* Attribute List */}
        <div className="hud-attr-list-container">
          {filteredEntries.length === 0 ? (
            <div className="hud-attr-empty-search">
              {searchQuery ? `No properties matching "${searchQuery}"` : 'No attributes available'}
            </div>
          ) : (
            <div className="hud-attr-table">
              {filteredEntries.map(({ key, value }) => {
                const isNull = value === null || value === undefined || value === '';
                const isBool = typeof value === 'boolean';
                const isNum = typeof value === 'number';
                const isObj = typeof value === 'object' && value !== null;

                return (
                  <div key={key} className="hud-attr-row" onClick={() => handleCopy(key, value)} title="Click to copy value">
                    <div className="hud-attr-key-col">
                      <span className="hud-attr-key-label" title={key}>
                        {key}
                      </span>
                    </div>
                    <div className="hud-attr-val-col">
                      {isNull ? (
                        <span className="hud-val-empty">—</span>
                      ) : isBool ? (
                        <span className={`hud-val-bool ${value ? 'hud-val-bool-true' : 'hud-val-bool-false'}`}>
                          {value ? 'TRUE' : 'FALSE'}
                        </span>
                      ) : isNum ? (
                        <span className="hud-val-number">{value.toLocaleString()}</span>
                      ) : isObj ? (
                        <span className="hud-val-object">{JSON.stringify(value)}</span>
                      ) : (
                        <span className="hud-val-string">{String(value)}</span>
                      )}
                      {copiedKey === key && <span className="hud-copied-badge">Copied</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FeatureInfo;
