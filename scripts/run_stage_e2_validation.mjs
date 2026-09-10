import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://localhost:5173/';
const DEBUG_PORT = 9222;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runStageE2Validation() {
  console.log('================================================================');
  console.log('STAGE E2 — UNIFIED LAYER LEGEND AUTOMATED END-TO-END VALIDATION');
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
    '--user-data-dir=' + process.env.TEMP + '\\chrome_stage_e2_profile_' + Date.now(),
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
    // ── TEST E2.1 — APPLICATION STARTUP ──────────────────────────────────────
    console.log('\n--- TEST E2.1: Application Startup ---');
    await send('Page.navigate', { url: APP_URL });
    await sleep(4000); // Allow mount, layer loading, discovery

    const e21State = await evaluate(`(() => {
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
      };
    })()`);

    const realErrorsStartup = consoleMessages.filter(m => m.type === 'error' && !m.text.includes('favicon'));
    const e21Pass = e21State.hasCanvas && e21State.hasSidebar && e21State.hasLegend && e21State.mapReady && realErrorsStartup.length === 0;

    testMatrix['TEST E2.1'] = {
      name: 'Application Startup (Map, Sidebar, and Unified Legend loaded, 0 console errors)',
      pass: e21Pass,
      evidence: { ...e21State, errorCount: realErrorsStartup.length }
    };
    console.log(`Result: ${e21Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.1'].evidence);

    // ── TEST E2.2 — CORE LAYER LEGEND: STATES ────────────────────────────────
    console.log('\n--- TEST E2.2: Core Layer Legend (States) ---');
    // 1. Verify states legend is visible initially
    const e22Init = await evaluate(`(() => {
      const statesItem = document.querySelector('[data-testid="legend-item-states"]');
      const statesImg = document.querySelector('[data-testid="legend-img-states"]');
      return {
        hasStatesItem: !!statesItem,
        imgSrc: statesImg ? statesImg.getAttribute('src') : null,
      };
    })()`);

    // 2. Toggle states OFF
    await evaluate(`(() => {
      window.__olService.toggleLayer('states', false);
    })()`);
    await sleep(500);

    const e22Off = await evaluate(`(() => {
      const statesItem = document.querySelector('[data-testid="legend-item-states"]');
      return { hasStatesItem: !!statesItem };
    })()`);

    // 3. Toggle states back ON
    await evaluate(`(() => {
      window.__olService.toggleLayer('states', true);
    })()`);
    await sleep(500);

    const e22On = await evaluate(`(() => {
      const statesItem = document.querySelector('[data-testid="legend-item-states"]');
      const statesImg = document.querySelector('[data-testid="legend-img-states"]');
      return {
        hasStatesItem: !!statesItem,
        imgSrc: statesImg ? statesImg.getAttribute('src') : null,
      };
    })()`);

    const e22Pass = e22Init.hasStatesItem && 
                   !e22Off.hasStatesItem && 
                   e22On.hasStatesItem && 
                   e22On.imgSrc?.includes('LAYER=ward%3Astates') &&
                   e22On.imgSrc?.includes('REQUEST=GetLegendGraphic');

    testMatrix['TEST E2.2'] = {
      name: 'Core Layer Legend: States (ON -> visible, OFF -> disappears, ON -> reappears)',
      pass: e22Pass,
      evidence: { init: e22Init, off: e22Off, on: e22On }
    };
    console.log(`Result: ${e22Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.2'].evidence);

    // ── TEST E2.3 — CORE LAYER LEGENDS (districts, zones, roads, streetlights) ─
    console.log('\n--- TEST E2.3: Core Layer Legends (districts, zones, roads, streetlights) ---');
    const coreLayers = ['districts', 'zones', 'roads', 'streetlights'];
    const coreResults = {};
    let allCorePass = true;

    for (const layer of coreLayers) {
      // Toggle OFF
      await evaluate(`(() => {
        window.__olService.toggleLayer('${layer}', false);
      })()`);
      await sleep(350);

      const offCheck = await evaluate(`(() => {
        const item = document.querySelector('[data-testid="legend-item-${layer}"]');
        return !item;
      })()`);

      // Toggle ON
      await evaluate(`(() => {
        window.__olService.toggleLayer('${layer}', true);
      })()`);
      await sleep(350);

      const onCheck = await evaluate(`(() => {
        const item = document.querySelector('[data-testid="legend-item-${layer}"]');
        const img = document.querySelector('[data-testid="legend-img-${layer}"]');
        return {
          itemVisible: !!item,
          hasGetLegend: img ? img.getAttribute('src')?.includes('GetLegendGraphic') : false,
          correctLayer: img ? img.getAttribute('src')?.includes('ward%3A${layer}') : false,
        };
      })()`);

      const pass = offCheck && onCheck.itemVisible && onCheck.hasGetLegend && onCheck.correctLayer;
      if (!pass) allCorePass = false;
      coreResults[layer] = { offCheck, onCheck, pass };
    }

    testMatrix['TEST E2.3'] = {
      name: 'Core Layer Legends: districts, zones, roads, streetlights (individual toggle isolation)',
      pass: allCorePass,
      evidence: coreResults
    };
    console.log(`Result: ${allCorePass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.3'].evidence);

    // ── TEST E2.4 — DYNAMIC TL_LAYER_1 ───────────────────────────────────────
    console.log('\n--- TEST E2.4: Dynamic Layer tl_layer_1 ---');
    // Turn ON tl_layer_1
    await evaluate(`(() => {
      window.__olService.toggleDynamicLayer('tl_layer_1', true);
    })()`);
    await sleep(600);

    const e24On = await evaluate(`(() => {
      const item = document.querySelector('[data-testid="legend-item-tl_layer_1"]');
      const img = document.querySelector('[data-testid="legend-img-tl_layer_1"]');
      const tag = item?.querySelector('.hud-legend-item-tag')?.textContent?.trim();
      return {
        itemVisible: !!item,
        imgSrc: img ? img.getAttribute('src') : null,
        tag,
      };
    })()`);

    // Turn OFF tl_layer_1
    await evaluate(`(() => {
      window.__olService.toggleDynamicLayer('tl_layer_1', false);
    })()`);
    await sleep(500);

    const e24Off = await evaluate(`(() => {
      const item = document.querySelector('[data-testid="legend-item-tl_layer_1"]');
      return { itemVisible: !!item };
    })()`);

    const e24Pass = e24On.itemVisible && 
                   e24On.imgSrc?.includes('ward%3Atl_layer_1') && 
                   e24On.tag === 'Dynamic' && 
                   !e24Off.itemVisible;

    testMatrix['TEST E2.4'] = {
      name: 'Dynamic Layer tl_layer_1 (ON -> appears with GetLegendGraphic, OFF -> disappears)',
      pass: e24Pass,
      evidence: { on: e24On, off: e24Off }
    };
    console.log(`Result: ${e24Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.4'].evidence);

    // ── TEST E2.5 — DYNAMIC EXAMPLE_1 ────────────────────────────────────────
    console.log('\n--- TEST E2.5: Dynamic Layer Example_1 ---');
    await evaluate(`(() => {
      window.__olService.toggleDynamicLayer('Example_1', true);
    })()`);
    await sleep(600);

    const e25On = await evaluate(`(() => {
      const item = document.querySelector('[data-testid="legend-item-Example_1"]');
      const img = document.querySelector('[data-testid="legend-img-Example_1"]');
      return {
        itemVisible: !!item,
        imgSrc: img ? img.getAttribute('src') : null,
      };
    })()`);

    await evaluate(`(() => {
      window.__olService.toggleDynamicLayer('Example_1', false);
    })()`);
    await sleep(500);

    const e25Off = await evaluate(`(() => {
      const item = document.querySelector('[data-testid="legend-item-Example_1"]');
      return { itemVisible: !!item };
    })()`);

    const e25Pass = e25On.itemVisible && 
                   e25On.imgSrc?.includes('ward%3AExample_1') && 
                   !e25Off.itemVisible;

    testMatrix['TEST E2.5'] = {
      name: 'Dynamic Layer Example_1 (Dynamically adapts to schema without special-cased code)',
      pass: e25Pass,
      evidence: { on: e25On, off: e25Off }
    };
    console.log(`Result: ${e25Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.5'].evidence);

    // ── TEST E2.6 — MULTIPLE VISIBLE LAYERS ──────────────────────────────────
    console.log('\n--- TEST E2.6: Multiple Visible Layers (states + roads + tl_layer_1) ---');
    // Turn all off
    await evaluate(`(() => {
      ['states', 'districts', 'zones', 'roads', 'streetlights'].forEach(l => window.__olService.toggleLayer(l, false));
      ['tl_layer_1', 'Example_1'].forEach(l => window.__olService.toggleDynamicLayer(l, false));
    })()`);
    await sleep(400);

    // Turn ON: states + roads + tl_layer_1
    await evaluate(`(() => {
      window.__olService.toggleLayer('states', true);
      window.__olService.toggleLayer('roads', true);
      window.__olService.toggleDynamicLayer('tl_layer_1', true);
    })()`);
    await sleep(500);

    const e26Three = await evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.hud-legend-item'));
      const countPill = document.querySelector('.hud-legend-count-pill')?.textContent?.trim();
      const ids = items.map(i => i.getAttribute('data-testid'));
      return {
        itemsCount: items.length,
        countPill,
        ids,
        hasStates: ids.includes('legend-item-states'),
        hasRoads: ids.includes('legend-item-roads'),
        hasTl: ids.includes('legend-item-tl_layer_1'),
        noDuplicates: new Set(ids).size === ids.length,
      };
    })()`);

    // Turn roads OFF
    await evaluate(`(() => {
      window.__olService.toggleLayer('roads', false);
    })()`);
    await sleep(500);

    const e26Two = await evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('.hud-legend-item'));
      const countPill = document.querySelector('.hud-legend-count-pill')?.textContent?.trim();
      const ids = items.map(i => i.getAttribute('data-testid'));
      return {
        itemsCount: items.length,
        countPill,
        hasStates: ids.includes('legend-item-states'),
        hasNoRoads: !ids.includes('legend-item-roads'),
        hasTl: ids.includes('legend-item-tl_layer_1'),
      };
    })()`);

    const e26Pass = e26Three.itemsCount === 3 && 
                   e26Three.hasStates && 
                   e26Three.hasRoads && 
                   e26Three.hasTl && 
                   e26Three.noDuplicates && 
                   e26Two.itemsCount === 2 && 
                   e26Two.hasStates && 
                   e26Two.hasNoRoads && 
                   e26Two.hasTl;

    testMatrix['TEST E2.6'] = {
      name: 'Multiple Visible Layers (3 simultaneous legends, roads OFF leaves 2, 0 duplicates)',
      pass: e26Pass,
      evidence: { three: e26Three, two: e26Two }
    };
    console.log(`Result: ${e26Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.6'].evidence);

    // ── TEST E2.7 — ACTIVE LAYER VS VISIBLE LAYER ────────────────────────────
    console.log('\n--- TEST E2.7: Active Layer vs Visible Layer ---');
    // Ensure states ON, roads ON
    await evaluate(`(() => {
      window.__olService.toggleLayer('states', true);
      window.__olService.toggleLayer('roads', true);
    })()`);
    await sleep(300);

    // Switch active layer to roads (in React sidebar)
    await evaluate(`(() => {
      const roadBtn = document.querySelector('[data-testid="hud-layer-roads"]') || Array.from(document.querySelectorAll('.hud-layer-btn')).find(b => b.textContent?.includes('Roads'));
      if (roadBtn) roadBtn.click();
    })()`);
    await sleep(400);

    const e27Check = await evaluate(`(() => {
      const statesItem = document.querySelector('[data-testid="legend-item-states"]');
      const roadsItem = document.querySelector('[data-testid="legend-item-roads"]');
      return {
        statesVisible: !!statesItem,
        roadsVisible: !!roadsItem,
      };
    })()`);

    const e27Pass = e27Check.statesVisible && e27Check.roadsVisible;
    testMatrix['TEST E2.7'] = {
      name: 'Active Layer vs Visible Layer (Changing active layer does NOT hide visible legends)',
      pass: e27Pass,
      evidence: e27Check
    };
    console.log(`Result: ${e27Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.7'].evidence);

    // ── TEST E2.8 — RAPID TOGGLING ───────────────────────────────────────────
    console.log('\n--- TEST E2.8: Rapid Toggling (ON -> OFF -> ON -> OFF -> ON) ---');
    for (let i = 0; i < 5; i++) {
      const isVis = i % 2 === 0;
      await evaluate(`window.__olService.toggleDynamicLayer('tl_layer_1', ${isVis})`);
      await sleep(100);
    }
    await sleep(500);

    const e28Check = await evaluate(`(() => {
      const item = document.querySelector('[data-testid="legend-item-tl_layer_1"]');
      const isOlVis = window.__olService.isLayerVisible('tl_layer_1');
      const items = document.querySelectorAll('[data-testid="legend-item-tl_layer_1"]');
      return {
        itemVisible: !!item,
        isOlVis,
        itemsCount: items.length,
      };
    })()`);

    const e28Pass = e28Check.itemVisible && e28Check.isOlVis && e28Check.itemsCount === 1;
    testMatrix['TEST E2.8'] = {
      name: 'Rapid Toggling (No race conditions, final ON state consistent, exactly 1 legend item)',
      pass: e28Pass,
      evidence: e28Check
    };
    console.log(`Result: ${e28Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.8'].evidence);

    // ── TEST E2.9 — LEGEND FAILURE ISOLATION ─────────────────────────────────
    console.log('\n--- TEST E2.9: Legend Failure Isolation ---');
    // Trigger simulated image error on states legend image
    const e29Check = await evaluate(`(() => {
      const img = document.querySelector('[data-testid="legend-img-states"]');
      if (img) {
        // Dispatch synthetic error event
        img.dispatchEvent(new Event('error'));
      }
      return { imgFound: !!img };
    })()`);
    await sleep(300);

    const e29Result = await evaluate(`(() => {
      const unavailableBadge = document.querySelector('[data-testid="legend-unavailable-states"]');
      const roadsItem = document.querySelector('[data-testid="legend-item-roads"]');
      const mapCanvas = document.querySelector('.ol-map-container canvas');
      return {
        hasUnavailableBadge: !!unavailableBadge,
        roadsLegendStillRendering: !!roadsItem,
        mapStillOperational: !!mapCanvas,
      };
    })()`);

    const e29Pass = e29Result.hasUnavailableBadge && e29Result.roadsLegendStillRendering && e29Result.mapStillOperational;
    testMatrix['TEST E2.9'] = {
      name: 'Legend Failure Isolation (Unavailable legend shows badge, other legends & map unaffected)',
      pass: e29Pass,
      evidence: e29Result
    };
    console.log(`Result: ${e29Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.9'].evidence);

    // ── TEST E2.10 — NO WFS ──────────────────────────────────────────────────
    console.log('\n--- TEST E2.10: No WFS Requests During Legend Operations ---');
    const netStart = networkRequests.length;

    // Toggle dynamic layer tl_layer_1
    await evaluate(`window.__olService.toggleDynamicLayer('tl_layer_1', true)`);
    await sleep(400);

    const netRecent = networkRequests.slice(netStart);
    const recentWfsCalls = netRecent.filter(r => r.url.includes('request=GetFeature')).length;
    const recentWfsTCalls = netRecent.filter(r => r.url.includes('/wfs/transaction') || (r.method === 'POST' && r.url.includes('/wfs'))).length;

    const allGetLegendCalls = networkRequests.filter(r => r.url.includes('GetLegendGraphic')).length;
    const dynamicWfsCalls = networkRequests.filter(r => 
      r.url.includes('request=GetFeature') && 
      (r.url.includes('tl_layer_1') || r.url.includes('Example_1'))
    ).length;

    const e210Pass = allGetLegendCalls >= 5 && recentWfsCalls === 0 && recentWfsTCalls === 0 && dynamicWfsCalls === 0;
    networkAudit.legendTraffic = {
      totalGetLegendGraphicRequests: allGetLegendCalls,
      recentWfsGetFeatureRequests: recentWfsCalls,
      dynamicWfsGetFeatureRequests: dynamicWfsCalls,
      wfsTransactionRequests: recentWfsTCalls,
    };

    testMatrix['TEST E2.10'] = {
      name: 'No WFS (WMS GetLegendGraphic used, 0 WFS GetFeature, 0 WFS-T)',
      pass: e210Pass,
      evidence: networkAudit.legendTraffic
    };
    console.log(`Result: ${e210Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.10'].evidence);

    // ── TEST E2.11 — NO EXCESSIVE LEGEND REQUESTS ────────────────────────────
    console.log('\n--- TEST E2.11: No Excessive Legend Requests ---');
    const e211ReqStart = networkRequests.length;

    // Toggle same layer ON -> OFF -> ON
    await evaluate(`window.__olService.toggleDynamicLayer('Example_1', false)`);
    await sleep(300);
    await evaluate(`window.__olService.toggleDynamicLayer('Example_1', true)`);
    await sleep(500);

    const e211Recent = networkRequests.slice(e211ReqStart);
    const e211LegendReqs = e211Recent.filter(r => r.url.includes('Example_1') && r.url.includes('GetLegendGraphic'));

    // Browser cache or 1 request max
    const e211Pass = e211LegendReqs.length <= 1;
    testMatrix['TEST E2.11'] = {
      name: 'No Excessive Legend Requests (Bounded network traffic, no runaway React effect loops)',
      pass: e211Pass,
      evidence: { requestsObserved: e211LegendReqs.length }
    };
    console.log(`Result: ${e211Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.11'].evidence);

    // ── TEST E2.12 — LEGEND AFTER PAGE RELOAD ────────────────────────────────
    console.log('\n--- TEST E2.12: Legend After Page Reload ---');
    await send('Page.reload');
    await sleep(4000);

    const e212Check = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="unified-legend-panel"]');
      const items = Array.from(document.querySelectorAll('.hud-legend-item')).map(i => i.getAttribute('data-testid'));
      return {
        panelVisible: !!panel,
        itemsCount: items.length,
        hasStates: items.includes('legend-item-states'),
        hasDistricts: items.includes('legend-item-districts'),
        hasZones: items.includes('legend-item-zones'),
        hasRoads: items.includes('legend-item-roads'),
        hasStreetlights: items.includes('legend-item-streetlights'),
        noStaleDynamicTl: !items.includes('legend-item-tl_layer_1'),
        noStaleDynamicEx: !items.includes('legend-item-Example_1'),
      };
    })()`);

    const e212Pass = e212Check.panelVisible && 
                    e212Check.itemsCount === 5 && 
                    e212Check.hasStates && 
                    e212Check.hasRoads && 
                    e212Check.noStaleDynamicTl;

    testMatrix['TEST E2.12'] = {
      name: 'Legend After Page Reload (Consistent default 5 core layers, 0 stale dynamic legends)',
      pass: e212Pass,
      evidence: e212Check
    };
    console.log(`Result: ${e212Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.12'].evidence);

    // ── TEST E2.13 — CORE REGRESSION ─────────────────────────────────────────
    console.log('\n--- TEST E2.13: Core Regression ---');
    const e213Check = await evaluate(`(() => {
      const ol = window.__olService;
      const core = ['states', 'districts', 'zones', 'roads', 'streetlights'];
      const ok = core.every(l => !!ol.layers[l] && !!ol[l + 'WfsSource']);

      // Test selection and feature info availability
      const geojson = {
        type: 'Feature',
        id: 'zones.1001',
        geometry: { type: 'Polygon', coordinates: [[[77.7, 13.4], [77.8, 13.4], [77.8, 13.5], [77.7, 13.5], [77.7, 13.4]]] },
        properties: { id: 1001, name: 'North Industrial Ward', status: 'Active' }
      };
      ol.setSelectedFeature('zones', geojson.id, geojson);
      if (ol.savedSelectCallback) ol.savedSelectCallback(geojson, 'zones');

      return {
        allSourcesReady: ok,
        selectedId: ol.selectedFeatureId,
      };
    })()`);
    await sleep(400);

    const e213Panel = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="feature-info-panel"]');
      const fid = panel?.querySelector('.hud-fid-pill')?.textContent?.trim();
      return {
        featureInfoVisible: !!panel,
        fid,
      };
    })()`);

    // Clean up selection
    await evaluate(`(() => {
      window.__olService.setSelectedFeature(null, null);
      if (window.__olService.savedSelectCallback) window.__olService.savedSelectCallback(null, null);
    })()`);

    const e213Pass = e213Check.allSourcesReady && e213Panel.featureInfoVisible && e213Panel.fid === 'zones.1001';
    testMatrix['TEST E2.13'] = {
      name: 'Core Regression (Layers, vector sources, selection, and Feature Info operational)',
      pass: e213Pass,
      evidence: { ...e213Check, ...e213Panel }
    };
    console.log(`Result: ${e213Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.13'].evidence);

    // ── TEST E2.14 — DYNAMIC REGRESSION ──────────────────────────────────────
    console.log('\n--- TEST E2.14: Dynamic Regression ---');
    const e214Check = await evaluate(`(() => {
      const ol = window.__olService;
      const defs = ol.dynamicLayerDefs;
      const hasDefs = defs && defs.size > 0;
      return {
        hasDynamicLayerDefs: hasDefs,
        defsCount: defs ? defs.size : 0,
      };
    })()`);

    const e214Pass = e214Check.hasDynamicLayerDefs && e214Check.defsCount >= 2;
    testMatrix['TEST E2.14'] = {
      name: 'Dynamic Regression (Layer discovery, definitions, and rendering ready)',
      pass: e214Pass,
      evidence: e214Check
    };
    console.log(`Result: ${e214Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.14'].evidence);

    // ── TEST E2.15 — DIFFERENT DYNAMIC LAYER ─────────────────────────────────
    console.log('\n--- TEST E2.15: Different Dynamic Layer Schema Adaptation ---');
    // Turn Example_1 ON and inspect its legend graphic
    await evaluate(`window.__olService.toggleDynamicLayer('Example_1', true)`);
    await sleep(600);

    const e215Check = await evaluate(`(() => {
      const item = document.querySelector('[data-testid="legend-item-Example_1"]');
      const img = document.querySelector('[data-testid="legend-img-Example_1"]');
      return {
        itemVisible: !!item,
        hasExample1Src: img?.getAttribute('src')?.includes('ward%3AExample_1'),
        tag: item?.querySelector('.hud-legend-item-tag')?.textContent?.trim(),
      };
    })()`);

    await evaluate(`window.__olService.toggleDynamicLayer('Example_1', false)`);

    const e215Pass = e215Check.itemVisible && e215Check.hasExample1Src && e215Check.tag === 'Dynamic';
    testMatrix['TEST E2.15'] = {
      name: 'Different Dynamic Layer (Example_1 handled completely dynamically)',
      pass: e215Pass,
      evidence: e215Check
    };
    console.log(`Result: ${e215Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.15'].evidence);

    // ── TEST E2.16 — CONSOLE AUDIT ───────────────────────────────────────────
    console.log('\n--- TEST E2.16: Console Audit ---');
    const realErrors = consoleMessages.filter(m => m.type === 'error' && !m.text.includes('favicon'));
    const realExceptions = exceptions.filter(e => !e.text?.includes('favicon'));

    const e216Pass = realErrors.length === 0 && realExceptions.length === 0;
    testMatrix['TEST E2.16'] = {
      name: 'Console Audit (0 uncaught exceptions, 0 unhandled promise rejections, 0 console errors)',
      pass: e216Pass,
      evidence: { errorCount: realErrors.length, exceptionCount: realExceptions.length, errors: realErrors }
    };
    console.log(`Result: ${e216Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.16'].evidence);

    // ── TEST E2.17 — DUPLICATE UI / STATE AUDIT ──────────────────────────────
    console.log('\n--- TEST E2.17: Duplicate UI / State Audit ---');
    // Perform multiple toggle and switch cycles
    for (let i = 0; i < 4; i++) {
      await evaluate(`window.__olService.toggleLayer('roads', false)`);
      await sleep(100);
      await evaluate(`window.__olService.toggleLayer('roads', true)`);
      await sleep(100);
      await evaluate(`window.__olService.toggleDynamicLayer('tl_layer_1', true)`);
      await sleep(100);
      await evaluate(`window.__olService.toggleDynamicLayer('tl_layer_1', false)`);
      await sleep(100);
    }
    await sleep(400);

    const e217Check = await evaluate(`(() => {
      const panels = document.querySelectorAll('[data-testid="unified-legend-panel"]');
      const items = Array.from(document.querySelectorAll('.hud-legend-item')).map(i => i.getAttribute('data-testid'));
      return {
        panelsCount: panels.length,
        itemsCount: items.length,
        noDuplicateItems: new Set(items).size === items.length,
      };
    })()`);

    const e217Pass = e217Check.panelsCount === 1 && e217Check.noDuplicateItems;
    testMatrix['TEST E2.17'] = {
      name: 'Duplicate UI / State Audit (Exactly 1 legend panel, 0 duplicate items across cycles)',
      pass: e217Pass,
      evidence: e217Check
    };
    console.log(`Result: ${e217Pass ? 'PASS' : 'FAIL'}`, testMatrix['TEST E2.17'].evidence);

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
  console.log(`OVERALL STAGE E2 STATUS: ${allPass ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  return { allPass, testMatrix, networkAudit };
}

runStageE2Validation().then(({ allPass }) => {
  process.exit(allPass ? 0 : 1);
}).catch(err => {
  console.error('Fatal Validation Runner Error:', err);
  process.exit(1);
});
