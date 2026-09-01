import type { Feature, Point } from 'geojson';

export interface StreetlightProperties {
  name: string;
  type: string;
  created_at?: string;
  updated_at?: string;
}

export interface StreetlightFeature extends Feature<Point, StreetlightProperties> {
  id?: number | string; // Feature ID from PostGIS
}
