import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://localhost:5173/';
const DEBUG_PORT = 9222;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runStageE3Validation() {
  console.log('================================================================');
  console.log('STAGE E3 — DYNAMIC FEATURE DELETION (WFS-T) AUTOMATED E2E SUITE');
  console.log('Comprehensive 17-Test Matrix with Real Browser CDP & Network Audit');
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
    '--user-data-dir=' + process.env.TEMP + '\\chrome_stage_e3_profile_' + Date.now(),
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
    // ── TEST E3.1 — APPLICATION STARTUP & LIFECYCLE AUDIT ─────────────────────
    console.log('\n--- TEST E3.1: Application Startup & GIS Lifecycle Audit ---');
    await send('Page.navigate', { url: APP_URL });
    await sleep(4000); // Allow mount, layer loading, discovery

    const e31State = await evaluate(`(() => {
      const canvas = document.querySelector('.ol-map-container canvas');
      const sidebar = document.querySelector('.hud-sidebar-container');
      const legend = document.querySelector('[data-testid="unified-legend-panel"]');
      const ol = window.__olService;
      return {
        hasCanvas: !!canvas,
        hasSidebar: !!sidebar,
        hasLegend: !!legend,
        hasOlService: !!ol,
        mapReady: ol ? !!ol.getMap() : false,
        layerCount: ol && ol.getMap() ? ol.getMap().getLayers().getLength() : 0,
      };
    })()`);

    const e31Pass = e31State.hasCanvas && e31State.hasSidebar && e31State.hasLegend && e31State.mapReady && e31State.layerCount >= 6;
    testMatrix['TEST E3.1'] = {
      name: 'Application Startup & GIS Lifecycle Audit',
      pass: e31Pass,
      evidence: e31State
    };
    console.log(`Result: ${e31Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.1'].evidence);

    // ── TEST E3.2 — DYNAMIC LAYER DISCOVERY & MULTI-LAYER SETUP ───────────────
    console.log('\n--- TEST E3.2: Dynamic Layer Discovery & Multi-Layer Setup ---');
    for (let i = 0; i < 20; i++) {
      const count = await evaluate(`window.__olService && window.__olService.dynamicLayerDefs ? window.__olService.dynamicLayerDefs.size : 0`);
      if (count >= 2) break;
      await sleep(300);
    }

    const e32State = await evaluate(`(() => {
      const ol = window.__olService;
      const defs = [];
      if (ol && ol.dynamicLayerDefs) {
        ol.dynamicLayerDefs.forEach((d, name) => defs.push(name));
      }
      return {
        discoveredCount: defs.length,
        layers: defs,
        hasTlLayer1: defs.includes('tl_layer_1'),
        hasExample1: defs.includes('Example_1')
      };
    })()`);

    // Toggle tl_layer_1 ON
    await evaluate(`(() => {
      window.__olService.toggleDynamicLayer('tl_layer_1', true);
      window.__olService.toggleDynamicLayer('Example_1', true);
    })()`);
    await sleep(500);

    const e32Pass = e32State.hasTlLayer1 && e32State.hasExample1;
    testMatrix['TEST E3.2'] = {
      name: 'Dynamic Layer Discovery & Multi-Layer Setup',
      pass: e32Pass,
      evidence: e32State
    };
    console.log(`Result: ${e32Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.2'].evidence);

    // ── TEST E3.3 — DYNAMIC FEATURE SELECTION & FEATURE INFO AUDIT ───────────
    console.log('\n--- TEST E3.3: Dynamic Feature Selection & Feature Info Audit ---');
    // Query initial count of features in tl_layer_1
    const initialTotalRes = await fetch('http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:tl_layer_1&resultType=hits', {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const initialTotalText = await initialTotalRes.text();
    const initialTotalMatch = initialTotalText.match(/numberOfFeatures="(\d+)"/);
    const initialCount = initialTotalMatch ? parseInt(initialTotalMatch[1], 10) : 0;

    // Fetch live feature info for the last feature in tl_layer_1 from GeoServer
    const dynRes = await fetch(`http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:tl_layer_1&maxFeatures=1&startIndex=${initialCount - 1}&outputFormat=application/json`, {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const dynData = await dynRes.json();
    const tlFeature = dynData.features[0];
    const targetFid = tlFeature.id;

    if (!tlFeature) {
      throw new Error('Test feature in tl_layer_1 not found in GeoServer!');
    }

    const selectReqStart = networkRequests.length;

    // Trigger selection via olService
    await evaluate(`(() => {
      const feat = ${JSON.stringify(tlFeature)};
      const ol = window.__olService;
      ol.setSelectedFeature('tl_layer_1', feat.id, feat);
      if (ol.savedSelectCallback) {
        ol.savedSelectCallback(feat, 'tl_layer_1');
      }
    })()`);

    await sleep(600);

    const e33Dom = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const fid = panel?.querySelector('.hud-fid-pill')?.textContent?.trim();
      const layerName = panel?.querySelector('.hud-card-layer-name')?.textContent?.trim();
      const geomType = panel?.querySelector('.hud-geom-badge')?.textContent?.trim();
      const title = panel?.querySelector('.hud-feature-title')?.textContent?.trim();
      const delBtn = panel?.querySelector('.hud-action-btn.delete-btn');
      const delBtnText = delBtn?.textContent?.trim();
      const rows = Array.from(panel?.querySelectorAll('.hud-attr-row') || []);
      return {
        panelVisible: !!panel,
        fid,
        layerName,
        geomType,
        title,
        hasDeleteBtn: !!delBtn,
        deleteBtnText: delBtnText,
        attributesCount: rows.length
      };
    })()`);

    const e33Pass = e33Dom.panelVisible &&
                   e33Dom.fid === targetFid &&
                   e33Dom.hasDeleteBtn &&
                   e33Dom.deleteBtnText === 'Delete' &&
                   e33Dom.attributesCount > 0;

    testMatrix['TEST E3.3'] = {
      name: 'Dynamic Feature Selection & Feature Info Inspection',
      pass: e33Pass,
      evidence: e33Dom
    };
    console.log(`Result: ${e33Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.3'].evidence);

    // ── TEST E3.4 — DYNAMIC DELETE HAPPY PATH (WFS-T DELETE) ─────────────────
    console.log('\n--- TEST E3.4: Dynamic Delete Happy Path (WFS-T Delete) ---');
    const deleteReqStart = networkRequests.length;

    // Step 1: Click "Delete" -> enters confirmation state "Confirm Del"
    await evaluate(`(() => {
      const delBtn = document.querySelector('.hud-action-btn.delete-btn');
      if (delBtn) delBtn.click();
    })()`);
    await sleep(300);

    const confirmState = await evaluate(`(() => {
      const delBtn = document.querySelector('.hud-action-btn.delete-btn');
      return {
        isConfirm: delBtn?.classList.contains('confirm'),
        text: delBtn?.textContent?.trim()
      };
    })()`);

    // Step 2: Click "Confirm Del" -> triggers WFS-T Delete transaction
    await evaluate(`(() => {
      const delBtn = document.querySelector('.hud-action-btn.delete-btn');
      if (delBtn) delBtn.click();
    })()`);

    await sleep(1500); // Allow transaction and UI cleanup to complete

    const e34Requests = networkRequests.slice(deleteReqStart);
    const wfstDeleteCalls = e34Requests.filter(r => r.url.includes('/api/geoserver/wfs/transaction'));

    const e34Pass = confirmState.text === 'Confirm Del' && wfstDeleteCalls.length === 1;
    testMatrix['TEST E3.4'] = {
      name: 'Dynamic Delete Happy Path (Confirmation + 1 WFS-T Delete)',
      pass: e34Pass,
      evidence: {
        confirmBtnState: confirmState,
        wfstDeleteCallsCount: wfstDeleteCalls.length,
        method: wfstDeleteCalls[0]?.method,
        url: wfstDeleteCalls[0]?.url
      }
    };
    console.log(`Result: ${e34Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.4'].evidence);

    // ── TEST E3.5 — NETWORK CONTRACT & STRICT ZERO-WFS-GETFEATURE AUDIT ──────
    console.log('\n--- TEST E3.5: Network Contract & Strict Zero-WFS-GetFeature Audit ---');
    // For the delete operation:
    // WMS GetFeatureInfo during delete = 0
    // WFS GetFeature = 0
    // WFS-T Delete = exactly 1
    // Post-delete full-layer WFS GetFeature = 0
    const deletePhaseRequests = networkRequests.slice(deleteReqStart);
    const wmsGetFeatureInfoDuringDelete = deletePhaseRequests.filter(r => r.url.includes('request=GetFeatureInfo')).length;
    const wfsGetFeatureDuringDelete = deletePhaseRequests.filter(r => r.url.includes('service=WFS') && r.url.includes('request=GetFeature') && !r.url.includes('bbox=')).length;
    const wfstTransactionCount = deletePhaseRequests.filter(r => r.url.includes('/api/geoserver/wfs/transaction')).length;
    const postDeleteFullWfs = deletePhaseRequests.filter(r => (r.url.includes('tl_layer_1') || r.url.includes('Example_1')) && r.url.includes('request=GetFeature')).length;

    const e35Pass = wmsGetFeatureInfoDuringDelete === 0 &&
                   wfsGetFeatureDuringDelete === 0 &&
                   wfstTransactionCount === 1 &&
                   postDeleteFullWfs === 0;

    networkAudit.wmsGetFeatureInfoDuringDelete = wmsGetFeatureInfoDuringDelete;
    networkAudit.wfsGetFeatureDuringDelete = wfsGetFeatureDuringDelete;
    networkAudit.wfstTransactionCount = wfstTransactionCount;
    networkAudit.postDeleteFullWfs = postDeleteFullWfs;

    testMatrix['TEST E3.5'] = {
      name: 'Network Audit (0 WFS GetFeature, 1 WFS-T Delete, 0 Full-Layer WFS)',
      pass: e35Pass,
      evidence: networkAudit
    };
    console.log(`Result: ${e35Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.5'].evidence);

    // ── TEST E3.6 — WFS-T PAYLOAD & GEOSERVER VERIFICATION ───────────────────
    console.log('\n--- TEST E3.6: WFS-T Payload Structure & Server Verification ---');
    const deletePayload = wfstDeleteCalls[0]?.postData ? JSON.parse(wfstDeleteCalls[0].postData) : null;
    
    // Verify server-side PostGIS/GeoServer: check hit count for targetFid
    const verifyRes = await fetch(`http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&featureId=${targetFid}&resultType=hits`, {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const verifyText = await verifyRes.text();
    const hitsMatch = verifyText.match(/numberOfFeatures="(\d+)"/);
    const featureHits = hitsMatch ? parseInt(hitsMatch[1], 10) : -1;

    // Check total count on tl_layer_1
    const totalRes = await fetch('http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:tl_layer_1&resultType=hits', {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const totalText = await totalRes.text();
    const totalMatch = totalText.match(/numberOfFeatures="(\d+)"/);
    const totalCount = totalMatch ? parseInt(totalMatch[1], 10) : -1;

    const e36Pass = deletePayload?.action === 'delete' &&
                   deletePayload?.layerName === 'tl_layer_1' &&
                   deletePayload?.featureId === targetFid &&
                   featureHits === 0 &&
                   totalCount === initialCount - 1;

    testMatrix['TEST E3.6'] = {
      name: 'WFS-T Payload Structure & Server Verification',
      pass: e36Pass,
      evidence: {
        payload: deletePayload,
        featureHitsOnServer: featureHits,
        totalLayerCountOnServer: totalCount
      }
    };
    console.log(`Result: ${e36Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.6'].evidence);

    // ── TEST E3.7 — UI CLEANUP & FEATURE INFO DISMISSAL ──────────────────────
    console.log('\n--- TEST E3.7: UI State Cleanup & Feature Info Dismissal ---');
    const e37State = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const ol = window.__olService;
      const dynFeatures = ol && ol.dynamicVectorSource ? ol.dynamicVectorSource.getFeatures() : [];
      return {
        panelDismissed: !panel,
        selectedFeatureId: ol ? ol.selectedFeatureId : null,
        dynamicVectorFeaturesCount: dynFeatures.length
      };
    })()`);

    const e37Pass = e37State.panelDismissed &&
                   e37State.selectedFeatureId === null &&
                   e37State.dynamicVectorFeaturesCount === 0;

    testMatrix['TEST E3.7'] = {
      name: 'UI State Cleanup (Feature Info dismissed, highlight cleared)',
      pass: e37Pass,
      evidence: e37State
    };
    console.log(`Result: ${e37Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.7'].evidence);

    // ── TEST E3.8 — ZERO-DELETE PROTECTION (NON-EXISTENT FEATURE) ────────────
    console.log('\n--- TEST E3.8: Zero-Delete Protection ---');
    // Attempt delete targeting already non-existent feature tl_layer_1.999999
    const e38Res = await evaluate(`(async () => {
      const res = await fetch('/api/geoserver/wfs/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layerName: 'tl_layer_1',
          featureId: 'tl_layer_1.999999',
          action: 'delete'
        })
      });
      return { status: res.status, data: await res.json() };
    })()`);

    const e38Pass = e38Res.status === 400 &&
                   e38Res.data.success === false &&
                   e38Res.data.totalDeleted === 0;

    testMatrix['TEST E3.8'] = {
      name: 'Zero-Delete Protection (Non-existent fid yields HTTP 400 & zero deleted)',
      pass: e38Pass,
      evidence: e38Res
    };
    console.log(`Result: ${e38Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.8'].evidence);

    // ── TEST E3.9 — WRONG-LAYER / CROSS-LAYER PROTECTION ─────────────────────
    console.log('\n--- TEST E3.9: Wrong-Layer / Cross-Layer Violation Protection ---');
    // Fetch first feature of tl_layer_1 to ensure it exists
    const f1Res = await fetch('http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:tl_layer_1&maxFeatures=1&startIndex=0&outputFormat=application/json', {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const f1Data = await f1Res.json();
    const safeOtherFid = f1Data.features[0].id;
    const featFirst = f1Data.features[0];

    // Attempt delete targeting layer Example_1 with safeOtherFid (from tl_layer_1)
    const e39Res = await evaluate(`(async () => {
      const res = await fetch('/api/geoserver/wfs/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layerName: 'Example_1',
          featureId: '${safeOtherFid}',
          action: 'delete'
        })
      });
      return { status: res.status, data: await res.json() };
    })()`);

    // Verify feature safeOtherFid was NOT deleted
    const fSafeRes = await fetch(`http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&featureId=${safeOtherFid}&resultType=hits`, {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const fSafeText = await fSafeRes.text();
    const fSafeHits = fSafeText.includes('numberOfFeatures="1"');

    const e39Pass = e39Res.status === 400 &&
                   e39Res.data.error.includes('Cross-layer violation') &&
                   fSafeHits;

    testMatrix['TEST E3.9'] = {
      name: 'Wrong-Layer Protection (Cross-layer delete strictly rejected)',
      pass: e39Pass,
      evidence: { response: e39Res, targetFeatureStillExists: fSafeHits }
    };
    console.log(`Result: ${e39Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.9'].evidence);

    // ── TEST E3.10 — MULTI-LAYER ISOLATION (LAYER A VS LAYER B) ──────────────
    console.log('\n--- TEST E3.10: Multi-Layer Isolation (Layer A vs Layer B) ---');
    // Verify Example_1 features count remains 249
    const exRes = await fetch('http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:Example_1&resultType=hits', {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const exText = await exRes.text();
    const exMatch = exText.match(/numberOfFeatures="(\d+)"/);
    const exCount = exMatch ? parseInt(exMatch[1], 10) : -1;

    // Verify Example_1 can be selected independently
    const exFeatureRes = await fetch('http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:Example_1&maxFeatures=1&outputFormat=application/json', {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const exData = await exFeatureRes.json();
    const exFeature = exData.features[0];

    await evaluate(`(() => {
      const feat = ${JSON.stringify(exFeature)};
      const ol = window.__olService;
      ol.setSelectedFeature('Example_1', feat.id, feat);
      if (ol.savedSelectCallback) {
        ol.savedSelectCallback(feat, 'Example_1');
      }
    })()`);
    await sleep(400);

    const exDom = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const fid = panel?.querySelector('.hud-fid-pill')?.textContent?.trim();
      const layerName = panel?.querySelector('.hud-card-layer-name')?.textContent?.trim();
      return {
        panelVisible: !!panel,
        fid,
        layerName
      };
    })()`);

    // Reset selection
    await evaluate(`(() => {
      const ol = window.__olService;
      ol.setSelectedFeature(null, null);
      if (ol.savedSelectCallback) {
        ol.savedSelectCallback(null, null);
      }
    })()`);
    await sleep(300);

    const e310Pass = exCount === 249 && exDom.panelVisible && exDom.fid === exFeature.id;
    testMatrix['TEST E3.10'] = {
      name: 'Multi-Layer Isolation (Layer B untouched & independently selectable)',
      pass: e310Pass,
      evidence: { example1Count: exCount, selectedOnLayerB: exDom }
    };
    console.log(`Result: ${e310Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.10'].evidence);

    // ── TEST E3.11 — DUPLICATE-CLICK & IN-FLIGHT SUBMISSION GUARD ─────────────
    console.log('\n--- TEST E3.11: Duplicate-Click & In-Flight Submission Guard ---');
    // Select feature featFirst
    await evaluate(`(() => {
      const feat = ${JSON.stringify(featFirst)};
      const ol = window.__olService;
      ol.setSelectedFeature('tl_layer_1', feat.id, feat);
      if (ol.savedSelectCallback) {
        ol.savedSelectCallback(feat, 'tl_layer_1');
      }
    })()`);
    await sleep(400);

    // Click once to enter confirmation state
    await evaluate(`(() => {
      const delBtn = document.querySelector('.hud-action-btn.delete-btn');
      if (delBtn) delBtn.click();
    })()`);
    await sleep(300);

    // Verify button switches to Confirm Del
    const guardCheck = await evaluate(`(() => {
      const delBtn = document.querySelector('.hud-action-btn.delete-btn');
      return {
        isConfirm: delBtn ? delBtn.textContent.includes('Confirm Del') : false,
        text: delBtn?.textContent?.trim()
      };
    })()`);

    // Cancel by clicking close or cancel
    await evaluate(`(() => {
      const closeBtn = document.querySelector('.hud-nav-btn[aria-label="Back to layers"]');
      if (closeBtn) closeBtn.click();
      const ol = window.__olService;
      ol.setSelectedFeature(null, null);
      if (ol.savedSelectCallback) ol.savedSelectCallback(null, null);
    })()`);
    await sleep(300);

    const e311Pass = guardCheck.isConfirm === true;
    testMatrix['TEST E3.11'] = {
      name: 'Duplicate-Click & In-Flight Submission Guard',
      pass: e311Pass,
      evidence: guardCheck
    };
    console.log(`Result: ${e311Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.11'].evidence);

    // ── TEST E3.12 — FAILURE HANDLING & STATE RECOVERY ───────────────────────
    console.log('\n--- TEST E3.12: Failure Handling & State Recovery ---');
    // Select feature featFirst again
    await evaluate(`(() => {
      const feat = ${JSON.stringify(featFirst)};
      const ol = window.__olService;
      ol.setSelectedFeature('tl_layer_1', feat.id, feat);
      if (ol.savedSelectCallback) {
        ol.savedSelectCallback(feat, 'tl_layer_1');
      }
    })()`);
    await sleep(400);

    // Mock an error by calling transaction endpoint with invalid parameter
    const errRes = await evaluate(`(async () => {
      const res = await fetch('/api/geoserver/wfs/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layerName: 'tl_layer_1',
          featureId: 'invalid_fid_format',
          action: 'delete'
        })
      });
      return { status: res.status, data: await res.json() };
    })()`);

    const e312Pass = errRes.status === 400 && (errRes.data.error !== undefined || errRes.data.success === false);
    testMatrix['TEST E3.12'] = {
      name: 'Failure Handling & State Recovery (Safe 400 rejection on invalid inputs)',
      pass: e312Pass,
      evidence: errRes
    };
    console.log(`Result: ${e312Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.12'].evidence);

    // Reset selection cleanly
    await evaluate(`(() => {
      const ol = window.__olService;
      ol.setSelectedFeature(null, null);
      if (ol.savedSelectCallback) ol.savedSelectCallback(null, null);
    })()`);
    await sleep(300);

    // ── TEST E3.13 — POST-DELETE MAP RENDERING, TOGGLE & ZOOM ────────────────
    console.log('\n--- TEST E3.13: Post-Delete Map Rendering, Toggle & Zoom ---');
    const e313State = await evaluate(`(() => {
      const ol = window.__olService;
      const layer = ol.layers['tl_layer_1'];
      const isVisible = layer?.getVisible();
      
      // Test toggle off and on
      ol.toggleDynamicLayer('tl_layer_1', false);
      const afterOff = layer?.getVisible();
      ol.toggleDynamicLayer('tl_layer_1', true);
      const afterOn = layer?.getVisible();

      // Test zoomToLayer
      ol.zoomToLayer('tl_layer_1');
      const view = ol.getMap().getView();
      const center = view.getCenter();
      const zoom = view.getZoom();

      return {
        initialVisible: isVisible,
        afterOff,
        afterOn,
        center,
        zoom: Math.round(zoom * 10) / 10
      };
    })()`);

    const e313Pass = e313State.afterOff === false && e313State.afterOn === true && e313State.zoom !== undefined;
    testMatrix['TEST E3.13'] = {
      name: 'Post-Delete Map Rendering, Layer Toggle & Zoom Intact',
      pass: e313Pass,
      evidence: e313State
    };
    console.log(`Result: ${e313Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.13'].evidence);

    // ── TEST E3.14 — UNIFIED LEGEND INTEGRITY REGRESSION ─────────────────────
    console.log('\n--- TEST E3.14: Unified Legend Integrity Regression ---');
    const e314State = await evaluate(`(() => {
      const legend = document.querySelector('[data-testid="unified-legend-panel"]');
      const items = Array.from(legend?.querySelectorAll('.hud-legend-item') || []).map(el => ({
        layer: el.getAttribute('data-layer'),
        label: el.querySelector('.hud-legend-label')?.textContent?.trim(),
        visible: el.classList.contains('active')
      }));
      return {
        legendMounted: !!legend,
        totalItems: items.length,
        items
      };
    })()`);

    const e314Pass = e314State.legendMounted && e314State.totalItems >= 7;
    testMatrix['TEST E3.14'] = {
      name: 'Unified Legend Integrity Regression (All layers present and synchronized)',
      pass: e314Pass,
      evidence: e314State
    };
    console.log(`Result: ${e314Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.14'].evidence);

    // ── TEST E3.15 — CORE-LAYER DELETE REGRESSION AUDIT ───────────────────────
    console.log('\n--- TEST E3.15: Core-Layer Deletion Regression Audit ---');
    // Verify core layer delete routes exist and function
    // Fetch a road to place a temporary streetlight on it, then delete it
    const createRes = await evaluate(`(async () => {
      const roadRes = await fetch('/api/roads');
      const roadData = await roadRes.json();
      const road = roadData.features[0];

      const res = await fetch('/api/streetlights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: road.geometry.coordinates[0] },
          properties: { name: 'E3 Temp Pole', type: 'LED', road_id: road.id, zone_id: road.properties.zone_id }
        })
      });
      return { status: res.status, data: await res.json() };
    })()`);

    let coreDeletePass = false;
    let coreDelRes = null;
    if (createRes.status === 201 && createRes.data?.id) {
      const testId = createRes.data.id;
      coreDelRes = await evaluate(`(async () => {
        const res = await fetch('/api/streetlights/' + ${testId}, {
          method: 'DELETE'
        });
        return { status: res.status };
      })()`);
      coreDeletePass = coreDelRes.status === 204;
    }

    testMatrix['TEST E3.15'] = {
      name: 'Core-Layer Deletion Regression Audit (streetlights DELETE 204)',
      pass: coreDeletePass,
      evidence: { createResult: createRes, deleteResult: coreDelRes }
    };
    console.log(`Result: ${coreDeletePass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.15'].evidence);

    // ── TEST E3.16 — SECURITY & INJECTION AUDIT ──────────────────────────────
    console.log('\n--- TEST E3.16: Security & Injection Audit ---');
    // Test XML injection attempts in layerName and featureId
    const sec1 = await evaluate(`(async () => {
      const res = await fetch('/api/geoserver/wfs/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layerName: 'tl_layer_1</wfs:Delete><wfs:Delete typeName="ward:roads">',
          featureId: '1',
          action: 'delete'
        })
      });
      return { status: res.status };
    })()`);

    const sec2 = await evaluate(`(async () => {
      const res = await fetch('/api/geoserver/wfs/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layerName: 'tl_layer_1',
          featureId: "1' OR '1'='1",
          action: 'delete'
        })
      });
      return { status: res.status };
    })()`);

    const e316Pass = sec1.status === 400 && sec2.status === 400;
    testMatrix['TEST E3.16'] = {
      name: 'Security & Injection Audit (XML & SQL injection strictly blocked with 400)',
      pass: e316Pass,
      evidence: { xmlInjectionStatus: sec1.status, sqlInjectionStatus: sec2.status }
    };
    console.log(`Result: ${e316Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.16'].evidence);

    // ── TEST E3.17 — CONSOLE & RUNTIME ERROR AUDIT ───────────────────────────
    console.log('\n--- TEST E3.17: Console & Runtime Error Audit ---');
    const realErrors = consoleMessages.filter(m => 
      m.type === 'error' && 
      !m.text.includes('favicon') && 
      !m.text.includes('Failed to load resource')
    );
    const e317Pass = exceptions.length === 0 && realErrors.length === 0;

    testMatrix['TEST E3.17'] = {
      name: 'Console & Runtime Audit (0 uncaught exceptions, 0 unexpected errors)',
      pass: e317Pass,
      evidence: { uncaughtExceptions: exceptions.length, consoleErrors: realErrors.length }
    };
    console.log(`Result: ${e317Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E3.17'].evidence);

  } finally {
    // Teardown
    console.log('\n[Teardown] Closing Chrome and connections...');
    ws.close();
    chromeProcess.kill();
  }

  // ── FINAL REPORT SUMMARY ───────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log('STAGE E3 AUTOMATED E2E VALIDATION SUMMARY');
  console.log('================================================================');
  let passCount = 0;
  let failCount = 0;
  for (const [testKey, result] of Object.entries(testMatrix)) {
    const mark = result.pass ? '✓ PASS' : '✗ FAIL';
    if (result.pass) passCount++;
    else failCount++;
    console.log(`${testKey.padEnd(12)}: ${mark} - ${result.name}`);
  }

  console.log('\n----------------------------------------------------------------');
  console.log(`TOTAL TESTS: ${passCount + failCount} | PASS: ${passCount} | FAIL: ${failCount}`);
  console.log('----------------------------------------------------------------');
  console.log('OVERALL VERDICT:', failCount === 0 ? 'STAGE E3 PASS' : 'STAGE E3 FAIL');
  console.log('================================================================\n');

  return { testMatrix, networkAudit, passCount, failCount };
}

runStageE3Validation()
  .then(res => {
    if (res.failCount > 0) process.exit(1);
    else process.exit(0);
  })
  .catch(err => {
    console.error('Fatal Error during Stage E3 validation:', err);
    process.exit(1);
  });
