import { BasemapId } from '../lib/openlayers';
import { IconLayers, IconCheck } from './Icons';

interface BasemapOption {
  id: BasemapId;
  name: string;
  subtitle: string;
  emoji: string;
}

const BASEMAP_OPTIONS: BasemapOption[] = [
  {
    id: 'arcgis_satellite',
    name: 'ArcGIS Satellite',
    subtitle: 'High-Res Aerial',
    emoji: '🛰️',
  },
  {
    id: 'sentinel_satellite',
    name: 'Sentinel-2 Satellite',
    subtitle: 'Multispectral',
    emoji: '📡',
  },
  {
    id: 'osm',
    name: 'OpenStreetMap',
    subtitle: 'Street Vector',
    emoji: '🗺️',
  },
  {
    id: 'carto_dark',
    name: 'CartoDB Dark Mode',
    subtitle: 'High Contrast',
    emoji: '🌙',
  },
  {
    id: 'arcgis_topo',
    name: 'ArcGIS Topo',
    subtitle: 'Contour Relief',
    emoji: '🏔️',
  },
  {
    id: 'carto_voyager',
    name: 'CartoDB Voyager',
    subtitle: 'Detailed Street',
    emoji: '🎨',
  },
  {
    id: 'none',
    name: 'None',
    subtitle: 'Blank Canvas',
    emoji: '🚫',
  },
];

interface BasemapModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBasemap: BasemapId;
  onSelectBasemap: (id: BasemapId) => void;
}

export default function BasemapModal({
  isOpen,
  onClose,
  currentBasemap,
  onSelectBasemap,
}: BasemapModalProps) {
  if (!isOpen) return null;

  return (
    <div className="basemap-modal-wrapper">
      <div
        className="basemap-modal-container"
        role="dialog"
        aria-label="Base Maps and Terrain"
      >
        {/* Header */}
        <div className="basemap-modal-header">
          <div className="basemap-header-badge">
            <IconLayers width={18} height={18} />
          </div>
          <div className="basemap-header-text">
            <h2 className="basemap-title">BASE MAPS &amp; TERRAIN</h2>
            <p className="basemap-subtitle">Select aerial imagery &amp; 3D mesh surface</p>
          </div>
          <button
            type="button"
            className="basemap-close-btn"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Section Title */}
        <div className="basemap-section-title-row">
          <span className="basemap-section-title">1. IMAGERY &amp; BASE MAPS</span>
          <span className="basemap-section-tag">2D &amp; 3D Supported</span>
        </div>

        {/* Basemap 2-Column Grid */}
        <div className="basemap-grid">
          {BASEMAP_OPTIONS.map((opt) => {
            const isSelected = currentBasemap === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={`basemap-card ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  onSelectBasemap(opt.id);
                }}
              >
                <div className="basemap-card-top">
                  <span className="basemap-card-emoji" role="img" aria-label={opt.name}>
                    {opt.emoji}
                  </span>
                  {isSelected && (
                    <div className="basemap-check-circle">
                      <IconCheck width={12} height={12} />
                    </div>
                  )}
                </div>
                <div className="basemap-card-body">
                  <span className="basemap-card-name">{opt.name}</span>
                  <span className="basemap-card-sub">{opt.subtitle}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
