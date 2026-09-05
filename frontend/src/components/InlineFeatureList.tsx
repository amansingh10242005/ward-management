import { useState, useEffect, useRef, useCallback } from 'react';
import { olService } from '../lib/openlayers';
import { IconSearch, IconCirclePlus, IconEye, IconEyeOff } from './Icons';
import { parseFeatureId } from '../utils/featureUtils';

interface InlineFeatureListProps {
  activeLayer: 'streetlights' | 'roads' | 'zones' | 'states' | 'districts';
  selectedFeature: any | null;
  onSelectFeature: (feature: any) => void;
  onCreateClick?: () => void;
}

function getFeatureDisplay(f: any, activeLayer: string) {
  const props = f.properties || {};
  switch (activeLayer) {
    case 'states':
      return {
        primary: props.state || props.STATE || props.state_name || `State ${f.id}`,
        secondary: props.state_lgd ? `LGD: ${props.state_lgd}` : (props.state_code ? `Code: ${props.state_code}` : `ID: ${f.id}`),
      };
    case 'districts':
      return {
        primary: props.district || props.District || props.district_name || `District ${f.id}`,
        secondary: (props.state || props.State) ? `State: ${props.state || props.State}` : `ID: ${f.id}`,
      };
    case 'zones':
      return {
        primary: props.name || `Zone ${f.id}`,
        secondary: props.type || props.category ? `${props.type || props.category}` : `ID: ${f.id}`,
      };
    case 'roads':
      return {
        primary: props.name || `Road ${f.id}`,
        secondary: props.zone_id ? `Zone ID: ${props.zone_id}` : (props.category ? `Type: ${props.category}` : `ID: ${f.id}`),
      };
    case 'streetlights':
      return {
        primary: props.name || props.identifier || `Streetlight ${f.id}`,
        secondary: props.road_id ? `Road ID: ${props.road_id}` : (props.type ? `Type: ${props.type}` : `ID: ${f.id}`),
      };
    default:
      return { primary: `Feature ${f.id}`, secondary: '' };
  }
}

export default function InlineFeatureList({
  activeLayer,
  selectedFeature,
  onSelectFeature,
  onCreateClick,
}: InlineFeatureListProps) {
  const [features, setFeatures] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() =>
    new Set(olService.getHiddenFeatureIds(activeLayer))
  );
  const selectedRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);

  // Sync hiddenIds whenever activeLayer changes
  useEffect(() => {
    setHiddenIds(new Set(olService.getHiddenFeatureIds(activeLayer)));
  }, [activeLayer]);

  const handleToggleFeature = (e: React.MouseEvent, featureId: string | number) => {
    e.stopPropagation();
    const rawId = String(parseFeatureId(featureId) ?? featureId);
    const isNowVisible = olService.toggleFeatureVisibility(activeLayer, rawId);
    setHiddenIds(prev => {
      const next = new Set(prev);
      if (isNowVisible) {
        next.delete(rawId);
      } else {
        next.add(rawId);
      }
      return next;
    });
  };

  const fetchFeatures = useCallback(async (searchTerm: string, layer: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const seq = ++requestSeqRef.current;

    setLoading(true);
    try {
      const f = await olService.searchFeaturesFromBackend(layer, searchTerm, controller.signal);
      if (seq === requestSeqRef.current) {
        setFeatures(f);
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        console.error(e);
        if (seq === requestSeqRef.current) {
          setFeatures([]);
        }
      }
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Immediate fetch on layer switch
  useEffect(() => {
    setSearch('');
    fetchFeatures('', activeLayer);
  }, [activeLayer, fetchFeatures]);

  // Debounced fetch on search query change
  useEffect(() => {
    if (!search.trim()) return;
    const timeout = setTimeout(() => {
      fetchFeatures(search, activeLayer);
    }, 250);
    return () => clearTimeout(timeout);
  }, [search, activeLayer, fetchFeatures]);

  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (!val.trim()) {
      fetchFeatures('', activeLayer);
    }
  };

  // Refresh when layer is modified (create/update/delete)
  useEffect(() => {
    const cleanup = olService.onLayerRefresh((refreshedLayer) => {
      if (refreshedLayer === activeLayer) {
        fetchFeatures(search, activeLayer);
      }
    });
    return cleanup;
  }, [activeLayer, search, fetchFeatures]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedFeature && selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedFeature, features]);

  const getCreateLabel = () => {
    switch (activeLayer) {
      case 'streetlights': return 'Add Streetlight';
      case 'roads':        return 'Add Road';
      case 'zones':        return 'Add Zone';
      default:             return 'Add Feature';
    }
  };

  return (
    <div className="inline-feature-panel">
      {/* Search Bar */}
      <div className="inline-feature-search">
        <IconSearch width={13} height={13} className="inline-feature-search-icon" />
        <input
          type="text"
          placeholder={`Search ${activeLayer}...`}
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="inline-feature-search-input"
          onClick={(e) => e.stopPropagation()}
        />
        {!loading && features.length > 0 && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>
            {features.length}
          </span>
        )}
      </div>

      {/* Feature List */}
      <div className="inline-feature-list">
        {loading ? (
          <div className="inline-feature-empty">Loading {activeLayer}...</div>
        ) : features.length === 0 ? (
          <div className="inline-feature-empty">
            No {activeLayer}{search ? ` matching "${search}"` : ''} found.
          </div>
        ) : (
          features.map((f) => {
            const rawId = String(parseFeatureId(f.id) ?? f.id);
            const isSelected = selectedFeature?.id === f.id;
            const isVisible = !hiddenIds.has(rawId) && olService.isFeatureVisible(activeLayer, rawId);
            const { primary, secondary } = getFeatureDisplay(f, activeLayer);
            return (
              <div
                key={f.id}
                ref={isSelected ? selectedRef : null}
                className={`inline-feature-item ${isSelected ? 'selected' : ''} ${!isVisible ? 'dimmed' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectFeature(f);
                }}
              >
                <button
                  type="button"
                  className={`inline-feature-eye-btn ${!isVisible ? 'hidden' : ''}`}
                  onClick={(e) => handleToggleFeature(e, f.id)}
                  title={isVisible ? `Hide ${primary}` : `Show ${primary}`}
                  aria-label={isVisible ? `Hide ${primary}` : `Show ${primary}`}
                >
                  {isVisible ? <IconEye width={14} height={14} /> : <IconEyeOff width={14} height={14} />}
                </button>
                <div className="inline-feature-text">
                  <div className="inline-feature-primary">{primary}</div>
                  {secondary && (
                    <div className="inline-feature-secondary">{secondary}</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Create CTA */}
      {onCreateClick && (
        <div className="inline-feature-footer">
          <button
            type="button"
            className="inline-feature-create-btn"
            onClick={(e) => {
              e.stopPropagation();
              onCreateClick();
            }}
          >
            <IconCirclePlus width={14} height={14} />
            <span>{getCreateLabel()}</span>
          </button>
        </div>
      )}
    </div>
  );
}
