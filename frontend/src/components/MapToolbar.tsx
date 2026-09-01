import { IconPoint, IconLine, IconPolygon } from './Icons';

interface MapToolbarProps {
  mode: 'idle' | 'create' | 'edit' | 'move';
  activeLayer: 'streetlights' | 'roads' | 'zones' | 'states' | 'districts' | null;
  onDrawPoint: () => void;
  onDrawLine: () => void;
  onDrawPolygon: () => void;
}

export default function MapToolbar({
  mode,
  activeLayer,
  onDrawPoint,
  onDrawLine,
  onDrawPolygon,
}: MapToolbarProps) {
  const isDrawingPoint   = mode === 'create' && activeLayer === 'streetlights';
  const isDrawingLine    = mode === 'create' && activeLayer === 'roads';
  const isDrawingPolygon = mode === 'create' && activeLayer === 'zones';

  return (
    <div className="map-toolbar" role="toolbar" aria-label="Map drawing tools">
      <button
        className={`btn-icon${isDrawingPoint ? ' active' : ''}`}
        onClick={onDrawPoint}
        title="Draw Streetlight (Point)"
        aria-label="Draw Streetlight"
        aria-pressed={isDrawingPoint}
      >
        <IconPoint />
      </button>

      <button
        className={`btn-icon${isDrawingLine ? ' active' : ''}`}
        onClick={onDrawLine}
        title="Draw Road (Line)"
        aria-label="Draw Road"
        aria-pressed={isDrawingLine}
      >
        <IconLine />
      </button>

      <button
        className={`btn-icon${isDrawingPolygon ? ' active' : ''}`}
        onClick={onDrawPolygon}
        title="Draw Zone (Polygon)"
        aria-label="Draw Zone"
        aria-pressed={isDrawingPolygon}
      >
        <IconPolygon />
      </button>
    </div>
  );
}
