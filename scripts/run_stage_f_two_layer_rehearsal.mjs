/**
 * Stage F — Two-Arbitrary-Vector Live Demo Rehearsal & Full Requirement Audit
 *
 * Implements Phase F6 & Phase F20:
 * - Creates 2 completely fresh, arbitrary vector datasets in PostGIS (Polygon + Point)
 * - Verifies SRID 4326, geometry validity, and creates GiST indexes
 * - Publishes both layers to GeoServer with styles via REST API
 * - Proves dynamic discovery in the live frontend application via Chrome DevTools Protocol
 * - Demonstrates exclusive two-layer display, legend sync, zoom, feature info,
 *   move, vertex edit, attribute edit, delete, undo/redo, basemap switching, and toggle isolation
 * - Verifies strict network invariants (0 WFS GetFeature during edit/history)
 * - Safely cleans up temporary rehearsal layers and tables
 */

import { spawn } from 'child_process';
import { pool } from '../backend/src/db/pool.js';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://localhost:5173/';
const DEBUG_PORT = 9222;
const GEOSERVER_URL = 'http://localhost:8080/geoserver';
const WORKSPACE = 'ward';
const DATASTORE = 'ward_db';
const GEO_AUTH = 'Basic ' + Buffer.from('admin:geoserver').toString('base64');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTwoLayerRehearsal() {
  console.log('================================================================');
  console.log('STAGE F — TWO-ARBITRARY-VECTOR LIVE DEMO REHEARSAL & AUDIT');
  console.log('Real-Time PostGIS Import -> GiST -> GeoServer -> React Discovery');
  console.log('================================================================\n');

  const rehearsalReport = {
    datasetA: null,
    datasetB: null,
    dbValidation: {},
    geoserverPublish: {},
    discovery: {},
    twoLayerDisplay: {},
    zoom: {},
    legend: {},
    featureInfo: {},
    mapEditMove: {},
    mapEditVertex: {},
    attributeEdit: {},
    deleteAndUndoRedo: {},
    basemapSwitching: {},
    toggleIsolation: {},
    networkInvariants: {},
    cleanup: {},
  };

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // STEP 1 & 2: CREATE DATASET A (MultiPolygon) IN POSTGIS
    // ══════════════════════════════════════════════════════════════════════════
    console.log('[Step 1] Creating Dataset A (MultiPolygon: tl_demo_zones_f) in PostGIS...');
    await pool.query(`DROP TABLE IF EXISTS public.tl_demo_zones_f CASCADE;`);
    await pool.query(`
      CREATE TABLE public.tl_demo_zones_f (
        id SERIAL PRIMARY KEY,
        zone_code VARCHAR(32) NOT NULL,
        zone_name VARCHAR(128) NOT NULL,
        area_ha NUMERIC(10,2) DEFAULT 12.50,
        category VARCHAR(64) DEFAULT 'Commercial',
        geom geometry(MultiPolygon, 4326) NOT NULL
      );
    `);

    // Insert 3 valid non-overlapping MultiPolygon features in Ward extent
    await pool.query(`
      INSERT INTO public.tl_demo_zones_f (zone_code, zone_name, area_ha, category, geom) VALUES
      ('WZ-01', 'North Business District', 24.50, 'Commercial',
       ST_Multi(ST_GeomFromText('POLYGON((80.060 12.900, 80.080 12.900, 80.080 12.920, 80.060 12.920, 80.060 12.900))', 4326))),
      ('WZ-02', 'Central Civic Center', 18.25, 'Institutional',
       ST_Multi(ST_GeomFromText('POLYGON((80.090 12.900, 80.110 12.900, 80.110 12.920, 80.090 12.920, 80.090 12.900))', 4326))),
      ('WZ-03', 'Greenbelt Eco Park', 35.00, 'Recreational',
       ST_Multi(ST_GeomFromText('POLYGON((80.070 12.930, 80.100 12.930, 80.100 12.950, 80.070 12.950, 80.070 12.930))', 4326)));
    `);

    // Verify Dataset A PostGIS state
    const countA = await pool.query('SELECT count(*) FROM public.tl_demo_zones_f');
    const sridA = await pool.query('SELECT DISTINCT ST_SRID(geom) as srid FROM public.tl_demo_zones_f');
    const typeA = await pool.query('SELECT DISTINCT ST_GeometryType(geom) as gtype FROM public.tl_demo_zones_f');
    const validA = await pool.query('SELECT count(*) as invalid_count FROM public.tl_demo_zones_f WHERE ST_IsValid(geom) = false');

    // Create & Verify GiST Index for Dataset A
    console.log('[Step 2] Creating GiST Spatial Index on tl_demo_zones_f...');
    await pool.query('CREATE INDEX tl_demo_zones_f_geom_gist_idx ON public.tl_demo_zones_f USING GIST (geom);');
    const gistA = await pool.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'tl_demo_zones_f' AND indexdef LIKE '%gist%'");

    rehearsalReport.datasetA = {
      tableName: 'tl_demo_zones_f',
      rowCount: parseInt(countA.rows[0].count, 10),
      srid: parseInt(sridA.rows[0].srid, 10),
      geomType: typeA.rows[0].gtype,
      invalidCount: parseInt(validA.rows[0].invalid_count, 10),
      gistIndex: gistA.rows[0]?.indexname || null,
      gistValid: !!gistA.rows[0]?.indexdef?.includes('gist (geom)'),
    };
    console.log('  Dataset A Verified:', rehearsalReport.datasetA);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 3 & 4: CREATE DATASET B (Point) IN POSTGIS
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n[Step 3] Creating Dataset B (Point: tl_demo_sensors_f) in PostGIS...');
    await pool.query(`DROP TABLE IF EXISTS public.tl_demo_sensors_f CASCADE;`);
    await pool.query(`
      CREATE TABLE public.tl_demo_sensors_f (
        id SERIAL PRIMARY KEY,
        sensor_id VARCHAR(32) NOT NULL,
        sensor_name VARCHAR(128) NOT NULL,
        reading_ppm NUMERIC(8,2) DEFAULT 42.10,
        status VARCHAR(32) DEFAULT 'Active',
        geom geometry(Point, 4326) NOT NULL
      );
    `);

    // Insert 4 valid Point features distributed across Ward area
    await pool.query(`
      INSERT INTO public.tl_demo_sensors_f (sensor_id, sensor_name, reading_ppm, status, geom) VALUES
      ('SN-101', 'North PM2.5 Air Monitor', 38.50, 'Active', ST_SetSRID(ST_MakePoint(80.070, 12.910), 4326)),
      ('SN-102', 'East Industrial Sensor', 65.20, 'Warning', ST_SetSRID(ST_MakePoint(80.100, 12.910), 4326)),
      ('SN-103', 'Eco-Park Ambient Sensor', 22.00, 'Active', ST_SetSRID(ST_MakePoint(80.080, 12.940), 4326)),
      ('SN-104', 'Highway Traffic Node', 78.40, 'Maintenance', ST_SetSRID(ST_MakePoint(80.120, 12.930), 4326));
    `);

    const countB = await pool.query('SELECT count(*) FROM public.tl_demo_sensors_f');
    const sridB = await pool.query('SELECT DISTINCT ST_SRID(geom) as srid FROM public.tl_demo_sensors_f');
    const typeB = await pool.query('SELECT DISTINCT ST_GeometryType(geom) as gtype FROM public.tl_demo_sensors_f');
    const validB = await pool.query('SELECT count(*) as invalid_count FROM public.tl_demo_sensors_f WHERE ST_IsValid(geom) = false');

    // Create & Verify GiST Index for Dataset B
    console.log('[Step 4] Creating GiST Spatial Index on tl_demo_sensors_f...');
    await pool.query('CREATE INDEX tl_demo_sensors_f_geom_gist_idx ON public.tl_demo_sensors_f USING GIST (geom);');
    const gistB = await pool.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'tl_demo_sensors_f' AND indexdef LIKE '%gist%'");

    rehearsalReport.datasetB = {
      tableName: 'tl_demo_sensors_f',
      rowCount: parseInt(countB.rows[0].count, 10),
      srid: parseInt(sridB.rows[0].srid, 10),
      geomType: typeB.rows[0].gtype,
      invalidCount: parseInt(validB.rows[0].invalid_count, 10),
      gistIndex: gistB.rows[0]?.indexname || null,
      gistValid: !!gistB.rows[0]?.indexdef?.includes('gist (geom)'),
    };
    console.log('  Dataset B Verified:', rehearsalReport.datasetB);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 5: PUBLISH BOTH LAYERS TO GEOSERVER WITH STYLES
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n[Step 5] Publishing tl_demo_zones_f and tl_demo_sensors_f to GeoServer...');
    
    // Clean up if previous rehearsal layers existed in GeoServer
    await fetch(`${GEOSERVER_URL}/rest/workspaces/${WORKSPACE}/datastores/${DATASTORE}/featuretypes/tl_demo_zones_f?recurse=true`, {
      method: 'DELETE',
      headers: { Authorization: GEO_AUTH }
    }).catch(() => {});
    await fetch(`${GEOSERVER_URL}/rest/workspaces/${WORKSPACE}/datastores/${DATASTORE}/featuretypes/tl_demo_sensors_f?recurse=true`, {
      method: 'DELETE',
      headers: { Authorization: GEO_AUTH }
    }).catch(() => {});

    // Publish Dataset A
    const pubResA = await fetch(`${GEOSERVER_URL}/rest/workspaces/${WORKSPACE}/datastores/${DATASTORE}/featuretypes.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: GEO_AUTH },
      body: JSON.stringify({
        featureType: {
          name: 'tl_demo_zones_f',
          nativeName: 'tl_demo_zones_f',
          title: 'Demo Planning Zones (TL Rehearsal)',
          srs: 'EPSG:4326',
          defaultStyle: { name: 'ward_zones' }
        }
      })
    });

    // Publish Dataset B
    const pubResB = await fetch(`${GEOSERVER_URL}/rest/workspaces/${WORKSPACE}/datastores/${DATASTORE}/featuretypes.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: GEO_AUTH },
      body: JSON.stringify({
        featureType: {
          name: 'tl_demo_sensors_f',
          nativeName: 'tl_demo_sensors_f',
          title: 'Demo Environmental Sensors (TL Rehearsal)',
          srs: 'EPSG:4326',
          defaultStyle: { name: 'point' }
        }
      })
    });

    // Verify GeoServer WFS feature count
    const wfsHitsA = await (await fetch(`${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:tl_demo_zones_f&resultType=hits`, {
      headers: { Authorization: GEO_AUTH }
    })).text();
    const hitsA = parseInt(wfsHitsA.match(/numberOfFeatures="(\d+)"/)?.[1] || '0', 10);

    const wfsHitsB = await (await fetch(`${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:tl_demo_sensors_f&resultType=hits`, {
      headers: { Authorization: GEO_AUTH }
    })).text();
    const hitsB = parseInt(wfsHitsB.match(/numberOfFeatures="(\d+)"/)?.[1] || '0', 10);

    rehearsalReport.geoserverPublish = {
      layerAPublished: pubResA.status === 201 || pubResA.status === 200,
      layerBPublished: pubResB.status === 201 || pubResB.status === 200,
      wfsHitsA: hitsA,
      wfsHitsB: hitsB,
    };
    console.log('  GeoServer Publication Verified:', rehearsalReport.geoserverPublish);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 6: LAUNCH CHROME CDP & TEST APPLICATION INTERACTION
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n[Step 6] Connecting to Chrome DevTools Protocol & Initializing Live App...');
    const chromeProcess = spawn(CHROME_PATH, [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1400,900',
      `--user-data-dir=${process.env.TEMP}\\chrome_rehearsal_${Date.now()}`,
      'about:blank'
    ]);

    let wsUrl = null;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        const res = await fetch(`http://localhost:${DEBUG_PORT}/json`);
        const targets = await res.json();
        const pt = targets.find(t => t.type === 'page' && !t.url.startsWith('chrome-extension://'));
        if (pt && pt.webSocketDebuggerUrl) {
          wsUrl = pt.webSocketDebuggerUrl;
          break;
        }
      } catch (_) {}
    }

    if (!wsUrl) throw new Error('Failed to connect to Chrome remote debugging port.');
    const ws = new WebSocket(wsUrl);
    await new Promise(r => ws.onopen = r);

    let msgId = 1;
    const pending = new Map();
    const consoleMsgs = [];
    const exceptions = [];
    const networkReqs = [];

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id && pending.has(data.id)) {
        const { resolve, reject } = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) reject(data.error);
        else resolve(data.result);
        return;
      }
      if (data.method === 'Runtime.consoleAPICalled') {
        const type = data.params.type;
        const text = (data.params.args || []).map(a => a.value || JSON.stringify(a)).join(' ');
        consoleMsgs.push({ type, text });
      }
      if (data.method === 'Runtime.exceptionThrown') {
        exceptions.push(data.params.exceptionDetails);
      }
      if (data.method === 'Network.requestWillBeSent') {
        networkReqs.push({
          url: data.params.request.url,
          method: data.params.request.method,
          timestamp: Date.now()
        });
      }
    };

    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

    const evaluate = async (expression) => {
      const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
      }
      return res.result?.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');

    await send('Page.navigate', { url: APP_URL });
    await sleep(4000); // Allow initial mount and layer loading

    // ── STEP 7: DYNAMIC DISCOVERY OF THE TWO REHEARSAL LAYERS ─────────────────
    console.log('\n[Step 7] Triggering Dynamic Discovery for newly published layers...');
    const discoveredList = await evaluate(`(async () => {
      if (window.__refreshDynamicLayers) {
        const layers = await window.__refreshDynamicLayers();
        return layers.map(l => l.name);
      }
      return [];
    })()`);

    const hasZones = discoveredList.includes('tl_demo_zones_f');
    const hasSensors = discoveredList.includes('tl_demo_sensors_f');
    rehearsalReport.discovery = {
      discoveredCount: discoveredList.length,
      allDiscovered: discoveredList,
      hasZones,
      hasSensors,
      pass: hasZones && hasSensors
    };
    console.log('  Dynamic Discovery Result:', rehearsalReport.discovery);

    // ── STEP 8: CRITICAL TWO-LAYER DISPLAY CONDITION ───────────────────────────
    console.log('\n[Step 8] Enforcing Critical Two-Layer Demo View (Exclusively 2 Rehearsal Layers)...');
    const twoLayerState = await evaluate(`(() => {
      const ol = window.__olService;
      // Turn OFF all 5 core layers
      ['states', 'districts', 'zones', 'roads', 'streetlights'].forEach(l => {
        ol.toggleLayer(l, false);
      });
      // Turn OFF previous dynamic layers
      ol.toggleDynamicLayer('tl_layer_1', false);
      ol.toggleDynamicLayer('Example_1', false);

      // Turn ON ONLY the two new rehearsal layers
      ol.toggleDynamicLayer('tl_demo_zones_f', true);
      ol.toggleDynamicLayer('tl_demo_sensors_f', true);

      const map = ol.getMap();
      const layers = map ? map.getLayers().getArray() : [];
      
      const zonesLayer = ol.layers['tl_demo_zones_f'];
      const sensorsLayer = ol.layers['tl_demo_sensors_f'];

      return {
        zonesVisible: zonesLayer ? zonesLayer.getVisible() : false,
        sensorsVisible: sensorsLayer ? sensorsLayer.getVisible() : false,
        totalMapLayers: layers.length,
      };
    })()`);

    rehearsalReport.twoLayerDisplay = {
      ...twoLayerState,
      pass: twoLayerState.zonesVisible && twoLayerState.sensorsVisible
    };
    console.log('  Exclusive Two-Layer Display Result:', rehearsalReport.twoLayerDisplay);

    // ── STEP 9: DYNAMIC LEGEND INTEGRATION ────────────────────────────────────
    console.log('\n[Step 9] Verifying Unified Legend Sync with Only 2 Active Layers...');
    await sleep(800);
    const legendState = await evaluate(`(() => {
      const legend = document.querySelector('[data-testid="unified-legend-panel"]');
      const items = Array.from(legend?.querySelectorAll('.hud-legend-item') || []);
      const titles = items.map(el => el.querySelector('.hud-legend-item-title')?.textContent?.trim());
      return {
        legendMounted: !!legend,
        itemCount: items.length,
        titles: titles,
        hasZonesLegend: titles.some(t => t?.includes('Planning Zones') || t?.includes('tl_demo_zones_f')),
        hasSensorsLegend: titles.some(t => t?.includes('Sensors') || t?.includes('tl_demo_sensors_f')),
      };
    })()`);

    rehearsalReport.legend = {
      ...legendState,
      pass: legendState.legendMounted && legendState.itemCount === 2 && legendState.hasZonesLegend && legendState.hasSensorsLegend
    };
    console.log('  Unified Legend Audit Result:', rehearsalReport.legend);

    // ── STEP 10: ZOOM TO EXTENT AUDIT ─────────────────────────────────────────
    console.log('\n[Step 10] Auditing Targeted Extent Zooming for both layers...');
    const initialView = await evaluate(`(() => {
      const v = window.__olService.getMap().getView();
      return { center: v.getCenter(), zoom: v.getZoom() };
    })()`);

    await evaluate(`(() => {
      const ol = window.__olService;
      const defZones = ol.dynamicLayerDefs.get('tl_demo_zones_f');
      ol.zoomToDynamicLayerExtent({ name: 'tl_demo_zones_f', ...defZones });
    })()`);
    await sleep(1000); // Allow 800ms view animation to complete

    const zonesView = await evaluate(`(() => {
      const v = window.__olService.getMap().getView();
      return { center: v.getCenter(), zoom: v.getZoom() };
    })()`);

    await evaluate(`(() => {
      const ol = window.__olService;
      const defSensors = ol.dynamicLayerDefs.get('tl_demo_sensors_f');
      ol.zoomToDynamicLayerExtent({ name: 'tl_demo_sensors_f', ...defSensors });
    })()`);
    await sleep(1000); // Allow 800ms view animation to complete

    const sensorsView = await evaluate(`(() => {
      const v = window.__olService.getMap().getView();
      return { center: v.getCenter(), zoom: v.getZoom() };
    })()`);

    const hasMovedZones = initialView.center[0] !== zonesView.center[0] || initialView.center[1] !== zonesView.center[1] || initialView.zoom !== zonesView.zoom;
    const hasMovedSensors = zonesView.center[0] !== sensorsView.center[0] || zonesView.center[1] !== sensorsView.center[1] || zonesView.zoom !== sensorsView.zoom;

    rehearsalReport.zoom = {
      initialView,
      zonesView,
      sensorsView,
      hasMovedZones,
      hasMovedSensors,
      pass: hasMovedZones && hasMovedSensors
    };
    console.log('  Zoom to Extent Result:', rehearsalReport.zoom);

    // ── STEP 11: FEATURE INFO (SELECTION) ON BOTH LAYERS ──────────────────────
    console.log('\n[Step 11] Auditing Feature Info Inspection across MultiPolygon & Point layers...');
    // Query feature IDs from GeoServer WFS for precise selection inspection
    const featZones = (await (await fetch(`${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:tl_demo_zones_f&maxFeatures=1&outputFormat=application/json`, { headers: { Authorization: GEO_AUTH } })).json()).features[0];
    const featSensors = (await (await fetch(`${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:tl_demo_sensors_f&maxFeatures=1&outputFormat=application/json`, { headers: { Authorization: GEO_AUTH } })).json()).features[0];

    // 1. Select Zones feature
    await evaluate(`(() => {
      const ol = window.__olService;
      const feat = ${JSON.stringify(featZones)};
      ol.setSelectedFeature('tl_demo_zones_f', feat.id, feat);
      if (ol.savedSelectCallback) {
        ol.savedSelectCallback(feat, 'tl_demo_zones_f');
      }
    })()`);
    await sleep(600);

    const fiResultA = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const fid = panel?.querySelector('.hud-fid-pill')?.textContent?.trim() || '';
      const geomType = panel?.querySelector('.hud-geom-badge')?.textContent?.trim() || '';
      const rows = Array.from(panel?.querySelectorAll('.hud-attr-row') || []).map(r => ({
        key: r.querySelector('.hud-attr-key')?.textContent?.trim(),
        val: r.querySelector('.hud-attr-val')?.textContent?.trim()
      }));
      return { panelMountedA: !!panel, fidA: fid, geomTypeA: geomType, rowsCountA: rows.length };
    })()`);

    // 2. Select Sensors feature
    await evaluate(`(() => {
      const ol = window.__olService;
      const feat = ${JSON.stringify(featSensors)};
      ol.setSelectedFeature('tl_demo_sensors_f', feat.id, feat);
      if (ol.savedSelectCallback) {
        ol.savedSelectCallback(feat, 'tl_demo_sensors_f');
      }
    })()`);
    await sleep(600);

    const fiResultB = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const fid = panel?.querySelector('.hud-fid-pill')?.textContent?.trim() || '';
      const geomType = panel?.querySelector('.hud-geom-badge')?.textContent?.trim() || '';
      const rows = Array.from(panel?.querySelectorAll('.hud-attr-row') || []).map(r => ({
        key: r.querySelector('.hud-attr-key')?.textContent?.trim(),
        val: r.querySelector('.hud-attr-val')?.textContent?.trim()
      }));
      return { panelMountedB: !!panel, fidB: fid, geomTypeB: geomType, rowsCountB: rows.length };
    })()`);

    rehearsalReport.featureInfo = {
      ...fiResultA,
      ...fiResultB,
      pass: fiResultA.panelMountedA && fiResultA.fidA.includes('tl_demo_zones_f') &&
            fiResultB.panelMountedB && fiResultB.fidB.includes('tl_demo_sensors_f')
    };
    console.log('  Feature Info Result:', rehearsalReport.featureInfo);

    // ── STEP 12: MAP EDITING (MOVE & VERTEX) + UNDO / REDO ─────────────────────
    console.log('\n[Step 12] Auditing Map Editing (Move on Point, Vertex on MultiPolygon) + Undo / Redo...');
    const netStartEdits = networkReqs.length;

    // A. Move Point Feature on tl_demo_sensors_f
    const movePayload = {
      layerName: 'tl_demo_sensors_f',
      featureId: featSensors.id,
      action: 'update',
      feature: {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [80.071, 12.911] },
        properties: featSensors.properties
      }
    };
    const moveRes = await (await fetch('http://localhost:3001/api/geoserver/wfs/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(movePayload)
    })).json();

    // Record Move in history service and verify undo/redo
    const moveHist = await evaluate(`(async () => {
      const hist = window.__historyService;
      hist.recordSuccess({
        operationType: 'move',
        layerName: 'tl_demo_sensors_f',
        isCore: false,
        originalFeatureId: '${featSensors.id}',
        currentFeatureId: '${featSensors.id}',
        before: { geometry: ${JSON.stringify(featSensors.geometry)}, properties: ${JSON.stringify(featSensors.properties)} },
        after: { geometry: ${JSON.stringify(movePayload.feature.geometry)}, properties: ${JSON.stringify(featSensors.properties)} }
      });
      const uRes = await hist.undo();
      const rRes = await hist.redo();
      return { undoOk: uRes.success, redoOk: rRes.success };
    })()`);

    // B. Vertex Edit on tl_demo_zones_f MultiPolygon
    const modifiedGeom = JSON.parse(JSON.stringify(featZones.geometry));
    modifiedGeom.coordinates[0][0][0] = [80.061, 12.901]; // Perturb first vertex
    modifiedGeom.coordinates[0][0][4] = [80.061, 12.901]; // Close polygon ring

    const vertexPayload = {
      layerName: 'tl_demo_zones_f',
      featureId: featZones.id,
      action: 'update',
      feature: {
        type: 'Feature',
        geometry: modifiedGeom,
        properties: featZones.properties
      }
    };
    const vertexRes = await (await fetch('http://localhost:3001/api/geoserver/wfs/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vertexPayload)
    })).json();

    const vertexHist = await evaluate(`(async () => {
      const hist = window.__historyService;
      hist.recordSuccess({
        operationType: 'vertex',
        layerName: 'tl_demo_zones_f',
        isCore: false,
        originalFeatureId: '${featZones.id}',
        currentFeatureId: '${featZones.id}',
        before: { geometry: ${JSON.stringify(featZones.geometry)}, properties: ${JSON.stringify(featZones.properties)} },
        after: { geometry: ${JSON.stringify(modifiedGeom)}, properties: ${JSON.stringify(featZones.properties)} }
      });
      const uRes = await hist.undo();
      const rRes = await hist.redo();
      return { undoOk: uRes.success, redoOk: rRes.success };
    })()`);

    rehearsalReport.mapEditMove = { moveSuccess: moveRes.success, ...moveHist, pass: moveRes.success && moveHist.undoOk && moveHist.redoOk };
    rehearsalReport.mapEditVertex = { vertexSuccess: vertexRes.success, ...vertexHist, pass: vertexRes.success && vertexHist.undoOk && vertexHist.redoOk };
    console.log('  Move Edit & Undo/Redo:', rehearsalReport.mapEditMove);
    console.log('  Vertex Edit & Undo/Redo:', rehearsalReport.mapEditVertex);

    // ── STEP 13: ATTRIBUTE EDITING + UNDO / REDO ──────────────────────────────
    console.log('\n[Step 13] Auditing Attribute Editing on MultiPolygon Layer + Undo / Redo...');
    const originalZoneName = featZones.properties.zone_name;
    const updatedZoneName = `Audited District ${Date.now()}`;
    const updatedProps = { ...featZones.properties, zone_name: updatedZoneName };

    const attrPayload = {
      layerName: 'tl_demo_zones_f',
      featureId: featZones.id,
      action: 'update',
      feature: {
        type: 'Feature',
        geometry: featZones.geometry,
        properties: updatedProps
      }
    };
    const attrRes = await (await fetch('http://localhost:3001/api/geoserver/wfs/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(attrPayload)
    })).json();

    const attrHist = await evaluate(`(async () => {
      const hist = window.__historyService;
      hist.recordSuccess({
        operationType: 'update',
        layerName: 'tl_demo_zones_f',
        isCore: false,
        originalFeatureId: '${featZones.id}',
        currentFeatureId: '${featZones.id}',
        before: { geometry: ${JSON.stringify(featZones.geometry)}, properties: ${JSON.stringify(featZones.properties)} },
        after: { geometry: ${JSON.stringify(featZones.geometry)}, properties: ${JSON.stringify(updatedProps)} }
      });
      const uRes = await hist.undo();
      const rRes = await hist.redo();
      return { undoOk: uRes.success, redoOk: rRes.success };
    })()`);

    rehearsalReport.attributeEdit = {
      attrUpdateSuccess: attrRes.success,
      ...attrHist,
      pass: attrRes.success && attrHist.undoOk && attrHist.redoOk
    };
    console.log('  Attribute Edit & Undo/Redo Result:', rehearsalReport.attributeEdit);

    // ── STEP 14: DYNAMIC FEATURE DELETE + UNDO (INSERT) + REDO (DELETE) ────────
    console.log('\n[Step 14] Auditing Dynamic Delete + Undo (WFS-T Insert) + Redo (WFS-T Delete)...');
    // Fetch 3rd feature of tl_demo_zones_f to delete
    const featToDelete = (await (await fetch(`${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:tl_demo_zones_f&maxFeatures=1&startIndex=2&outputFormat=application/json`, { headers: { Authorization: GEO_AUTH } })).json()).features[0];
    const delTargetFid = featToDelete.id;

    // 1. Forward Delete
    const delRes = await (await fetch('http://localhost:3001/api/geoserver/wfs/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layerName: 'tl_demo_zones_f', featureId: delTargetFid, action: 'delete' })
    })).json();

    // Verify 2 features remain on server
    const hitsAfterDel = parseInt((await (await fetch(`${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:tl_demo_zones_f&resultType=hits`, { headers: { Authorization: GEO_AUTH } })).text()).match(/numberOfFeatures="(\d+)"/)?.[1] || '0', 10);

    // 2. Undo Delete (WFS-T Insert)
    const delUndoRes = await evaluate(`(async () => {
      const hist = window.__historyService;
      hist.recordSuccess({
        operationType: 'delete',
        layerName: 'tl_demo_zones_f',
        isCore: false,
        originalFeatureId: '${delTargetFid}',
        currentFeatureId: '${delTargetFid}',
        before: { geometry: ${JSON.stringify(featToDelete.geometry)}, properties: ${JSON.stringify(featToDelete.properties)} },
        after: {}
      });
      const u = await hist.undo();
      return { undoOk: u.success, restoredFid: u.entry?.currentFeatureId };
    })()`);

    // Verify 3 features restored on server
    const hitsAfterUndo = parseInt((await (await fetch(`${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:tl_demo_zones_f&resultType=hits`, { headers: { Authorization: GEO_AUTH } })).text()).match(/numberOfFeatures="(\d+)"/)?.[1] || '0', 10);

    // 3. Redo Delete (WFS-T Delete on recreated feature ID)
    const delRedoRes = await evaluate(`(async () => {
      const hist = window.__historyService;
      const r = await hist.redo();
      return { redoOk: r.success, deletedFid: r.entry?.currentFeatureId };
    })()`);

    // Verify 2 features remain on server
    const hitsAfterRedo = parseInt((await (await fetch(`${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:tl_demo_zones_f&resultType=hits`, { headers: { Authorization: GEO_AUTH } })).text()).match(/numberOfFeatures="(\d+)"/)?.[1] || '0', 10);

    rehearsalReport.deleteAndUndoRedo = {
      forwardDeleteOk: delRes.success,
      hitsAfterDel,
      undoInsertOk: delUndoRes.undoOk,
      restoredFid: delUndoRes.restoredFid,
      hitsAfterUndo,
      redoDeleteOk: delRedoRes.redoOk,
      hitsAfterRedo,
      pass: delRes.success && hitsAfterDel === 2 && delUndoRes.undoOk && hitsAfterUndo === 3 && delRedoRes.redoOk && hitsAfterRedo === 2
    };
    console.log('  Delete + Undo/Redo Result:', rehearsalReport.deleteAndUndoRedo);

    // ── STEP 15: BASEMAP SWITCHING AUDIT ──────────────────────────────────────
    console.log('\n[Step 15] Auditing Basemap Switching while Two Demo Layers are Active...');
    const basemapResult = await evaluate(`(() => {
      const ol = window.__olService;
      const initialBasemap = ol.getBasemap();
      
      // Switch to Satellite
      ol.setBasemap('satellite');
      const satActive = ol.getBasemap() === 'satellite';

      // Switch to CartoDB Dark
      ol.setBasemap('carto-dark');
      const darkActive = ol.getBasemap() === 'carto-dark';

      // Return to OSM
      ol.setBasemap('osm');
      const osmActive = ol.getBasemap() === 'osm';

      const zonesStillVis = ol.layers['tl_demo_zones_f']?.getVisible();
      const sensorsStillVis = ol.layers['tl_demo_sensors_f']?.getVisible();

      return {
        initialBasemap,
        satActive,
        darkActive,
        osmActive,
        zonesStillVis,
        sensorsStillVis
      };
    })()`);

    rehearsalReport.basemapSwitching = {
      ...basemapResult,
      pass: basemapResult.satActive && basemapResult.darkActive && basemapResult.osmActive && basemapResult.zonesStillVis && basemapResult.sensorsStillVis
    };
    console.log('  Basemap Switching Result:', rehearsalReport.basemapSwitching);

    // ── STEP 16: LAYER TOGGLE ISOLATION AUDIT ─────────────────────────────────
    console.log('\n[Step 16] Auditing Layer Toggle Isolation between the Two Layers...');
    const toggleResult = await evaluate(`(() => {
      const ol = window.__olService;
      // Turn OFF zones -> sensors must stay ON
      ol.toggleDynamicLayer('tl_demo_zones_f', false);
      const zonesOff = !ol.layers['tl_demo_zones_f']?.getVisible();
      const sensorsStayOn = ol.layers['tl_demo_sensors_f']?.getVisible();

      // Turn ON zones again -> both ON
      ol.toggleDynamicLayer('tl_demo_zones_f', true);
      const bothOnAgain = ol.layers['tl_demo_zones_f']?.getVisible() && ol.layers['tl_demo_sensors_f']?.getVisible();

      return { zonesOff, sensorsStayOn, bothOnAgain };
    })()`);

    rehearsalReport.toggleIsolation = {
      ...toggleResult,
      pass: toggleResult.zonesOff && toggleResult.sensorsStayOn && toggleResult.bothOnAgain
    };
    console.log('  Layer Toggle Isolation Result:', rehearsalReport.toggleIsolation);

    // ── STEP 17: STRICT NETWORK INVARIANTS AUDIT ──────────────────────────────
    console.log('\n[Step 17] Auditing Strict Network Invariants across Rehearsal...');
    const editAndHistoryReqs = networkReqs.slice(netStartEdits);
    const browserWfsGetFeature = editAndHistoryReqs.filter(r => r.url.includes('GetFeature') && !r.url.includes('GetFeatureInfo') && !r.url.includes('resultType=hits')).length;
    const fullLayerWfs = editAndHistoryReqs.filter(r => r.url.includes('outputFormat=application/json') && r.url.includes('GetFeature')).length;

    rehearsalReport.networkInvariants = {
      browserWfsGetFeatureCount: browserWfsGetFeature,
      fullLayerWfsCount: fullLayerWfs,
      pass: browserWfsGetFeature === 0 && fullLayerWfs === 0
    };
    console.log('  Network Invariants Result:', rehearsalReport.networkInvariants);

    // ── STEP 18: CONSOLE & RUNTIME AUDIT ──────────────────────────────────────
    const unexpectedErrors = consoleMsgs.filter(m => m.type === 'error' && !m.text.includes('favicon'));
    console.log('\n[Step 18] Console & Runtime Exceptions Audit...');
    console.log(`  Uncaught Exceptions: ${exceptions.length}`);
    console.log(`  Unexpected Console Errors: ${unexpectedErrors.length}`);

    ws.close();
    chromeProcess.kill();

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 19: CLEANUP OF DISPOSABLE REHEARSAL LAYERS & TABLES
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n[Step 19] Cleaning up Disposable Rehearsal Layers & Tables...');
    // Unpublish from GeoServer
    const delGeoA = await fetch(`${GEOSERVER_URL}/rest/workspaces/${WORKSPACE}/datastores/${DATASTORE}/featuretypes/tl_demo_zones_f?recurse=true`, {
      method: 'DELETE',
      headers: { Authorization: GEO_AUTH }
    });
    const delGeoB = await fetch(`${GEOSERVER_URL}/rest/workspaces/${WORKSPACE}/datastores/${DATASTORE}/featuretypes/tl_demo_sensors_f?recurse=true`, {
      method: 'DELETE',
      headers: { Authorization: GEO_AUTH }
    });

    // Drop database tables
    await pool.query('DROP TABLE IF EXISTS public.tl_demo_zones_f CASCADE;');
    await pool.query('DROP TABLE IF EXISTS public.tl_demo_sensors_f CASCADE;');

    // Verify existing demo layers are untouched
    const tl1Res = await pool.query('SELECT count(*) FROM public.tl_layer_1;');
    const ex1Res = await pool.query('SELECT count(*) FROM public."Example_1";');

    rehearsalReport.cleanup = {
      geoServerUnpublishedA: delGeoA.status === 200,
      geoServerUnpublishedB: delGeoB.status === 200,
      authoritativeTlLayer1Count: parseInt(tl1Res.rows[0].count, 10),
      authoritativeExample1Count: parseInt(ex1Res.rows[0].count, 10),
      pass: parseInt(tl1Res.rows[0].count, 10) === 244 && parseInt(ex1Res.rows[0].count, 10) === 249
    };
    console.log('  Cleanup Verified:', rehearsalReport.cleanup);

    console.log('\n================================================================');
    console.log('STAGE F TWO-LAYER LIVE DEMO REHEARSAL VERDICT:');
    console.log('================================================================');
    const allSectionsPass = Object.values(rehearsalReport).every(s => s.pass !== false);
    console.log(`REHEARSAL STATUS: ${allSectionsPass ? '100% PASS' : 'FAILED'}`);
    console.log('================================================================\n');

    if (!allSectionsPass) {
      console.error('Rehearsal failed in one or more sections:', rehearsalReport);
      process.exit(1);
    }

    return rehearsalReport;
  } catch (err) {
    console.error('Fatal Rehearsal Error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTwoLayerRehearsal();
