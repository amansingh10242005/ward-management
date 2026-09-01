export function mapRowToGeoJSONFeature(row) {
  const { id, geom, ...properties } = row;
  return {
    type: 'Feature',
    id,
    geometry: JSON.parse(geom),
    properties
  };
}
