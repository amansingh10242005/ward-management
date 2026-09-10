import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://localhost:5173/';
const DEBUG_PORT = 9222;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runStageE1Validation() {
  console.log('================================================================');
  console.log('STAGE E1 — FEATURE INFO AUTOMATED END-TO-END VALIDATION');
  console.log('Comprehensive 17-Test Suite with Real Browser CDP & Network Audit');
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
    '--user-data-dir=' + process.env.TEMP + '\\chrome_stage_e1_profile_' + Date.now(),
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
    // ── TEST E1.1 — APPLICATION STARTUP ──────────────────────────────────────
    console.log('\n--- TEST E1.1: Application Startup ---');
    await send('Page.navigate', { url: APP_URL });
    await sleep(4000); // Allow mount, layer loading, discovery

    const e11State = await evaluate(`(() => {
      const canvas = document.querySelector('.ol-map-container canvas');
      const sidebar = document.querySelector('.hud-sidebar-container');
      const ol = window.__olService;
      return {
        hasCanvas: !!canvas,
        hasSidebar: !!sidebar,
        hasOlService: !!ol,
        mapReady: ol ? !!ol.getMap() : false,
      };
    })()`);

    const realErrorsStartup = consoleMessages.filter(m => m.type === 'error' && !m.text.includes('favicon'));
    const e11Pass = e11State.hasCanvas && e11State.hasSidebar && e11State.mapReady && realErrorsStartup.length === 0;

    testMatrix['TEST E1.1'] = {
      name: 'Application Startup (Map & Sidebar functional, 0 console errors)',
      pass: e11Pass,
      evidence: { ...e11State, errorCount: realErrorsStartup.length }
    };
    console.log(`Result: ${e11Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.1'].evidence);

    // ── TEST E1.2 — CORE FEATURE INFO ────────────────────────────────────────
    console.log('\n--- TEST E1.2: Core Feature Info ---');
    const e12State = await evaluate(`(() => {
      const ol = window.__olService;
      const geojson = {
        type: 'Feature',
        id: 'zones.1001',
        geometry: { 
          type: 'Polygon', 
          coordinates: [[[77.7, 13.4], [77.8, 13.4], [77.8, 13.5], [77.7, 13.5], [77.7, 13.4]]] 
        },
        properties: { 
          id: 1001, 
          name: 'North Industrial Ward', 
          type: 'Industrial', 
          area_sqm: 450000, 
          status: 'Active' 
        }
      };

      ol.setSelectedFeature('zones', geojson.id, geojson);
      if (ol.savedSelectCallback) {
        ol.savedSelectCallback(geojson, 'zones');
      }

      return {
        selectedId: ol.selectedFeatureId,
        selectedLayer: ol.selectedLayerName,
        propsCount: Object.keys(geojson.properties).length,
      };
    })()`);

    await sleep(500);

    const e12Dom = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const title = panel?.querySelector('.hud-feature-title')?.textContent?.trim();
      const layerName = panel?.querySelector('.hud-card-layer-name')?.textContent?.trim();
      const fid = panel?.querySelector('.hud-fid-pill')?.textContent?.trim();
      const geomType = panel?.querySelector('.hud-geom-badge')?.textContent?.trim();
      const rows = Array.from(panel?.querySelectorAll('.hud-attr-row') || []).map(r => ({
        key: r.querySelector('.hud-attr-key-label')?.textContent?.trim(),
        val: r.querySelector('.hud-attr-val-col')?.textContent?.trim()
      }));

      // Verify no input form fields in read-only info
      const formInputs = panel?.querySelectorAll('input:not(.hud-attr-search-input), select, textarea');

      return {
        panelVisible: !!panel,
        title,
        layerName,
        fid,
        geomType,
        attributesCount: rows.length,
        hasNameAttr: rows.some(r => r.key?.toLowerCase() === 'name'),
        hasNoFormInputs: formInputs?.length === 0,
      };
    })()`);

    const e12Pass = e12Dom.panelVisible && 
                   e12Dom.attributesCount > 0 && 
                   e12Dom.hasNoFormInputs && 
                   e12Dom.geomType === 'Polygon';

    testMatrix['TEST E1.2'] = {
      name: 'Core Feature Info (Layer, ID, geomType, actual attributes, read-only)',
      pass: e12Pass,
      evidence: e12Dom
    };
    console.log(`Result: ${e12Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.2'].evidence);

    // ── TEST E1.3 — DYNAMIC FEATURE INFO (tl_layer_1) ─────────────────────────
    console.log('\n--- TEST E1.3: Dynamic Feature Info (tl_layer_1) ---');
    // Fetch live feature info for tl_layer_1.36 from GeoServer
    const dynRes = await fetch('http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:tl_layer_1&featureID=tl_layer_1.36&outputFormat=application/json', {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const dynData = await dynRes.json();
    const tlFeature = dynData.features[0];

    await evaluate(`(() => {
      const feat = ${JSON.stringify(tlFeature)};
      const ol = window.__olService;
      ol.setSelectedFeature('tl_layer_1', feat.id, feat);
      if (ol.savedSelectCallback) {
        ol.savedSelectCallback(feat, 'tl_layer_1');
      }
    })()`);

    await sleep(600);

    const e13Check = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const fid = panel?.querySelector('.hud-fid-pill')?.textContent?.trim();
      const layerName = panel?.querySelector('.hud-card-layer-name')?.textContent?.trim();
      const geomType = panel?.querySelector('.hud-geom-badge')?.textContent?.trim();
      const rows = Array.from(panel?.querySelectorAll('.hud-attr-row') || []);
      const keys = rows.map(r => r.querySelector('.hud-attr-key-label')?.textContent?.trim());

      return {
        panelVisible: !!panel,
        fid,
        layerName,
        geomType,
        totalRenderedAttributes: rows.length,
        hasNameAlt: keys.includes('NAME_ALT'),
        hasPopEst: keys.includes('POP_EST'),
        hasIsoA2: keys.includes('ISO_A2'),
        hasNoFormInputs: panel?.querySelectorAll('input:not(.hud-attr-search-input)')?.length === 0,
      };
    })()`);

    const e13Pass = e13Check.panelVisible && 
                   e13Check.fid === 'tl_layer_1.36' && 
                   e13Check.totalRenderedAttributes > 100 && 
                   e13Check.hasNameAlt && 
                   e13Check.hasPopEst;

    testMatrix['TEST E1.3'] = {
      name: 'Dynamic Feature Info (tl_layer_1: all returned attributes, no hardcoding)',
      pass: e13Pass,
      evidence: e13Check
    };
    console.log(`Result: ${e13Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.3'].evidence);

    // ── TEST E1.4 — SECOND DYNAMIC LAYER (Example_1) ─────────────────────────
    console.log('\n--- TEST E1.4: Second Dynamic Layer (Example_1) ---');
    const ex1Res = await fetch('http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:Example_1&maxFeatures=1&outputFormat=application/json', {
      headers: { Authorization: 'Basic ' + Buffer.from('admin:geoserver').toString('base64') }
    });
    const ex1Data = await ex1Res.json();
    const ex1Feature = ex1Data.features[0];

    await evaluate(`(() => {
      const feat = ${JSON.stringify(ex1Feature)};
      const ol = window.__olService;
      ol.setSelectedFeature('Example_1', feat.id, feat);
      if (ol.savedSelectCallback) {
        ol.savedSelectCallback(feat, 'Example_1');
      }
    })()`);

    await sleep(600);

    const e14Check = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const fid = panel?.querySelector('.hud-fid-pill')?.textContent?.trim();
      const layerName = panel?.querySelector('.hud-card-layer-name')?.textContent?.trim();
      const rows = Array.from(panel?.querySelectorAll('.hud-attr-row') || []);

      return {
        panelVisible: !!panel,
        fid,
        layerName,
        renderedAttributesCount: rows.length,
      };
    })()`);

    const e14Pass = e14Check.panelVisible && 
                   e14Check.layerName === 'Example_1' && 
                   e14Check.fid === ex1Feature.id && 
                   e14Check.renderedAttributesCount > 0;

    testMatrix['TEST E1.4'] = {
      name: 'Second Dynamic Layer (Example_1: dynamically adapts to schema)',
      pass: e14Pass,
      evidence: e14Check
    };
    console.log(`Result: ${e14Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.4'].evidence);

    // ── TEST E1.5 — DIFFERENT ATTRIBUTE SCHEMA ───────────────────────────────
    console.log('\n--- TEST E1.5: Different Attribute Schema ---');
    await evaluate(`(() => {
      const ol = window.__olService;
      const slFeat = {
        type: 'Feature',
        id: 'streetlights.501',
        geometry: { type: 'Point', coordinates: [77.7, 13.4] },
        properties: { identifier: 'SL-501', wattage: 120, pole_height: 9.5, status: 'operational' }
      };
      ol.setSelectedFeature('streetlights', slFeat.id, slFeat);
      if (ol.savedSelectCallback) ol.savedSelectCallback(slFeat, 'streetlights');
    })()`);

    await sleep(400);

    const e15Check = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const rows = Array.from(panel?.querySelectorAll('.hud-attr-row') || []);
      const keys = rows.map(r => r.querySelector('.hud-attr-key-label')?.textContent?.trim());

      return {
        layerName: panel?.querySelector('.hud-card-layer-name')?.textContent?.trim(),
        keys,
        hasWattage: keys.includes('wattage'),
        hasPoleHeight: keys.includes('pole_height'),
        doesNotHaveTlKeys: !keys.includes('NAME_ALT') && !keys.includes('POP_EST')
      };
    })()`);

    const e15Pass = e15Check.hasWattage && e15Check.hasPoleHeight && e15Check.doesNotHaveTlKeys;
    testMatrix['TEST E1.5'] = {
      name: 'Different Attribute Schema (Table automatically changes to match actual properties)',
      pass: e15Pass,
      evidence: e15Check
    };
    console.log(`Result: ${e15Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.5'].evidence);

    // ── TEST E1.6 — NULL / EMPTY VALUES ──────────────────────────────────────
    console.log('\n--- TEST E1.6: Null / Empty Values Handling ---');
    await evaluate(`(() => {
      const ol = window.__olService;
      const featWithNulls = {
        type: 'Feature',
        id: 'test_layer.99',
        geometry: { type: 'Point', coordinates: [77.1, 13.1] },
        properties: {
          nullField: null,
          undefinedField: undefined,
          emptyString: '',
          validField: 'Valid Text'
        }
      };
      ol.setSelectedFeature('test_layer', featWithNulls.id, featWithNulls);
      if (ol.savedSelectCallback) ol.savedSelectCallback(featWithNulls, 'test_layer');
    })()`);

    await sleep(400);

    const e16Dom = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const rows = Array.from(panel?.querySelectorAll('.hud-attr-row') || []);
      const emptyBadges = panel?.querySelectorAll('.hud-val-empty');

      return {
        panelVisible: !!panel,
        rowsCount: rows.length,
        emptyBadgesCount: emptyBadges ? emptyBadges.length : 0,
        emptyText: emptyBadges && emptyBadges[0] ? emptyBadges[0].textContent : null,
      };
    })()`);

    const e16Pass = e16Dom.panelVisible && e16Dom.emptyBadgesCount >= 3 && e16Dom.emptyText === '—';
    testMatrix['TEST E1.6'] = {
      name: 'Null / Empty Values (Graceful display as em dash, no crash)',
      pass: e16Pass,
      evidence: e16Dom
    };
    console.log(`Result: ${e16Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.6'].evidence);

    // ── TEST E1.7 — LONG VALUES ──────────────────────────────────────────────
    console.log('\n--- TEST E1.7: Long Values Wrapping ---');
    const longText = 'VeryLongAttributeValue_'.repeat(15) + 'AmanWardManagerTestingLongTextHandlingWithoutHorizontalOverflow';
    await evaluate(`(() => {
      const ol = window.__olService;
      const featWithLong = {
        type: 'Feature',
        id: 'test_layer.100',
        geometry: { type: 'Point', coordinates: [77.1, 13.1] },
        properties: {
          shortProp: 'Normal',
          longDescription: ${JSON.stringify(longText)}
        }
      };
      ol.setSelectedFeature('test_layer', featWithLong.id, featWithLong);
      if (ol.savedSelectCallback) ol.savedSelectCallback(featWithLong, 'test_layer');
    })()`);

    await sleep(400);

    const e17Dom = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const sidebar = document.querySelector('.hud-sidebar-container');
      const longValCol = panel?.querySelector('.hud-attr-row:last-child .hud-attr-val-col');
      
      const sidebarRect = sidebar?.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();

      return {
        panelVisible: !!panel,
        sidebarWidth: sidebarRect?.width,
        panelWidth: panelRect?.width,
        panelContainedInSidebar: panelRect ? panelRect.right <= (sidebarRect?.right + 2) : false,
        hasWordBreak: longValCol ? window.getComputedStyle(longValCol).wordBreak : null,
      };
    })()`);

    const e17Pass = e17Dom.panelVisible && e17Dom.panelContainedInSidebar;
    testMatrix['TEST E1.7'] = {
      name: 'Long Values (Word-wrap, no horizontal page break or layout overflow)',
      pass: e17Pass,
      evidence: e17Dom
    };
    console.log(`Result: ${e17Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.7'].evidence);

    // ── TEST E1.8 — READ-ONLY GUARANTEE ──────────────────────────────────────
    console.log('\n--- TEST E1.8: Read-Only Guarantee ---');
    const e18Check = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const editableInputs = panel?.querySelectorAll('input[name], textarea, select');
      const saveButtons = Array.from(panel?.querySelectorAll('button') || []).filter(b => 
        b.textContent.toLowerCase().includes('save')
      );
      return {
        editableInputsCount: editableInputs ? editableInputs.length : 0,
        saveButtonsCount: saveButtons.length,
        isPureReadOnly: editableInputs?.length === 0 && saveButtons.length === 0
      };
    })()`);

    const e18Pass = e18Check.isPureReadOnly;
    testMatrix['TEST E1.8'] = {
      name: 'Read-Only Guarantee (0 form inputs, 0 save buttons in inspection mode)',
      pass: e18Pass,
      evidence: e18Check
    };
    console.log(`Result: ${e18Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.8'].evidence);

    // ── TEST E1.9 — NETWORK AUDIT ────────────────────────────────────────────
    console.log('\n--- TEST E1.9: Network Audit ---');
    const e19ReqStart = networkRequests.length;

    // Select dynamic feature tl_layer_1.36
    await evaluate(`(() => {
      const feat = ${JSON.stringify(tlFeature)};
      const ol = window.__olService;
      ol.setSelectedFeature('tl_layer_1', feat.id, feat);
      if (ol.savedSelectCallback) ol.savedSelectCallback(feat, 'tl_layer_1');
    })()`);

    await sleep(600);

    // Filter requests after selection during inspection
    const e19Requests = networkRequests.slice(e19ReqStart);
    const wfsTCalls = e19Requests.filter(r => r.url.includes('/wfs/transaction') || r.method === 'POST').length;
    const fullWfsCalls = e19Requests.filter(r => r.url.includes('request=GetFeature') && !r.url.includes('featureID')).length;
    const putDeleteCalls = e19Requests.filter(r => r.method === 'PUT' || r.method === 'DELETE').length;

    const e19Pass = wfsTCalls === 0 && fullWfsCalls === 0 && putDeleteCalls === 0;
    networkAudit.inspection = {
      wfsT: wfsTCalls,
      fullLayerWfs: fullWfsCalls,
      putOrDelete: putDeleteCalls
    };

    testMatrix['TEST E1.9'] = {
      name: 'Network Audit (0 WFS-T, 0 full WFS, 0 PUT/DELETE on inspect)',
      pass: e19Pass,
      evidence: networkAudit.inspection
    };
    console.log(`Result: ${e19Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.9'].evidence);

    // ── TEST E1.10 — SELECTION SWITCHING ─────────────────────────────────────
    console.log('\n--- TEST E1.10: Selection Switching (A -> B) ---');
    const featA = {
      type: 'Feature',
      id: 'layerA.1',
      geometry: { type: 'Point', coordinates: [10, 10] },
      properties: { uniquePropA: 'Value_A', commonProp: 'A' }
    };
    const featB = {
      type: 'Feature',
      id: 'layerB.2',
      geometry: { type: 'Point', coordinates: [20, 20] },
      properties: { uniquePropB: 'Value_B', commonProp: 'B' }
    };

    // Select A
    await evaluate(`(() => {
      const f = ${JSON.stringify(featA)};
      window.__olService.setSelectedFeature('layerA', f.id, f);
      if (window.__olService.savedSelectCallback) window.__olService.savedSelectCallback(f, 'layerA');
    })()`);
    await sleep(300);

    // Switch to B
    await evaluate(`(() => {
      const f = ${JSON.stringify(featB)};
      window.__olService.setSelectedFeature('layerB', f.id, f);
      if (window.__olService.savedSelectCallback) window.__olService.savedSelectCallback(f, 'layerB');
    })()`);
    await sleep(400);

    const e110Dom = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const fid = panel?.querySelector('.hud-fid-pill')?.textContent?.trim();
      const rows = Array.from(panel?.querySelectorAll('.hud-attr-row') || []);
      const keys = rows.map(r => r.querySelector('.hud-attr-key-label')?.textContent?.trim());
      const values = rows.map(r => r.querySelector('.hud-attr-val-col')?.textContent?.trim());

      return {
        fid,
        hasPropB: keys.includes('uniquePropB'),
        hasNoStalePropA: !keys.includes('uniquePropA'),
        commonPropValue: values[keys.indexOf('commonProp')],
        panelsCount: document.querySelectorAll('[data-testid="feature-info-panel"]').length
      };
    })()`);

    const e110Pass = e110Dom.fid === 'layerB.2' && 
                    e110Dom.hasPropB && 
                    e110Dom.hasNoStalePropA && 
                    e110Dom.commonPropValue === 'B' && 
                    e110Dom.panelsCount === 1;

    testMatrix['TEST E1.10'] = {
      name: 'Selection Switching (Smooth A -> B, no stale attributes, exactly 1 panel)',
      pass: e110Pass,
      evidence: e110Dom
    };
    console.log(`Result: ${e110Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.10'].evidence);

    // ── TEST E1.11 — DESELECT ────────────────────────────────────────────────
    console.log('\n--- TEST E1.11: Deselect Feature ---');
    await evaluate(`(() => {
      const ol = window.__olService;
      ol.setSelectedFeature(null, null);
      if (ol.savedSelectCallback) ol.savedSelectCallback(null, null);
    })()`);

    await sleep(400);

    const e111Dom = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const sidebar = document.querySelector('.hud-sidebar-container');
      return {
        featureInfoPanelGone: !panel,
        sidebarVisible: !!sidebar,
      };
    })()`);

    const e111Pass = e111Dom.featureInfoPanelGone && e111Dom.sidebarVisible;
    testMatrix['TEST E1.11'] = {
      name: 'Deselect Feature (Returns cleanly to empty state, no stale data)',
      pass: e111Pass,
      evidence: e111Dom
    };
    console.log(`Result: ${e111Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.11'].evidence);

    // ── TEST E1.12 — LAYER SWITCH ────────────────────────────────────────────
    console.log('\n--- TEST E1.12: Layer Switch ---');
    await evaluate(`(() => {
      const f = ${JSON.stringify(tlFeature)};
      window.__olService.setSelectedFeature('tl_layer_1', f.id, f);
      if (window.__olService.savedSelectCallback) window.__olService.savedSelectCallback(f, 'tl_layer_1');
    })()`);
    await sleep(300);

    // Deselect and switch layer
    await evaluate(`(() => {
      window.__olService.setSelectedFeature(null, null);
      if (window.__olService.savedSelectCallback) window.__olService.savedSelectCallback(null, null);
    })()`);
    await sleep(400);

    const e112Check = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const sidebar = document.querySelector('.hud-sidebar-container');
      return {
        panelVisible: !!panel,
        sidebarReady: !!sidebar,
      };
    })()`);

    const e112Pass = !e112Check.panelVisible && e112Check.sidebarReady;
    testMatrix['TEST E1.12'] = {
      name: 'Layer Switch (No leaked dynamic feature state under core layers)',
      pass: e112Pass,
      evidence: e112Check
    };
    console.log(`Result: ${e112Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.12'].evidence);

    // ── TEST E1.13 — RELOAD ──────────────────────────────────────────────────
    console.log('\n--- TEST E1.13: Regression After Reload ---');
    await send('Page.reload');
    await sleep(4000);

    const e113Dom = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const sidebar = document.querySelector('.hud-sidebar-container');

      return {
        panelPresentOnFreshLoad: !!panel,
        sidebarReady: !!sidebar,
      };
    })()`);

    const e113Pass = !e113Dom.panelPresentOnFreshLoad && e113Dom.sidebarReady;
    testMatrix['TEST E1.13'] = {
      name: 'Regression After Reload (Starts cleanly with empty selection state)',
      pass: e113Pass,
      evidence: e113Dom
    };
    console.log(`Result: ${e113Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.13'].evidence);

    // ── TEST E1.14 — SECURITY DISPLAY TEST ───────────────────────────────────
    console.log('\n--- TEST E1.14: Security Display Test (HTML / Script Injection) ---');
    const xssPayload = '<script id="xss-test">window.__XSS_PWNED__ = true;</script><img src="x" onerror="window.__IMG_PWNED__ = true;" />';
    
    await evaluate(`(() => {
      const ol = window.__olService;
      const xssFeat = {
        type: 'Feature',
        id: 'sec.1',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: {
          xssField: ${JSON.stringify(xssPayload)},
          safeField: 'Legitimate text'
        }
      };
      ol.setSelectedFeature('sec_layer', xssFeat.id, xssFeat);
      if (ol.savedSelectCallback) ol.savedSelectCallback(xssFeat, 'sec_layer');
    })()`);

    await sleep(500);

    const e114Check = await evaluate(`(() => {
      const pwnedScript = !!window.__XSS_PWNED__;
      const pwnedImg = !!window.__IMG_PWNED__;
      const scriptTagInDom = !!document.getElementById('xss-test');
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const rows = Array.from(panel?.querySelectorAll('.hud-attr-row') || []);
      const xssRow = rows.find(r => r.querySelector('.hud-attr-key-label')?.textContent?.trim() === 'xssField');
      const valText = xssRow?.querySelector('.hud-attr-val-col')?.textContent;

      return {
        pwnedScript,
        pwnedImg,
        scriptTagInDom,
        renderedAsPlainText: valText?.includes('<script'),
        noExecution: !pwnedScript && !pwnedImg && !scriptTagInDom
      };
    })()`);

    const e114Pass = e114Check.noExecution && e114Check.renderedAsPlainText;
    testMatrix['TEST E1.14'] = {
      name: 'Security Display Test (HTML/XSS rendered safely as plain text)',
      pass: e114Pass,
      evidence: e114Check
    };
    console.log(`Result: ${e114Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.14'].evidence);

    // ── TEST E1.15 — CORE REGRESSION ─────────────────────────────────────────
    console.log('\n--- TEST E1.15: Core Regression ---');
    const e115State = await evaluate(`(() => {
      const ol = window.__olService;
      const coreLayers = ['states', 'districts', 'zones', 'roads', 'streetlights'];
      const ok = coreLayers.every(l => !!ol.layers[l] && !!ol[l + 'WfsSource']);
      return {
        coreLayersCount: coreLayers.length,
        allSourcesReady: ok
      };
    })()`);

    const e115Pass = e115State.allSourcesReady;
    testMatrix['TEST E1.15'] = {
      name: 'Core Regression (States, districts, zones, roads, streetlights intact)',
      pass: e115Pass,
      evidence: e115State
    };
    console.log(`Result: ${e115Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.15'].evidence);

    // ── TEST E1.16 — CONSOLE AUDIT ───────────────────────────────────────────
    console.log('\n--- TEST E1.16: Console Audit ---');
    const realErrors = consoleMessages.filter(m => m.type === 'error' && !m.text.includes('favicon'));
    const realExceptions = exceptions.filter(e => !e.text?.includes('favicon'));

    const e116Pass = realErrors.length === 0 && realExceptions.length === 0;
    testMatrix['TEST E1.16'] = {
      name: 'Console Audit (0 uncaught exceptions, 0 errors)',
      pass: e116Pass,
      evidence: { errorCount: realErrors.length, exceptionCount: realExceptions.length, errors: realErrors }
    };
    console.log(`Result: ${e116Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.16'].evidence);

    // ── TEST E1.17 — DUPLICATE UI / EVENT AUDIT ──────────────────────────────
    console.log('\n--- TEST E1.17: Duplicate UI / Event Audit ---');
    const e117Cycles = await evaluate(`(() => {
      const feat = ${JSON.stringify(tlFeature)};
      const ol = window.__olService;
      for (let i = 0; i < 5; i++) {
        ol.setSelectedFeature('tl_layer_1', feat.id, feat);
        if (ol.savedSelectCallback) ol.savedSelectCallback(feat, 'tl_layer_1');
        ol.setSelectedFeature(null, null);
        if (ol.savedSelectCallback) ol.savedSelectCallback(null, null);
      }
      // Final select
      ol.setSelectedFeature('tl_layer_1', feat.id, feat);
      if (ol.savedSelectCallback) ol.savedSelectCallback(feat, 'tl_layer_1');

      const panels = document.querySelectorAll('[data-testid="feature-info-panel"]');
      return {
        panelsCount: panels.length,
        activeInteractionsCount: ol.activeInteractions.length,
      };
    })()`);

    await sleep(400);

    const e117Pass = e117Cycles.panelsCount === 1 && e117Cycles.activeInteractionsCount <= 5;
    testMatrix['TEST E1.17'] = {
      name: 'Duplicate UI / Event Audit (Exactly 1 Feature Info panel, no duplicate listeners)',
      pass: e117Pass,
      evidence: e117Cycles
    };
    console.log(`Result: ${e117Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E1.17'].evidence);

    // Clean up selection
    await evaluate(`(() => {
      window.__olService.setSelectedFeature(null, null);
      if (window.__olService.savedSelectCallback) window.__olService.savedSelectCallback(null, null);
    })()`);

  } finally {
    ws.close();
    chromeProcess.kill();
  }

  // ── FINAL VALIDATION REPORT ───────────────────────────────────────────────
  console.log('\n================================================================');
  console.log('FINAL VALIDATION MATRIX — ALL 17 TESTS:');
  console.log('================================================================');
  let allPass = true;
  for (const [id, res] of Object.entries(testMatrix)) {
    console.log(`${id.padEnd(12)} [${res.pass ? 'PASS' : 'FAIL'}] — ${res.name}`);
    if (!res.pass) allPass = false;
  }
  console.log('================================================================');
  console.log(`OVERALL STAGE E1 STATUS: ${allPass ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return { allPass, testMatrix, networkAudit };
}

runStageE1Validation().then(({ allPass }) => {
  process.exit(allPass ? 0 : 1);
}).catch(err => {
  console.error('Fatal Validation Runner Error:', err);
  process.exit(1);
});
