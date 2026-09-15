import { pool } from '../backend/src/db/pool.js';

const GEOSERVER_URL = 'http://localhost:8080/geoserver';
const WORKSPACE = 'ward';
const DATASTORE = 'ward_db';
const GEO_AUTH = 'Basic ' + Buffer.from('admin:geoserver').toString('base64');
const TEST_LAYER = 'final_dynamic_cleanup_test';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTest() {
  console.log('=== PHASE 10: PROVING GENERIC DYNAMIC DISCOVERY ===');

  // 1. PostGIS table creation
  console.log(`[Step 1] Creating table public."${TEST_LAYER}" in PostGIS...`);
  await pool.query(`DROP TABLE IF EXISTS public."${TEST_LAYER}" CASCADE;`);
  await pool.query(`
    CREATE TABLE public."${TEST_LAYER}" (
      id SERIAL PRIMARY KEY,
      test_code VARCHAR(32) NOT NULL,
      test_name VARCHAR(64) NOT NULL,
      category VARCHAR(32) DEFAULT 'Validation',
      geom geometry(Polygon, 4326) NOT NULL
    );
  `);

  await pool.query(`
    INSERT INTO public."${TEST_LAYER}" (test_code, test_name, category, geom) VALUES
    ('FDCT-01', 'Generic Test Zone Alpha', 'Commercial',
     ST_GeomFromText('POLYGON((80.110 12.910, 80.130 12.910, 80.130 12.930, 80.110 12.930, 80.110 12.910))', 4326)),
    ('FDCT-02', 'Generic Test Zone Beta', 'Residential',
     ST_GeomFromText('POLYGON((80.135 12.910, 80.155 12.910, 80.155 12.930, 80.135 12.930, 80.135 12.910))', 4326));
  `);

  await pool.query(`
    CREATE INDEX "${TEST_LAYER}_geom_gist_idx" 
    ON public."${TEST_LAYER}" USING GIST (geom);
  `);

  const countRes = await pool.query(`SELECT count(*) FROM public."${TEST_LAYER}"`);
  console.log(`✓ Created public."${TEST_LAYER}" with ${countRes.rows[0].count} features and GiST index.`);

  // 2. Publish to GeoServer
  console.log(`[Step 2] Publishing "${TEST_LAYER}" to GeoServer workspace "${WORKSPACE}"...`);
  const ftPayload = {
    featureType: {
      name: TEST_LAYER,
      nativeName: TEST_LAYER,
      title: 'Final Dynamic Cleanup Test Layer',
      srs: 'EPSG:4326',
      enabled: true
    }
  };

  const pubRes = await fetch(`${GEOSERVER_URL}/rest/workspaces/${WORKSPACE}/datastores/${DATASTORE}/featuretypes`, {
    method: 'POST',
    headers: {
      Authorization: GEO_AUTH,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(ftPayload)
  });

  if (!pubRes.ok && pubRes.status !== 201) {
    const txt = await pubRes.text();
    console.error(`Failed to publish: ${pubRes.status}`, txt);
    throw new Error(`GeoServer publish failed: ${pubRes.status}`);
  }
  console.log(`✓ GeoServer layer "${TEST_LAYER}" published successfully!`);

  // 3. Verify WMS & WFS responses
  console.log(`[Step 3] Verifying WFS GetFeature for "${TEST_LAYER}"...`);
  const wfsUrl = `${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:${TEST_LAYER}&outputFormat=application/json`;
  const wfsRes = await fetch(wfsUrl);
  if (!wfsRes.ok) throw new Error(`WFS request failed: ${wfsRes.status}`);
  const wfsData = await wfsRes.json();
  console.log(`✓ WFS returned ${wfsData.features?.length} features.`);

  // 4. Verify Backend API Discovery
  console.log(`[Step 4] Checking /api/geoserver/layers discovery...`);
  const apiRes = await fetch('http://localhost:3001/api/geoserver/layers?force=true');
  const apiData = await apiRes.json();
  const found = (apiData.layers || []).find(l => l.name === TEST_LAYER);
  if (!found) throw new Error(`Backend discovery failed: layer "${TEST_LAYER}" not in API output`);
  console.log(`✓ Backend discovered layer: "${found.name}" (Title: "${found.title}") without any code changes!`);

  console.log('\n✓ GENERIC DYNAMIC DISCOVERY VALIDATION PASSED (Layer Ready for UI Inspection)');

  return { success: true };
}

runTest().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
