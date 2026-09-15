/**
 * Safely parse a GeoServer feature ID to extract its raw numeric or string identifier.
 * GeoServer WFS often prefixes feature IDs with the layer name, e.g., 'zones.12'.
 * This utility isolates the identifier if present, or returns the original ID.
 * 
 * @param id The raw feature ID from OpenLayers/GeoServer
 * @returns The parsed ID without the layer prefix
 */
export function parseFeatureId(id: string | number | undefined | null): string | number | null {
  if (id == null) return null;
  
  if (typeof id === 'string' && id.includes('.')) {
    const parts = id.split('.');
    return parts.length > 1 ? parts[1] : id;
  }
  
  return id;
}

/**
 * Recursively extracts the first numeric [x, y] coordinate tuple from any GeoJSON geometry coordinates array.
 * Works uniformly on Point, LineString, Polygon, MultiPoint, MultiLineString, and MultiPolygon.
 */
export function findFirstCoordinate(coords: any): [number, number] | null {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    return [coords[0], coords[1]];
  }
  return findFirstCoordinate(coords[0]);
}

/**
 * Checks if a coordinate array is in EPSG:3857 (Web Mercator meters) rather than EPSG:4326 (degrees).
 */
export function isMercatorCoordinates(coords: any): boolean {
  const pt = findFirstCoordinate(coords);
  return pt !== null && (Math.abs(pt[0]) > 180 || Math.abs(pt[1]) > 90);
}
