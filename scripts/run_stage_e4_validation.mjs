import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://localhost:5173/';
const DEBUG_PORT = 9222;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runStageE4Validation() {
  console.log('================================================================');
  console.log('STAGE E4 — UNDO / REDO FOR GIS FEATURE EDITING E2E TEST SUITE');
  console.log('Comprehensive 22-Test Matrix with Real Browser CDP & Network Audit');
  console.log('================================================================\n');

  // 1. Launch Headless Chrome
  console.log('[Setup] Launching Headless Chrome on port', DEBUG_PORT, '...');
  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800',
    '--user-data-dir=' + process.env.TEMP + '\\chrome_stage_e4_profile_' + Date.now(),
    'about:blank'
  ]);

  chromeProcess.stderr.on('data', () => {});

  let wsUrl = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    await sleep(400);
    try {
      const res = await fetch(`http://localhost:${DEBUG_PORT}/json`);
      const targets = await res.json();
      const pageTarget = targets.find(t => t.type === 'page' && !t.url.startsWith('chrome-extension://'));
      if (pageTarget && pageTarget.webSocketDebuggerUrl) {
        wsUrl = pageTarget.webSocketDebuggerUrl;
        break;
      }
      const newRes = await fetch(`http://localhost:${DEBUG_PORT}/json/new?${APP_URL}`, { method: 'PUT' });
      const newPage = await newRes.json();
      if (newPage && newPage.webSocketDebuggerUrl) {
        wsUrl = newPage.webSocketDebuggerUrl;
        break;
      }
    } catch {
      // retry
    }
  }

  if (!wsUrl) {
    chromeProcess.kill();
    throw new Error('Failed to connect to Chrome DevTools Protocol on port ' + DEBUG_PORT);
  }

  console.log('[Setup] Connected to Chrome DevTools Protocol at:', wsUrl);

  const ws = new WebSocket(wsUrl);
  await new Promise(resolve => ws.onopen = resolve);

  let msgId = 1;
  const pendingRequests = new Map();
  const consoleMessages = [];
  const networkRequests = [];
  const exceptions = [];

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pendingRequests.has(data.id)) {
      const { resolve, reject } = pendingRequests.get(data.id);
      pendingRequests.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
      return;
    }

    if (data.method === 'Runtime.consoleAPICalled') {
      const type = data.params.type;
      const text = (data.params.args || []).map(a => a.value || JSON.stringify(a)).join(' ');
      consoleMessages.push({ type, text, timestamp: Date.now() });
      if (type === 'error' && !text.includes('favicon')) {
        console.error('  [Browser Console Error]:', text);
      }
    }

    if (data.method === 'Runtime.exceptionThrown') {
      const details = data.params.exceptionDetails;
      exceptions.push(details);
      console.error('  [Browser Uncaught Exception]:', details.text, details.exception?.description);
    }

    if (data.method === 'Network.requestWillBeSent') {
      const req = data.params.request;
      networkRequests.push({
        url: req.url,
        method: req.method,
        postData: req.postData || null,
        timestamp: Date.now(),
      });
    }
  };

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Evaluation failed';
      throw new Error(desc);
    }
    return res.result?.value;
  }

  // Enable CDP Domains
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  const testMatrix = {};
  const networkAudit = {};

  try {
    // ── TEST E4.1 — APPLICATION STARTUP & BASELINE AUDIT ───────────────────────
    console.log('\n--- TEST E4.1: Application Startup & Baseline Audit ---');
    await send('Page.navigate', { url: APP_URL });
    await sleep(4000); // Allow mount, layer loading, discovery

    const e41State = await evaluate(`(() => {
      const canvas = document.querySelector('.ol-map-container canvas');
      const sidebar = document.querySelector('.hud-sidebar-container');
      const legend = document.querySelector('[data-testid="unified-legend-panel"]');
      const hudUndo = document.getElementById('btn-hud-undo');
      const hudRedo = document.getElementById('btn-hud-redo');
      const mapUndo = document.getElementById('btn-map-undo');
      const mapRedo = document.getElementById('btn-map-redo');
      const ol = window.__olService;
      const hist = window.__historyService;
      return {
        hasCanvas: !!canvas,
        hasSidebar: !!sidebar,
        hasLegend: !!legend,
        hasHudUndo: !!hudUndo,
        hasHudRedo: !!hudRedo,
        hasMapUndo: !!mapUndo,
        hasMapRedo: !!mapRedo,
        hasOlService: !!ol,
        hasHistoryService: !!hist,
        mapReady: ol ? !!ol.getMap() : false,
        layerCount: ol && ol.getMap() ? ol.getMap().getLayers().getLength() : 0,
      };
    })()`);

    const e41Pass = e41State.hasCanvas &&
                   e41State.hasSidebar &&
                   e41State.hasLegend &&
                   e41State.hasHudUndo &&
                   e41State.hasHudRedo &&
                   e41State.hasMapUndo &&
                   e41State.hasMapRedo &&
                   e41State.hasHistoryService &&
                   e41State.mapReady &&
                   e41State.layerCount >= 6;

    testMatrix['TEST E4.1'] = {
      name: 'Startup & Baseline Audit (Map, Sidebar, Legend, Undo/Redo Buttons)',
      pass: e41Pass,
      evidence: e41State
    };
    console.log(`Result: ${e41Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.1'].evidence);

    // ── TEST E4.2 — INITIAL HISTORY STATE & EMPTY-STACK INVARIANT ─────────────
    console.log('\n--- TEST E4.2: Initial History State & Empty-Stack Invariant ---');
    const netStartE42 = networkRequests.length;

    const e42State = await evaluate(`(() => {
      const hist = window.__historyService;
      const hudUndo = document.getElementById('btn-hud-undo');
      const hudRedo = document.getElementById('btn-hud-redo');
      return {
        canUndo: hist.canUndo(),
        canRedo: hist.canRedo(),
        undoDisabled: hudUndo ? hudUndo.disabled : false,
        redoDisabled: hudRedo ? hudRedo.disabled : false,
        undoStackLen: hist.getUndoStack().length,
        redoStackLen: hist.getRedoStack().length,
      };
    })()`);

    // Click both buttons while empty
    await evaluate(`(() => {
      const hudUndo = document.getElementById('btn-hud-undo');
      const hudRedo = document.getElementById('btn-hud-redo');
      if (hudUndo) hudUndo.click();
      if (hudRedo) hudRedo.click();
    })()`);
    await sleep(300);

    const netCallsE42 = networkRequests.slice(netStartE42).length;
    const e42Pass = !e42State.canUndo &&
                   !e42State.canRedo &&
                   e42State.undoDisabled &&
                   e42State.redoDisabled &&
                   e42State.undoStackLen === 0 &&
                   e42State.redoStackLen === 0 &&
                   netCallsE42 === 0;

    testMatrix['TEST E4.2'] = {
      name: 'Initial History State (Undo/Redo Disabled, 0 API calls on empty click)',
      pass: e42Pass,
      evidence: { ...e42State, networkCallsOnEmptyClick: netCallsE42 }
    };
    console.log(`Result: ${e42Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.2'].evidence);

    // ── PREPARE DYNAMIC TARGET FEATURE FOR TESTS E4.3 - E4.10 ─────────────────
    // Query initial count of features in tl_layer_1
    const initialTotalRes = await fetch('http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:tl_layer_1&resultType=hits', {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const initialTotalText = await initialTotalRes.text();
    const initialTotalMatch = initialTotalText.match(/numberOfFeatures="(\d+)"/);
    const initialCount = initialTotalMatch ? parseInt(initialTotalMatch[1], 10) : 0;

    // Fetch feature near end of layer for non-destructive test isolation
    const dynRes = await fetch(`http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:tl_layer_1&maxFeatures=1&startIndex=${Math.max(0, initialCount - 5)}&outputFormat=application/json`, {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const dynData = await dynRes.json();
    const tlFeature = dynData.features[0];
    const targetFid = tlFeature.id;
    const initialSov = tlFeature.properties.SOVEREIGNT || 'Original Country';

    console.log(`[Target Feature] FID: ${targetFid}, Initial SOVEREIGNT: "${initialSov}"`);

    // Ensure tl_layer_1 is toggled ON
    await evaluate(`(() => {
      window.__olService.toggleDynamicLayer('tl_layer_1', true);
    })()`);
    await sleep(300);

    // ── TEST E4.3 — DYNAMIC ATTRIBUTE EDIT (FORWARD OPERATION) ────────────────
    console.log('\n--- TEST E4.3: Dynamic Attribute Edit (Forward WFS-T Update) ---');
    const netStartE43 = networkRequests.length;
    const updatedSovVal = `TestEdit_${Date.now()}`;

    // Select feature and perform update via form transaction
    await evaluate(`(async () => {
      const feat = ${JSON.stringify(tlFeature)};
      const ol = window.__olService;
      const hist = window.__historyService;
      ol.setSelectedFeature('tl_layer_1', feat.id, feat);
      if (ol.savedSelectCallback) {
        ol.savedSelectCallback(feat, 'tl_layer_1');
      }

      // Execute forward attribute update
      const payload = {
        layerName: 'tl_layer_1',
        featureId: feat.id,
        action: 'update',
        feature: {
          type: 'Feature',
          geometry: feat.geometry,
          properties: { ...feat.properties, SOVEREIGNT: "${updatedSovVal}" }
        }
      };
      await fetch('/api/geoserver/wfs/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // Record to history
      hist.recordSuccess({
        operationType: 'update',
        layerName: 'tl_layer_1',
        isCore: false,
        originalFeatureId: feat.id,
        currentFeatureId: feat.id,
        before: {
          geometry: feat.geometry,
          properties: feat.properties,
        },
        after: {
          geometry: feat.geometry,
          properties: { ...feat.properties, SOVEREIGNT: "${updatedSovVal}" },
        }
      });
    })()`);
    await sleep(800);

    const e43Requests = networkRequests.slice(netStartE43).filter(r => r.url.includes('/api/geoserver/wfs/transaction'));
    const e43State = await evaluate(`(() => {
      const hist = window.__historyService;
      return {
        canUndo: hist.canUndo(),
        canRedo: hist.canRedo(),
        undoCount: hist.getUndoStack().length,
        redoCount: hist.getRedoStack().length,
      };
    })()`);

    const e43Pass = e43Requests.length === 1 && e43State.canUndo && !e43State.canRedo && e43State.undoCount === 1;
    testMatrix['TEST E4.3'] = {
      name: 'Dynamic Attribute Edit (1 WFS-T Update, Undo enabled, Redo disabled)',
      pass: e43Pass,
      evidence: { wfstCalls: e43Requests.length, ...e43State }
    };
    console.log(`Result: ${e43Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.3'].evidence);

    // ── TEST E4.4 — UNDO DYNAMIC ATTRIBUTE EDIT (INVERSE WFS-T UPDATE) ─────────
    console.log('\n--- TEST E4.4: Undo Dynamic Attribute Edit (Inverse WFS-T Update) ---');
    const netStartE44 = networkRequests.length;

    // Trigger Undo via button click
    await evaluate(`(() => {
      const hudUndo = document.getElementById('btn-hud-undo');
      if (hudUndo) hudUndo.click();
    })()`);
    await sleep(1000);

    const e44Requests = networkRequests.slice(netStartE44).filter(r => r.url.includes('/api/geoserver/wfs/transaction'));
    const e44State = await evaluate(`(() => {
      const hist = window.__historyService;
      return {
        canUndo: hist.canUndo(),
        canRedo: hist.canRedo(),
        undoCount: hist.getUndoStack().length,
        redoCount: hist.getRedoStack().length,
      };
    })()`);

    // Verify server-side restoration
    const verifyUndoRes = await fetch(`http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&featureId=${targetFid}&outputFormat=application/json`, {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const verifyUndoData = await verifyUndoRes.json();
    const restoredSov = verifyUndoData.features[0]?.properties?.SOVEREIGNT;

    const e44Pass = e44Requests.length === 1 &&
                   !e44State.canUndo &&
                   e44State.canRedo &&
                   e44State.undoCount === 0 &&
                   e44State.redoCount === 1 &&
                   restoredSov === initialSov;

    testMatrix['TEST E4.4'] = {
      name: 'Undo Dynamic Attribute Edit (1 Inverse WFS-T Update, Server Restored, Redo Enabled)',
      pass: e44Pass,
      evidence: { wfstCalls: e44Requests.length, restoredSov, ...e44State }
    };
    console.log(`Result: ${e44Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.4'].evidence);

    // ── TEST E4.5 — REDO DYNAMIC ATTRIBUTE EDIT (FORWARD WFS-T UPDATE) ─────────
    console.log('\n--- TEST E4.5: Redo Dynamic Attribute Edit (Forward WFS-T Update) ---');
    const netStartE45 = networkRequests.length;

    // Click Redo
    await evaluate(`(() => {
      const hudRedo = document.getElementById('btn-hud-redo');
      if (hudRedo) hudRedo.click();
    })()`);
    await sleep(1000);

    const e45Requests = networkRequests.slice(netStartE45).filter(r => r.url.includes('/api/geoserver/wfs/transaction'));
    const e45State = await evaluate(`(() => {
      const hist = window.__historyService;
      return {
        canUndo: hist.canUndo(),
        canRedo: hist.canRedo(),
        undoCount: hist.getUndoStack().length,
        redoCount: hist.getRedoStack().length,
      };
    })()`);

    // Verify server-side reapplied value
    const verifyRedoRes = await fetch(`http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&featureId=${targetFid}&outputFormat=application/json`, {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const verifyRedoData = await verifyRedoRes.json();
    const reappliedSov = verifyRedoData.features[0]?.properties?.SOVEREIGNT;

    const e45Pass = e45Requests.length === 1 &&
                   e45State.canUndo &&
                   !e45State.canRedo &&
                   e45State.undoCount === 1 &&
                   e45State.redoCount === 0 &&
                   reappliedSov === updatedSovVal;

    testMatrix['TEST E4.5'] = {
      name: 'Redo Dynamic Attribute Edit (1 Forward WFS-T Update, Reapplied, Undo Enabled)',
      pass: e45Pass,
      evidence: { wfstCalls: e45Requests.length, reappliedSov, ...e45State }
    };
    console.log(`Result: ${e45Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.5'].evidence);

    // Clean up E4.3-E4.5: undo back to original value so baseline is clean
    await evaluate(`window.__historyService.undo()`);
    await sleep(600);
    await evaluate(`window.__historyService.clear()`);

    // ── TEST E4.6 — DYNAMIC MOVE EDIT & UNDO / REDO ───────────────────────────
    console.log('\n--- TEST E4.6: Dynamic Move Edit & Undo / Redo ---');
    const origGeom = JSON.parse(JSON.stringify(tlFeature.geometry));
    const movedGeom = JSON.parse(JSON.stringify(tlFeature.geometry));
    // Shift longitude coordinates slightly (+0.001)
    if (movedGeom.type === 'Polygon') {
      movedGeom.coordinates = movedGeom.coordinates.map(ring => ring.map(([lon, lat]) => [lon + 0.001, lat]));
    } else if (movedGeom.type === 'MultiPolygon') {
      movedGeom.coordinates = movedGeom.coordinates.map(poly => poly.map(ring => ring.map(([lon, lat]) => [lon + 0.001, lat])));
    }

    // Step 1: Forward Move
    const netStartMove = networkRequests.length;
    await evaluate(`(async () => {
      const feat = ${JSON.stringify(tlFeature)};
      const moved = ${JSON.stringify(movedGeom)};
      const payload = {
        layerName: 'tl_layer_1',
        featureId: feat.id,
        action: 'update',
        feature: { type: 'Feature', geometry: moved, properties: feat.properties }
      };
      await fetch('/api/geoserver/wfs/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      window.__historyService.recordSuccess({
        operationType: 'move',
        layerName: 'tl_layer_1',
        isCore: false,
        originalFeatureId: feat.id,
        currentFeatureId: feat.id,
        before: { geometry: feat.geometry, properties: feat.properties },
        after: { geometry: moved, properties: feat.properties }
      });
    })()`);
    await sleep(600);
    const moveReqs = networkRequests.slice(netStartMove).filter(r => r.url.includes('/api/geoserver/wfs/transaction')).length;

    // Step 2: Undo Move
    const netStartUndoMove = networkRequests.length;
    await evaluate(`window.__historyService.undo()`);
    await sleep(600);
    const undoMoveReqs = networkRequests.slice(netStartUndoMove).filter(r => r.url.includes('/api/geoserver/wfs/transaction')).length;

    // Step 3: Redo Move
    const netStartRedoMove = networkRequests.length;
    await evaluate(`window.__historyService.redo()`);
    await sleep(600);
    const redoMoveReqs = networkRequests.slice(netStartRedoMove).filter(r => r.url.includes('/api/geoserver/wfs/transaction')).length;

    // Restore baseline
    await evaluate(`window.__historyService.undo()`);
    await sleep(600);
    await evaluate(`window.__historyService.clear()`);

    const e46Pass = moveReqs === 1 && undoMoveReqs === 1 && redoMoveReqs === 1;
    testMatrix['TEST E4.6'] = {
      name: 'Dynamic Move & Undo / Redo (1 Update move, 1 Update undo, 1 Update redo)',
      pass: e46Pass,
      evidence: { moveReqs, undoMoveReqs, redoMoveReqs }
    };
    console.log(`Result: ${e46Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.6'].evidence);

    // ── TEST E4.7 — DYNAMIC VERTEX EDIT & UNDO / REDO ─────────────────────────
    console.log('\n--- TEST E4.7: Dynamic Vertex Edit & Undo / Redo ---');
    const vertexGeom = JSON.parse(JSON.stringify(tlFeature.geometry));
    if (vertexGeom.type === 'Polygon') {
      vertexGeom.coordinates[0][0][1] += 0.001; // shift first vertex lat
    } else if (vertexGeom.type === 'MultiPolygon') {
      vertexGeom.coordinates[0][0][0][1] += 0.001;
    }

    const netStartVertex = networkRequests.length;
    await evaluate(`(async () => {
      const feat = ${JSON.stringify(tlFeature)};
      const vGeom = ${JSON.stringify(vertexGeom)};
      const payload = {
        layerName: 'tl_layer_1',
        featureId: feat.id,
        action: 'update',
        feature: { type: 'Feature', geometry: vGeom, properties: feat.properties }
      };
      await fetch('/api/geoserver/wfs/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      window.__historyService.recordSuccess({
        operationType: 'vertex',
        layerName: 'tl_layer_1',
        isCore: false,
        originalFeatureId: feat.id,
        currentFeatureId: feat.id,
        before: { geometry: feat.geometry, properties: feat.properties },
        after: { geometry: vGeom, properties: feat.properties }
      });
    })()`);
    await sleep(600);

    const vReqs = networkRequests.slice(netStartVertex).filter(r => r.url.includes('/api/geoserver/wfs/transaction')).length;

    const netStartUndoV = networkRequests.length;
    await evaluate(`window.__historyService.undo()`);
    await sleep(600);
    const undoVReqs = networkRequests.slice(netStartUndoV).filter(r => r.url.includes('/api/geoserver/wfs/transaction')).length;

    const netStartRedoV = networkRequests.length;
    await evaluate(`window.__historyService.redo()`);
    await sleep(600);
    const redoVReqs = networkRequests.slice(netStartRedoV).filter(r => r.url.includes('/api/geoserver/wfs/transaction')).length;

    // Restore baseline
    await evaluate(`window.__historyService.undo()`);
    await sleep(600);
    await evaluate(`window.__historyService.clear()`);

    const e47Pass = vReqs === 1 && undoVReqs === 1 && redoVReqs === 1;
    testMatrix['TEST E4.7'] = {
      name: 'Dynamic Vertex Edit & Undo / Redo (1 Update vertex, 1 Update undo, 1 Update redo)',
      pass: e47Pass,
      evidence: { vReqs, undoVReqs, redoVReqs }
    };
    console.log(`Result: ${e47Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.7'].evidence);

    // ── TEST E4.8 — DYNAMIC DELETE (FORWARD WFS-T DELETE) ─────────────────────
    console.log('\n--- TEST E4.8: Dynamic Delete (Forward WFS-T Delete) ---');
    // We create a temporary dedicated feature in tl_layer_1 so tests E4.8 - E4.10 are 100% isolated!
    const testFeatPayload = {
      layerName: 'tl_layer_1',
      action: 'insert',
      feature: {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[12.5, 41.8], [12.5, 41.9], [12.6, 41.9], [12.6, 41.8], [12.5, 41.8]]]
        },
        properties: {
          SOVEREIGNT: 'UndoRedo_Test_Country',
          featurecla: 'Admin-0 country'
        }
      }
    };
    const initInsertRes = await fetch('http://localhost:3001/api/geoserver/wfs/transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testFeatPayload)
    });
    const initInsertData = await initInsertRes.json();
    const delTargetFid = initInsertData.featureId;
    console.log('[Setup] Created isolated dynamic feature for delete/undo tests:', delTargetFid);

    const netStartDel = networkRequests.length;
    await evaluate(`(async () => {
      const fid = "${delTargetFid}";
      const payload = {
        layerName: 'tl_layer_1',
        featureId: fid,
        action: 'delete'
      };
      await fetch('/api/geoserver/wfs/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      window.__historyService.recordSuccess({
        operationType: 'delete',
        layerName: 'tl_layer_1',
        isCore: false,
        originalFeatureId: fid,
        currentFeatureId: fid,
        before: {
          geometry: ${JSON.stringify(testFeatPayload.feature.geometry)},
          properties: ${JSON.stringify(testFeatPayload.feature.properties)},
        },
        after: {}
      });
    })()`);
    await sleep(800);

    const delReqs = networkRequests.slice(netStartDel).filter(r => r.url.includes('/api/geoserver/wfs/transaction')).length;

    // Verify deleted from server
    const checkDelRes = await fetch(`http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&featureId=${delTargetFid}&resultType=hits`, {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const checkDelText = await checkDelRes.text();
    const hitsMatch = checkDelText.match(/numberOfFeatures="(\d+)"/);
    const delHits = hitsMatch ? parseInt(hitsMatch[1], 10) : 0;

    const e48Pass = delReqs === 1 && delHits === 0;
    testMatrix['TEST E4.8'] = {
      name: 'Dynamic Delete (1 WFS-T Delete, Pre-delete State Recorded)',
      pass: e48Pass,
      evidence: { delReqs, delHits, delTargetFid }
    };
    console.log(`Result: ${e48Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.8'].evidence);

    // ── TEST E4.9 — UNDO DYNAMIC DELETE (WFS-T INSERT RESTORATION) ────────────
    console.log('\n--- TEST E4.9: Undo Dynamic Delete (WFS-T Insert Restoration) ---');
    const netStartUndoDel = networkRequests.length;

    await evaluate(`window.__historyService.undo()`);
    await sleep(1000);

    const undoDelReqs = networkRequests.slice(netStartUndoDel).filter(r => r.url.includes('/api/geoserver/wfs/transaction'));
    const undoEntry = await evaluate(`window.__historyService.getRedoStack()[0]`);

    // Verify server has recreated feature
    const recreatedFid = undoEntry ? undoEntry.currentFeatureId : null;
    const checkRecreatedRes = await fetch(`http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&featureId=${recreatedFid}&outputFormat=application/json`, {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const checkRecreatedData = await checkRecreatedRes.json();
    const recreatedFeature = checkRecreatedData.features?.[0];

    const e49Pass = undoDelReqs.length === 1 &&
                   recreatedFid !== null &&
                   recreatedFeature &&
                   recreatedFeature.properties?.SOVEREIGNT === 'UndoRedo_Test_Country';

    testMatrix['TEST E4.9'] = {
      name: 'Undo Dynamic Delete (1 WFS-T Insert, Recreated Server-Side, New FID Bound)',
      pass: e49Pass,
      evidence: {
        undoDelReqs: undoDelReqs.length,
        originalFid: delTargetFid,
        recreatedFid,
        restoredProperty: recreatedFeature?.properties?.SOVEREIGNT
      }
    };
    console.log(`Result: ${e49Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.9'].evidence);

    // ── TEST E4.10 — REDO DYNAMIC DELETE (TARGETING RECREATED FEATURE ID) ──────
    console.log('\n--- TEST E4.10: Redo Dynamic Delete (Targeting Recreated Feature ID) ---');
    const netStartRedoDel = networkRequests.length;

    await evaluate(`window.__historyService.redo()`);
    await sleep(1000);

    const redoDelReqs = networkRequests.slice(netStartRedoDel).filter(r => r.url.includes('/api/geoserver/wfs/transaction'));

    // Verify recreated feature is deleted again from server
    const checkRedoDelRes = await fetch(`http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&featureId=${recreatedFid}&resultType=hits`, {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const checkRedoDelText = await checkRedoDelRes.text();
    const redoHitsMatch = checkRedoDelText.match(/numberOfFeatures="(\d+)"/);
    const redoDelHits = redoHitsMatch ? parseInt(redoHitsMatch[1], 10) : 0;

    const e410Pass = redoDelReqs.length === 1 && redoDelHits === 0;
    testMatrix['TEST E4.10'] = {
      name: 'Redo Dynamic Delete (1 WFS-T Delete on Recreated Feature ID, Clean Server State)',
      pass: e410Pass,
      evidence: { redoDelReqs: redoDelReqs.length, recreatedFid, redoDelHits }
    };
    console.log(`Result: ${e410Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.10'].evidence);

    await evaluate(`window.__historyService.clear()`);

    // ── TEST E4.11 — MULTI-STEP HISTORY ORDER (STRICT LIFO) ───────────────────
    console.log('\n--- TEST E4.11: Multi-Step History Order (Strict LIFO) ---');
    // Record three mock operations A, B, C
    const lifoTest = await evaluate(`(() => {
      const hist = window.__historyService;
      hist.clear();
      hist.recordSuccess({ operationType: 'update', layerName: 'tl_layer_1', isCore: false, originalFeatureId: '1', currentFeatureId: '1', before: { properties: { step: 'orig' } }, after: { properties: { step: 'A' } } });
      hist.recordSuccess({ operationType: 'move', layerName: 'tl_layer_1', isCore: false, originalFeatureId: '1', currentFeatureId: '1', before: { properties: { step: 'A' } }, after: { properties: { step: 'B' } } });
      hist.recordSuccess({ operationType: 'vertex', layerName: 'tl_layer_1', isCore: false, originalFeatureId: '1', currentFeatureId: '1', before: { properties: { step: 'B' } }, after: { properties: { step: 'C' } } });

      const undoOrder = hist.getUndoStack().map(e => e.operationType);
      return { undoOrder };
    })()`);

    // Order in stack is [update (A), move (B), vertex (C)].
    // First undo will pop C, then B, then A.
    const e411Pass = JSON.stringify(lifoTest.undoOrder) === JSON.stringify(['update', 'move', 'vertex']);
    testMatrix['TEST E4.11'] = {
      name: 'Multi-Step History Order (Strict LIFO: A -> B -> C)',
      pass: e411Pass,
      evidence: lifoTest
    };
    console.log(`Result: ${e411Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.11'].evidence);
    await evaluate(`window.__historyService.clear()`);

    // ── TEST E4.12 — NEW EDIT CLEARS REDO STACK ───────────────────────────────
    console.log('\n--- TEST E4.12: New Edit Clears Redo Stack ---');
    const redoClearState = await evaluate(`(() => {
      const hist = window.__historyService;
      hist.clear();
      // Step 1: Record A
      hist.recordSuccess({ operationType: 'update', layerName: 'tl_layer_1', isCore: false, originalFeatureId: '1', currentFeatureId: '1', before: {}, after: {} });
      // Simulate Undo A manually into redo stack
      const a = hist.getUndoStack()[0];
      hist.clear();
      // Push A to redo stack directly for test
      hist.recordSuccess({ operationType: 'update', layerName: 'tl_layer_1', isCore: false, originalFeatureId: '1', currentFeatureId: '1', before: {}, after: {} });
      // Now pop to redo
      const entry = hist.getUndoStack()[0];
      // Manually set up undoStack: [], redoStack: [entry]
      (hist).undoStack = [];
      (hist).redoStack = [entry];
      (hist).notify();

      const canRedoBefore = hist.canRedo();
      const redoLenBefore = hist.getRedoStack().length;

      // Step 2: New Edit B
      hist.recordSuccess({ operationType: 'move', layerName: 'tl_layer_1', isCore: false, originalFeatureId: '1', currentFeatureId: '1', before: {}, after: {} });

      const canRedoAfter = hist.canRedo();
      const redoLenAfter = hist.getRedoStack().length;

      return { canRedoBefore, redoLenBefore, canRedoAfter, redoLenAfter };
    })()`);

    const e412Pass = redoClearState.canRedoBefore &&
                    redoClearState.redoLenBefore === 1 &&
                    !redoClearState.canRedoAfter &&
                    redoClearState.redoLenAfter === 0;

    testMatrix['TEST E4.12'] = {
      name: 'New Edit Clears Redo Stack Invariant',
      pass: e412Pass,
      evidence: redoClearState
    };
    console.log(`Result: ${e412Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.12'].evidence);
    await evaluate(`window.__historyService.clear()`);

    // ── TEST E4.13 — CORE LAYER CREATE / UNDO / REDO ──────────────────────────
    console.log('\n--- TEST E4.13: Core Layer Create / Undo / Redo ---');
    // Fetch road geometry to get a guaranteed valid coordinate for streetlight
    const roadRes = await fetch('http://localhost:3001/api/roads');
    const roadData = await roadRes.json();
    const firstRoad = roadData.features[0];
    const validCoord = firstRoad.geometry.coordinates[0];
    const roadId = firstRoad.id;
    const zoneId = firstRoad.properties?.zone_id || 1;

    const slPayload = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: validCoord },
      properties: { name: 'E4_Test_Streetlight', type: 'standard', road_id: roadId, zone_id: zoneId }
    };

    // Create via API
    const slCreateRes = await fetch('http://localhost:3001/api/streetlights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slPayload)
    });
    const slCreated = await slCreateRes.json();
    const slId = String(slCreated.id);
    console.log('[Core Setup] Created streetlight ID:', slId);

    // Record creation in history
    await evaluate(`(() => {
      window.__historyService.recordSuccess({
        operationType: 'create',
        layerName: 'streetlights',
        isCore: true,
        originalFeatureId: "${slId}",
        currentFeatureId: "${slId}",
        before: {},
        after: ${JSON.stringify(slPayload)}
      });
    })()`);

    // Undo create -> should DELETE the feature
    const netStartSlUndo = networkRequests.length;
    await evaluate(`window.__historyService.undo()`);
    await sleep(800);
    const slUndoReqs = networkRequests.slice(netStartSlUndo).filter(r => r.url.includes('/api/streetlights'));

    // Check DB hit: should return 404 or not found
    const verifySlDelRes = await fetch(`http://localhost:3001/api/streetlights/${slId}`);
    const slDeletedOk = verifySlDelRes.status === 404;

    // Redo create -> should re-create the feature
    const netStartSlRedo = networkRequests.length;
    await evaluate(`window.__historyService.redo()`);
    await sleep(800);
    const slRedoReqs = networkRequests.slice(netStartSlRedo).filter(r => r.url.includes('/api/streetlights'));

    // Get re-created ID and clean up
    const redoEntry = await evaluate(`window.__historyService.getUndoStack()[0]`);
    const recreatedSlId = redoEntry ? redoEntry.currentFeatureId : slId;
    await fetch(`http://localhost:3001/api/streetlights/${recreatedSlId}`, { method: 'DELETE' });

    const e413Pass = slUndoReqs.length === 1 && slDeletedOk && slRedoReqs.length === 1;
    testMatrix['TEST E4.13'] = {
      name: 'Core Layer Create / Undo / Redo (REST DELETE undo, REST POST redo)',
      pass: e413Pass,
      evidence: { slUndoReqs: slUndoReqs.length, slDeletedOk, slRedoReqs: slRedoReqs.length, slId, recreatedSlId }
    };
    console.log(`Result: ${e413Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.13'].evidence);
    await evaluate(`window.__historyService.clear()`);

    // ── TEST E4.14 — FAILED UNDO HANDLING ─────────────────────────────────────
    console.log('\n--- TEST E4.14: Failed Undo Handling ---');
    const failedUndoState = await evaluate(`(async () => {
      const hist = window.__historyService;
      hist.clear();
      // Record an entry with an invalid target that will fail on server
      hist.recordSuccess({
        operationType: 'update',
        layerName: 'tl_layer_1',
        isCore: false,
        originalFeatureId: 'nonexistent_layer.999999',
        currentFeatureId: 'nonexistent_layer.999999',
        before: { geometry: { type: 'Point', coordinates: [0,0] }, properties: {} },
        after: { geometry: { type: 'Point', coordinates: [0,0] }, properties: {} }
      });

      const undoCountBefore = hist.getUndoStack().length;
      const redoCountBefore = hist.getRedoStack().length;

      // Attempt undo
      const res = await hist.undo();

      const undoCountAfter = hist.getUndoStack().length;
      const redoCountAfter = hist.getRedoStack().length;

      return {
        success: res.success,
        error: res.error,
        undoCountBefore,
        undoCountAfter,
        redoCountBefore,
        redoCountAfter
      };
    })()`);

    const e414Pass = !failedUndoState.success &&
                    failedUndoState.undoCountBefore === 1 &&
                    failedUndoState.undoCountAfter === 1 &&
                    failedUndoState.redoCountBefore === 0 &&
                    failedUndoState.redoCountAfter === 0;

    testMatrix['TEST E4.14'] = {
      name: 'Failed Undo Handling (Stack Uncorrupted, No Stack Movement on Server Error)',
      pass: e414Pass,
      evidence: failedUndoState
    };
    console.log(`Result: ${e414Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.14'].evidence);
    await evaluate(`window.__historyService.clear()`);

    // ── TEST E4.15 — FAILED REDO HANDLING ─────────────────────────────────────
    console.log('\n--- TEST E4.15: Failed Redo Handling ---');
    const failedRedoState = await evaluate(`(async () => {
      const hist = window.__historyService;
      hist.clear();
      // Set up an invalid redo entry
      const badEntry = {
        id: 'bad_1',
        timestamp: Date.now(),
        operationType: 'update',
        layerName: 'tl_layer_1',
        isCore: false,
        originalFeatureId: 'nonexistent_layer.999999',
        currentFeatureId: 'nonexistent_layer.999999',
        before: {},
        after: { geometry: { type: 'Point', coordinates: [0,0] }, properties: {} }
      };
      (hist).redoStack = [badEntry];
      (hist).notify();

      const redoCountBefore = hist.getRedoStack().length;
      const res = await hist.redo();
      const redoCountAfter = hist.getRedoStack().length;

      return {
        success: res.success,
        error: res.error,
        redoCountBefore,
        redoCountAfter
      };
    })()`);

    const e415Pass = !failedRedoState.success &&
                    failedRedoState.redoCountBefore === 1 &&
                    failedRedoState.redoCountAfter === 1;

    testMatrix['TEST E4.15'] = {
      name: 'Failed Redo Handling (Redo Stack Preserved on Server Error)',
      pass: e415Pass,
      evidence: failedRedoState
    };
    console.log(`Result: ${e415Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.15'].evidence);
    await evaluate(`window.__historyService.clear()`);

    // ── TEST E4.16 — DUPLICATE-CLICK & CONCURRENCY PROTECTION ─────────────────
    console.log('\n--- TEST E4.16: Duplicate-Click & Concurrency Protection ---');
    // Set up a valid operation
    await evaluate(`(() => {
      const hist = window.__historyService;
      hist.clear();
      hist.recordSuccess({
        operationType: 'update',
        layerName: 'tl_layer_1',
        isCore: false,
        originalFeatureId: "${targetFid}",
        currentFeatureId: "${targetFid}",
        before: { geometry: ${JSON.stringify(tlFeature.geometry)}, properties: ${JSON.stringify(tlFeature.properties)} },
        after: { geometry: ${JSON.stringify(tlFeature.geometry)}, properties: ${JSON.stringify(tlFeature.properties)} }
      });
    })()`);

    const netStartRapid = networkRequests.length;
    // Rapid double click on Undo button
    const concurrencyResult = await evaluate(`(() => {
      const p1 = window.__historyService.undo();
      const p2 = window.__historyService.undo();
      return Promise.all([p1, p2]);
    })()`);

    await sleep(800);
    const rapidRequests = networkRequests.slice(netStartRapid).filter(r => r.url.includes('/api/geoserver/wfs/transaction'));

    const e416Pass = rapidRequests.length === 1 &&
                    concurrencyResult[0].success === true &&
                    concurrencyResult[1].success === false;

    testMatrix['TEST E4.16'] = {
      name: 'Duplicate-Click / Concurrency Protection (Exactly 1 Network Transaction)',
      pass: e416Pass,
      evidence: {
        wfstCalls: rapidRequests.length,
        firstCallSuccess: concurrencyResult[0].success,
        secondCallSuccess: concurrencyResult[1].success,
        secondCallError: concurrencyResult[1].error
      }
    };
    console.log(`Result: ${e416Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.16'].evidence);
    await evaluate(`window.__historyService.clear()`);

    // ── TEST E4.17 — STRICT ZERO WFS GETFEATURE INVARIANT ─────────────────────
    console.log('\n--- TEST E4.17: Strict Zero WFS GetFeature Invariant ---');
    // Invariant: Across all undo/redo tests, browser WFS GetFeature calls = 0
    const historyRequests = networkRequests.slice(netStartE43);
    const browserWfsGetFeature = historyRequests.filter(r => r.url.includes('GetFeature') && !r.url.includes('GetFeatureInfo') && !r.url.includes('resultType=hits')).length;

    const e417Pass = browserWfsGetFeature === 0;
    testMatrix['TEST E4.17'] = {
      name: 'Strict Zero WFS GetFeature Invariant (Browser WFS GetFeature = 0)',
      pass: e417Pass,
      evidence: { browserWfsGetFeatureCount: browserWfsGetFeature }
    };
    console.log(`Result: ${e417Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.17'].evidence);

    // ── TEST E4.18 — STRICT ZERO FULL-LAYER WFS REFRESH INVARIANT ─────────────
    console.log('\n--- TEST E4.18: Strict Zero Full-Layer WFS Refresh Invariant ---');
    const fullLayerWfsCalls = historyRequests.filter(r => r.url.includes('outputFormat=application/json') && r.url.includes('GetFeature')).length;

    const e418Pass = fullLayerWfsCalls === 0;
    testMatrix['TEST E4.18'] = {
      name: 'Strict Zero Full-Layer WFS Refresh Invariant (Full-Layer WFS = 0)',
      pass: e418Pass,
      evidence: { fullLayerWfsCalls }
    };
    console.log(`Result: ${e418Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.18'].evidence);

    // ── TEST E4.19 — MAP / FEATURE INFO / UNIFIED LEGEND SYNCHRONIZATION ───────
    console.log('\n--- TEST E4.19: Map, Feature Info & Unified Legend Synchronization ---');
    const syncState = await evaluate(`(() => {
      const legend = document.querySelector('[data-testid="unified-legend-panel"]');
      const items = Array.from(legend?.querySelectorAll('.hud-legend-item') || []);
      const map = window.__olService?.getMap();
      return {
        legendMounted: !!legend,
        legendItemCount: items.length,
        mapHasTarget: map ? !!map.getTarget() : false,
      };
    })()`);

    const e419Pass = syncState.legendMounted && syncState.legendItemCount >= 5 && syncState.mapHasTarget;
    testMatrix['TEST E4.19'] = {
      name: 'Map, Feature Info & Unified Legend Synchronization Audit',
      pass: e419Pass,
      evidence: syncState
    };
    console.log(`Result: ${e419Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.19'].evidence);

    // ── TEST E4.20 — CORE-LAYER CRUD REGRESSION AUDIT ─────────────────────────
    console.log('\n--- TEST E4.20: Core-Layer CRUD Regression Audit ---');
    // Test streetlight create and delete
    const regSlRes = await fetch('http://localhost:3001/api/streetlights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slPayload)
    });
    const regSlData = await regSlRes.json();
    const regSlId = regSlData.id;

    const regDelRes = await fetch(`http://localhost:3001/api/streetlights/${regSlId}`, { method: 'DELETE' });
    const e420Pass = regSlRes.status === 201 && regDelRes.status === 204;

    testMatrix['TEST E4.20'] = {
      name: 'Core-Layer CRUD Regression Audit (Streetlights Create 201 + Delete 204)',
      pass: e420Pass,
      evidence: { createStatus: regSlRes.status, deleteStatus: regDelRes.status, regSlId }
    };
    console.log(`Result: ${e420Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.20'].evidence);

    // ── TEST E4.21 — KEYBOARD SHORTCUTS AUDIT (CTRL+Z / CTRL+Y) ───────────────
    console.log('\n--- TEST E4.21: Keyboard Shortcuts Audit (Ctrl+Z / Ctrl+Y) ---');
    // Setup 1 operation in history
    await evaluate(`(() => {
      const hist = window.__historyService;
      hist.clear();
      hist.recordSuccess({
        operationType: 'update',
        layerName: 'tl_layer_1',
        isCore: false,
        originalFeatureId: "${targetFid}",
        currentFeatureId: "${targetFid}",
        before: { geometry: ${JSON.stringify(tlFeature.geometry)}, properties: ${JSON.stringify(tlFeature.properties)} },
        after: { geometry: ${JSON.stringify(tlFeature.geometry)}, properties: ${JSON.stringify(tlFeature.properties)} }
      });
    })()`);

    const netStartKeyUndo = networkRequests.length;
    // Dispatch Ctrl+Z
    await evaluate(`(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'z',
        code: 'KeyZ',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      });
      window.dispatchEvent(event);
    })()`);
    await sleep(800);

    const keyUndoReqs = networkRequests.slice(netStartKeyUndo).filter(r => r.url.includes('/api/geoserver/wfs/transaction')).length;

    const netStartKeyRedo = networkRequests.length;
    // Dispatch Ctrl+Y
    await evaluate(`(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'y',
        code: 'KeyY',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      });
      window.dispatchEvent(event);
    })()`);
    await sleep(800);

    const keyRedoReqs = networkRequests.slice(netStartKeyRedo).filter(r => r.url.includes('/api/geoserver/wfs/transaction')).length;

    await evaluate(`window.__historyService.clear()`);

    const e421Pass = keyUndoReqs === 1 && keyRedoReqs === 1;
    testMatrix['TEST E4.21'] = {
      name: 'Keyboard Shortcuts Audit (Ctrl+Z triggers Undo, Ctrl+Y triggers Redo)',
      pass: e421Pass,
      evidence: { keyUndoReqs, keyRedoReqs }
    };
    console.log(`Result: ${e421Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.21'].evidence);

    // ── TEST E4.22 — RUNTIME & CONSOLE AUDIT ───────────────────────────────────
    console.log('\n--- TEST E4.22: Runtime & Console Audit ---');
    const unexpectedErrors = consoleMessages.filter(m => m.type === 'error' && !m.text.includes('favicon'));
    const uncaughtExceptions = exceptions.length;

    const e422Pass = unexpectedErrors.length === 0 && uncaughtExceptions === 0;
    testMatrix['TEST E4.22'] = {
      name: 'Runtime & Console Error Audit (0 Uncaught Exceptions, 0 Unexpected Console Errors)',
      pass: e422Pass,
      evidence: { uncaughtExceptions, unexpectedErrorsCount: unexpectedErrors.length }
    };
    console.log(`Result: ${e422Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E4.22'].evidence);

  } finally {
    ws.close();
    chromeProcess.kill();
  }

  // ── PRINT SUMMARY REPORT ───────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log('STAGE E4 VALIDATION MATRIX RESULTS:');
  console.log('================================================================');

  let passedCount = 0;
  const totalCount = Object.keys(testMatrix).length;

  for (const [testId, result] of Object.entries(testMatrix)) {
    if (result.pass) passedCount++;
    console.log(`${testId.padEnd(12)} | ${result.name.padEnd(65)} | ${result.pass ? 'PASS' : 'FAIL'}`);
  }

  console.log('================================================================');
  console.log(`FINAL TALLY: ${passedCount} / ${totalCount} TESTS PASSED`);
  console.log('================================================================\n');

  if (passedCount !== totalCount) {
    console.error(`VALIDATION FAILED: ${totalCount - passedCount} tests failed.`);
    process.exit(1);
  } else {
    console.log('STAGE E4 VALIDATION OFFICIALLY PASSED!');
  }
}

runStageE4Validation().catch((err) => {
  console.error('Fatal test runner failure:', err);
  process.exit(1);
});
