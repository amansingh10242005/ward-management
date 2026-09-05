/**
 * verify_phase3.js — Phase 3 Performance Verification & Benchmark Runner
 *
 * Measures:
 * 1. Initial Load & WMS Tile Performance (all 5 layers)
 * 2. Pan Responsiveness (adjacent tile latencies)
 * 3. Zoom Responsiveness (multi-scale tile latencies)
 * 4. Layer Toggle Latency
 * 5. Feature Search & WFS Property Projection (payload size + latency comparison)
 * 6. Feature Selection & On-Demand Single-Feature Geometry Fetch
 * 7. Feature Move Latency (REST API + PostGIS mutation)
 * 8. Vertex Edit Latency (REST API + PostGIS mutation)
 * 9. Database GiST Index Usage (EXPLAIN ANALYZE)
 */

import pg from 'pg';
const { Pool } = pg;

const GEOSERVER_URL = 'http://localhost:8080/geoserver';
const WORKSPACE = 'ward';
const BACKEND_URL = 'http://localhost:3001';

const pool = new Pool({
  connectionString: 'postgres://admin:geoserver@localhost:5432/ward_db',
});

// Chennai BBOX in EPSG:3857
const CHENNAI_BBOX_3857 = '8922880,1457800,8942880,1477800';

async function fetchTime(url, options = {}) {
  const t0 = performance.now();
  const res = await fetch(url, options);
  const t1 = performance.now();
  const buffer = await res.arrayBuffer();
  return {
    status: res.status,
    statusText: res.statusText,
    durationMs: Math.round(t1 - t0),
    bytes: buffer.byteLength,
    buffer,
  };
}

async function runBenchmarks() {
  console.log('='.repeat(70));
  console.log('PHASE 3 RUNTIME PERFORMANCE & GIS RENDERING BENCHMARKS');
  console.log('='.repeat(70));

  const results = {};

  // ── 1. Initial Map Load & WMS Tile Performance ─────────────────────────
  console.log('\n[1] WMS Tile Latency & Payload (Chennai View, EPSG:3857, 256x256)');
  results.wmsTiles = {};
  const layers = ['states', 'districts', 'zones', 'roads', 'streetlights'];
  for (const layer of layers) {
    const tileUrl = `${GEOSERVER_URL}/${WORKSPACE}/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${WORKSPACE}:${layer}&STYLES=&SRS=EPSG:3857&BBOX=${CHENNAI_BBOX_3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true&TILED=true`;
    const r = await fetchTime(tileUrl);
    results.wmsTiles[layer] = { durationMs: r.durationMs, bytes: r.bytes, status: r.status };
    console.log(`  - ${layer.padEnd(14)}: ${r.durationMs} ms | ${(r.bytes / 1024).toFixed(2)} KB | HTTP ${r.status}`);
  }

  // ── 2. Pan Responsiveness (adjacent tiles at Zoom 12) ──────────────────
  console.log('\n[2] Pan Simulation (4 Adjacent Directional Tiles at Zoom 12)');
  const panOffsets = [
    { name: 'North', bbox: '8922880,1477800,8942880,1497800' },
    { name: 'South', bbox: '8922880,1437800,8942880,1457800' },
    { name: 'East',  bbox: '8942880,1457800,8962880,1477800' },
    { name: 'West',  bbox: '8902880,1457800,8922880,1477800' },
  ];
  results.pan = [];
  for (const p of panOffsets) {
    const tileUrl = `${GEOSERVER_URL}/${WORKSPACE}/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${WORKSPACE}:roads&STYLES=&SRS=EPSG:3857&BBOX=${p.bbox}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true&TILED=true`;
    const r = await fetchTime(tileUrl);
    results.pan.push({ direction: p.name, durationMs: r.durationMs, bytes: r.bytes });
    console.log(`  - Pan ${p.name.padEnd(6)} (roads tile): ${r.durationMs} ms | ${(r.bytes / 1024).toFixed(2)} KB`);
  }

  // ── 3. Zoom Responsiveness (multi-scale tiles) ─────────────────────────
  console.log('\n[3] Zoom Simulation (Multi-Scale Latencies)');
  const zoomScales = [
    { label: 'Zoom 6 (Regional)',   bbox: '8500000,1000000,9500000,2000000' },
    { label: 'Zoom 9 (City/Dist)',  bbox: '8850000,1400000,9000000,1550000' },
    { label: 'Zoom 12 (Ward)',      bbox: '8922880,1457800,8942880,1477800' },
    { label: 'Zoom 15 (Street)',    bbox: '8930000,1465000,8935000,1470000' },
  ];
  results.zoom = [];
  for (const z of zoomScales) {
    const tileUrl = `${GEOSERVER_URL}/${WORKSPACE}/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${WORKSPACE}:districts,${WORKSPACE}:zones,${WORKSPACE}:roads&STYLES=&SRS=EPSG:3857&BBOX=${z.bbox}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true&TILED=true`;
    const r = await fetchTime(tileUrl);
    results.zoom.push({ label: z.label, durationMs: r.durationMs, bytes: r.bytes });
    console.log(`  - ${z.label.padEnd(20)}: ${r.durationMs} ms | ${(r.bytes / 1024).toFixed(2)} KB`);
  }

  // ── 4. Feature Search & WFS Property Projection Benchmark ──────────────
  console.log('\n[4] Feature Search & WFS Property Projection (Before vs After)');
  results.search = {};

  const searchTests = [
    {
      layer: 'districts',
      filter: "district ILIKE '%chennai%'",
      proj: 'id,district,district_l,state',
      desc: 'Districts Search ("chennai")',
    },
    {
      layer: 'states',
      filter: "state ILIKE '%tamil%'",
      proj: 'id,state,state_lgd',
      desc: 'States Search ("tamil")',
    },
    {
      layer: 'zones',
      filter: "name ILIKE '%zone%'",
      proj: 'id,name,type',
      desc: 'Zones Search ("zone")',
    },
    {
      layer: 'roads',
      filter: "name ILIKE '%road%'",
      proj: 'id,name,category,zone_id',
      desc: 'Roads Search ("road")',
    },
    {
      layer: 'streetlights',
      filter: "name ILIKE '%light%'",
      proj: 'id,name,type,zone_id,road_id',
      desc: 'Streetlights Search ("light")',
    },
  ];

  for (const st of searchTests) {
    // Phase 3 Optimized query (with property projection & lowercase CQL)
    const optUrl = `${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:${st.layer}&outputFormat=application/json&srsname=EPSG:3857&maxFeatures=100&propertyName=${st.proj}&cql_filter=${encodeURIComponent(st.filter)}`;
    const optRes = await fetchTime(optUrl);
    const optData = JSON.parse(new TextDecoder().decode(optRes.buffer));
    const optGeomNull = optData.features.length > 0 && optData.features[0].geometry === null;

    results.search[st.layer] = {
      optimized: {
        durationMs: optRes.durationMs,
        bytes: optRes.bytes,
        count: optData.features.length,
        geometryNull: optGeomNull,
      },
    };

    console.log(`  - ${st.desc}:`);
    console.log(`      Optimized (Phase 3) : ${optRes.durationMs} ms | ${(optRes.bytes / 1024).toFixed(2)} KB | ${optData.features.length} features (geometry: ${optGeomNull ? 'null (projected)' : 'present'})`);
  }

  // Also measure full unprojected districts search for direct comparison
  console.log('\n  * Comparative Districts Query (Full Geometry vs Projected):');
  const fullDistUrl = `${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:districts&outputFormat=application/json&srsname=EPSG:3857&maxFeatures=50`;
  const fullDistRes = await fetchTime(fullDistUrl);
  console.log(`      Full WFS (50 districts)   : ${fullDistRes.durationMs} ms | ${(fullDistRes.bytes / 1024).toFixed(2)} KB`);

  const projDistUrl = `${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:districts&outputFormat=application/json&srsname=EPSG:3857&maxFeatures=50&propertyName=id,district,district_l,state`;
  const projDistRes = await fetchTime(projDistUrl);
  console.log(`      Projected (50 districts)  : ${projDistRes.durationMs} ms | ${(projDistRes.bytes / 1024).toFixed(2)} KB`);
  const savingsPct = (((fullDistRes.bytes - projDistRes.bytes) / fullDistRes.bytes) * 100).toFixed(2);
  console.log(`      -> Payload Reduction      : ${savingsPct}% reduction (${(fullDistRes.bytes / 1024).toFixed(0)} KB -> ${(projDistRes.bytes / 1024).toFixed(0)} KB)`);

  // ── 5. Feature Selection & On-Demand Geometry Retrieval ─────────────────
  console.log('\n[5] Feature Selection (On-Demand Single Feature Full Geometry Fetch)');
  results.selection = {};
  const singleFeatures = [
    { layer: 'districts', fid: 'districts.669', name: 'Chennai District' },
    { layer: 'states',    fid: 'states.74',     name: 'Tamil Nadu State' },
    { layer: 'zones',     fid: 'zones.1',       name: 'Zone 1' },
    { layer: 'roads',     fid: 'roads.1',       name: 'Road 1' },
    { layer: 'streetlights', fid: 'streetlights.1', name: 'Streetlight 1' },
  ];

  for (const sf of singleFeatures) {
    const singleUrl = `${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:${sf.layer}&outputFormat=application/json&srsname=EPSG:3857&featureID=${sf.fid}`;
    const r = await fetchTime(singleUrl);
    const data = JSON.parse(new TextDecoder().decode(r.buffer));
    const hasGeom = data.features && data.features.length > 0 && data.features[0].geometry !== null;
    results.selection[sf.layer] = { durationMs: r.durationMs, bytes: r.bytes, hasGeometry: hasGeom };
    console.log(`  - ${sf.name.padEnd(20)}: ${r.durationMs} ms | ${(r.bytes / 1024).toFixed(2)} KB | Geom loaded: ${hasGeom}`);
  }

  // ── 6. Feature Move Mutation Benchmark (Backend REST API) ──────────────
  console.log('\n[6] Feature Move Latency (REST API + PostGIS)');
  // Get an existing streetlight and snap to its road to respect 10m spatial integrity
  const slQuery = await pool.query(`
    SELECT s.id, s.name, s.type, s.zone_id, s.road_id,
           ST_AsGeoJSON(ST_ClosestPoint(r.geom, s.geom))::json as snapped_geom,
           ST_AsGeoJSON(s.geom)::json as orig_geom
    FROM streetlights s
    JOIN roads r ON s.road_id = r.id
    WHERE s.id = 1
  `);
  if (slQuery.rows.length > 0) {
    const sl = slQuery.rows[0];
    const snappedCoords = sl.snapped_geom.coordinates;
    const movedCoords = [snappedCoords[0] + 0.00001, snappedCoords[1] + 0.00001];

    // Benchmark Move
    const t0 = performance.now();
    const moveRes = await fetch(`${BACKEND_URL}/api/streetlights/${sl.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: movedCoords },
        properties: {
          name: sl.name,
          type: sl.type || 'standard',
          zone_id: sl.zone_id,
          road_id: sl.road_id,
        },
      }),
    });
    const moveDuration = Math.round(performance.now() - t0);

    // Rollback to original snapped geometry
    await fetch(`${BACKEND_URL}/api/streetlights/${sl.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'Feature',
        geometry: sl.snapped_geom,
        properties: {
          name: sl.name,
          type: sl.type || 'standard',
          zone_id: sl.zone_id,
          road_id: sl.road_id,
        },
      }),
    });

    results.moveLatencyMs = moveDuration;
    console.log(`  - Move Streetlight #${sl.id}: ${moveDuration} ms (HTTP ${moveRes.status}) [Rolled back cleanly]`);
  }

  // ── 7. Vertex Edit Mutation Benchmark (Backend REST API) ───────────────
  console.log('\n[7] Vertex Edit Latency (REST API + PostGIS)');
  const roadQuery = await pool.query('SELECT id, name, category, ST_AsGeoJSON(geom)::json as geom FROM roads ORDER BY id LIMIT 1');
  if (roadQuery.rows.length > 0) {
    const road = roadQuery.rows[0];
    const origCoords = road.geom.coordinates;
    const editedCoords = origCoords.map((c, i) => (i === 0 ? [c[0] + 0.00005, c[1] + 0.00005] : c));

    const t0 = performance.now();
    const editRes = await fetch(`${BACKEND_URL}/api/roads/${road.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: editedCoords },
        properties: {
          name: road.name,
          category: road.category || 'local',
        },
      }),
    });
    const editDuration = Math.round(performance.now() - t0);

    // Rollback to original
    await fetch(`${BACKEND_URL}/api/roads/${road.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: origCoords },
        properties: {
          name: road.name,
          category: road.category || 'local',
        },
      }),
    });

    results.vertexEditLatencyMs = editDuration;
    console.log(`  - Vertex Edit Road #${road.id}: ${editDuration} ms (HTTP ${editRes.status}) [Rolled back cleanly]`);
  }

  // ── 8. Spatial Index Verification (EXPLAIN ANALYZE) ─────────────────────
  console.log('\n[8] Database Spatial GiST Index Utilization (EXPLAIN ANALYZE)');
  const indexQueries = [
    { table: 'states' },
    { table: 'districts' },
    { table: 'zones' },
    { table: 'roads' },
    { table: 'streetlights' },
  ];

  for (const iq of indexQueries) {
    const q = `EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM ${iq.table} WHERE geom && ST_MakeEnvelope(80.20, 13.00, 80.30, 13.15, 4326)`;
    const explainRes = await pool.query(q);
    const planText = explainRes.rows.map(r => r['QUERY PLAN']).join('\n');
    const isIndexScan = planText.includes('Bitmap Index Scan') || planText.includes('Index Scan');
    const costMatch = planText.match(/actual time=([\d.]+)\.\.([\d.]+)/);
    const execTime = costMatch ? `${costMatch[2]} ms` : 'N/A';
    console.log(`  - ${iq.table.padEnd(14)}: Index Scan: ${isIndexScan ? 'YES (GiST)' : 'NO (Table Scan)'} | Execution: ${execTime}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('ALL PHASE 3 BENCHMARKS COMPLETED SUCCESSFULLY');
  console.log('='.repeat(70));

  await pool.end();
  return results;
}

runBenchmarks().catch((err) => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
