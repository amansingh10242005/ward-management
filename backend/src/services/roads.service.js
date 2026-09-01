import { pool } from '../db/pool.js';
import { NotFoundError, GeometryValidationError } from '../utils/errors.js';
import { mapRowToGeoJSONFeature } from '../utils/geojson.utils.js';

export const roadsService = {
  async getAll(bbox) {
    let query = `
      SELECT id, name, category AS type, zone_id, created_at, updated_at, ST_AsGeoJSON(geom) AS geom 
      FROM roads
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

    if (!zoneId) {
      throw new GeometryValidationError('Missing zone_id', 'Roads must belong to a Zone');
    }

    // Geometric validation for LineStrings (Roads)
    const validityCheck = await pool.query(`
      SELECT ST_IsSimple(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) as is_simple,
             ST_Length(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography) as length,
             ST_Intersects(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), (SELECT geom FROM zones WHERE id = $2)) as is_inside_zone
    `, [geoJsonStr, zoneId]);
    
    if (!validityCheck.rows[0].is_simple) {
      throw new GeometryValidationError('Invalid road geometry', 'self-intersecting');
    }
    if (validityCheck.rows[0].length < 5) {
      throw new GeometryValidationError('Invalid road geometry', 'too short');
    }
    if (validityCheck.rows[0].is_inside_zone === null) {
      throw new NotFoundError('Zone not found');
    }
    if (validityCheck.rows[0].is_inside_zone === false) {
      throw new GeometryValidationError('Invalid road geometry', 'Road must intersect with the selected Zone');
    }

    const { rows } = await pool.query(`
      INSERT INTO roads (name, category, geom, zone_id)
      VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), $4)
      RETURNING id, name, category AS type, zone_id, created_at, updated_at, ST_AsGeoJSON(geom) AS geom
    `, [feature.properties.name, feature.properties.type, geoJsonStr, zoneId]);
    
    return mapRowToGeoJSONFeature(rows[0]);
  },

  async update(id, feature) {
    const geoJsonStr = JSON.stringify(feature.geometry);
    const zoneId = feature.properties.zone_id;

    if (!zoneId) {
      throw new GeometryValidationError('Missing zone_id', 'Roads must belong to a Zone');
    }

    // Geometric validation for LineStrings (Roads)
    const validityCheck = await pool.query(`
      SELECT ST_IsSimple(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) as is_simple,
             ST_Length(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography) as length,
             ST_Intersects(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), (SELECT geom FROM zones WHERE id = $2)) as is_inside_zone
    `, [geoJsonStr, zoneId]);
    
    if (!validityCheck.rows[0].is_simple) {
      throw new GeometryValidationError('Invalid road geometry', 'self-intersecting');
    }
    if (validityCheck.rows[0].length < 5) {
      throw new GeometryValidationError('Invalid road geometry', 'too short');
    }
    if (validityCheck.rows[0].is_inside_zone === null) {
      throw new NotFoundError('Zone not found');
    }
    if (validityCheck.rows[0].is_inside_zone === false) {
      throw new GeometryValidationError('Invalid road geometry', 'Road must intersect with the selected Zone');
    }

    const { rows } = await pool.query(`
      UPDATE roads 
      SET name = $1, category = $2, geom = ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), zone_id = $4, updated_at = NOW()
      WHERE id = $5
      RETURNING id, name, category AS type, zone_id, created_at, updated_at, ST_AsGeoJSON(geom) AS geom
    `, [feature.properties.name, feature.properties.type, geoJsonStr, zoneId, id]);
    
    if (rows.length === 0) {
      throw new NotFoundError('Road not found');
    }
    
    return mapRowToGeoJSONFeature(rows[0]);
  },

  async delete(id) {
    const { rowCount } = await pool.query(`DELETE FROM roads WHERE id = $1`, [id]);
    if (rowCount === 0) {
      throw new NotFoundError('Road not found');
    }
  }
};
