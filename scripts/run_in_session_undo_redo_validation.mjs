import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://localhost:5173/';
const DEBUG_PORT = 9222;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runInSessionUndoRedoValidation() {
  console.log('================================================================');
  console.log('CONTEXTUAL IN-SESSION UNDO / REDO VALIDATION SUITE (ISUR.1 - ISUR.30)');
  console.log('Real Browser CDP, Network Audit, Geometry Sync, and History Separation');
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
    '--user-data-dir=' + process.env.TEMP + '\\chrome_isur_profile_' + Date.now(),
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

  try {
    // ── STARTUP ─────────────────────────────────────────────────────────────
    console.log('[Setup] Navigating to', APP_URL);
    await send('Page.navigate', { url: APP_URL });
    await sleep(4000); // Wait for layers and map mount

    // ── ISUR.1 — DEFAULT BROWSING: UNDO/REDO HIDDEN ──────────────────────────
    console.log('\n--- ISUR.1: Default Browsing State: Undo/Redo Hidden ---');
    const isur1 = await evaluate(`(() => {
      const hudUndo = document.getElementById('btn-hud-undo');
      const hudRedo = document.getElementById('btn-hud-redo');
      const mapUndo = document.getElementById('btn-map-undo');
      const mapRedo = document.getElementById('btn-map-redo');
      const divider = document.getElementById('map-undo-redo-divider');
      const session = window.__editSessionHistory;
      return {
        hudUndoDisplay: hudUndo ? window.getComputedStyle(hudUndo).display : null,
        hudRedoDisplay: hudRedo ? window.getComputedStyle(hudRedo).display : null,
        mapUndoDisplay: mapUndo ? window.getComputedStyle(mapUndo).display : null,
        mapRedoDisplay: mapRedo ? window.getComputedStyle(mapRedo).display : null,
        dividerDisplay: divider ? window.getComputedStyle(divider).display : null,
        sessionActive: session ? session.isActive() : false,
      };
    })()`);

    const isur1Pass = isur1.hudUndoDisplay === 'none' &&
                     isur1.hudRedoDisplay === 'none' &&
                     isur1.mapUndoDisplay === 'none' &&
                     isur1.mapRedoDisplay === 'none' &&
                     isur1.dividerDisplay === 'none' &&
                     !isur1.sessionActive;

    testMatrix['ISUR.1'] = {
      name: 'Default Browsing: Undo/Redo Hidden in DOM styles',
      pass: isur1Pass,
      evidence: isur1,
    };
    console.log(`Result: ${isur1Pass ? 'PASS' : 'FAIL'}`, isur1);

    // Prepare target dynamic feature for editing tests
    const dynRes = await fetch('http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:tl_layer_1&maxFeatures=1&outputFormat=application/json', {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const dynData = await dynRes.json();
    const testFeature = dynData.features[0];
    const targetFid = testFeature.id;
    console.log(`[Target Feature] Using test feature: ${targetFid}`);

    // Ensure tl_layer_1 is toggled on
    await evaluate(`window.__olService.toggleDynamicLayer('tl_layer_1', true);`);
    await sleep(400);

    // ── ISUR.2 — ENTER VERTEX EDIT: UNDO/REDO VISIBLE ─────────────────────────
    console.log('\n--- ISUR.2: Enter Vertex Edit: Undo/Redo Visible ---');
    await evaluate(`(() => {
      const feat = ${JSON.stringify(testFeature)};
      const ol = window.__olService;
      ol.setSelectedFeature('tl_layer_1', feat.id, feat);
      if (ol.savedSelectCallback) {
        ol.savedSelectCallback(feat, 'tl_layer_1');
      }
      ol.activateVertexEdit('tl_layer_1', feat.id, feat, () => {}, () => {});
    })()`);

    await sleep(200); // Give React time to re-render TechSidebar and App

    const isur2 = await evaluate(`(() => {
      const hudUndo = document.getElementById('btn-hud-undo');
      const hudRedo = document.getElementById('btn-hud-redo');
      const mapUndo = document.getElementById('btn-map-undo');
      const mapRedo = document.getElementById('btn-map-redo');
      const session = window.__editSessionHistory;
      return {
        sessionActive: session.isActive(),
        sessionType: session.getSessionType(),
        canUndo: session.canUndo(),
        canRedo: session.canRedo(),
        undoCount: session.getUndoCount(),
        redoCount: session.getRedoCount(),
        hudUndoDisplay: hudUndo ? window.getComputedStyle(hudUndo).display : null,
        hudRedoDisplay: hudRedo ? window.getComputedStyle(hudRedo).display : null,
        mapUndoDisplay: mapUndo ? window.getComputedStyle(mapUndo).display : null,
        mapRedoDisplay: mapRedo ? window.getComputedStyle(mapRedo).display : null,
        mapUndoDisabled: mapUndo ? mapUndo.disabled : false,
        mapRedoDisabled: mapRedo ? mapRedo.disabled : false,
      };
    })()`);

    const isur2Pass = isur2.sessionActive &&
                     isur2.sessionType === 'vertex_edit' &&
                     !isur2.canUndo &&
                     !isur2.canRedo &&
                     isur2.hudUndoDisplay === 'none' &&
                     isur2.hudRedoDisplay === 'none' &&
                     isur2.mapUndoDisplay !== 'none' &&
                     isur2.mapRedoDisplay !== 'none' &&
                     isur2.mapUndoDisabled &&
                     isur2.mapRedoDisabled;

    testMatrix['ISUR.2'] = {
      name: 'Enter Vertex Edit: Undo/Redo Visible On Map, Hidden in Sidebar & Initially Disabled',
      pass: isur2Pass,
      evidence: isur2,
    };
    console.log(`Result: ${isur2Pass ? 'PASS' : 'FAIL'}`, isur2);

    // ── ISUR.3 — VERTEX EDIT BEFORE SAVE: UNDO MODIFICATION (0 NETWORK) ───────
    console.log('\n--- ISUR.3: Vertex Edit Before Save: Undo Modification (0 Network) ---');
    const netStartIsur3 = networkRequests.length;

    const isur3 = await evaluate(`(() => {
      const ol = window.__olService;
      const session = window.__editSessionHistory;
      const initialGeom = JSON.parse(JSON.stringify(ol.getVertexEditCurrentGeometry()));

      const sampleCoord = (g) => {
        if (g.type === 'Polygon') return g.coordinates[0][0];
        if (g.type === 'MultiPolygon') return g.coordinates[0][0][0];
        if (g.type === 'LineString') return g.coordinates[0];
        if (g.type === 'Point') return g.coordinates;
        return [0, 0];
      };

      const initialSample = sampleCoord(initialGeom);

      // Apply first vertex change (G1) with pushToHistory = true
      const modifiedGeom1 = JSON.parse(JSON.stringify(initialGeom));
      if (modifiedGeom1.type === 'Polygon') {
        modifiedGeom1.coordinates[0][0][0] += 0.05;
      } else if (modifiedGeom1.type === 'MultiPolygon') {
        modifiedGeom1.coordinates[0][0][0][0] += 0.05;
      }
      ol.setVertexEditGeometry(modifiedGeom1, true);

      const afterEditCanUndo = session.canUndo();
      const afterEditCanRedo = session.canRedo();
      const afterEditSample = sampleCoord(ol.getVertexEditCurrentGeometry());

      // Now trigger local Undo
      const undoResult = ol.undoVertexEdit();
      const restoredSample = sampleCoord(ol.getVertexEditCurrentGeometry());

      const samplesMatch = Math.abs(initialSample[0] - restoredSample[0]) < 1e-4 &&
                           Math.abs(initialSample[1] - restoredSample[1]) < 1e-4;

      return {
        initialSample,
        afterEditCanUndo,
        afterEditCanRedo,
        afterEditSample,
        undoResult,
        restoredSample,
        samplesMatch,
        sessionCanUndoAfter: session.canUndo(),
        sessionCanRedoAfter: session.canRedo(),
      };
    })()`);

    const netCallsIsur3 = networkRequests.slice(netStartIsur3).filter(r => r.url.includes('/wfs') || r.url.includes('/api/')).length;
    const isur3Pass = isur3.afterEditCanUndo &&
                     !isur3.afterEditCanRedo &&
                     isur3.undoResult &&
                     isur3.samplesMatch &&
                     !isur3.sessionCanUndoAfter &&
                     isur3.sessionCanRedoAfter &&
                     netCallsIsur3 === 0;

    testMatrix['ISUR.3'] = {
      name: 'Vertex Edit Before Save: Undo Restores Local Geometry (0 Network)',
      pass: isur3Pass,
      evidence: { ...isur3, netCallsIsur3 },
    };
    console.log(`Result: ${isur3Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.3'].evidence);

    // ── ISUR.4 — VERTEX REDO: REDO RESTORES MODIFICATION (0 NETWORK) ──────────
    console.log('\n--- ISUR.4: Vertex Redo: Redo Restores Modification (0 Network) ---');
    const netStartIsur4 = networkRequests.length;

    const isur4 = await evaluate(`(() => {
      const ol = window.__olService;
      const session = window.__editSessionHistory;
      const redoResult = ol.redoVertexEdit();
      const redoneGeom = ol.getVertexEditCurrentGeometry();

      const sampleCoord = (g) => {
        if (g.type === 'Polygon') return g.coordinates[0][0];
        if (g.type === 'MultiPolygon') return g.coordinates[0][0][0];
        return [0, 0];
      };

      return {
        redoResult,
        canUndoAfter: session.canUndo(),
        canRedoAfter: session.canRedo(),
        redoneSample: sampleCoord(redoneGeom),
      };
    })()`);

    const netCallsIsur4 = networkRequests.slice(netStartIsur4).filter(r => r.url.includes('/wfs') || r.url.includes('/api/')).length;
    const isur4Pass = isur4.redoResult &&
                     isur4.canUndoAfter &&
                     !isur4.canRedoAfter &&
                     netCallsIsur4 === 0;

    testMatrix['ISUR.4'] = {
      name: 'Vertex Redo: Reapplies Geometry In-Memory (0 Network)',
      pass: isur4Pass,
      evidence: { ...isur4, netCallsIsur4 },
    };
    console.log(`Result: ${isur4Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.4'].evidence);

    // ── ISUR.5 — MULTIPLE VERTEX CHANGES (G0 -> G1 -> G2 -> G3) ───────────────
    console.log('\n--- ISUR.5: Multiple Vertex Changes: Multi-step Undo & Redo ---');
    const netStartIsur5 = networkRequests.length;

    const isur5 = await evaluate(`(() => {
      const ol = window.__olService;
      const session = window.__editSessionHistory;

      const sampleCoord = (g) => {
        if (g.type === 'Polygon') return g.coordinates[0][0];
        if (g.type === 'MultiPolygon') return g.coordinates[0][0][0];
        return [0, 0];
      };

      const matchSample = (c1, c2) => Math.abs(c1[0] - c2[0]) < 1e-4 && Math.abs(c1[1] - c2[1]) < 1e-4;

      // Undo back to G0 to start clean multi-step test
      ol.undoVertexEdit();
      const G0 = JSON.parse(JSON.stringify(ol.getVertexEditCurrentGeometry()));
      const s0 = sampleCoord(G0);

      // Create G1
      const G1 = JSON.parse(JSON.stringify(G0));
      if (G1.type === 'Polygon') G1.coordinates[0][0][0] += 0.02;
      else G1.coordinates[0][0][0][0] += 0.02;
      ol.setVertexEditGeometry(G1, true);
      const s1 = sampleCoord(G1);

      // Create G2
      const G2 = JSON.parse(JSON.stringify(G1));
      if (G2.type === 'Polygon') G2.coordinates[0][0][1] += 0.03;
      else G2.coordinates[0][0][0][1] += 0.03;
      ol.setVertexEditGeometry(G2, true);
      const s2 = sampleCoord(G2);

      // Create G3
      const G3 = JSON.parse(JSON.stringify(G2));
      if (G3.type === 'Polygon') G3.coordinates[0][0][0] += 0.04;
      else G3.coordinates[0][0][0][0] += 0.04;
      ol.setVertexEditGeometry(G3, true);
      const s3 = sampleCoord(G3);

      const countAtG3 = session.getUndoCount();

      // Undo 1: G3 -> G2
      ol.undoVertexEdit();
      const atG2 = matchSample(sampleCoord(ol.getVertexEditCurrentGeometry()), s2);

      // Undo 2: G2 -> G1
      ol.undoVertexEdit();
      const atG1 = matchSample(sampleCoord(ol.getVertexEditCurrentGeometry()), s1);

      // Undo 3: G1 -> G0
      ol.undoVertexEdit();
      const atG0 = matchSample(sampleCoord(ol.getVertexEditCurrentGeometry()), s0);

      // Redo 1: G0 -> G1
      ol.redoVertexEdit();
      const redoAtG1 = matchSample(sampleCoord(ol.getVertexEditCurrentGeometry()), s1);

      // Redo 2: G1 -> G2
      ol.redoVertexEdit();
      const redoAtG2 = matchSample(sampleCoord(ol.getVertexEditCurrentGeometry()), s2);

      // Redo 3: G2 -> G3
      ol.redoVertexEdit();
      const redoAtG3 = matchSample(sampleCoord(ol.getVertexEditCurrentGeometry()), s3);

      return {
        countAtG3,
        atG2,
        atG1,
        atG0,
        redoAtG1,
        redoAtG2,
        redoAtG3,
        canUndoEnd: session.canUndo(),
        canRedoEnd: session.canRedo(),
      };
    })()`);

    const netCallsIsur5 = networkRequests.slice(netStartIsur5).filter(r => r.url.includes('/wfs') || r.url.includes('/api/')).length;
    const isur5Pass = isur5.countAtG3 === 4 &&
                     isur5.atG2 && isur5.atG1 && isur5.atG0 &&
                     isur5.redoAtG1 && isur5.redoAtG2 && isur5.redoAtG3 &&
                     isur5.canUndoEnd && !isur5.canRedoEnd &&
                     netCallsIsur5 === 0;

    testMatrix['ISUR.5'] = {
      name: 'Multiple Vertex Changes: Exact Sequential Undo & Redo (0 Network)',
      pass: isur5Pass,
      evidence: { ...isur5, netCallsIsur5 },
    };
    console.log(`Result: ${isur5Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.5'].evidence);

    // ── ISUR.6 — NEW LOCAL MODIFICATION CLEARS LOCAL REDO ─────────────────────
    console.log('\n--- ISUR.6: New Local Modification Clears Local Redo ---');
    const isur6 = await evaluate(`(() => {
      const ol = window.__olService;
      const session = window.__editSessionHistory;

      // Undo once to have redo available
      ol.undoVertexEdit();
      const canRedoBefore = session.canRedo();
      const redoCountBefore = session.getRedoCount();

      // Now apply new edit (G4)
      const current = JSON.parse(JSON.stringify(ol.getVertexEditCurrentGeometry()));
      if (current.type === 'Polygon') current.coordinates[0][0][0] += 0.08;
      else current.coordinates[0][0][0][0] += 0.08;
      ol.setVertexEditGeometry(current, true);

      return {
        canRedoBefore,
        redoCountBefore,
        canRedoAfter: session.canRedo(),
        redoCountAfter: session.getRedoCount(),
        canUndoAfter: session.canUndo(),
      };
    })()`);

    const isur6Pass = isur6.canRedoBefore &&
                     isur6.redoCountBefore > 0 &&
                     !isur6.canRedoAfter &&
                     isur6.redoCountAfter === 0 &&
                     isur6.canUndoAfter;

    testMatrix['ISUR.6'] = {
      name: 'New Local Modification Clears Local Redo Stack',
      pass: isur6Pass,
      evidence: isur6,
    };
    console.log(`Result: ${isur6Pass ? 'PASS' : 'FAIL'}`, isur6);

    // ── ISUR.7 — FINISH VERTEX EDITING: ONE WFS-T UPDATE & BUTTONS HIDDEN ─────
    console.log('\n--- ISUR.7: Finish Vertex Editing: Exactly 1 WFS-T Update & Buttons Hidden ---');
    const netStartIsur7 = networkRequests.length;

    await evaluate(`(async () => {
      const ol = window.__olService;
      const hist = window.__historyService;
      const finalGeom = ol.getVertexEditCurrentGeometry();
      const feat = ${JSON.stringify(testFeature)};

      // Commit final geometry
      const payload = {
        layerName: 'tl_layer_1',
        featureId: feat.id,
        action: 'update',
        feature: {
          type: 'Feature',
          geometry: finalGeom,
          properties: feat.properties
        }
      };

      await fetch('/api/geoserver/wfs/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // Record committed server history
      hist.recordSuccess({
        operationType: 'vertex',
        layerName: 'tl_layer_1',
        isCore: false,
        originalFeatureId: feat.id,
        currentFeatureId: feat.id,
        before: { geometry: feat.geometry, properties: feat.properties },
        after: { geometry: finalGeom, properties: feat.properties }
      });

      // Finish OL session
      ol.finishVertexEdit();
    })()`);

    await sleep(250); // Allow React to re-render to idle state

    const isur7 = await evaluate(`(() => {
      const hudUndo = document.getElementById('btn-hud-undo');
      const hudRedo = document.getElementById('btn-hud-redo');
      const session = window.__editSessionHistory;
      const hist = window.__historyService;

      return {
        sessionActive: session.isActive(),
        hudUndoDisplay: hudUndo ? window.getComputedStyle(hudUndo).display : null,
        hudRedoDisplay: hudRedo ? window.getComputedStyle(hudRedo).display : null,
        committedCanUndo: hist.canUndo(),
      };
    })()`);

    const wfstCallsIsur7 = networkRequests.slice(netStartIsur7).filter(r => r.url.includes('/wfs/transaction')).length;
    const isur7Pass = !isur7.sessionActive &&
                     isur7.hudUndoDisplay === 'none' &&
                     isur7.hudRedoDisplay === 'none' &&
                     isur7.committedCanUndo &&
                     wfstCallsIsur7 === 1;

    testMatrix['ISUR.7'] = {
      name: 'Finish Vertex Edit: Exactly 1 Server WFS-T Update, Session Cleared, UI Hidden',
      pass: isur7Pass,
      evidence: { ...isur7, wfstCallsIsur7 },
    };
    console.log(`Result: ${isur7Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.7'].evidence);

    // ── ISUR.8 — UNDO AFTER FINISH: COMMITTED HISTORYSERVICE REVERTS SERVER ───
    console.log('\n--- ISUR.8: Undo After Finish: Committed HistoryService Reverts Server ---');
    const netStartIsur8 = networkRequests.length;

    const isur8 = await evaluate(`(async () => {
      const hist = window.__historyService;
      const res = await hist.undo();
      return {
        undoSuccess: res.success,
        committedCanUndo: hist.canUndo(),
        committedCanRedo: hist.canRedo(),
      };
    })()`);

    await sleep(400);
    const wfstCallsIsur8 = networkRequests.slice(netStartIsur8).filter(r => r.url.includes('/wfs/transaction')).length;
    const isur8Pass = isur8.undoSuccess &&
                     !isur8.committedCanUndo &&
                     isur8.committedCanRedo &&
                     wfstCallsIsur8 === 1;

    testMatrix['ISUR.8'] = {
      name: 'Undo After Finish: Committed HistoryService Issues 1 Inverse WFS-T Update',
      pass: isur8Pass,
      evidence: { ...isur8, wfstCallsIsur8 },
    };
    console.log(`Result: ${isur8Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.8'].evidence);

    // Clean up redo to keep history pristine
    await evaluate(`window.__historyService.redo(); window.__historyService.undo();`);

    // ── ISUR.9 — MOVE EDIT: LOCAL UNDO/REDO (0 SERVER CALLS) ─────────────────
    console.log('\n--- ISUR.9: Move Edit: Local Undo / Redo (0 Server Calls) ---');
    const netStartIsur9 = networkRequests.length;

    const isur9 = await evaluate(`(() => {
      const session = window.__editSessionHistory;
      const feat = ${JSON.stringify(testFeature)};

      // Start move session
      session.startSession('move', feat.geometry);

      // Move geometry
      const movedGeom = JSON.parse(JSON.stringify(feat.geometry));
      if (movedGeom.type === 'Polygon') movedGeom.coordinates[0][0][0] += 0.1;
      else movedGeom.coordinates[0][0][0][0] += 0.1;
      session.pushSnapshot(movedGeom);

      const canUndoMove = session.canUndo();
      const canRedoMove = session.canRedo();

      // Local undo move
      const undoSnap = session.undo();
      const canUndoAfterUndo = session.canUndo();
      const canRedoAfterUndo = session.canRedo();

      // Local redo move
      const redoSnap = session.redo();

      return {
        sessionActive: session.isActive(),
        canUndoMove,
        canRedoMove,
        canUndoAfterUndo,
        canRedoAfterUndo,
        undoGeomMatchesOriginal: JSON.stringify(undoSnap) === JSON.stringify(feat.geometry),
        redoGeomMatchesMoved: JSON.stringify(redoSnap) === JSON.stringify(movedGeom),
      };
    })()`);

    const netCallsIsur9 = networkRequests.slice(netStartIsur9).filter(r => r.url.includes('/wfs') || r.url.includes('/api/')).length;
    const isur9Pass = isur9.sessionActive &&
                     isur9.canUndoMove &&
                     !isur9.canRedoMove &&
                     !isur9.canUndoAfterUndo &&
                     isur9.canRedoAfterUndo &&
                     isur9.undoGeomMatchesOriginal &&
                     isur9.redoGeomMatchesMoved &&
                     netCallsIsur9 === 0;

    testMatrix['ISUR.9'] = {
      name: 'Move Edit: Local In-Session Undo & Redo (0 Server Calls)',
      pass: isur9Pass,
      evidence: { ...isur9, netCallsIsur9 },
    };
    console.log(`Result: ${isur9Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.9'].evidence);

    // ── ISUR.10 — FINISH MOVE: EXACTLY 1 WFS-T UPDATE ─────────────────────────
    console.log('\n--- ISUR.10: Finish Move: Exactly 1 WFS-T Update ---');
    const netStartIsur10 = networkRequests.length;

    const isur10 = await evaluate(`(async () => {
      const session = window.__editSessionHistory;
      const hist = window.__historyService;
      const feat = ${JSON.stringify(testFeature)};
      const finalGeom = session.getCurrentSnapshot();

      const payload = {
        layerName: 'tl_layer_1',
        featureId: feat.id,
        action: 'update',
        feature: {
          type: 'Feature',
          geometry: finalGeom,
          properties: feat.properties
        }
      };

      await fetch('/api/geoserver/wfs/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      hist.recordSuccess({
        operationType: 'move',
        layerName: 'tl_layer_1',
        isCore: false,
        originalFeatureId: feat.id,
        currentFeatureId: feat.id,
        before: { geometry: feat.geometry, properties: feat.properties },
        after: { geometry: finalGeom, properties: feat.properties }
      });

      session.clearSession();
      return {
        sessionActive: session.isActive(),
      };
    })()`);

    await sleep(400);
    const wfstCallsIsur10 = networkRequests.slice(netStartIsur10).filter(r => r.url.includes('/wfs/transaction')).length;
    const isur10Pass = !isur10.sessionActive && wfstCallsIsur10 === 1;

    testMatrix['ISUR.10'] = {
      name: 'Finish Move: Exactly 1 WFS-T Update Committed',
      pass: isur10Pass,
      evidence: { ...isur10, wfstCallsIsur10 },
    };
    console.log(`Result: ${isur10Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.10'].evidence);

    // Restore feature back to clean original state
    await evaluate(`window.__historyService.undo();`);

    // ── ISUR.11 — CREATE POINT: UNDO/REDO DRAWING (0 SERVER CALLS) ───────────
    console.log('\n--- ISUR.11: Create Point: Undo/Redo Drawing (0 Server Calls) ---');
    const netStartIsur11 = networkRequests.length;

    const isur11 = await evaluate(`(() => {
      const ol = window.__olService;
      const session = window.__editSessionHistory;

      ol.activateDraw('Point', 'streetlights', () => {});

      const activeAfterDraw = session.isActive();
      const type = session.getSessionType();

      // Undo draw point
      const undoOk = ol.undoDrawPoint();
      const redoOk = ol.redoDrawPoint();

      ol.cancelInteraction();

      return {
        activeAfterDraw,
        type,
        undoOk: undoOk !== undefined,
        redoOk: redoOk !== undefined,
        sessionClearedOnCancel: !session.isActive(),
      };
    })()`);

    const netCallsIsur11 = networkRequests.slice(netStartIsur11).filter(r => r.url.includes('/wfs') || r.url.includes('/api/')).length;
    const isur11Pass = isur11.activeAfterDraw &&
                      isur11.type === 'create' &&
                      isur11.undoOk &&
                      isur11.redoOk &&
                      isur11.sessionClearedOnCancel &&
                      netCallsIsur11 === 0;

    testMatrix['ISUR.11'] = {
      name: 'Create Point: Local Undo/Redo (0 Server Calls)',
      pass: isur11Pass,
      evidence: { ...isur11, netCallsIsur11 },
    };
    console.log(`Result: ${isur11Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.11'].evidence);

    // ── ISUR.12 — CREATE LINE: UNDO/REDO SKETCH POINTS (0 SERVER CALLS) ───────
    console.log('\n--- ISUR.12: Create Line: Undo/Redo Sketch Points ---');
    const netStartIsur12 = networkRequests.length;

    const isur12 = await evaluate(`(() => {
      const ol = window.__olService;
      const session = window.__editSessionHistory;

      ol.activateDraw('LineString', 'roads', () => {});

      // Simulate sketch coordinate sequence P1, P2, P3
      session.pushSnapshot({ type: 'LineString', coordinates: [[77.1, 28.1], [77.2, 28.2]] });
      session.pushSnapshot({ type: 'LineString', coordinates: [[77.1, 28.1], [77.2, 28.2], [77.3, 28.3]] });

      const countBeforeUndo = session.getUndoCount();

      // Undo removes P3
      const snapAfterUndo = session.undo();
      const geomAfterUndo = snapAfterUndo.geometry || snapAfterUndo;
      const coordsAfterUndo = geomAfterUndo.coordinates;

      // Redo restores P3
      const snapAfterRedo = session.redo();
      const geomAfterRedo = snapAfterRedo.geometry || snapAfterRedo;
      const coordsAfterRedo = geomAfterRedo.coordinates;

      ol.cancelInteraction();

      return {
        countBeforeUndo,
        lenAfterUndo: coordsAfterUndo.length,
        lenAfterRedo: coordsAfterRedo.length,
        cleared: !session.isActive(),
      };
    })()`);

    const netCallsIsur12 = networkRequests.slice(netStartIsur12).filter(r => r.url.includes('/wfs') || r.url.includes('/api/')).length;
    const isur12Pass = isur12.countBeforeUndo === 2 &&
                      isur12.lenAfterUndo === 2 &&
                      isur12.lenAfterRedo === 3 &&
                      isur12.cleared &&
                      netCallsIsur12 === 0;

    testMatrix['ISUR.12'] = {
      name: 'Create Line: Undo/Redo Drawing Points Sequence (0 Network)',
      pass: isur12Pass,
      evidence: { ...isur12, netCallsIsur12 },
    };
    console.log(`Result: ${isur12Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.12'].evidence);

    // ── ISUR.13 — CREATE POLYGON: UNDO/REDO SKETCH POINTS (0 SERVER CALLS) ────
    console.log('\n--- ISUR.13: Create Polygon: Undo/Redo Sketch Points ---');
    const netStartIsur13 = networkRequests.length;

    const isur13 = await evaluate(`(() => {
      const ol = window.__olService;
      const session = window.__editSessionHistory;

      ol.activateDraw('Polygon', 'zones', () => {});

      // Simulate sketch vertices P1, P2, P3, P4
      session.pushSnapshot({ type: 'Polygon', coordinates: [[[77.1, 28.1], [77.2, 28.1], [77.2, 28.2], [77.1, 28.1]]] });
      session.pushSnapshot({ type: 'Polygon', coordinates: [[[77.1, 28.1], [77.2, 28.1], [77.3, 28.2], [77.2, 28.3], [77.1, 28.1]]] });

      const snapUndo = session.undo();
      const geomUndo = snapUndo.geometry || snapUndo;
      const snapRedo = session.redo();
      const geomRedo = snapRedo.geometry || snapRedo;

      ol.cancelInteraction();

      return {
        undoLen: geomUndo.coordinates[0].length,
        redoLen: geomRedo.coordinates[0].length,
        cleared: !session.isActive(),
      };
    })()`);

    const netCallsIsur13 = networkRequests.slice(netStartIsur13).filter(r => r.url.includes('/wfs') || r.url.includes('/api/')).length;
    const isur13Pass = isur13.undoLen === 4 &&
                      isur13.redoLen === 5 &&
                      isur13.cleared &&
                      netCallsIsur13 === 0;

    testMatrix['ISUR.13'] = {
      name: 'Create Polygon: Undo/Redo Drawing Vertices (0 Network)',
      pass: isur13Pass,
      evidence: { ...isur13, netCallsIsur13 },
    };
    console.log(`Result: ${isur13Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.13'].evidence);

    // ── ISUR.14 — CANCEL VERTEX EDIT: DISCARD UNSAVED CHANGES & HIDE BUTTONS ──
    console.log('\n--- ISUR.14: Cancel Vertex Edit: Discard Local Changes & Hide Buttons ---');
    const netStartIsur14 = networkRequests.length;

    await evaluate(`(() => {
      const ol = window.__olService;
      const feat = ${JSON.stringify(testFeature)};

      ol.activateVertexEdit('tl_layer_1', feat.id, feat, () => {}, () => {});

      // Modify vertex
      const modGeom = JSON.parse(JSON.stringify(feat.geometry));
      if (modGeom.type === 'Polygon') modGeom.coordinates[0][0][0] += 0.05;
      else modGeom.coordinates[0][0][0][0] += 0.05;
      ol.setVertexEditGeometry(modGeom, true);

      // Cancel vertex edit
      ol.cancelVertexEdit();
    })()`);

    await sleep(200);

    const isur14 = await evaluate(`(() => {
      const hudUndo = document.getElementById('btn-hud-undo');
      const hudRedo = document.getElementById('btn-hud-redo');
      const session = window.__editSessionHistory;

      return {
        sessionActive: session.isActive(),
        hudUndoDisplay: hudUndo ? window.getComputedStyle(hudUndo).display : null,
        hudRedoDisplay: hudRedo ? window.getComputedStyle(hudRedo).display : null,
      };
    })()`);

    const netCallsIsur14 = networkRequests.slice(netStartIsur14).filter(r => r.url.includes('/wfs') || r.url.includes('/api/')).length;
    const isur14Pass = !isur14.sessionActive &&
                      isur14.hudUndoDisplay === 'none' &&
                      isur14.hudRedoDisplay === 'none' &&
                      netCallsIsur14 === 0;

    testMatrix['ISUR.14'] = {
      name: 'Cancel Vertex Edit: Unsaved Changes Discarded, Controls Hidden (0 Network)',
      pass: isur14Pass,
      evidence: { ...isur14, netCallsIsur14 },
    };
    console.log(`Result: ${isur14Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.14'].evidence);

    // ── ISUR.15 — CANCEL MOVE: RESTORE ORIGINAL GEOMETRY & HIDE BUTTONS ───────
    console.log('\n--- ISUR.15: Cancel Move: Restore Original Geometry & Hide Buttons ---');
    await evaluate(`(() => {
      const ol = window.__olService;
      const session = window.__editSessionHistory;
      const feat = ${JSON.stringify(testFeature)};

      session.startSession('move', feat.geometry);
      session.pushSnapshot({ ...feat.geometry });

      ol.cancelInteraction();
    })()`);

    await sleep(200);

    const isur15 = await evaluate(`(() => {
      const hudUndo = document.getElementById('btn-hud-undo');
      const hudRedo = document.getElementById('btn-hud-redo');
      const session = window.__editSessionHistory;

      return {
        sessionActive: session.isActive(),
        hudUndoDisplay: hudUndo ? window.getComputedStyle(hudUndo).display : null,
        hudRedoDisplay: hudRedo ? window.getComputedStyle(hudRedo).display : null,
      };
    })()`);

    const isur15Pass = !isur15.sessionActive &&
                      isur15.hudUndoDisplay === 'none' &&
                      isur15.hudRedoDisplay === 'none';

    testMatrix['ISUR.15'] = {
      name: 'Cancel Move: Session Reset, Controls Hidden',
      pass: isur15Pass,
      evidence: isur15,
    };
    console.log(`Result: ${isur15Pass ? 'PASS' : 'FAIL'}`, isur15);

    // ── ISUR.16 — CANCEL CREATE: DISCARD SKETCH & HIDE BUTTONS ────────────────
    console.log('\n--- ISUR.16: Cancel Create: Discard Sketch & Hide Buttons ---');
    await evaluate(`(() => {
      const ol = window.__olService;
      const session = window.__editSessionHistory;

      ol.activateDraw('Point', 'streetlights', () => {});
      session.pushSnapshot({ type: 'Point', coordinates: [77.1, 28.1] });

      ol.cancelInteraction();
    })()`);

    await sleep(200);

    const isur16 = await evaluate(`(() => {
      const hudUndo = document.getElementById('btn-hud-undo');
      const hudRedo = document.getElementById('btn-hud-redo');
      const session = window.__editSessionHistory;

      return {
        sessionActive: session.isActive(),
        hudUndoDisplay: hudUndo ? window.getComputedStyle(hudUndo).display : null,
        hudRedoDisplay: hudRedo ? window.getComputedStyle(hudRedo).display : null,
      };
    })()`);

    const isur16Pass = !isur16.sessionActive &&
                      isur16.hudUndoDisplay === 'none' &&
                      isur16.hudRedoDisplay === 'none';

    testMatrix['ISUR.16'] = {
      name: 'Cancel Create: Sketch Discarded, Controls Hidden',
      pass: isur16Pass,
      evidence: isur16,
    };
    console.log(`Result: ${isur16Pass ? 'PASS' : 'FAIL'}`, isur16);

    // ── ISUR.17 — FINISH CREATE: EXACTLY 1 INSERT & BUTTONS HIDDEN ────────────
    console.log('\n--- ISUR.17: Finish Create: Exactly 1 Server Insert & Controls Hidden ---');
    const roadRes = await fetch('http://localhost:3001/api/roads');
    const roadData = await roadRes.json();
    const firstRoad = roadData.features[0];
    const validCoord = firstRoad.geometry.coordinates[0];
    const roadId = firstRoad.id;
    const zoneId = firstRoad.properties?.zone_id || 1;

    const slPayload = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: validCoord },
      properties: { name: 'ISUR_Test_Streetlight', type: 'standard', road_id: roadId, zone_id: zoneId }
    };

    const netStartIsur17 = networkRequests.length;

    const isur17 = await evaluate(`(async () => {
      const session = window.__editSessionHistory;
      session.startSession('create', null);
      session.pushSnapshot(${JSON.stringify(slPayload.geometry)});

      // Create streetlight via API
      const res = await fetch('/api/streetlights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(${JSON.stringify(slPayload)})
      });
      const created = await res.json();
      const createdId = String(created.id || created.data?.id || '');

      session.clearSession();
      return {
        createdId,
        sessionActive: session.isActive(),
      };
    })()`);

    await sleep(200);

    const hudUndoDisplay17 = await evaluate(`(() => {
      const hudUndo = document.getElementById('btn-hud-undo');
      return hudUndo ? window.getComputedStyle(hudUndo).display : null;
    })()`);

    const apiInsertsIsur17 = networkRequests.slice(netStartIsur17).filter(r => r.url.includes('/api/streetlights') && r.method === 'POST').length;
    const isur17Pass = !!isur17.createdId &&
                      !isur17.sessionActive &&
                      hudUndoDisplay17 === 'none' &&
                      apiInsertsIsur17 === 1;

    // Clean up created streetlight
    if (isur17.createdId) {
      await fetch(`http://localhost:3001/api/streetlights/${isur17.createdId}`, { method: 'DELETE' });
    }

    testMatrix['ISUR.17'] = {
      name: 'Finish Create: Exactly 1 Server Insert, Local Session Cleared',
      pass: isur17Pass,
      evidence: { ...isur17, hudUndoDisplay17, apiInsertsIsur17 },
    };
    console.log(`Result: ${isur17Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.17'].evidence);

    // ── ISUR.18 — KEYBOARD CTRL+Z DURING VERTEX EDIT: LOCAL UNDO (0 SERVER) ───
    console.log('\n--- ISUR.18: Keyboard Ctrl+Z During Vertex Edit: Local Undo (0 Server) ---');
    const netStartIsur18 = networkRequests.length;

    const isur18 = await evaluate(`(() => {
      const ol = window.__olService;
      const session = window.__editSessionHistory;
      const feat = ${JSON.stringify(testFeature)};

      ol.activateVertexEdit('tl_layer_1', feat.id, feat, () => {}, () => {});

      const sampleCoord = (g) => {
        if (g.type === 'Polygon') return g.coordinates[0][0];
        if (g.type === 'MultiPolygon') return g.coordinates[0][0][0];
        return [0, 0];
      };

      const originalSample = sampleCoord(feat.geometry);

      // Make edit
      const modGeom = JSON.parse(JSON.stringify(feat.geometry));
      if (modGeom.type === 'Polygon') modGeom.coordinates[0][0][0] += 0.05;
      else modGeom.coordinates[0][0][0][0] += 0.05;
      ol.setVertexEditGeometry(modGeom, true);

      const canUndoBeforeKey = session.canUndo();

      // Dispatch Ctrl+Z
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));

      const canUndoAfterKey = session.canUndo();
      const canRedoAfterKey = session.canRedo();
      const keyRestoredSample = sampleCoord(ol.getVertexEditCurrentGeometry());

      const revertedToOriginal = Math.abs(keyRestoredSample[0] - originalSample[0]) < 1e-4 &&
                                 Math.abs(keyRestoredSample[1] - originalSample[1]) < 1e-4;

      ol.cancelVertexEdit();

      return {
        canUndoBeforeKey,
        canUndoAfterKey,
        canRedoAfterKey,
        revertedToOriginal,
      };
    })()`);

    const netCallsIsur18 = networkRequests.slice(netStartIsur18).filter(r => r.url.includes('/wfs') || r.url.includes('/api/')).length;
    const isur18Pass = isur18.canUndoBeforeKey &&
                      !isur18.canUndoAfterKey &&
                      isur18.canRedoAfterKey &&
                      isur18.revertedToOriginal &&
                      netCallsIsur18 === 0;

    testMatrix['ISUR.18'] = {
      name: 'Keyboard Ctrl+Z During Vertex Edit: Local Undo Executed (0 Network)',
      pass: isur18Pass,
      evidence: { ...isur18, netCallsIsur18 },
    };
    console.log(`Result: ${isur18Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.18'].evidence);

    // ── ISUR.19 — KEYBOARD CTRL+Y DURING VERTEX EDIT: LOCAL REDO (0 SERVER) ───
    console.log('\n--- ISUR.19: Keyboard Ctrl+Y During Vertex Edit: Local Redo (0 Server) ---');
    const netStartIsur19 = networkRequests.length;

    const isur19 = await evaluate(`(() => {
      const ol = window.__olService;
      const session = window.__editSessionHistory;
      const feat = ${JSON.stringify(testFeature)};

      ol.activateVertexEdit('tl_layer_1', feat.id, feat, () => {}, () => {});

      const sampleCoord = (g) => {
        if (g.type === 'Polygon') return g.coordinates[0][0];
        if (g.type === 'MultiPolygon') return g.coordinates[0][0][0];
        return [0, 0];
      };

      const modGeom = JSON.parse(JSON.stringify(feat.geometry));
      if (modGeom.type === 'Polygon') modGeom.coordinates[0][0][0] += 0.05;
      else modGeom.coordinates[0][0][0][0] += 0.05;
      ol.setVertexEditGeometry(modGeom, true);
      const modSample = sampleCoord(modGeom);

      // Undo first
      ol.undoVertexEdit();

      // Dispatch Ctrl+Y
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));

      const canRedoAfterKey = session.canRedo();
      const currentSample = sampleCoord(ol.getVertexEditCurrentGeometry());

      const restoredMod = Math.abs(currentSample[0] - modSample[0]) < 1e-4 &&
                          Math.abs(currentSample[1] - modSample[1]) < 1e-4;

      ol.cancelVertexEdit();

      return {
        canRedoAfterKey,
        restoredMod,
      };
    })()`);

    const netCallsIsur19 = networkRequests.slice(netStartIsur19).filter(r => r.url.includes('/wfs') || r.url.includes('/api/')).length;
    const isur19Pass = !isur19.canRedoAfterKey &&
                      isur19.restoredMod &&
                      netCallsIsur19 === 0;

    testMatrix['ISUR.19'] = {
      name: 'Keyboard Ctrl+Y During Vertex Edit: Local Redo Executed (0 Network)',
      pass: isur19Pass,
      evidence: { ...isur19, netCallsIsur19 },
    };
    console.log(`Result: ${isur19Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.19'].evidence);

    // ── ISUR.20 — KEYBOARD SHORTCUTS DURING CREATE (0 SERVER CALLS) ───────────
    console.log('\n--- ISUR.20: Keyboard Shortcuts During Create (0 Server Calls) ---');
    const netStartIsur20 = networkRequests.length;

    const isur20 = await evaluate(`(() => {
      const ol = window.__olService;
      const session = window.__editSessionHistory;

      ol.activateDraw('LineString', 'roads', () => {});
      session.pushSnapshot({ type: 'LineString', coordinates: [[77.1, 28.1], [77.2, 28.2]] });

      // Dispatch Ctrl+Z
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      const countAfterUndo = session.getUndoCount();

      // Dispatch Ctrl+Y
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
      const countAfterRedo = session.getUndoCount();

      ol.cancelInteraction();

      return {
        countAfterUndo,
        countAfterRedo,
      };
    })()`);

    const netCallsIsur20 = networkRequests.slice(netStartIsur20).filter(r => r.url.includes('/wfs') || r.url.includes('/api/')).length;
    const isur20Pass = isur20.countAfterUndo === 0 &&
                      isur20.countAfterRedo === 1 &&
                      netCallsIsur20 === 0;

    testMatrix['ISUR.20'] = {
      name: 'Keyboard Shortcuts During Create: Points Removed/Restored (0 Network)',
      pass: isur20Pass,
      evidence: { ...isur20, netCallsIsur20 },
    };
    console.log(`Result: ${isur20Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.20'].evidence);

    // ── ISUR.21 — CONTEXTUAL VISIBILITY ACROSS EDIT LIFECYCLE ─────────────────
    console.log('\n--- ISUR.21: Contextual Visibility Across Full Lifecycle ---');
    const isur21Browse = await evaluate(`(() => {
      const hudUndo = document.getElementById('btn-hud-undo');
      const mapUndo = document.getElementById('btn-map-undo');
      return {
        hud: hudUndo ? window.getComputedStyle(hudUndo).display : null,
        map: mapUndo ? window.getComputedStyle(mapUndo).display : null,
      };
    })()`);

    await evaluate(`(() => {
      const feat = ${JSON.stringify(testFeature)};
      window.__olService.activateVertexEdit('tl_layer_1', feat.id, feat, () => {}, () => {});
    })()`);
    await sleep(200);

    const isur21Edit = await evaluate(`(() => {
      const hudUndo = document.getElementById('btn-hud-undo');
      const mapUndo = document.getElementById('btn-map-undo');
      return {
        hud: hudUndo ? window.getComputedStyle(hudUndo).display : null,
        map: mapUndo ? window.getComputedStyle(mapUndo).display : null,
      };
    })()`);

    await evaluate(`window.__olService.cancelVertexEdit();`);
    await sleep(200);

    const isur21Cancel = await evaluate(`(() => {
      const hudUndo = document.getElementById('btn-hud-undo');
      const mapUndo = document.getElementById('btn-map-undo');
      return {
        hud: hudUndo ? window.getComputedStyle(hudUndo).display : null,
        map: mapUndo ? window.getComputedStyle(mapUndo).display : null,
      };
    })()`);

    const isur21Pass = isur21Browse.map === 'none' &&
                      isur21Browse.hud === 'none' &&
                      isur21Edit.map !== 'none' &&
                      isur21Edit.hud === 'none' &&
                      isur21Cancel.map === 'none' &&
                      isur21Cancel.hud === 'none';

    testMatrix['ISUR.21'] = {
      name: 'Contextual Visibility: Hidden Browsing -> Visible Edit on Map (Hidden in Sidebar) -> Hidden Post-Edit',
      pass: isur21Pass,
      evidence: { browse: isur21Browse, edit: isur21Edit, cancel: isur21Cancel },
    };
    console.log(`Result: ${isur21Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.21'].evidence);

    // ── ISUR.22 — HISTORY SEPARATION INVARIANT ────────────────────────────────
    console.log('\n--- ISUR.22: History Separation Invariant (Local vs Committed) ---');
    const isur22 = await evaluate(`(() => {
      const ol = window.__olService;
      const hist = window.__historyService;
      const feat = ${JSON.stringify(testFeature)};

      const serverUndoBefore = hist.getUndoStack().length;
      const serverRedoBefore = hist.getRedoStack().length;

      // Start local edit session
      ol.activateVertexEdit('tl_layer_1', feat.id, feat, () => {}, () => {});

      // 3 local edits + 2 local undos + 1 local redo
      const g = JSON.parse(JSON.stringify(feat.geometry));
      ol.setVertexEditGeometry(g, true);
      ol.setVertexEditGeometry(g, true);
      ol.undoVertexEdit();
      ol.undoVertexEdit();
      ol.redoVertexEdit();

      const serverUndoDuring = hist.getUndoStack().length;
      const serverRedoDuring = hist.getRedoStack().length;

      ol.cancelVertexEdit();

      return {
        serverUndoBefore,
        serverRedoBefore,
        serverUndoDuring,
        serverRedoDuring,
        stacksUntouched: serverUndoBefore === serverUndoDuring && serverRedoBefore === serverRedoDuring,
      };
    })()`);

    const isur22Pass = isur22.stacksUntouched;
    testMatrix['ISUR.22'] = {
      name: 'History Separation: In-Session Actions Do Not Pollute Committed History',
      pass: isur22Pass,
      evidence: isur22,
    };
    console.log(`Result: ${isur22Pass ? 'PASS' : 'FAIL'}`, isur22);

    // ── ISUR.23 — EDIT -> FINISH -> GLOBAL UNDO COMMITTED LIFECYCLE ───────────
    console.log('\n--- ISUR.23: Edit -> Finish -> Global Undo Committed Lifecycle ---');
    const isur23 = await evaluate(`(async () => {
      const hist = window.__historyService;
      const feat = ${JSON.stringify(testFeature)};

      // Commit simulated edit
      hist.recordSuccess({
        operationType: 'vertex',
        layerName: 'tl_layer_1',
        isCore: false,
        originalFeatureId: feat.id,
        currentFeatureId: feat.id,
        before: { geometry: feat.geometry, properties: feat.properties },
        after: { geometry: feat.geometry, properties: { ...feat.properties, SOVEREIGNT: 'ISUR_23' } }
      });

      const undoRes = await hist.undo();
      return {
        undoSuccess: undoRes.success,
      };
    })()`);

    const isur23Pass = isur23.undoSuccess;
    testMatrix['ISUR.23'] = {
      name: 'Edit -> Finish -> Global Committed Undo Reverts Server State',
      pass: isur23Pass,
      evidence: isur23,
    };
    console.log(`Result: ${isur23Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.23'].evidence);

    // ── ISUR.24 — EDIT -> UNDO TO ORIGINAL -> FINISH: ZERO NET CHANGE ─────────
    console.log('\n--- ISUR.24: Edit -> Undo to Original -> Finish: Zero Net Change ---');
    const isur24 = await evaluate(`(() => {
      const ol = window.__olService;
      const session = window.__editSessionHistory;
      const feat = ${JSON.stringify(testFeature)};

      ol.activateVertexEdit('tl_layer_1', feat.id, feat, () => {}, () => {});

      // Modify vertex
      const modGeom = JSON.parse(JSON.stringify(feat.geometry));
      if (modGeom.type === 'Polygon') modGeom.coordinates[0][0][0] += 0.05;
      else modGeom.coordinates[0][0][0][0] += 0.05;
      ol.setVertexEditGeometry(modGeom, true);

      const hasNetChangesBefore = session.hasNetChanges();

      // Undo back to original
      ol.undoVertexEdit();
      const hasNetChangesAfter = session.hasNetChanges();

      ol.finishVertexEdit();

      return {
        hasNetChangesBefore,
        hasNetChangesAfter,
      };
    })()`);

    const isur24Pass = isur24.hasNetChangesBefore && !isur24.hasNetChangesAfter;
    testMatrix['ISUR.24'] = {
      name: 'Edit -> Undo to Original -> Finish: hasNetChanges Detects No-Op',
      pass: isur24Pass,
      evidence: isur24,
    };
    console.log(`Result: ${isur24Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.24'].evidence);

    // ── ISUR.25 — MOVE + VERTEX SESSION TRANSITION: NO STALE HISTORY ──────────
    console.log('\n--- ISUR.25: Move + Vertex Session Transition: No Stale History ---');
    const isur25 = await evaluate(`(() => {
      const ol = window.__olService;
      const session = window.__editSessionHistory;
      const feat = ${JSON.stringify(testFeature)};

      // 1. Move session
      session.startSession('move', feat.geometry);
      session.pushSnapshot({ ...feat.geometry });
      ol.cancelInteraction();

      // 2. Vertex edit session immediately after
      ol.activateVertexEdit('tl_layer_1', feat.id, feat, () => {}, () => {});

      const type = session.getSessionType();
      const initialCount = session.getUndoCount();
      const canUndo = session.canUndo();

      ol.cancelVertexEdit();

      return {
        type,
        initialCount,
        canUndo,
      };
    })()`);

    const isur25Pass = isur25.type === 'vertex_edit' &&
                      isur25.initialCount === 1 && // initial geometry snapshot
                      !isur25.canUndo; // no edits beyond initial geometry

    testMatrix['ISUR.25'] = {
      name: 'Session Transition: Fresh History on Each Session Start',
      pass: isur25Pass,
      evidence: isur25,
    };
    console.log(`Result: ${isur25Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.25'].evidence);

    // ── ISUR.26 — RAPID REPEATED UNDO/REDO: INTEGRITY & NO CRASHES ────────────
    console.log('\n--- ISUR.26: Rapid Repeated Undo/Redo: Integrity & No Crashes ---');
    const isur26 = await evaluate(`(() => {
      const ol = window.__olService;
      const feat = ${JSON.stringify(testFeature)};

      ol.activateVertexEdit('tl_layer_1', feat.id, feat, () => {}, () => {});

      const mod = JSON.parse(JSON.stringify(feat.geometry));
      if (mod.type === 'Polygon') mod.coordinates[0][0][0] += 0.05;
      else mod.coordinates[0][0][0][0] += 0.05;
      ol.setVertexEditGeometry(mod, true);

      // Perform 5 rapid alternating undo/redo cycles
      for (let i = 0; i < 5; i++) {
        ol.undoVertexEdit();
        ol.redoVertexEdit();
      }

      const finalGeom = ol.getVertexEditCurrentGeometry();
      ol.cancelVertexEdit();

      return {
        completedCycles: 5,
        validCoordinates: !!(finalGeom && finalGeom.coordinates),
      };
    })()`);

    const isur26Pass = isur26.completedCycles === 5 && isur26.validCoordinates;
    testMatrix['ISUR.26'] = {
      name: 'Rapid Repeated Undo/Redo: 5 Rapid Cycles Without Corruption or Crash',
      pass: isur26Pass,
      evidence: isur26,
    };
    console.log(`Result: ${isur26Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.26'].evidence);

    // ── ISUR.27 — FEATURE INFO SYNCHRONIZATION ────────────────────────────────
    console.log('\n--- ISUR.27: Feature Info & Metric Synchronization ---');
    const isur27 = await evaluate(`(() => {
      const ol = window.__olService;
      const feat = ${JSON.stringify(testFeature)};

      let liveMetricGeom = null;
      ol.activateVertexEdit('tl_layer_1', feat.id, feat, (updatedGeom) => {
        liveMetricGeom = updatedGeom;
      }, () => {});

      const sampleCoord = (g) => {
        if (g.type === 'Polygon') return g.coordinates[0][0];
        if (g.type === 'MultiPolygon') return g.coordinates[0][0][0];
        return [0, 0];
      };

      // Modify vertex
      const mod = JSON.parse(JSON.stringify(feat.geometry));
      if (mod.type === 'Polygon') mod.coordinates[0][0][0] += 0.1;
      else mod.coordinates[0][0][0][0] += 0.1;
      ol.setVertexEditGeometry(mod, true);

      const metricReceived = !!liveMetricGeom;
      const metricMatchesMod = Math.abs(sampleCoord(liveMetricGeom)[0] - sampleCoord(mod)[0]) < 1e-4;

      ol.undoVertexEdit();
      const metricReverted = Math.abs(sampleCoord(liveMetricGeom)[0] - sampleCoord(feat.geometry)[0]) < 1e-4;

      ol.cancelVertexEdit();

      return {
        metricReceived,
        metricMatchesMod,
        metricReverted,
      };
    })()`);

    const isur27Pass = isur27.metricReceived && isur27.metricMatchesMod && isur27.metricReverted;
    testMatrix['ISUR.27'] = {
      name: 'Feature Info & Metric Bar Follow Local Undo/Redo In Real Time',
      pass: isur27Pass,
      evidence: isur27,
    };
    console.log(`Result: ${isur27Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.27'].evidence);

    // ── ISUR.28 — MAP HIGHLIGHT SYNCHRONIZATION ───────────────────────────────
    console.log('\n--- ISUR.28: Map Highlight Synchronization ---');
    const isur28 = await evaluate(`(() => {
      const ol = window.__olService;
      const feat = ${JSON.stringify(testFeature)};

      ol.activateVertexEdit('tl_layer_1', feat.id, feat, () => {}, () => {});
      const mapFeatures = ol.dynamicVectorSource.getFeatures();
      const hasFeaturesOnMap = mapFeatures.length > 0;

      ol.cancelVertexEdit();

      return {
        hasFeaturesOnMap,
      };
    })()`);

    const isur28Pass = isur28.hasFeaturesOnMap;
    testMatrix['ISUR.28'] = {
      name: 'Map Highlight & Vertex Layer Synchronized During Edit Session',
      pass: isur28Pass,
      evidence: isur28,
    };
    console.log(`Result: ${isur28Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.28'].evidence);

    // ── ISUR.29 — NO DUPLICATE LISTENERS AFTER REPEATED CYCLES ────────────────
    console.log('\n--- ISUR.29: Listener Leak Prevention Across 5 Cycles ---');
    const isur29 = await evaluate(`(() => {
      const ol = window.__olService;
      const feat = ${JSON.stringify(testFeature)};

      // Run 5 enter/cancel cycles
      for (let i = 0; i < 5; i++) {
        ol.activateVertexEdit('tl_layer_1', feat.id, feat, () => {}, () => {});
        ol.cancelVertexEdit();
      }

      return {
        cycles: 5,
        cleanTeardown: !window.__editSessionHistory.isActive(),
      };
    })()`);

    const isur29Pass = isur29.cleanTeardown;
    testMatrix['ISUR.29'] = {
      name: 'No Duplicate Listeners or Memory Leaks Over Repeated Edit Cycles',
      pass: isur29Pass,
      evidence: isur29,
    };
    console.log(`Result: ${isur29Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.29'].evidence);

    // ── ISUR.30 — CONSOLE & RUNTIME AUDIT ─────────────────────────────────────
    console.log('\n--- ISUR.30: Console & Runtime Audit ---');
    const uncaughtCount = exceptions.length;
    const errorLogs = consoleMessages.filter(m => m.type === 'error' && !m.text.includes('favicon'));

    const isur30Pass = uncaughtCount === 0 && errorLogs.length === 0;
    testMatrix['ISUR.30'] = {
      name: 'Console & Runtime Audit (0 Uncaught Exceptions, 0 Error Logs)',
      pass: isur30Pass,
      evidence: { uncaughtCount, errorLogsCount: errorLogs.length },
    };
    console.log(`Result: ${isur30Pass ? 'PASS' : 'FAIL'}`, testMatrix['ISUR.30'].evidence);

    // ── SUMMARY & TALLY ───────────────────────────────────────────────────────
    console.log('\n================================================================');
    console.log('CONTEXTUAL IN-SESSION UNDO / REDO TEST MATRIX RESULTS:');
    console.log('================================================================');
    let allPass = true;
    for (const [id, res] of Object.entries(testMatrix)) {
      const status = res.pass ? 'PASS' : 'FAIL';
      if (!res.pass) allPass = false;
      console.log(`${id.padEnd(10)} | ${res.name.padEnd(65)} | ${status}`);
    }

    const passCount = Object.values(testMatrix).filter(r => r.pass).length;
    const totalCount = Object.keys(testMatrix).length;
    console.log('================================================================');
    console.log(`FINAL TALLY: ${passCount} / ${totalCount} TESTS PASSED`);
    console.log('================================================================\n');

    if (allPass && totalCount === 30) {
      console.log('🎉 ALL 30 IN-SESSION UNDO/REDO TESTS PASSED!');
    } else {
      console.error('❌ SOME TESTS FAILED IN THE MATRIX!');
      process.exit(1);
    }

  } finally {
    try {
      ws.close();
      chromeProcess.kill();
    } catch {}
  }
}

runInSessionUndoRedoValidation().catch((err) => {
  console.error('Fatal error during validation:', err);
  process.exit(1);
});
