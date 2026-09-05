/**
 * geometryValidation.ts — Client-side validation for vector geometries before saving.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateGeometry(geometry: any, _layerName: string): ValidationResult {
  if (!geometry || !geometry.type || !geometry.coordinates) {
    return { valid: false, error: 'Invalid geometry structure.' };
  }

  const { type, coordinates } = geometry;

  if (type === 'Point') {
    if (
      !Array.isArray(coordinates) ||
      coordinates.length < 2 ||
      isNaN(coordinates[0]) ||
      isNaN(coordinates[1])
    ) {
      return {
        valid: false,
        error: 'Point geometry requires valid numeric coordinates [longitude, latitude].',
      };
    }
    return { valid: true };
  }

  if (type === 'LineString') {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return {
        valid: false,
        error: 'A road line must contain at least 2 vertices.',
      };
    }

    for (let i = 0; i < coordinates.length; i++) {
      const pt = coordinates[i];
      if (!Array.isArray(pt) || pt.length < 2 || isNaN(pt[0]) || isNaN(pt[1])) {
        return {
          valid: false,
          error: `Vertex #${i + 1} has invalid coordinates.`,
        };
      }
    }

    // Ensure not all points are identical (collapsed line)
    const first = coordinates[0];
    const hasDistinction = coordinates.some(
      (c) => Math.abs(c[0] - first[0]) > 1e-7 || Math.abs(c[1] - first[1]) > 1e-7
    );
    if (!hasDistinction) {
      return {
        valid: false,
        error: 'The line must have distinct vertices and cannot be collapsed into a single point.',
      };
    }

    return { valid: true };
  }

  if (type === 'Polygon') {
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      return {
        valid: false,
        error: 'A polygon must have at least one linear ring.',
      };
    }

    const outerRing = coordinates[0];
    if (!Array.isArray(outerRing) || outerRing.length < 4) {
      return {
        valid: false,
        error: 'A polygon must have at least 3 distinct vertices (minimum 4 coordinates including the closing vertex).',
      };
    }

    // Auto-close outer ring if slightly open
    const first = outerRing[0];
    const last = outerRing[outerRing.length - 1];
    if (Math.abs(first[0] - last[0]) > 1e-7 || Math.abs(first[1] - last[1]) > 1e-7) {
      outerRing.push([...first]);
    }

    for (let i = 0; i < outerRing.length; i++) {
      const pt = outerRing[i];
      if (!Array.isArray(pt) || pt.length < 2 || isNaN(pt[0]) || isNaN(pt[1])) {
        return {
          valid: false,
          error: `Polygon vertex #${i + 1} has invalid coordinates.`,
        };
      }
    }

    return { valid: true };
  }

  if (type === 'MultiPolygon') {
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      return {
        valid: false,
        error: 'MultiPolygon must contain at least one polygon.',
      };
    }
    return { valid: true };
  }

  return { valid: true };
}
