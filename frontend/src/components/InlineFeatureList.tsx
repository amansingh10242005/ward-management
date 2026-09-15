import { useState, useEffect, useRef, useCallback } from 'react';
import { olService } from '../lib/openlayers';
import { IconSearch, IconCirclePlus, IconEye, IconEyeOff } from './Icons';
import { parseFeatureId } from '../utils/featureUtils';

interface InlineFeatureListProps {
  activeLayer: 'streetlights' | 'roads' | 'zones' | 'states' | 'districts' | string;
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
        secondary: (props.state_lgd || props.STATE_LGD) ? `LGD: ${props.state_lgd || props.STATE_LGD}` : (props.state_code ? `Code: ${props.state_code}` : `ID: ${f.id}`),
      };
    case 'districts':
      return {
        primary: props.district || props.District || props.district_name || `District ${f.id}`,
        secondary: (props.state || props.STATE || props.State) ? `State: ${props.state || props.STATE || props.State}` : (props.district_l || props.DISTRICT_L ? `LGD: ${props.district_l || props.DISTRICT_L}` : `ID: ${f.id}`),
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
    default: {
      const primary = props.name || props.NAME || props.name_en || props.title || props.site_name || props.label || `Feature ${f.id}`;
      const secondary = props.category || props.type || props.notes || (props.scalerank !== undefined ? `Rank: ${props.scalerank}` : '') || '';
      return { primary: String(primary), secondary: String(secondary) };
    }
  }
}

const PAGE_SIZE = 40;

export default function InlineFeatureList({
  activeLayer,
  selectedFeature,
  onSelectFeature,
  onCreateClick,
}: InlineFeatureListProps) {
  const [features, setFeatures] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() =>
    new Set(olService.getHiddenFeatureIds(activeLayer))
  );
  const listContainerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const loadMoreAbortControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const featuresRef = useRef<any[]>([]);
  featuresRef.current = features;
  const lastScrolledSelectedIdRef = useRef<string | null>(null);

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
    if (loadMoreAbortControllerRef.current) {
      loadMoreAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const seq = ++requestSeqRef.current;

    setLoading(true);
    setLoadingMore(false);
    try {
      const res = await olService.searchFeaturesFromBackend(layer, searchTerm, controller.signal, 0, PAGE_SIZE);
      if (seq === requestSeqRef.current) {
        const items = res.features || (Array.isArray(res) ? res : []);
        setFeatures(items);
        setHasMore(res.hasMore ?? (items.length === PAGE_SIZE));
        setTotalCount(res.totalCount ?? items.length);
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        console.error(e);
        if (seq === requestSeqRef.current) {
          setFeatures([]);
          setHasMore(false);
          setTotalCount(0);
        }
      }
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    const offset = featuresRef.current.length;
    if (offset === 0) return;

    if (loadMoreAbortControllerRef.current) {
      loadMoreAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    loadMoreAbortControllerRef.current = controller;
    const seq = requestSeqRef.current;

    setLoadingMore(true);
    try {
      const res = await olService.searchFeaturesFromBackend(
        activeLayer,
        search,
        controller.signal,
        offset,
        PAGE_SIZE
      );
      if (seq === requestSeqRef.current) {
        const newItems = res.features || (Array.isArray(res) ? res : []);
        setFeatures(prev => {
          const existingIds = new Set(prev.map(f => f.id));
          const filtered = newItems.filter((f: any) => !existingIds.has(f.id));
          return [...prev, ...filtered];
        });
        setHasMore(res.hasMore ?? (newItems.length === PAGE_SIZE));
        if (res.totalCount != null) {
          setTotalCount(res.totalCount);
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        console.error('Failed to load more features', e);
      }
    } finally {
      if (seq === requestSeqRef.current) {
        setLoadingMore(false);
      }
    }
  }, [loading, loadingMore, hasMore, activeLayer, search]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    // Trigger next page when within 180px of bottom (approx 4 rows)
    if (scrollHeight - (scrollTop + clientHeight) < 180) {
      loadMore();
    }
  };

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

  // Auto fill if list doesn't cause overflow on large displays
  useEffect(() => {
    if (!loading && !loadingMore && hasMore && listContainerRef.current) {
      const el = listContainerRef.current;
      if (el.scrollHeight <= el.clientHeight && features.length > 0) {
        loadMore();
      }
    }
  }, [loading, loadingMore, hasMore, features.length, loadMore]);

  // Scroll selected item into view ONLY when selectedFeature ID changes
  useEffect(() => {
    const selectedId = selectedFeature?.id ? String(selectedFeature.id) : null;
    if (selectedId && selectedId !== lastScrolledSelectedIdRef.current && selectedRef.current) {
      lastScrolledSelectedIdRef.current = selectedId;
      selectedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (!selectedId) {
      lastScrolledSelectedIdRef.current = null;
    }
  }, [selectedFeature]);

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
          <span
            style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}
            title={totalCount != null ? `${features.length} loaded of ${totalCount} total` : `${features.length} features`}
          >
            {totalCount != null && totalCount > features.length ? `${features.length}/${totalCount}` : features.length}
          </span>
        )}
      </div>

      {/* Feature List */}
      <div
        ref={listContainerRef}
        className="inline-feature-list"
        onScroll={handleScroll}
      >
        {loading ? (
          <div className="inline-feature-empty">Loading {activeLayer}...</div>
        ) : features.length === 0 ? (
          <div className="inline-feature-empty">
            No {activeLayer}{search ? ` matching "${search}"` : ''} found.
          </div>
        ) : (
          <>
            {features.map((f) => {
              const rawId = String(parseFeatureId(f.id) ?? f.id);
              const selectedRawId = selectedFeature?.id ? String(parseFeatureId(selectedFeature.id) ?? selectedFeature.id) : null;
              const isSelected = (selectedFeature?.id != null && (selectedFeature.id === f.id || String(selectedFeature.id) === String(f.id))) ||
                (selectedRawId != null && selectedRawId === rawId) ||
                (selectedFeature?.properties?.id != null && f.properties?.id != null && String(selectedFeature.properties.id) === String(f.properties.id));
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
            })}

            {loadingMore && (
              <div className="inline-feature-loading-more">
                <span className="inline-feature-spinner" />
                <span>Loading more...</span>
              </div>
            )}
          </>
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
