import { useState } from 'react';
import { olService } from '../lib/openlayers';
import { IconStreetlight, IconLine, IconPolygon, IconEye, IconEyeOff, IconMore } from './Icons';

interface LayerControlProps {
  activeLayer: 'streetlights' | 'roads' | 'zones' | 'states' | 'districts' | null;
  setActiveLayer: (layer: 'streetlights' | 'roads' | 'zones' | 'states' | 'districts' | null) => void;
}

export default function LayerControl({ activeLayer, setActiveLayer }: LayerControlProps) {
  const [layers, setLayers] = useState({
    streetlights: false,
    roads: false,
    zones: false,
    states: false,
    districts: false,
  });

  const toggleLayer = (e: React.MouseEvent, layerName: keyof typeof layers) => {
    e.stopPropagation();
    const isVisible = !layers[layerName];
    setLayers(prev => ({ ...prev, [layerName]: isVisible }));
    olService.toggleLayer(layerName, isVisible);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* State Boundary row */}
      <div
        className={`layer-row${activeLayer === 'states' ? ' active' : ''}`}
        data-layer="states"
        role="row"
        onClick={() => setActiveLayer(activeLayer === 'states' ? null : 'states')}
        style={{ cursor: 'pointer' }}
      >
        <div className="layer-icon">
          <IconPolygon />
        </div>
        <div className="layer-name">State Boundaries</div>
        <button
          className={`layer-toggle${!layers.states ? ' hidden' : ''}`}
          onClick={(e) => toggleLayer(e, 'states')}
          title={layers.states ? 'Hide layer' : 'Show layer'}
          aria-label={layers.states ? 'Hide states layer' : 'Show states layer'}
        >
          {layers.states ? <IconEye /> : <IconEyeOff />}
        </button>
        <button className="layer-toggle" title="Layer options" aria-label="States layer options" onClick={e => e.stopPropagation()}>
          <IconMore />
        </button>
      </div>

      {/* District Boundary row */}
      <div
        className={`layer-row${activeLayer === 'districts' ? ' active' : ''}`}
        data-layer="districts"
        role="row"
        onClick={() => setActiveLayer(activeLayer === 'districts' ? null : 'districts')}
        style={{ cursor: 'pointer' }}
      >
        <div className="layer-icon">
          <IconPolygon />
        </div>
        <div className="layer-name">District Boundaries</div>
        <button
          className={`layer-toggle${!layers.districts ? ' hidden' : ''}`}
          onClick={(e) => toggleLayer(e, 'districts')}
          title={layers.districts ? 'Hide layer' : 'Show layer'}
          aria-label={layers.districts ? 'Hide districts layer' : 'Show districts layer'}
        >
          {layers.districts ? <IconEye /> : <IconEyeOff />}
        </button>
        <button className="layer-toggle" title="Layer options" aria-label="Districts layer options" onClick={e => e.stopPropagation()}>
          <IconMore />
        </button>
      </div>
      {/* Streetlights row */}
      <div
        className={`layer-row${activeLayer === 'streetlights' ? ' active' : ''}`}
        data-layer="streetlights"
        role="row"
        onClick={() => setActiveLayer(activeLayer === 'streetlights' ? null : 'streetlights')}
        style={{ cursor: 'pointer' }}
      >
        <div className="layer-icon" style={{ color: 'var(--text-main)', background: 'rgba(255,165,0,0.2)' }}>
          <IconStreetlight />
        </div>
        <div className="layer-name">Streetlights</div>
        <button
          className={`layer-toggle${!layers.streetlights ? ' hidden' : ''}`}
          onClick={(e) => toggleLayer(e, 'streetlights')}
          title={layers.streetlights ? 'Hide layer' : 'Show layer'}
          aria-label={layers.streetlights ? 'Hide streetlights layer' : 'Show streetlights layer'}
        >
          {layers.streetlights ? <IconEye /> : <IconEyeOff />}
        </button>
        <button className="layer-toggle" title="Layer options" aria-label="Streetlights layer options" onClick={e => e.stopPropagation()}>
          <IconMore />
        </button>
      </div>

      {/* Roads row */}
      <div
        className={`layer-row${activeLayer === 'roads' ? ' active' : ''}`}
        data-layer="roads"
        role="row"
        onClick={() => setActiveLayer(activeLayer === 'roads' ? null : 'roads')}
        style={{ cursor: 'pointer' }}
      >
        <div className="layer-icon" style={{ color: 'var(--text-main)', background: 'rgba(59,130,246,0.2)' }}>
          <IconLine />
        </div>
        <div className="layer-name">Roads</div>
        <button
          className={`layer-toggle${!layers.roads ? ' hidden' : ''}`}
          onClick={(e) => toggleLayer(e, 'roads')}
          title={layers.roads ? 'Hide layer' : 'Show layer'}
          aria-label={layers.roads ? 'Hide roads layer' : 'Show roads layer'}
        >
          {layers.roads ? <IconEye /> : <IconEyeOff />}
        </button>
        <button className="layer-toggle" title="Layer options" aria-label="Roads layer options" onClick={e => e.stopPropagation()}>
          <IconMore />
        </button>
      </div>

      {/* Zones row */}
      <div
        className={`layer-row${activeLayer === 'zones' ? ' active' : ''}`}
        data-layer="zones"
        role="row"
        onClick={() => setActiveLayer(activeLayer === 'zones' ? null : 'zones')}
        style={{ cursor: 'pointer' }}
      >
        <div className="layer-icon" style={{ color: 'var(--text-main)', background: 'rgba(16,185,129,0.2)', border: '1px solid #10b981' }}>
          <IconPolygon />
        </div>
        <div className="layer-name">Zones</div>
        <button
          className={`layer-toggle${!layers.zones ? ' hidden' : ''}`}
          onClick={(e) => toggleLayer(e, 'zones')}
          title={layers.zones ? 'Hide layer' : 'Show layer'}
          aria-label={layers.zones ? 'Hide zones layer' : 'Show zones layer'}
        >
          {layers.zones ? <IconEye /> : <IconEyeOff />}
        </button>
        <button className="layer-toggle" title="Layer options" aria-label="Zones layer options" onClick={e => e.stopPropagation()}>
          <IconMore />
        </button>
      </div>
    </div>
  );
}
