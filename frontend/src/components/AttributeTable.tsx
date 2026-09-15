import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  IconDownload, 
  IconSearch, 
  IconFocus, 
  IconEdit, 
  IconTrash, 
  IconCheck, 
  IconX, 
  IconSortAsc, 
  IconSortDesc,
  IconPoint,
  IconLine,
  IconPolygon
} from './Icons';
import { apiClient } from '../lib/api';
import { olService } from '../lib/openlayers';
import { historyService } from '../services/historyService';
import { parseFeatureId } from '../utils/featureUtils';
import type { 
  AttributeTableColumn, 
  AttributeTableRow 
} from '../types/attributeTable';

export interface AttributeTableProps {
  isOpen: boolean;
  onClose: () => void;
  activeLayer: string | null;
  setActiveLayer: (layer: string) => void;
  dynamicLayers: any[];
  coreVisibility?: Record<string, boolean>;
  onSelectFeature?: (feature: any, layerName: string) => void;
  onZoomToFeature?: (layerName?: string, featureId?: string | number, feature?: any) => void;
  onError?: (err: string) => void;
}

const CORE_LAYERS = [
  { id: 'roads', name: 'roads', title: 'Roads', geomType: 'LineString', icon: IconLine },
  { id: 'streetlights', name: 'streetlights', title: 'Streetlights', geomType: 'Point', icon: IconPoint },
  { id: 'zones', name: 'zones', title: 'Zones', geomType: 'Polygon', icon: IconPolygon },
  { id: 'districts', name: 'districts', title: 'Districts', geomType: 'Polygon', icon: IconPolygon },
  { id: 'states', name: 'states', title: 'States', geomType: 'Polygon', icon: IconPolygon },
];

interface DropdownOption {
  value: string;
  label: string;
}

const LAYER_FIELD_DROPDOWNS: Record<string, Record<string, DropdownOption[]>> = {
  streetlights: {
    type: [
      { value: 'standard', label: 'Standard' },
      { value: 'solar', label: 'Solar' },
      { value: 'LED', label: 'LED' },
    ],
  },
  zones: {
    type: [
      { value: 'residential', label: 'Residential' },
      { value: 'commercial', label: 'Commercial' },
      { value: 'park', label: 'Park' },
    ],
  },
  roads: {
    category: [
      { value: 'local', label: 'Local' },
      { value: 'arterial', label: 'Arterial' },
      { value: 'highway', label: 'Highway' },
    ],
    type: [
      { value: 'local', label: 'Local' },
      { value: 'arterial', label: 'Arterial' },
      { value: 'highway', label: 'Highway' },
    ],
  },
};

function getDropdownOptionsForField(
  layerName: string,
  colName: string,
  features: AttributeTableRow[],
  currentVal: any
): DropdownOption[] | null {
  const colKey = colName.toLowerCase();
  
  // 1. Check fixed map for known layers
  const layerMap = LAYER_FIELD_DROPDOWNS[layerName] || LAYER_FIELD_DROPDOWNS[layerName.toLowerCase()];
  if (layerMap && layerMap[colKey]) {
    const predefined = [...layerMap[colKey]];
    if (currentVal && !predefined.some(opt => opt.value.toLowerCase() === String(currentVal).toLowerCase())) {
      predefined.push({ value: String(currentVal), label: String(currentVal) });
    }
    return predefined;
  }

  // 2. If it is a 'type' or 'category' column on ANY layer (core or dynamic)
  if (colKey === 'type' || colKey === 'category') {
    const distinctSet = new Set<string>();
    if (currentVal) distinctSet.add(String(currentVal));
    features.forEach(f => {
      const v = f.properties[colName];
      if (v !== null && v !== undefined && String(v).trim() !== '') {
        distinctSet.add(String(v));
      }
    });

    if (distinctSet.size > 0) {
      return Array.from(distinctSet).map(val => ({
        value: val,
        label: val.charAt(0).toUpperCase() + val.slice(1),
      }));
    }
  }

  return null;
}

export default function AttributeTable({
  isOpen,
  onClose,
  activeLayer,
  setActiveLayer,
  dynamicLayers = [],
  onSelectFeature,
  onError,
}: AttributeTableProps) {
  // ── Available Layers for Tabs ──────────────────────────────────────────────
  const allAvailableLayers = useMemo(() => {
    const list: Array<{ id: string; name: string; title: string; geomType: string; isCore: boolean }> = [
      ...CORE_LAYERS.map(c => ({ ...c, isCore: true })),
      ...dynamicLayers.map(d => ({
        id: d.name,
        name: d.name,
        title: d.title || d.name,
        geomType: 'Vector',
        isCore: false
      }))
    ];
    return list;
  }, [dynamicLayers]);

  // Currently selected layer in attribute table
  const [selectedLayer, setSelectedLayer] = useState<string>('roads');

  // Sync selected table layer when activeLayer changes from outside
  useEffect(() => {
    if (activeLayer && allAvailableLayers.some(l => l.name === activeLayer)) {
      setSelectedLayer(activeLayer);
    } else if (!selectedLayer && allAvailableLayers.length > 0) {
      setSelectedLayer(allAvailableLayers[0].name);
    }
  }, [activeLayer, allAvailableLayers, selectedLayer]);

  // ── Table State ────────────────────────────────────────────────────────────
  const [features, setFeatures] = useState<AttributeTableRow[]>([]);
  const [columns, setColumns] = useState<AttributeTableColumn[]>([]);
  const [totalFeatures, setTotalFeatures] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'ASC' | 'DESC'>('ASC');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedRowId, setSelectedRowId] = useState<string | number | null>(null);

  // ── Row Editing State ──────────────────────────────────────────────────────
  const [editingRowId, setEditingRowId] = useState<string | number | null>(null);
  const [draftProps, setDraftProps] = useState<Record<string, any>>({});
  const [originalProps, setOriginalProps] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [rowError, setRowError] = useState<string | null>(null);

  // ── Delete State ───────────────────────────────────────────────────────────
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | number | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1); // reset to page 1 on new search
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ── Layer concurrency guard ───────────────────────────────────────────────
  const activeLayerRef = useRef(selectedLayer);
  activeLayerRef.current = selectedLayer;

  // ── Fetch Layer Data ───────────────────────────────────────────────────────
  const fetchTableData = useCallback(async () => {
    if (!selectedLayer || !isOpen) return;
    const targetLayer = selectedLayer;

    setIsLoading(true);
    setRowError(null);

    try {
      const res = await apiClient.geoserver.getFeatures(targetLayer, {
        page: currentPage,
        pageSize,
        search: debouncedSearch,
        sortBy: sortBy || undefined,
        sortDirection: sortBy ? sortDirection : undefined,
      });

      // Ignore response if user or history has switched to another layer
      if (activeLayerRef.current !== targetLayer) {
        return;
      }

      if (res) {
        setFeatures(res.features || []);
        setTotalFeatures(res.totalFeatures || 0);
        setTotalPages(res.totalPages || 1);

        // Derive column definitions dynamically from schema
        if (res.schema?.properties) {
          const cols: AttributeTableColumn[] = [];
          for (const prop of res.schema.properties) {
            const isGeom = prop.type?.startsWith('gml:') || 
              prop.localType?.toLowerCase().includes('geom') ||
              prop.localType?.toLowerCase().includes('polygon') ||
              prop.localType?.toLowerCase().includes('point') ||
              prop.localType?.toLowerCase().includes('line');

            if (isGeom) continue; // geometry handled in dedicated column

            const isId = prop.name.toLowerCase() === 'id' || prop.name.toLowerCase() === 'fid';
            const isAutoTimestamp = ['created_at', 'updated_at', 'createdat', 'updatedat', 'created_date', 'updated_date', 'timestamp'].includes(prop.name.toLowerCase());
            cols.push({
              name: prop.name,
              label: prop.name.replace(/_/g, ' ').toUpperCase(),
              type: prop.type || 'string',
              localType: prop.localType || 'string',
              editable: !isId && !isAutoTimestamp,
              nullable: true,
              isGeometry: false,
            });
          }
          setColumns(cols);
        }
      }
    } catch (err: any) {
      console.error('[AttributeTable] Fetch error:', err);
      const msg = err.message || 'Failed to load table data';
      setRowError(msg);
      if (onError) onError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [selectedLayer, isOpen, currentPage, pageSize, debouncedSearch, sortBy, sortDirection, onError]);

  useEffect(() => {
    fetchTableData();
  }, [fetchTableData]);

  // ── History Sync ───────────────────────────────────────────────────────────
  // When undo/redo executes in historyService, update local row state without full re-fetch
  useEffect(() => {
    return historyService.subscribe(() => {
      // Refresh active page smoothly on undo/redo
      fetchTableData();
    });
  }, [fetchTableData]);

  // ── Layer Tab Switching ────────────────────────────────────────────────────
  const handleSelectLayerTab = (layerName: string) => {
    if (layerName === selectedLayer) return;
    setSelectedLayer(layerName);
    setActiveLayer(layerName);
    setCurrentPage(1);
    setSearchQuery('');
    setSortBy(null);
    setEditingRowId(null);
    setConfirmDeleteId(null);
    setRowError(null);
  };

  // ── Column Sorting ─────────────────────────────────────────────────────────
  const handleSort = (colName: string) => {
    if (sortBy === colName) {
      if (sortDirection === 'ASC') {
        setSortDirection('DESC');
      } else {
        setSortBy(null);
        setSortDirection('ASC');
      }
    } else {
      setSortBy(colName);
      setSortDirection('ASC');
    }
    setCurrentPage(1);
  };

  // ── Row Locate / Selection ─────────────────────────────────────────────────
  const handleLocateRow = (row: AttributeTableRow) => {
    setSelectedRowId(row.id);

    const geojsonFeature: any = {
      type: 'Feature',
      id: row.id,
      properties: row.properties || {},
      geometry: row.geometry || (row.centroid ? {
        type: 'Point',
        coordinates: row.centroid
      } : null)
    };

    // Synchronize map center and glow highlight
    olService.centerOnFeature(selectedLayer, row.id, geojsonFeature);
    if (geojsonFeature.geometry) {
      olService.setSelectedFeature(selectedLayer, row.id, geojsonFeature);
    } else {
      olService.setSelectedFeature(selectedLayer, row.id);
    }

    // Synchronize Feature Info without extra WFS GetFeature
    if (onSelectFeature) {
      onSelectFeature(geojsonFeature, selectedLayer);
    }
  };

  // ── Direct Row Editing (Single or Multi-Field) ─────────────────────────────
  const handleStartEdit = (row: AttributeTableRow) => {
    setEditingRowId(row.id);
    setDraftProps({ ...row.properties });
    setOriginalProps({ ...row.properties });
    setRowError(null);
  };

  const handleCancelEdit = () => {
    setEditingRowId(null);
    setDraftProps({});
    setOriginalProps({});
    setRowError(null);
  };

  const handleFieldChange = (colName: string, value: any) => {
    setDraftProps(prev => ({
      ...prev,
      [colName]: value,
    }));
  };

  const handleSaveRow = async (row: AttributeTableRow) => {
    if (isSaving) return; // duplicate clicks prevented
    setIsSaving(true);
    setRowError(null);

    // Calculate ONLY the modified properties (untouched properties remain untouched)
    const changedProperties: Record<string, any> = {};
    let hasChanges = false;

    for (const [key, rawVal] of Object.entries(draftProps)) {
      const orig = originalProps[key];
      const colDef = columns.find(c => c.name === key);
      let val = rawVal;

      if (colDef) {
        const lt = (colDef.localType || colDef.type || '').toLowerCase();
        if (lt === 'int' || lt === 'integer' || lt.includes('int')) {
          if (rawVal === '' || rawVal === null || rawVal === undefined) {
            val = colDef.nullable ? null : 0;
          } else {
            val = parseInt(String(rawVal), 10);
            if (isNaN(val)) val = rawVal;
          }
        } else if (lt === 'float' || lt === 'double' || lt === 'number' || lt.includes('decimal')) {
          if (rawVal === '' || rawVal === null || rawVal === undefined) {
            val = colDef.nullable ? null : 0;
          } else {
            val = parseFloat(String(rawVal));
            if (isNaN(val)) val = rawVal;
          }
        } else if (lt === 'boolean' || lt.includes('bool')) {
          val = rawVal === true || String(rawVal).toLowerCase() === 'true';
        }
      }

      if (val !== orig && String(val) !== String(orig)) {
        changedProperties[key] = val;
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      setEditingRowId(null);
      setIsSaving(false);
      return;
    }

    // Ensure createdAt is never overwritten on update
    const createdAtCol = columns.find(c => ['created_at', 'createdat', 'created_date'].includes(c.name.toLowerCase()));
    if (createdAtCol && createdAtCol.name in changedProperties) {
      delete changedProperties[createdAtCol.name];
    }

    // Automatically assign updatedAt on save if the layer schema has an update timestamp column
    const updatedAtCol = columns.find(c => ['updated_at', 'updatedat', 'updated_date'].includes(c.name.toLowerCase()));
    if (updatedAtCol) {
      changedProperties[updatedAtCol.name] = new Date().toISOString();
    }

    const isCore = CORE_LAYERS.some(c => c.name === selectedLayer);

    try {
      if (!isCore) {
        // Dynamic Layer: exactly 1 WFS-T Update transaction
        const payload = {
          layerName: selectedLayer,
          featureId: String(row.id),
          action: 'update',
          feature: {
            type: 'Feature',
            geometry: row.geometry,
            properties: changedProperties,
          },
        };

        const res = await apiClient.geoserver.transaction(payload);
        if (!res?.success && res?.totalUpdated !== 1) {
          throw new Error(res?.error || 'Update failed');
        }
      } else {
        // Core Layer: exactly 1 Core REST PUT transaction
        const rawId = (row.properties?.id != null && !isNaN(Number(row.properties.id)))
          ? row.properties.id
          : (parseFeatureId(row.id) ?? row.id);
        const client = (apiClient as any)[selectedLayer];
        if (!client?.update) {
          throw new Error(`Layer ${selectedLayer} does not support update`);
        }
        await client.update(rawId, {
          type: 'Feature',
          geometry: row.geometry,
          properties: { ...originalProps, ...changedProperties },
        });
      }

      // 1. Update row in local table state immediately
      setFeatures(prev => prev.map(f => {
        if (f.id === row.id) {
          return {
            ...f,
            properties: { ...f.properties, ...changedProperties }
          };
        }
        return f;
      }));

      // 2. Record success in HistoryService for Undo/Redo integration
      historyService.recordSuccess({
        operationType: 'update',
        layerName: selectedLayer,
        isCore,
        originalFeatureId: String(row.id),
        currentFeatureId: String(row.id),
        before: { geometry: row.geometry, properties: originalProps },
        after: { geometry: row.geometry, properties: { ...originalProps, ...changedProperties } }
      });

      // 3. Refresh map WMS/WFS rendering
      olService.refreshWfsLayerStyles();

      // 4. Exit edit mode
      setEditingRowId(null);
    } catch (err: any) {
      console.error('[AttributeTable] Save error:', err);
      const msg = err.message || 'Failed to save feature changes';
      setRowError(msg);
      if (onError) onError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Direct Row Deletion ───────────────────────────────────────────────────
  const handleDeleteRow = async (row: AttributeTableRow) => {
    if (isDeleting) return; // duplicate clicks prevented
    setIsDeleting(true);
    setRowError(null);

    const isCore = CORE_LAYERS.some(c => c.name === selectedLayer);

    try {
      if (!isCore) {
        // Dynamic Layer: exactly 1 WFS-T Delete transaction
        const res = await apiClient.geoserver.transaction({
          layerName: selectedLayer,
          featureId: String(row.id),
          action: 'delete',
        });
        if (!res?.success && res?.totalDeleted !== 1) {
          throw new Error(res?.error || 'Delete failed');
        }
      } else {
        // Core Layer: Core REST DELETE
        const rawId = (row.properties?.id != null && !isNaN(Number(row.properties.id)))
          ? row.properties.id
          : (parseFeatureId(row.id) ?? row.id);
        const client = (apiClient as any)[selectedLayer];
        if (!client?.delete) {
          throw new Error(`Layer ${selectedLayer} does not support delete`);
        }
        await client.delete(rawId);
      }

      // 1. Remove row from local table state
      setFeatures(prev => prev.filter(f => f.id !== row.id));
      setTotalFeatures(prev => Math.max(0, prev - 1));

      // 2. Record success in HistoryService
      historyService.recordSuccess({
        operationType: 'delete',
        layerName: selectedLayer,
        isCore,
        originalFeatureId: String(row.id),
        currentFeatureId: String(row.id),
        before: { geometry: row.geometry, properties: row.properties },
        after: {}
      });

      // 3. Refresh map rendering
      olService.refreshWfsLayerStyles();
      setConfirmDeleteId(null);
    } catch (err: any) {
      console.error('[AttributeTable] Delete error:', err);
      const msg = err.message || 'Failed to delete feature';
      setRowError(msg);
      if (onError) onError(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  // ── Export CSV ─────────────────────────────────────────────────────────────
  const handleExportCsv = () => {
    if (features.length === 0) return;

    const visibleCols = columns.map(c => c.name);
    const headers = ['id', ...visibleCols];

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvRows = [
      headers.join(','),
      ...features.map(f => {
        const rowData = [
          escapeCsv(f.id),
          ...visibleCols.map(c => escapeCsv(f.properties[c]))
        ];
        return rowData.join(',');
      })
    ];

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedLayer}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Export GeoJSON ─────────────────────────────────────────────────────────
  const handleExportGeoJson = () => {
    if (features.length === 0) return;

    const geoJson = {
      type: 'FeatureCollection',
      name: selectedLayer,
      totalFeatures: features.length,
      features: features.map(f => ({
        type: 'Feature',
        id: f.id,
        geometry: f.geometry,
        properties: f.properties,
      }))
    };

    const blob = new Blob([JSON.stringify(geoJson, null, 2)], { type: 'application/geo+json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedLayer}_export.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div 
      className="attribute-table-dock"
      data-testid="attribute-table-panel"
      id="attribute-table-panel"
    >
      {/* ── TOP HEADER / LAYER TABS ─────────────────────────────────────────── */}
      <div className="attr-table-header">
        <div className="attr-table-tabs-container">
          <div className="attr-table-tabs">
            {allAvailableLayers.map(l => {
              const isTabActive = l.name === selectedLayer;
              return (
                <button
                  key={l.name}
                  className={`attr-layer-tab ${isTabActive ? 'active' : ''}`}
                  onClick={() => handleSelectLayerTab(l.name)}
                  data-testid={`attr-tab-${l.name}`}
                  title={`${l.title} (${l.geomType})`}
                >
                  <span className="attr-tab-icon">
                    {l.geomType === 'Point' && <IconPoint width={14} height={14} />}
                    {l.geomType === 'LineString' && <IconLine width={14} height={14} />}
                    {(l.geomType === 'Polygon' || l.geomType === 'Vector') && <IconPolygon width={14} height={14} />}
                  </span>
                  <span className="attr-tab-name">{l.title}</span>
                  {isTabActive && <span className="attr-tab-active-dot" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Controls & Close */}
        <div className="attr-table-header-actions">
          <button
            className="attr-btn attr-btn-outline"
            onClick={handleExportCsv}
            disabled={features.length === 0}
            data-testid="btn-export-csv"
            title="Export current table view to CSV"
          >
            <IconDownload width={14} height={14} />
            <span>CSV</span>
          </button>
          <button
            className="attr-btn attr-btn-outline"
            onClick={handleExportGeoJson}
            disabled={features.length === 0}
            data-testid="btn-export-geojson"
            title="Export current table view to GeoJSON"
          >
            <IconDownload width={14} height={14} />
            <span>GeoJSON</span>
          </button>
          <button
            className="attr-btn-icon"
            onClick={onClose}
            data-testid="btn-close-attribute-table"
            title="Close Attribute Table"
          >
            <IconX width={16} height={16} />
          </button>
        </div>
      </div>

      {/* ── CONTROLS TOOLBAR ─────────────────────────────────────────────────── */}
      <div className="attr-table-toolbar">
        {/* Layer Info & Counter */}
        <div className="attr-toolbar-left">
          <span className="attr-layer-badge" data-testid="attr-active-layer-badge">
            {selectedLayer.toUpperCase()}
          </span>
          <span className="attr-count-badge" data-testid="attr-record-count">
            {isLoading ? 'Loading...' : `${totalFeatures} Features`}
          </span>
        </div>

        {/* Search & Filter */}
        <div className="attr-toolbar-center">
          <div className="attr-search-wrapper">
            <IconSearch width={14} height={14} className="attr-search-icon" />
            <input
              type="text"
              className="attr-search-input"
              placeholder={`Search ${selectedLayer}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="attr-search-input"
            />
            {searchQuery && (
              <button 
                className="attr-search-clear"
                onClick={() => setSearchQuery('')}
                title="Clear search"
              >
                &times;
              </button>
            )}
          </div>
        </div>

        {/* Pagination Toolbar */}
        <div className="attr-toolbar-right">
          <div className="attr-pagination-controls">
            <span className="attr-page-info" data-testid="attr-pagination-info">
              Page {currentPage} of {totalPages}
            </span>
            <button
              className="attr-page-btn"
              disabled={currentPage <= 1 || isLoading}
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              data-testid="btn-prev-page"
              title="Previous page"
            >
              &lsaquo;
            </button>
            <button
              className="attr-page-btn"
              disabled={currentPage >= totalPages || isLoading}
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              data-testid="btn-next-page"
              title="Next page"
            >
              &rsaquo;
            </button>
            <select
              className="attr-page-size-select"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              data-testid="attr-page-size-select"
            >
              <option value={10}>10 / page</option>
              <option value={25}>25 / page</option>
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── ERROR BANNER ────────────────────────────────────────────────────── */}
      {rowError && (
        <div className="attr-error-banner" data-testid="attr-error-banner">
          <span>{rowError}</span>
          <button onClick={() => setRowError(null)}>&times;</button>
        </div>
      )}

      {/* ── TABLE VIEWPORT ──────────────────────────────────────────────────── */}
      <div className="attr-table-container">
        <table className="attr-data-table" data-testid="attr-data-table">
          <thead>
            <tr>
              <th className="attr-th-fixed attr-th-id">ID</th>
              {columns.map(col => {
                const isSorted = sortBy === col.name;
                return (
                  <th 
                    key={col.name} 
                    className={`attr-th ${isSorted ? 'sorted' : ''}`}
                    onClick={() => handleSort(col.name)}
                    data-testid={`attr-header-${col.name}`}
                    title={`Click to sort by ${col.label}`}
                  >
                    <div className="attr-th-content">
                      <span>{col.label}</span>
                      <span className="attr-sort-icon">
                        {isSorted && (sortDirection === 'ASC' ? <IconSortAsc width={12} height={12} /> : <IconSortDesc width={12} height={12} />)}
                      </span>
                    </div>
                  </th>
                );
              })}
              <th className="attr-th attr-th-coords">COORDINATES</th>
              <th className="attr-th-fixed attr-th-actions">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length + 3} className="attr-td-loading" data-testid="attr-loading-indicator">
                  <div className="attr-loading-spinner" />
                  <span>Loading {selectedLayer} features...</span>
                </td>
              </tr>
            ) : features.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 3} className="attr-td-empty" data-testid="attr-empty-state">
                  No features found matching the criteria.
                </td>
              </tr>
            ) : (
              features.map(row => {
                const isEditing = editingRowId === row.id;
                const isSelected = selectedRowId === row.id;
                const isConfirmingDelete = confirmDeleteId === row.id;

                return (
                  <tr 
                    key={row.id}
                    className={`attr-tr ${isSelected ? 'selected' : ''} ${isEditing ? 'editing' : ''}`}
                    data-testid={`attr-row-${row.id}`}
                    onClick={() => setSelectedRowId(row.id)}
                  >
                    {/* ID Column */}
                    <td className="attr-td attr-td-id" title={String(row.id)}>
                      <span className="attr-fid-pill">{String(row.id).split('.').pop() || row.id}</span>
                    </td>

                    {/* Dynamic Columns */}
                    {columns.map(col => {
                      const val = isEditing ? draftProps[col.name] : row.properties[col.name];

                      return (
                        <td 
                          key={col.name} 
                          className="attr-td"
                          data-testid={`attr-cell-${row.id}-${col.name}`}
                        >
                          {isEditing && col.editable ? (
                            (() => {
                              const dropdownOptions = getDropdownOptionsForField(selectedLayer, col.name, features, val);
                              if (dropdownOptions && dropdownOptions.length > 0) {
                                let matchedVal = String(val ?? '');
                                const matchingOpt = dropdownOptions.find(o => o.value.toLowerCase() === matchedVal.toLowerCase());
                                if (matchingOpt) {
                                  matchedVal = matchingOpt.value;
                                }
                                return (
                                  <select
                                    className="attr-inline-select"
                                    value={matchedVal}
                                    onChange={(e) => handleFieldChange(col.name, e.target.value)}
                                    data-testid={`attr-select-${row.id}-${col.name}`}
                                  >
                                    {dropdownOptions.map(opt => (
                                      <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                );
                              }
                              return (
                                <input
                                  type="text"
                                  className="attr-inline-input"
                                  value={val === null || val === undefined ? '' : String(val)}
                                  onChange={(e) => handleFieldChange(col.name, e.target.value)}
                                  data-testid={`attr-input-${row.id}-${col.name}`}
                                />
                              );
                            })()
                          ) : (
                            <span 
                              className={`attr-val ${val === null || val === undefined ? 'null' : ''}`}
                              title={val === null || val === undefined ? 'null' : String(val)}
                            >
                              {val === null || val === undefined 
                                ? '—' 
                                : typeof val === 'boolean' 
                                  ? (val ? 'TRUE' : 'FALSE') 
                                  : String(val)}
                            </span>
                          )}
                        </td>
                      );
                    })}

                    {/* Coordinates / Geometry column */}
                    <td className="attr-td attr-td-coords">
                      {row.centroid ? (
                        <span className="attr-coords-badge" title={`Lon: ${row.centroid[0].toFixed(5)}, Lat: ${row.centroid[1].toFixed(5)}`}>
                          {`${row.centroid[1].toFixed(4)}°N, ${row.centroid[0].toFixed(4)}°E`}
                        </span>
                      ) : (
                        <span className="attr-geom-badge">{row.geomType}</span>
                      )}
                    </td>

                    {/* Actions Column (Locate, Edit, Delete) */}
                    <td className="attr-td attr-td-actions">
                      <div className="attr-row-actions">
                        {isEditing ? (
                          <>
                            <button
                              className="attr-action-btn btn-save"
                              onClick={() => handleSaveRow(row)}
                              disabled={isSaving}
                              data-testid={`btn-save-row-${row.id}`}
                              title="Save changes"
                            >
                              <IconCheck width={14} height={14} />
                            </button>
                            <button
                              className="attr-action-btn btn-cancel"
                              onClick={handleCancelEdit}
                              disabled={isSaving}
                              data-testid={`btn-cancel-row-${row.id}`}
                              title="Cancel editing"
                            >
                              <IconX width={14} height={14} />
                            </button>
                          </>
                        ) : isConfirmingDelete ? (
                          <>
                            <button
                              className="attr-action-btn btn-confirm-delete"
                              onClick={() => handleDeleteRow(row)}
                              disabled={isDeleting}
                              data-testid={`btn-confirm-delete-${row.id}`}
                              title="Confirm Delete"
                            >
                              <IconCheck width={14} height={14} />
                            </button>
                            <button
                              className="attr-action-btn btn-cancel"
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={isDeleting}
                              data-testid={`btn-cancel-delete-${row.id}`}
                              title="Cancel Delete"
                            >
                              <IconX width={14} height={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="attr-action-btn btn-locate"
                              onClick={() => handleLocateRow(row)}
                              data-testid={`btn-locate-row-${row.id}`}
                              title="Locate feature on map"
                            >
                              <IconFocus width={14} height={14} />
                            </button>
                            <button
                              className="attr-action-btn btn-edit"
                              onClick={() => handleStartEdit(row)}
                              data-testid={`btn-edit-row-${row.id}`}
                              title="Edit attributes"
                            >
                              <IconEdit width={14} height={14} />
                            </button>
                            <button
                              className="attr-action-btn btn-delete"
                              onClick={() => setConfirmDeleteId(row.id)}
                              data-testid={`btn-delete-row-${row.id}`}
                              title="Delete feature"
                            >
                              <IconTrash width={14} height={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
