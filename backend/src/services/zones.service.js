import { pool } from '../db/pool.js';
import { NotFoundError, GeometryValidationError } from '../utils/errors.js';
import { mapRowToGeoJSONFeature } from '../utils/geojson.utils.js';

export const zonesService = {
  async getAll(bbox) {
    let query = `
      SELECT id, name, type, created_at, updated_at, ST_AsGeoJSON(geom) AS geom 
      FROM zones
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
    
    // Pre-check geometry validity for Polygons
    const validityCheck = await pool.query(`
      SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) as is_valid,
             ST_IsValidReason(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) as reason,
             ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography) as area
    `, [geoJsonStr]);
    
    if (!validityCheck.rows[0].is_valid) {
      throw new GeometryValidationError('Invalid zone geometry', validityCheck.rows[0].reason);
    }
    if (validityCheck.rows[0].area < 50) {
      throw new GeometryValidationError('Invalid zone geometry', 'area too small');
    }

    const { rows } = await pool.query(`
      INSERT INTO zones (name, type, geom)
      VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))
      RETURNING id, name, type, created_at, updated_at, ST_AsGeoJSON(geom) AS geom
    `, [feature.properties.name, feature.properties.type, geoJsonStr]);
    
    return mapRowToGeoJSONFeature(rows[0]);
  },

  async update(id, feature) {
    const geoJsonStr = JSON.stringify(feature.geometry);
    
    // Pre-check geometry validity for Polygons
    const validityCheck = await pool.query(`
      SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) as is_valid,
             ST_IsValidReason(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) as reason,
             ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography) as area
    `, [geoJsonStr]);
    
    if (!validityCheck.rows[0].is_valid) {
      throw new GeometryValidationError('Invalid zone geometry', validityCheck.rows[0].reason);
    }
    if (validityCheck.rows[0].area < 50) {
      throw new GeometryValidationError('Invalid zone geometry', 'area too small');
    }

    const { rows } = await pool.query(`
      UPDATE zones 
      SET name = $1, type = $2, geom = ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), updated_at = NOW()
      WHERE id = $4
      RETURNING id, name, type, created_at, updated_at, ST_AsGeoJSON(geom) AS geom
    `, [feature.properties.name, feature.properties.type, geoJsonStr, id]);
    
    if (rows.length === 0) {
      throw new NotFoundError('Zone not found');
    }
    
    return mapRowToGeoJSONFeature(rows[0]);
  },

  async delete(id) {
    const { rowCount } = await pool.query(`DELETE FROM zones WHERE id = $1`, [id]);
    if (rowCount === 0) {
      throw new NotFoundError('Zone not found');
    }
  }
};
