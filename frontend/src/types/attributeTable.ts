/**
 * attributeTable.ts — Generic Data Model for GIS Attribute Table
 * Supports arbitrary discovered GeoServer schemas and Core PostGIS layers.
 */

export interface AttributeTableColumn {
  name: string;
  label: string;
  type: string;
  localType: string;
  editable: boolean;
  nullable: boolean;
  isGeometry?: boolean;
}

export interface AttributeTableRow {
  id: string | number;
  properties: Record<string, any>;
  geometry?: any;
  geomType: string;
  centroid?: [number, number] | null; // [lon, lat]
}

export interface AttributeTableQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortDirection?: 'ASC' | 'DESC';
  filterProp?: string;
  filterVal?: string | number;
}

export interface AttributeTableResponse {
  layerName: string;
  page: number;
  pageSize: number;
  totalFeatures: number;
  totalPages: number;
  schema?: {
    layerName: string;
    qualifiedName: string;
    properties: Array<{ name: string; type: string; localType: string }>;
  };
  features: AttributeTableRow[];
}
