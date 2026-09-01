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

  const fetchFeatures = async () => {
    setLoading(true);
    try {
      const f = await olService.searchFeaturesFromBackend(activeLayer, search);
      setFeatures(f);
    } catch (e) {
      console.error(e);
      setFeatures([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch when activeLayer or search changes (with debounce)
  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchFeatures();
    }, 300);
    return () => clearTimeout(timeout);
  }, [activeLayer, search]);

  // Fetch when map moves
  useEffect(() => {
    const cleanup = olService.onMoveEnd(() => {
      fetchFeatures();
    });
    return cleanup;
  }, [activeLayer, search]);

  useEffect(() => {
    if (selectedFeature && selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedFeature, features]);

  const getFeatureDisplay = (f: any) => {
    const props = f.properties || {};
    switch (activeLayer) {
      case 'states': return { primary: props.STATE || props.state_name || `State ${f.id}`, secondary: props.state_code ? `Code: ${props.state_code}` : `ID: ${f.id}` };
      case 'districts': return { primary: props.District || props.district_name || `District ${f.id}`, secondary: props.State ? `State: ${props.State}` : `ID: ${f.id}` };
      case 'zones': return { primary: props.name || `Zone ${f.id}`, secondary: `ID: ${f.id}` };
      case 'roads': return { primary: props.name || `Road ${f.id}`, secondary: `Zone ID: ${props.zone_id || 'N/A'}` };
      case 'streetlights': return { primary: props.identifier || props.name || `Streetlight ${f.id}`, secondary: `Road ID: ${props.road_id || 'N/A'}` };
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
