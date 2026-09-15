import { pool } from '../backend/src/db/pool.js';

const GEOSERVER_URL = 'http://localhost:8080/geoserver';
const WORKSPACE = 'ward';
const DATASTORE = 'ward_db';
const GEO_AUTH = 'Basic ' + Buffer.from('admin:geoserver').toString('base64');

const DISPOSABLE_TABLES = ['Example_1', 'tl_layer_1', 'ne_10m_admin_2_label_points'];

async function executeCleanup() {
  console.log('=== PHASE 3: POSTGIS DATABASE CLEANUP ===');
  for (const table of DISPOSABLE_TABLES) {
    try {
      console.log(`Dropping table public."${table}"...`);
      await pool.query(`DROP TABLE IF EXISTS public."${table}" CASCADE;`);
      console.log(`✓ Dropped public."${table}"`);
    } catch (err) {
      console.error(`Failed to drop public."${table}":`, err.message);
    }
  }

  // Verify core tables
  console.log('\nVerifying core tables intact:');
  const coreTables = ['states', 'districts', 'zones', 'roads', 'streetlights'];
  for (const ct of coreTables) {
    const res = await pool.query(`SELECT count(*) FROM public."${ct}"`);
    console.log(`✓ Core table "${ct}": ${res.rows[0].count} rows intact.`);
  }

  console.log('\n=== PHASE 4: GEOSERVER LAYER CLEANUP ===');
  for (const layer of DISPOSABLE_TABLES) {
    try {
      console.log(`Unpublishing GeoServer layer "${layer}"...`);
      // Delete layer
      const layerRes = await fetch(`${GEOSERVER_URL}/rest/workspaces/${WORKSPACE}/layers/${layer}?recurse=true`, {
        method: 'DELETE',
        headers: { Authorization: GEO_AUTH }
      });
      console.log(`Layer DELETE "${layer}": ${layerRes.status} ${layerRes.statusText}`);

      // Delete featuretype
      const ftRes = await fetch(`${GEOSERVER_URL}/rest/workspaces/${WORKSPACE}/datastores/${DATASTORE}/featuretypes/${layer}?recurse=true`, {
        method: 'DELETE',
        headers: { Authorization: GEO_AUTH }
      });
      console.log(`FeatureType DELETE "${layer}": ${ftRes.status} ${ftRes.statusText}`);
    } catch (err) {
      console.error(`Failed to delete GeoServer layer "${layer}":`, err.message);
    }
  }

  // Verify remaining GeoServer layers
  console.log('\nVerifying remaining GeoServer layers:');
  const layersRes = await fetch(`${GEOSERVER_URL}/rest/workspaces/${WORKSPACE}/layers.json`, {
    headers: { Authorization: GEO_AUTH, Accept: 'application/json' }
  });
  if (layersRes.ok) {
    const data = await layersRes.json();
    const list = data.layers?.layer || [];
    const remaining = Array.isArray(list) ? list.map(l => l.name) : [list.name];
    console.log('Remaining GeoServer layers:', remaining);
  }

  // Invalidate backend caches if any
  try {
    const apiRes = await fetch('http://localhost:3001/api/geoserver/layers?force=true');
    if (apiRes.ok) {
      const apiData = await apiRes.json();
      console.log('Backend /api/geoserver/layers count:', (apiData.layers || []).length);
      console.log('Backend layers:', (apiData.layers || []).map(l => l.name));
    }
  } catch (err) {
    console.warn('Backend refresh note:', err.message);
  }

  await pool.end();
  console.log('\n✓ PostGIS & GeoServer cleanup complete!');
}

executeCleanup().catch(console.error);
