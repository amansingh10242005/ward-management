import { pool } from '../db/pool.js';
import { NotFoundError, GeometryValidationError } from '../utils/errors.js';
import { mapRowToGeoJSONFeature } from '../utils/geojson.utils.js';

/**
 * streetlights.service.js — PostGIS data access layer for streetlights.
 *
 * Responsibilities:
 *  - Execute parameterized SQL queries against the PostGIS database
 *  - Convert between raw DB rows and GeoJSON format for the API layer
 *  - Utilize PostGIS functions (ST_GeomFromGeoJSON, ST_AsGeoJSON, ST_SetSRID)
 */

export const streetlightsService = {
  async getAll(bbox) {
    let query = `
      SELECT id, name, type, zone_id, road_id, created_at, updated_at, ST_AsGeoJSON(geom) AS geom 
      FROM streetlights
    `;
    const params = [];
    
    if (bbox && bbox.length === 4) {
      query += ` WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)`;
      params.push(...bbox);
    }
    
    const { rows } = await pool.query(query, params);
    
    return {
      type: 'FeatureCollection',
      features: rows.map(mapRowToGeoJSONFeature)
    };
  },

  async create(feature) {
    const geoJsonStr = JSON.stringify(feature.geometry);
    const zoneId = feature.properties.zone_id;
    const roadId = feature.properties.road_id;

    if (!zoneId || !roadId) {
      throw new GeometryValidationError('Missing relationships', 'Streetlight requires both zone_id and road_id');
    }

    // Validate road belongs to zone and spatial distance
    const validityCheck = await pool.query(`
      SELECT 
        (SELECT zone_id FROM roads WHERE id = $1) as road_zone_id,
        ST_DWithin(
          ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geography,
          (SELECT geom FROM roads WHERE id = $1)::geography,
          10
        ) as is_near_road
    `, [roadId, geoJsonStr]);

    const { road_zone_id, is_near_road } = validityCheck.rows[0];

    if (road_zone_id == null) {
      throw new NotFoundError('Road not found');
    }
    if (road_zone_id !== zoneId) {
      throw new GeometryValidationError('Invalid relationships', 'The selected Road does not belong to the selected Zone');
    }
    if (!is_near_road) {
      throw new GeometryValidationError('Invalid geometry', 'Streetlight must be placed on or near the selected road');
    }

    const { rows } = await pool.query(`
      INSERT INTO streetlights (name, type, geom, zone_id, road_id)
      VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4, $5)
      RETURNING id, name, type, zone_id, road_id, created_at, updated_at, ST_AsGeoJSON(geom) AS geom
    `, [feature.properties.name, feature.properties.type, geoJsonStr, zoneId, roadId]);
    
    return mapRowToGeoJSONFeature(rows[0]);
  },

  async update(id, feature) {
    const geoJsonStr = JSON.stringify(feature.geometry);
    let zoneId = feature.properties?.zone_id;
    let roadId = feature.properties?.road_id;
    let name = feature.properties?.name;
    let type = feature.properties?.type;

    if (!zoneId || !roadId || !name) {
      const existing = await pool.query('SELECT name, type, zone_id, road_id FROM streetlights WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        throw new NotFoundError('Streetlight not found');
      }
      if (!zoneId) zoneId = existing.rows[0].zone_id;
      if (!roadId) roadId = existing.rows[0].road_id;
      if (!name) name = existing.rows[0].name;
      if (!type) type = existing.rows[0].type;
    }

    if (!zoneId || !roadId) {
      throw new GeometryValidationError('Missing relationships', 'Streetlight requires both zone_id and road_id');
    }

    // Validate road belongs to zone and spatial distance
    const validityCheck = await pool.query(`
      SELECT 
        (SELECT zone_id FROM roads WHERE id = $1) as road_zone_id,
        ST_DWithin(
          ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geography,
          (SELECT geom FROM roads WHERE id = $1)::geography,
          10
        ) as is_near_road
    `, [roadId, geoJsonStr]);

    const { road_zone_id, is_near_road } = validityCheck.rows[0];

    if (road_zone_id == null) {
      throw new NotFoundError('Road not found');
    }
    if (road_zone_id !== zoneId) {
      throw new GeometryValidationError('Invalid relationships', 'The selected Road does not belong to the selected Zone');
    }
    if (!is_near_road) {
      throw new GeometryValidationError('Invalid geometry', 'Streetlight must be placed on or near the selected road');
    }

    const { rows } = await pool.query(`
      UPDATE streetlights 
      SET name = $1, type = $2, geom = ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), zone_id = $4, road_id = $5, updated_at = NOW()
      WHERE id = $6
      RETURNING id, name, type, zone_id, road_id, created_at, updated_at, ST_AsGeoJSON(geom) AS geom
    `, [feature.properties.name, feature.properties.type, geoJsonStr, zoneId, roadId, id]);
    
    if (rows.length === 0) {
      throw new NotFoundError('Streetlight not found');
    }
    
    return mapRowToGeoJSONFeature(rows[0]);
  },

  async delete(id) {
    const { rowCount } = await pool.query(`DELETE FROM streetlights WHERE id = $1`, [id]);
    if (rowCount === 0) {
      throw new NotFoundError('Streetlight not found');
    }
  }
};
