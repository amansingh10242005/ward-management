import { useState, useMemo } from 'react';

const GEOSERVER_URL = import.meta.env.VITE_GEOSERVER_BASE_URL || 'http://localhost:8080/geoserver';

export type LayerSourceType = 'core' | 'dynamic';

export interface LegendItem {
  layerName: string;
  workspace: string;
  title: string;
  qualifiedName: string;
  styleName?: string;
  legendUrl: string;
  sourceType: LayerSourceType;
}

export interface CoreLayerDef {
  name: string;
  title: string;
  workspace: string;
  qualifiedName: string;
  styleName?: string;
}

export const CORE_LAYERS_REGISTRY: CoreLayerDef[] = [
  {
    name: 'states',
    title: 'State Boundaries',
    workspace: 'ward',
    qualifiedName: 'ward:states',
    styleName: 'ward:ward_states',
  },
  {
    name: 'districts',
    title: 'District Boundaries',
    workspace: 'ward',
    qualifiedName: 'ward:districts',
    styleName: 'ward:ward_districts',
  },
  {
    name: 'zones',
    title: 'Zones',
    workspace: 'ward',
    qualifiedName: 'ward:zones',
    styleName: 'ward_zones',
  },
  {
    name: 'roads',
    title: 'Roads',
    workspace: 'ward',
    qualifiedName: 'ward:roads',
    styleName: 'ward_roads',
  },
  {
    name: 'streetlights',
    title: 'Streetlights',
    workspace: 'ward',
    qualifiedName: 'ward:streetlights',
    styleName: 'ward_streetlights',
  },
];

export function buildLegendGraphicUrl(
  workspace: string,
  qualifiedName: string,
  styleName?: string
): string {
  const params = new URLSearchParams({
    REQUEST: 'GetLegendGraphic',
    VERSION: '1.0.0',
    FORMAT: 'image/png',
    LAYER: qualifiedName,
  });
  if (styleName) {
    params.set('STYLE', styleName);
  }
  return `${GEOSERVER_URL}/${workspace}/wms?${params.toString()}`;
}

export interface DynamicLayerMeta {
  name: string;
  workspace: string;
  qualifiedName: string;
  title?: string;
  defaultStyle?: string;
}

export interface UnifiedLegendProps {
  coreVisibility?: Record<string, boolean>;
  dynamicLayers?: DynamicLayerMeta[];
  dynamicVisibility?: Record<string, boolean>;
  // Backwards compatibility prop if visibleLayers was passed directly
  visibleLayers?: any[];
}

export default function UnifiedLegend({
  coreVisibility = {},
  dynamicLayers = [],
  dynamicVisibility = {},
  visibleLayers,
}: UnifiedLegendProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  // Resolve visible layers from both Core Registry and Dynamic Registry
  const visibleLegends = useMemo<LegendItem[]>(() => {
    // If legacy visibleLayers array was passed, wrap it directly
    if (visibleLayers && visibleLayers.length > 0 && dynamicLayers.length === 0 && Object.keys(coreVisibility).length === 0) {
      return visibleLayers.map((l) => ({
        layerName: l.name,
        workspace: l.workspace || 'ward',
        title: l.title || l.name,
        qualifiedName: l.qualifiedName || `ward:${l.name}`,
        legendUrl: buildLegendGraphicUrl(l.workspace || 'ward', l.qualifiedName || `ward:${l.name}`),
        sourceType: 'dynamic',
      }));
    }

    const items: LegendItem[] = [];

    // 1. Core layers (default to visible if undefined)
    for (const core of CORE_LAYERS_REGISTRY) {
      const isVis = coreVisibility[core.name] !== false;
      if (isVis) {
        items.push({
          layerName: core.name,
          workspace: core.workspace,
          title: core.title,
          qualifiedName: core.qualifiedName,
          styleName: core.styleName,
          legendUrl: buildLegendGraphicUrl(core.workspace, core.qualifiedName, core.styleName),
          sourceType: 'core',
        });
      }
    }

    // 2. Dynamic layers (default to false if undefined)
    for (const dyn of dynamicLayers) {
      const isVis = !!dynamicVisibility[dyn.name];
      if (isVis) {
        items.push({
          layerName: dyn.name,
          workspace: dyn.workspace || 'ward',
          title: dyn.title || dyn.name,
          qualifiedName: dyn.qualifiedName || `ward:${dyn.name}`,
          styleName: dyn.defaultStyle,
          legendUrl: buildLegendGraphicUrl(dyn.workspace || 'ward', dyn.qualifiedName || `ward:${dyn.name}`, dyn.defaultStyle),
          sourceType: 'dynamic',
        });
      }
    }

    return items;
  }, [coreVisibility, dynamicLayers, dynamicVisibility, visibleLayers]);

  // When no layers are visible, hide the floating panel completely
  if (visibleLegends.length === 0) {
    return null;
  }

  return (
    <div
      className="hud-unified-legend"
      data-testid="unified-legend-panel"
      role="region"
      aria-label="Map Layer Legend"
    >
      {/* Header */}
      <div className="hud-legend-header" onClick={() => setIsCollapsed((prev) => !prev)}>
        <div className="hud-legend-header-left">
          <svg
            className="hud-legend-icon"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
          </svg>
          <span className="hud-legend-header-title">MAP LEGEND</span>
          <span className="hud-legend-count-pill" title={`${visibleLegends.length} layers visible`}>
            {visibleLegends.length}
          </span>
        </div>

        <button
          type="button"
          className="hud-legend-collapse-btn"
          onClick={(e) => {
            e.stopPropagation();
            setIsCollapsed((prev) => !prev);
          }}
          aria-label={isCollapsed ? 'Expand legend' : 'Collapse legend'}
          title={isCollapsed ? 'Expand legend' : 'Collapse legend'}
        >
          {isCollapsed ? '+' : '−'}
        </button>
      </div>

      {/* Body / List of Layer Legends */}
      {!isCollapsed && (
        <div className="hud-legend-list">
          {visibleLegends.map((item) => {
            const hasError = !!imageErrors[item.qualifiedName];

            return (
              <div
                key={item.qualifiedName}
                className="hud-legend-item"
                data-testid={`legend-item-${item.layerName}`}
              >
                <div className="hud-legend-item-meta">
                  <span className="hud-legend-item-title">{item.title}</span>
                  <span className={`hud-legend-item-tag tag-${item.sourceType}`}>
                    {item.sourceType === 'core' ? 'Core' : 'Dynamic'}
                  </span>
                </div>

                <div className="hud-legend-graphic-wrap">
                  {hasError ? (
                    <div
                      className="hud-legend-unavailable"
                      data-testid={`legend-unavailable-${item.layerName}`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="12"
                        height="12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>Legend unavailable</span>
                    </div>
                  ) : (
                    <img
                      src={item.legendUrl}
                      alt={`Legend for ${item.title}`}
                      className="hud-legend-img"
                      data-testid={`legend-img-${item.layerName}`}
                      onError={() => {
                        setImageErrors((prev) => ({ ...prev, [item.qualifiedName]: true }));
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
