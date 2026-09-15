import { pool } from '../backend/src/db/pool.js';

const GEOSERVER_URL = 'http://localhost:8080/geoserver';
const WORKSPACE = 'ward';
const DATASTORE = 'ward_db';
const GEO_AUTH = 'Basic ' + Buffer.from('admin:geoserver').toString('base64');
const TEST_LAYER = 'final_dynamic_cleanup_test';

async function main() {
  console.log('Cleaning up final_dynamic_cleanup_test...');
  await pool.query(`DROP TABLE IF EXISTS public."${TEST_LAYER}" CASCADE;`);
  console.log('✓ PostGIS table dropped.');

  const lRes = await fetch(`${GEOSERVER_URL}/rest/workspaces/${WORKSPACE}/layers/${TEST_LAYER}?recurse=true`, {
    method: 'DELETE',
    headers: { Authorization: GEO_AUTH }
  });
  console.log(`✓ GeoServer layer delete: ${lRes.status}`);

  const ftRes = await fetch(`${GEOSERVER_URL}/rest/workspaces/${WORKSPACE}/datastores/${DATASTORE}/featuretypes/${TEST_LAYER}?recurse=true`, {
    method: 'DELETE',
    headers: { Authorization: GEO_AUTH }
  });
  console.log(`✓ GeoServer featuretype delete: ${ftRes.status}`);

  const res = await fetch('http://localhost:3001/api/geoserver/layers?force=true');
  const d = await res.json();
  console.log('Final /api/geoserver/layers count:', (d.layers || []).length);
  console.log('Remaining layers:', (d.layers || []).map(l => l.name));

  await pool.end();
  console.log('✓ Final test layer removed cleanly!');
}

main().catch(console.error);
