import { pool } from '../backend/src/db/pool.js';

const GEOSERVER_URL = 'http://localhost:8080/geoserver';
const WORKSPACE = 'ward';
const GEO_AUTH = 'Basic ' + Buffer.from('admin:geoserver').toString('base64');

async function main() {
  console.log('=== 1. POSTGRESQL TABLES IN WARD_DB ===');
  const tablesRes = await pool.query(`
    SELECT table_name, 
           (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name=t.table_name) as col_count
    FROM information_schema.tables t
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  for (const row of tablesRes.rows) {
    const tableName = row.table_name;
    try {
      const countRes = await pool.query(`SELECT count(*) FROM public."${tableName}"`);
      const geomRes = await pool.query(`
        SELECT f_geometry_column, srid, type 
        FROM geometry_columns 
        WHERE f_table_schema = 'public' AND f_table_name = '${tableName}'
      `);
      const geomInfo = geomRes.rows.length > 0 
        ? `${geomRes.rows[0].f_geometry_column} (${geomRes.rows[0].type}, SRID:${geomRes.rows[0].srid})` 
        : 'none';
      console.log(`Table: "${tableName}" | Rows: ${countRes.rows[0].count} | Geometry: ${geomInfo}`);
    } catch (err) {
      console.log(`Table: "${tableName}" | Error: ${err.message}`);
    }
  }

  console.log('\n=== 2. GEOSERVER LAYERS IN WORKSPACE WARD ===');
  try {
    const res = await fetch(`${GEOSERVER_URL}/rest/workspaces/${WORKSPACE}/layers.json`, {
      headers: { Authorization: GEO_AUTH, Accept: 'application/json' }
    });
    if (res.ok) {
      const data = await res.json();
      const layers = data.layers?.layer || [];
      const layerList = Array.isArray(layers) ? layers : [layers];
      for (const l of layerList) {
        console.log(`GeoServer Layer: ${l.name} (${l.href})`);
      }
    } else {
      console.log(`Failed to fetch GeoServer layers: ${res.status}`);
    }
  } catch (err) {
    console.log(`Error fetching GeoServer layers: ${err.message}`);
  }

  console.log('\n=== 3. BACKEND API DISCOVERY (/api/geoserver/layers) ===');
  try {
    const res = await fetch(`http://localhost:3001/api/geoserver/layers`);
    if (res.ok) {
      const data = await res.json();
      console.log(`Discovered count: ${(data.layers || []).length}`);
      for (const l of data.layers || []) {
        console.log(`Discovered: name="${l.name}", title="${l.title}", qualifiedName="${l.qualifiedName}"`);
      }
    } else {
      console.log(`Failed to fetch /api/geoserver/layers: ${res.status}`);
    }
  } catch (err) {
    console.log(`Error fetching /api/geoserver/layers: ${err.message}`);
  }

  await pool.end();
}

main().catch(console.error);
