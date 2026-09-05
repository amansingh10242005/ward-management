import { useState, useEffect, useRef } from 'react';
import { olService } from '../lib/openlayers';
import { IconSearch } from './Icons';

interface FeatureListProps {
  activeLayer: 'streetlights' | 'roads' | 'zones' | 'states' | 'districts';
  selectedFeature: any | null;
  onSelectFeature: (feature: any) => void;
}

export default function FeatureList({ activeLayer, selectedFeature, onSelectFeature }: FeatureListProps) {
  const [features, setFeatures] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const selectedRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchFeatures = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    try {
      const f = await olService.searchFeaturesFromBackend(activeLayer, search, controller.signal);
      setFeatures(f);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        console.error(e);
        setFeatures([]);
      }
    } finally {
      setLoading(false);
    }
  };

  // Fetch when activeLayer or search changes (with debounce)
  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchFeatures();
    }, 250);
    return () => clearTimeout(timeout);
  }, [activeLayer, search]);

  // Refresh when layer is modified (create/update/delete)
  useEffect(() => {
    const cleanup = olService.onLayerRefresh((refreshedLayer) => {
      if (refreshedLayer === activeLayer) {
        fetchFeatures();
      }
    });
    return cleanup;
  }, [activeLayer, fetchFeatures]);

  useEffect(() => {
    if (selectedFeature && selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedFeature, features]);

  const getFeatureDisplay = (f: any) => {
    const props = f.properties || {};
    switch (activeLayer) {
      case 'states': return { primary: props.state || props.STATE || props.state_name || `State ${f.id}`, secondary: props.state_lgd ? `LGD: ${props.state_lgd}` : (props.state_code ? `Code: ${props.state_code}` : `ID: ${f.id}`) };
      case 'districts': return { primary: props.district || props.District || props.district_name || `District ${f.id}`, secondary: (props.state || props.State) ? `State: ${props.state || props.State}` : `ID: ${f.id}` };
      case 'zones': return { primary: props.name || `Zone ${f.id}`, secondary: props.type ? `Type: ${props.type}` : `ID: ${f.id}` };
      case 'roads': return { primary: props.name || `Road ${f.id}`, secondary: props.zone_id ? `Zone ID: ${props.zone_id}` : `ID: ${f.id}` };
      case 'streetlights': return { primary: props.name || props.identifier || `Streetlight ${f.id}`, secondary: props.road_id ? `Road ID: ${props.road_id}` : `ID: ${f.id}` };
      default: return { primary: `Feature ${f.id}`, secondary: '' };
    }
  };

  const filteredFeatures = features;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '10px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="search-bar" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <IconSearch />
          <input 
            type="text" 
            placeholder={`Search ${activeLayer}...`} 
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--text-main)' }}
          />
        </div>
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading {activeLayer}...
          </div>
        ) : filteredFeatures.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No {activeLayer} found{search ? ` matching "${search}"` : ''}.
          </div>
        ) : (
          filteredFeatures.map(f => {
            const isSelected = selectedFeature?.id === f.id;
            const { primary, secondary } = getFeatureDisplay(f);
            return (
              <div 
                key={f.id}
                ref={isSelected ? selectedRef : null}
                onClick={() => onSelectFeature(f)}
                style={{ 
                  padding: '10px 15px', 
                  cursor: 'pointer', 
                  background: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                  borderLeft: isSelected ? '3px solid #3b82f6' : '3px solid transparent',
                  borderBottom: '1px solid rgba(255,255,255,0.02)'
                }}
                onMouseEnter={e => { if(!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                onMouseLeave={e => { if(!isSelected) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ fontWeight: 600, color: isSelected ? '#60a5fa' : 'var(--text-main)', fontSize: '13px' }}>
                  {primary}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {secondary}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
