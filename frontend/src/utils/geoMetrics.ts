import GeoJSON from 'ol/format/GeoJSON';
import { getLength, getArea } from 'ol/sphere';
import { parseFeatureId } from './featureUtils';

export interface TelemetryCell {
  label: string;
  value: string;
  isTeal?: boolean;
}

export interface FeatureTelemetry {
  title: string;
  fid: string;
  cells: [TelemetryCell, TelemetryCell, TelemetryCell, TelemetryCell];
}

function findFirstCoordinate(coords: any): number[] | null {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    return [coords[0], coords[1]];
  }
  return findFirstCoordinate(coords[0]);
}

/**
 * Compute geometric length or area using OpenLayers spherical methods.
 */
export function calculateGeometryMetric(geometry: any): { label: string; value: string } | null {
  if (!geometry || !geometry.coordinates) return null;
  try {
    const sampleCoord = findFirstCoordinate(geometry.coordinates);
    const isMercator = sampleCoord && (Math.abs(sampleCoord[0]) > 180 || Math.abs(sampleCoord[1]) > 90);

    const geojson = new GeoJSON();
    const olGeom = geojson.readGeometry(geometry, {
      dataProjection: isMercator ? 'EPSG:3857' : 'EPSG:4326',
      featureProjection: 'EPSG:4326',
    });

    const geomType = olGeom.getType();
    if (geomType === 'LineString' || geomType === 'MultiLineString') {
      const lengthMeters = getLength(olGeom, { projection: 'EPSG:4326' });
      if (!isNaN(lengthMeters) && isFinite(lengthMeters) && lengthMeters > 0) {
        return {
          label: 'LENGTH',
          value: `${lengthMeters.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`,
        };
      }
    } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
      const areaSqM = getArea(olGeom, { projection: 'EPSG:4326' });
      if (!isNaN(areaSqM) && isFinite(areaSqM) && areaSqM > 0) {
        if (areaSqM > 1000000) {
          return {
            label: 'AREA',
            value: `${(areaSqM / 1000000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km²`,
          };
        }
        return {
          label: 'AREA',
          value: `${areaSqM.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`,
        };
      }
    } else if (geomType === 'Point') {
      return null;
    }
  } catch (err) {
    console.debug('Failed to compute geometry metric:', err);
  }
  return null;
}

/**
 * Format a selected GeoJSON feature into the 4-cell HUD metadata grid using actual database fields.
 */
export function getFeatureTelemetry(feature: any, layerName: string | null): FeatureTelemetry {
  const props = feature?.properties || {};
  const rawFid = parseFeatureId(feature?.id);
  const fidDisplay = rawFid ? `FID #${rawFid}` : 'FID #---';

  const geomMetric = calculateGeometryMetric(feature?.geometry);

  if (layerName === 'roads') {
    const roadName = props.name || (rawFid ? `Road #${rawFid}` : 'Unnamed Road');
    const category = props.category || props.type 
      ? (String(props.category || props.type).charAt(0).toUpperCase() + String(props.category || props.type).slice(1))
      : 'Local';
    const zoneVal = props.zone_id != null ? `Zone ${props.zone_id}` : 'Unassigned';
    const lengthVal = geomMetric?.value || (props.length ? `${Number(props.length).toFixed(2)} m` : 'Calculating…');

    return {
      title: roadName,
      fid: fidDisplay,
      cells: [
        { label: 'CATEGORY', value: category },
        { label: 'ZONE', value: zoneVal },
        { label: 'ID', value: rawFid ? `#${rawFid}` : 'N/A' },
        { label: 'LENGTH', value: lengthVal, isTeal: true },
      ],
    };
  }

  if (layerName === 'streetlights') {
    const slName = props.name || props.identifier || (rawFid ? `SL-${rawFid}` : 'Streetlight');
    const slType = props.type 
      ? (String(props.type).charAt(0).toUpperCase() + String(props.type).slice(1)) 
      : 'Standard';
    const zoneVal = props.zone_id != null ? `Zone ${props.zone_id}` : 'Unassigned';
    const roadVal = props.road_id != null ? `Road #${props.road_id}` : 'Unassigned';

    return {
      title: slName,
      fid: fidDisplay,
      cells: [
        { label: 'TYPE', value: slType },
        { label: 'ROAD', value: roadVal },
        { label: 'ZONE', value: zoneVal },
        { label: 'ID', value: rawFid ? `#${rawFid}` : 'N/A', isTeal: true },
      ],
    };
  }

  if (layerName === 'zones') {
    const zoneName = props.name || (rawFid ? `Zone #${rawFid}` : 'Zone');
    const zoneType = props.type ? (String(props.type).charAt(0).toUpperCase() + String(props.type).slice(1)) : 'Commercial';
    const createdVal = props.created_at
      ? new Date(props.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'Persisted';
    const areaVal = geomMetric?.value || 'Calculating…';

    return {
      title: zoneName,
      fid: fidDisplay,
      cells: [
        { label: 'TYPE', value: zoneType },
        { label: 'ID', value: rawFid ? `#${rawFid}` : 'N/A' },
        { label: 'CREATED', value: createdVal },
        { label: 'AREA', value: areaVal, isTeal: true },
      ],
    };
  }

  if (layerName === 'districts') {
    const distName = props.District || props.district || props.district_name || (rawFid ? `District #${rawFid}` : 'District');
    const stateVal = props.STATE || props.State || props.state || 'Unassigned';
    const lgdCode = String(props.DISTRICT_L ?? props.district_l ?? props.district_code ?? 'N/A');
    const areaVal = geomMetric?.value || 'Calculating…';

    return {
      title: distName,
      fid: fidDisplay,
      cells: [
        { label: 'STATE', value: stateVal },
        { label: 'LGD CODE', value: lgdCode },
        { label: 'ID', value: rawFid ? `#${rawFid}` : 'N/A' },
        { label: 'AREA', value: areaVal, isTeal: true },
      ],
    };
  }

  if (layerName === 'states') {
    const stName = props.STATE || props.state || props.state_name || (rawFid ? `State #${rawFid}` : 'State');
    const lgdCode = String(props.State_LGD ?? props.state_lgd ?? props.state_code ?? 'N/A');
    const areaVal = geomMetric?.value || 'Calculating…';

    return {
      title: stName,
      fid: fidDisplay,
      cells: [
        { label: 'LGD CODE', value: lgdCode },
        { label: 'GEOMETRY', value: 'MultiPolygon' },
        { label: 'ID', value: rawFid ? `#${rawFid}` : 'N/A' },
        { label: 'AREA', value: areaVal, isTeal: true },
      ],
    };
  }

  return {
    title: props.name || `Feature ${rawFid || ''}`,
    fid: fidDisplay,
    cells: [
      { label: 'ID', value: rawFid ? `#${rawFid}` : 'N/A' },
      { label: 'LAYER', value: layerName || 'Feature' },
      { label: 'STATUS', value: 'Persisted' },
      { label: 'METRIC', value: geomMetric?.value || 'N/A', isTeal: true },
    ],
  };
}
