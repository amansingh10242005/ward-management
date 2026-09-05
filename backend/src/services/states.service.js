import { pool } from '../db/pool.js';
import { NotFoundError, GeometryValidationError } from '../utils/errors.js';
import { mapRowToGeoJSONFeature } from '../utils/geojson.utils.js';

export const statesService = {
  async getAll(bbox) {
    let query = `
      SELECT id, state AS "STATE", state_lgd AS "State_LGD", ST_AsGeoJSON(geom) AS geom
      FROM states
    `;
    const params = [];

    if (bbox && bbox.length === 4) {
      query += ` WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)`;
      params.push(...bbox);
    }

    const { rows } = await pool.query(query, params);
    return {
      type: 'FeatureCollection',
      features: rows.map(mapRowToGeoJSONFeature),
    };
  },

  async update(id, feature) {
    const geoJsonStr = feature.geometry ? JSON.stringify(feature.geometry) : null;
    const stateName = feature.properties?.STATE || feature.properties?.name || feature.properties?.state_name;
    const stateLgd = feature.properties?.State_LGD || feature.properties?.state_code;

    if (geoJsonStr) {
      const validityCheck = await pool.query(`
        SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) as is_valid,
               ST_IsValidReason(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) as reason
      `, [geoJsonStr]);
      
      if (!validityCheck.rows[0].is_valid) {
        throw new GeometryValidationError('Invalid state geometry', validityCheck.rows[0].reason);
      }
    }

    const query = geoJsonStr ? `
      UPDATE states
      SET state = COALESCE($1, state),
          state_lgd = COALESCE($2, state_lgd),
          geom = ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)
      WHERE id = $4
      RETURNING id, state AS "STATE", state_lgd AS "State_LGD", ST_AsGeoJSON(geom) AS geom
    ` : `
      UPDATE states
      SET state = COALESCE($1, state),
          state_lgd = COALESCE($2, state_lgd)
      WHERE id = $3
      RETURNING id, state AS "STATE", state_lgd AS "State_LGD", ST_AsGeoJSON(geom) AS geom
    `;

    const params = geoJsonStr
      ? [stateName, stateLgd ? parseInt(stateLgd, 10) || null : null, geoJsonStr, id]
      : [stateName, stateLgd ? parseInt(stateLgd, 10) || null : null, id];

    const { rows } = await pool.query(query, params);

    if (rows.length === 0) {
      throw new NotFoundError('State not found');
    }
    return mapRowToGeoJSONFeature(rows[0]);
  },

  async delete(id) {
    const { rowCount } = await pool.query(`DELETE FROM states WHERE id = $1`, [id]);
    if (rowCount === 0) {
      throw new NotFoundError('State not found');
    }
  },
};
