export type GeometryType = 'Point' | 'LineString' | 'Polygon' | 'MultiPolygon' | 'MultiLineString' | 'MultiPoint';

export interface GeoJSONGeometry {
  type: GeometryType;
  coordinates: any[];
}

export interface ZoneProperties {
  name?: string;
  type?: string;
  created_at?: string;
  updated_at?: string;
}

export interface RoadProperties {
  name?: string;
  type?: string; // mapped from category in backend
  zone_id?: number;
  created_at?: string;
  updated_at?: string;
}

export interface StreetlightProperties {
  name?: string;
  type?: string;
  zone_id?: number;
  road_id?: number;
  created_at?: string;
  updated_at?: string;
}

export interface GeoJSONFeature<T = any> {
  type: 'Feature';
  id?: string | number;
  geometry: GeoJSONGeometry;
  properties: T;
}

export type ZoneFeature = GeoJSONFeature<ZoneProperties>;
export type RoadFeature = GeoJSONFeature<RoadProperties>;
export type StreetlightFeature = GeoJSONFeature<StreetlightProperties>;
