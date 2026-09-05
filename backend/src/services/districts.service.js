import { pool } from '../db/pool.js';
import { NotFoundError, GeometryValidationError } from '../utils/errors.js';
import { mapRowToGeoJSONFeature } from '../utils/geojson.utils.js';

export const districtsService = {
  async getAll(bbox) {
    let query = `
      SELECT id, district_l AS "DISTRICT_L", district AS "District", state AS "STATE", ST_AsGeoJSON(geom) AS geom
      FROM districts
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
    const districtName = feature.properties?.District || feature.properties?.name || feature.properties?.district_name;
    const stateName = feature.properties?.STATE || feature.properties?.state || feature.properties?.state_name;
    const districtLgd = feature.properties?.DISTRICT_L || feature.properties?.district_code;

    if (geoJsonStr) {
      const validityCheck = await pool.query(`
        SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) as is_valid,
               ST_IsValidReason(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) as reason
      `, [geoJsonStr]);
      
      if (!validityCheck.rows[0].is_valid) {
        throw new GeometryValidationError('Invalid district geometry', validityCheck.rows[0].reason);
      }
    }

    const query = geoJsonStr ? `
      UPDATE districts
      SET district = COALESCE($1, district),
          state = COALESCE($2, state),
          district_l = COALESCE($3, district_l),
          geom = ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)
      WHERE id = $5
      RETURNING id, district_l AS "DISTRICT_L", district AS "District", state AS "STATE", ST_AsGeoJSON(geom) AS geom
    ` : `
      UPDATE districts
      SET district = COALESCE($1, district),
          state = COALESCE($2, state),
          district_l = COALESCE($3, district_l)
      WHERE id = $4
      RETURNING id, district_l AS "DISTRICT_L", district AS "District", state AS "STATE", ST_AsGeoJSON(geom) AS geom
    `;

    const params = geoJsonStr
      ? [districtName, stateName, districtLgd, geoJsonStr, id]
      : [districtName, stateName, districtLgd, id];

    const { rows } = await pool.query(query, params);

    if (rows.length === 0) {
      throw new NotFoundError('District not found');
    }
    return mapRowToGeoJSONFeature(rows[0]);
  },

  async delete(id) {
    const { rowCount } = await pool.query(`DELETE FROM districts WHERE id = $1`, [id]);
    if (rowCount === 0) {
      throw new NotFoundError('District not found');
    }
  },
};
