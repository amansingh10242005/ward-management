import { pool } from '../db/pool.js';
import { NotFoundError, GeometryValidationError } from '../utils/errors.js';
import { mapRowToGeoJSONFeature } from '../utils/geojson.utils.js';

export const districtsService = {
  async getAll(bbox) {
    let query = `
      SELECT id, "DISTRICT_L", "District", "STATE", ST_AsGeoJSON(geom) AS geom
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
    const effectiveId = (feature.properties?.id != null && !isNaN(Number(feature.properties.id)))
      ? feature.properties.id
      : (typeof id === 'string' && id.includes('.') ? id.split('.')[1] : id);

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
      SET "District" = COALESCE($1, "District"),
          "STATE" = COALESCE($2, "STATE"),
          "DISTRICT_L" = COALESCE($3, "DISTRICT_L"),
          geom = ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)
      WHERE id = $5
      RETURNING id, "DISTRICT_L", "District", "STATE", ST_AsGeoJSON(geom) AS geom
    ` : `
      UPDATE districts
      SET "District" = COALESCE($1, "District"),
          "STATE" = COALESCE($2, "STATE"),
          "DISTRICT_L" = COALESCE($3, "DISTRICT_L")
      WHERE id = $4
      RETURNING id, "DISTRICT_L", "District", "STATE", ST_AsGeoJSON(geom) AS geom
    `;

    const params = geoJsonStr
      ? [districtName, stateName, districtLgd, geoJsonStr, effectiveId]
      : [districtName, stateName, districtLgd, effectiveId];

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
