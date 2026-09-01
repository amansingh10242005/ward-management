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
