export { default } from './UnifiedLegend';
export * from './UnifiedLegend';

// Backwards-compatibility interface alias
export type DynamicLayer = {
  workspace: string;
  name: string;
  qualifiedName: string;
  title: string;
  abstract?: string;
  srs?: string;
  nativeBoundingBox?: any;
  latLonBoundingBox?: any;
  defaultStyle?: string;
};
