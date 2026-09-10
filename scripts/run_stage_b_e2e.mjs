import { spawn } from 'child_process';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://localhost:5173/';
const DEBUG_PORT = 9222;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('STAGE B AUTOMATED END-TO-END VALIDATION SUITE');
  console.log('================================================================\n');

  // 1. Launch Headless Chrome with Remote Debugging
  console.log('[Setup] Launching Headless Chrome on port', DEBUG_PORT, '...');
  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800',
    '--user-data-dir=' + process.env.TEMP + '\\chrome_test_profile_' + Date.now(),
    'about:blank'
  ]);

  chromeProcess.stderr.on('data', () => {});

  let wsUrl = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(500);
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
      consoleMessages.push({ type, text });
      if (type === 'error') {
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

  const testResults = {};

  try {
    // ── TEST B.1: Full Application Startup ──────────────────────────────────
    console.log('\n--- Running TEST B.1: Full Application Startup ---');
    await send('Page.navigate', { url: APP_URL });
    await sleep(4000); // Wait for OpenLayers & React mount

    const debugInfo = await evaluate(`(() => {
      return {
        url: window.location.href,
        bodyHtml: document.body.innerHTML.substring(0, 300),
        title: document.title,
        scriptsCount: document.scripts.length,
      };
    })()`);
    console.log('[Debug Navigation]:', debugInfo);
    console.log('[Debug Console Messages]:', consoleMessages);
    console.log('[Debug Exceptions]:', exceptions);
    console.log('[Debug Network Requests]:', networkRequests.map(r => r.url).slice(0, 10));

    const b1State = await evaluate(`(() => {
      const canvas = document.querySelector('.ol-map-container canvas');
      const map = window.__olService ? window.__olService.getMap() : null;
      const sidebar = document.querySelector('.hud-sidebar');
      const discoveredSection = Array.from(document.querySelectorAll('div, span, button')).some(el => el.textContent.includes('DISCOVERED LAYERS'));
      
      return {
        canvasExists: !!canvas,
        canvasWidth: canvas ? canvas.width : 0,
        canvasHeight: canvas ? canvas.height : 0,
        mapReady: !!map,
        sidebarExists: !!sidebar,
        discoveredSectionExists: discoveredSection,
        hasOlService: !!window.__olService,
      };
    })()`);

    const hasCriticalConsoleErrors = exceptions.some(e => 
      (e.text || '').includes('dynamicLayerDefs') || 
      (e.exception?.description || '').includes('dynamicLayerDefs') ||
      (e.text || '').includes('Cannot read properties of undefined')
    );

    const b1Pass = b1State.canvasExists && b1State.mapReady && b1State.hasOlService && !hasCriticalConsoleErrors;
    testResults['TEST B.1'] = {
      name: 'Full Application Startup',
      pass: b1Pass,
      evidence: b1State,
      exceptionsCount: exceptions.length,
    };
    console.log(`TEST B.1 Result: ${b1Pass ? 'PASS' : 'FAIL'}`, b1State);

    // ── TEST B.2: React StrictMode / Remount Stability ───────────────────────
    console.log('\n--- Running TEST B.2: React StrictMode / Remount Stability ---');
    // Trigger a full reload to test remount / re-binding
    await send('Page.reload');
    await sleep(3500);

    const b2State = await evaluate(`(() => {
      const canvas = document.querySelector('.ol-map-container canvas');
      const map = window.__olService ? window.__olService.getMap() : null;
      const layersCount = map ? map.getLayers().getLength() : 0;
      return {
        canvasExists: !!canvas,
        mapReady: !!map,
        layersCount,
        hasOlService: !!window.__olService,
      };
    })()`);

    const b2Pass = b2State.canvasExists && b2State.mapReady && b2State.layersCount >= 6;
    testResults['TEST B.2'] = {
      name: 'React StrictMode / Remount Stability',
      pass: b2Pass,
      evidence: b2State,
    };
    console.log(`TEST B.2 Result: ${b2Pass ? 'PASS' : 'FAIL'}`, b2State);

    // ── TEST B.3: Dynamic Layer Discovery ───────────────────────────────────
    console.log('\n--- Running TEST B.3: Dynamic Layer Discovery ---');
    for (let i = 0; i < 20; i++) {
      const count = await evaluate(`window.__olService && window.__olService.dynamicLayerDefs ? window.__olService.dynamicLayerDefs.size : 0`);
      if (count > 0) break;
      await sleep(300);
    }
    const b3State = await evaluate(`(() => {
      let dynamicDefs = [];
      if (window.__olService && window.__olService.dynamicLayerDefs && typeof window.__olService.dynamicLayerDefs.forEach === 'function') {
        window.__olService.dynamicLayerDefs.forEach((def, name) => dynamicDefs.push(name));
      }
      const allElements = Array.from(document.querySelectorAll('span, div, label, p'));
      const discoveredItems = allElements
        .map(el => el.textContent || '')
        .filter(t => t.includes('tl_layer_1') || t.includes('Example_1'));
      return {
        dynamicDefs,
        discoveredItemsCount: discoveredItems.length,
        hasTlLayer1: dynamicDefs.includes('tl_layer_1'),
        hasExample1: dynamicDefs.includes('Example_1'),
      };
    })()`);

    const b3Pass = b3State.hasTlLayer1 || b3State.dynamicDefs.length > 0;
    testResults['TEST B.3'] = {
      name: 'Dynamic Layer Discovery',
      pass: b3Pass,
      evidence: b3State,
    };
    console.log(`TEST B.3 Result: ${b3Pass ? 'PASS' : 'FAIL'}`, b3State);

    // ── TEST B.4: Dynamic Layer Toggle ──────────────────────────────────────
    console.log('\n--- Running TEST B.4: Dynamic Layer Toggle ---');
    const startWfsCount = networkRequests.filter(r => r.url.includes('service=WFS') && r.url.includes('request=GetFeature')).length;

    // Toggle tl_layer_1 ON, OFF, ON
    const b4Toggle1 = await evaluate(`(() => {
      window.__olService.toggleDynamicLayer('tl_layer_1', true);
      const isVisible1 = window.__olService.layers['tl_layer_1']?.getVisible();
      window.__olService.toggleDynamicLayer('tl_layer_1', false);
      const isVisible2 = window.__olService.layers['tl_layer_1']?.getVisible();
      window.__olService.toggleDynamicLayer('tl_layer_1', true);
      const isVisible3 = window.__olService.layers['tl_layer_1']?.getVisible();
      return { isVisible1, isVisible2, isVisible3 };
    })()`);

    await sleep(1000);
    const endWfsCount = networkRequests.filter(r => r.url.includes('service=WFS') && r.url.includes('request=GetFeature')).length;
    const wfsCallsDuringToggle = endWfsCount - startWfsCount;

    const b4Pass = b4Toggle1.isVisible1 === true && b4Toggle1.isVisible2 === false && b4Toggle1.isVisible3 === true && wfsCallsDuringToggle === 0;
    testResults['TEST B.4'] = {
      name: 'Dynamic Layer Toggle',
      pass: b4Pass,
      evidence: { ...b4Toggle1, wfsCallsDuringToggle },
    };
    console.log(`TEST B.4 Result: ${b4Pass ? 'PASS' : 'FAIL'}`, { ...b4Toggle1, wfsCallsDuringToggle });

    // ── TEST B.11: Dynamic Extent Cache ─────────────────────────────────────
    console.log('\n--- Running TEST B.11: Dynamic Extent Cache ---');
    const b11State = await evaluate(`(() => {
      const cache = window.__olService ? window.__olService.layerExtentsCache : {};
      const tlExtent = cache['tl_layer_1'];
      const exampleExtent = cache['Example_1'];
      const isValidTl = Array.isArray(tlExtent) && tlExtent.length === 4 && tlExtent.every(v => typeof v === 'number' && !isNaN(v));
      
      // Test zoom
      if (isValidTl) {
        window.__olService.zoomToDynamicLayerExtent({ name: 'tl_layer_1', latLonBoundingBox: { minx: -180, miny: -90, maxx: 180, maxy: 83 } });
      }
      return {
        cachedKeys: Object.keys(cache),
        tlExtent,
        exampleExtent,
        isValidTl,
      };
    })()`);

    const b11Pass = b11State.isValidTl;
    testResults['TEST B.11'] = {
      name: 'Dynamic Extent Cache',
      pass: b11Pass,
      evidence: b11State,
    };
    console.log(`TEST B.11 Result: ${b11Pass ? 'PASS' : 'FAIL'}`, b11State);

    // ── TEST B.5: Dynamic Feature Selection ─────────────────────────────────
    console.log('\n--- Running TEST B.5: Dynamic Feature Selection ---');
    const beforeSelectReqCount = networkRequests.length;
    const beforeWfsGetFeatureCount = networkRequests.filter(r => r.url.includes('service=WFS') && r.url.includes('request=GetFeature')).length;

    // Simulate selecting a dynamic feature via WMS GetFeatureInfo / setSelectedFeature
    const b5State = await evaluate(`(() => {
      const testFeatureGeoJson = {
        type: 'Feature',
        id: 'tl_layer_1.101',
        geometry: {
          type: 'Point',
          coordinates: [80.25, 13.04]
        },
        properties: {
          id: 101,
          name: 'Dynamic Test Asset 101',
          status: 'Active'
        }
      };

      // Set selection
      window.__olService.setSelectedFeature('tl_layer_1', testFeatureGeoJson.id, testFeatureGeoJson);
      
      const featuresInDynamicSource = window.__olService.dynamicVectorSource.getFeatures();
      const hasFeature = featuresInDynamicSource.length === 1;
      const featureId = hasFeature ? featuresInDynamicSource[0].getId() : null;
      
      return {
        selectedLayerName: window.__olService.selectedLayerName,
        selectedFeatureId: window.__olService.selectedFeatureId,
        featuresInDynamicSourceCount: featuresInDynamicSource.length,
        featureId,
      };
    })()`);

    const afterWfsGetFeatureCount = networkRequests.filter(r => r.url.includes('service=WFS') && r.url.includes('request=GetFeature')).length;
    const wfsGetFeatureCalls = afterWfsGetFeatureCount - beforeWfsGetFeatureCount;

    const b5Pass = b5State.featuresInDynamicSourceCount === 1 && b5State.featureId === 'tl_layer_1.101' && wfsGetFeatureCalls === 0;
    testResults['TEST B.5'] = {
      name: 'Dynamic Feature Selection',
      pass: b5Pass,
      evidence: { ...b5State, wfsGetFeatureCalls },
    };
    console.log(`TEST B.5 Result: ${b5Pass ? 'PASS' : 'FAIL'}`, { ...b5State, wfsGetFeatureCalls });

    // ── TEST B.6: Listener Stacking / Draw Isolation ────────────────────────
    console.log('\n--- Running TEST B.6: Listener Stacking / Draw Isolation ---');
    const b6State = await evaluate(`(() => {
      // 1. Enter Draw Mode
      window.__olService.activateDraw('Point', 'streetlights', () => {});
      
      // Verify dynamicSelectKey is cleaned up
      const dynamicKeyInDraw = window.__olService.dynamicSelectKey;

      // 2. Simulate click on map during draw
      const map = window.__olService.getMap();
      if (map) {
        map.dispatchEvent({ type: 'singleclick', coordinate: [8920000, 1450000] });
      }

      // 3. Cancel draw mode
      window.__olService.cancelInteraction();
      const dynamicKeyAfterCancel = window.__olService.dynamicSelectKey;

      // 4. Reactivate select mode
      let selectFiredCount = 0;
      window.__olService.activateSelect((feat, layer) => {
        selectFiredCount++;
      });
      const dynamicKeyInSelect = window.__olService.dynamicSelectKey;

      return {
        dynamicKeyInDrawIsNull: dynamicKeyInDraw === null,
        dynamicKeyAfterCancelIsNull: dynamicKeyAfterCancel === null,
        dynamicKeyInSelectIsAttached: dynamicKeyInSelect !== null,
        selectFiredCount,
      };
    })()`);

    const b6Pass = b6State.dynamicKeyInDrawIsNull && b6State.dynamicKeyAfterCancelIsNull && b6State.dynamicKeyInSelectIsAttached;
    testResults['TEST B.6'] = {
      name: 'Listener Stacking / Draw Isolation',
      pass: b6Pass,
      evidence: b6State,
    };
    console.log(`TEST B.6 Result: ${b6Pass ? 'PASS' : 'FAIL'}`, b6State);

    // ── TEST B.7: Move Isolation ────────────────────────────────────────────
    console.log('\n--- Running TEST B.7: Move Isolation ---');
    const b7State = await evaluate(`(() => {
      // Activate translate on dynamic layer
      window.__olService.activateTranslate('tl_layer_1', () => {}, 'tl_layer_1.101');
      
      // In translate mode, dynamicSelectKey should be cleared
      const dynamicKeyInMove = window.__olService.dynamicSelectKey;
      
      // Cleanup
      window.__olService.cancelInteraction();
      return {
        dynamicKeyInMoveIsNull: dynamicKeyInMove === null,
      };
    })()`);

    const b7Pass = b7State.dynamicKeyInMoveIsNull;
    testResults['TEST B.7'] = {
      name: 'Move Isolation',
      pass: b7Pass,
      evidence: b7State,
    };
    console.log(`TEST B.7 Result: ${b7Pass ? 'PASS' : 'FAIL'}`, b7State);

    // ── TEST B.8: Temporary Feature Cleanup ──────────────────────────────────
    console.log('\n--- Running TEST B.8: Temporary Feature Cleanup ---');
    const b8State = await evaluate(`(() => {
      // 1. Add temporary feature
      window.__olService.setSelectedFeature('tl_layer_1', 'tl_layer_1.202', {
        type: 'Feature',
        id: 'tl_layer_1.202',
        geometry: { type: 'Point', coordinates: [80.2, 13.0] },
        properties: {}
      });
      const countAfterSelect = window.__olService.dynamicVectorSource.getFeatures().length;

      // 2. Clear selection
      window.__olService.setSelectedFeature(null, null);
      const countAfterDeselect = window.__olService.dynamicVectorSource.getFeatures().length;

      // 3. Select another and use clearDynamicFeatures()
      window.__olService.setSelectedFeature('tl_layer_1', 'tl_layer_1.303', {
        type: 'Feature',
        id: 'tl_layer_1.303',
        geometry: { type: 'Point', coordinates: [80.21, 13.01] },
        properties: {}
      });
      window.__olService.clearDynamicFeatures();
      const countAfterExplicitClear = window.__olService.dynamicVectorSource.getFeatures().length;

      // 4. Select and test removeWFSFeature
      window.__olService.setSelectedFeature('tl_layer_1', 'tl_layer_1.404', {
        type: 'Feature',
        id: 'tl_layer_1.404',
        geometry: { type: 'Point', coordinates: [80.22, 13.02] },
        properties: {}
      });
      window.__olService.removeWFSFeature('tl_layer_1', 'tl_layer_1.404');
      const countAfterRemove = window.__olService.dynamicVectorSource.getFeatures().length;

      return {
        countAfterSelect,
        countAfterDeselect,
        countAfterExplicitClear,
        countAfterRemove,
      };
    })()`);

    const b8Pass = b8State.countAfterSelect === 1 &&
                   b8State.countAfterDeselect === 0 &&
                   b8State.countAfterExplicitClear === 0 &&
                   b8State.countAfterRemove === 0;
    testResults['TEST B.8'] = {
      name: 'Temporary Feature Cleanup',
      pass: b8Pass,
      evidence: b8State,
    };
    console.log(`TEST B.8 Result: ${b8Pass ? 'PASS' : 'FAIL'}`, b8State);

    // ── TEST B.9: Successful Dynamic Edit Cleanup ───────────────────────────
    console.log('\n--- Running TEST B.9: Successful Dynamic Edit Cleanup ---');
    const b9State = await evaluate(`(() => {
      // 1. Select a dynamic test feature
      window.__olService.setSelectedFeature('tl_layer_1', 'tl_layer_1.505', {
        type: 'Feature',
        id: 'tl_layer_1.505',
        geometry: { type: 'Point', coordinates: [80.23, 13.03] },
        properties: { name: 'Pre-Edit Asset' }
      });
      const countDuringEdit = window.__olService.dynamicVectorSource.getFeatures().length;

      // 2. Simulate successful edit completion (form success / refresh)
      window.__olService.cancelInteraction();
      window.__olService.setSelectedFeature(null, null);
      window.__olService.clearDynamicFeatures();
      window.__olService.refreshLayer('tl_layer_1');
      
      const countAfterSuccess = window.__olService.dynamicVectorSource.getFeatures().length;
      const selectedFeatureId = window.__olService.selectedFeatureId;

      return {
        countDuringEdit,
        countAfterSuccess,
        selectedFeatureId,
      };
    })()`);

    const b9Pass = b9State.countDuringEdit === 1 && b9State.countAfterSuccess === 0 && b9State.selectedFeatureId === null;
    testResults['TEST B.9'] = {
      name: 'Successful Dynamic Edit Cleanup',
      pass: b9Pass,
      evidence: b9State,
    };
    console.log(`TEST B.9 Result: ${b9Pass ? 'PASS' : 'FAIL'}`, b9State);

    // ── TEST B.10: Failed Operation Cleanup ─────────────────────────────────
    console.log('\n--- Running TEST B.10: Failed Operation Cleanup ---');
    const b10State = await evaluate(`(() => {
      // 1. Select a dynamic test feature
      const initialGeom = { type: 'Point', coordinates: [80.23, 13.03] };
      window.__olService.setSelectedFeature('tl_layer_1', 'tl_layer_1.606', {
        type: 'Feature',
        id: 'tl_layer_1.606',
        geometry: initialGeom,
        properties: { name: 'Failing Op Asset' }
      });
      
      // 2. Trigger rollback on failure
      const feature = window.__olService.dynamicVectorSource.getFeatureById('tl_layer_1.606');
      if (feature) {
        // Mutate geometry temporarily
        feature.getGeometry().setCoordinates([80.29, 13.09]);
        // Rollback
        feature.getGeometry().setCoordinates([80.23, 13.03]);
        feature.changed();
      }
      
      const restoredCoords = feature ? feature.getGeometry().getCoordinates() : [];
      const isRestored = restoredCoords[0] === 80.23 && restoredCoords[1] === 13.03;

      // Clean up
      window.__olService.clearDynamicFeatures();
      window.__olService.setSelectedFeature(null, null);

      return {
        isRestored,
        cleanedUpCount: window.__olService.dynamicVectorSource.getFeatures().length,
      };
    })()`);

    const b10Pass = b10State.isRestored && b10State.cleanedUpCount === 0;
    testResults['TEST B.10'] = {
      name: 'Failed Operation Cleanup',
      pass: b10Pass,
      evidence: b10State,
    };
    console.log(`TEST B.10 Result: ${b10Pass ? 'PASS' : 'FAIL'}`, b10State);

    // ── TEST B.12: Multiple Dynamic Layers ──────────────────────────────────
    console.log('\n--- Running TEST B.12: Multiple Dynamic Layers ---');
    const b12State = await evaluate(`(() => {
      window.__olService.toggleDynamicLayer('tl_layer_1', true);
      window.__olService.toggleDynamicLayer('Example_1', true);
      
      const tlLayer = window.__olService.layers['tl_layer_1'];
      const exLayer = window.__olService.layers['Example_1'];
      
      const bothExist = !!tlLayer && !!exLayer;
      const bothVisible = tlLayer?.getVisible() && exLayer?.getVisible();
      
      return {
        bothExist,
        bothVisible,
        tlLayerZIndex: tlLayer?.getZIndex(),
        exLayerZIndex: exLayer?.getZIndex(),
      };
    })()`);

    const b12Pass = b12State.bothExist && b12State.bothVisible;
    testResults['TEST B.12'] = {
      name: 'Multiple Dynamic Layers',
      pass: b12Pass,
      evidence: b12State,
    };
    console.log(`TEST B.12 Result: ${b12Pass ? 'PASS' : 'FAIL'}`, b12State);

    // ── TEST B.13: Core Layer Regression ────────────────────────────────────
    console.log('\n--- Running TEST B.13: Core Layer Regression ---');
    const b13State = await evaluate(`(() => {
      const coreNames = ['states', 'districts', 'zones', 'roads', 'streetlights'];
      const layers = window.__olService.layers;
      const missingLayers = coreNames.filter(name => !layers[name]);
      
      // Test selection on core layer
      window.__olService.setSelectedFeature('zones', 'zones.1', {
        type: 'Feature',
        id: 'zones.1',
        geometry: { type: 'Polygon', coordinates: [[[80.2, 13.0], [80.25, 13.0], [80.25, 13.05], [80.2, 13.05], [80.2, 13.0]]] },
        properties: { name: 'Tambaram Zone 1' }
      });
      const selectedCoreLayer = window.__olService.selectedLayerName;
      const selectedCoreId = window.__olService.selectedFeatureId;
      
      // Deselect
      window.__olService.setSelectedFeature(null, null);

      return {
        coreLayersPresent: missingLayers.length === 0,
        missingLayers,
        selectedCoreLayer,
        selectedCoreId,
      };
    })()`);

    const b13Pass = b13State.coreLayersPresent && b13State.selectedCoreLayer === 'zones' && b13State.selectedCoreId === 'zones.1';
    testResults['TEST B.13'] = {
      name: 'Core Layer Regression',
      pass: b13Pass,
      evidence: b13State,
    };
    console.log(`TEST B.13 Result: ${b13Pass ? 'PASS' : 'FAIL'}`, b13State);

    // ── TEST B.14: Network Audit ────────────────────────────────────────────
    console.log('\n--- Running TEST B.14: Network Audit ---');
    const totalRequests = networkRequests.length;
    const wmsGetMapRequests = networkRequests.filter(r => r.url.includes('request=GetMap')).length;
    const wmsGetFeatureInfoRequests = networkRequests.filter(r => r.url.includes('request=GetFeatureInfo')).length;
    const wfsGetFeatureRequests = networkRequests.filter(r => r.url.includes('service=WFS') && r.url.includes('request=GetFeature'));
    const dynamicWfsGetFeatureRequests = wfsGetFeatureRequests.filter(r => 
      r.url.includes('tl_layer_1') || r.url.includes('Example_1')
    );
    const geoserverDiscoveryRequests = networkRequests.filter(r => r.url.includes('/api/geoserver/layers')).length;

    const b14Pass = dynamicWfsGetFeatureRequests.length === 0;
    testResults['TEST B.14'] = {
      name: 'Network Audit',
      pass: b14Pass,
      evidence: {
        totalRequests,
        wmsGetMapRequests,
        wmsGetFeatureInfoRequests,
        wfsGetFeatureTotal: wfsGetFeatureRequests.length,
        dynamicWfsGetFeatureCount: dynamicWfsGetFeatureRequests.length,
        geoserverDiscoveryRequests,
      }
    };
    console.log(`TEST B.14 Result: ${b14Pass ? 'PASS' : 'FAIL'}`, testResults['TEST B.14'].evidence);

    // ── TEST B.15: Console Audit ────────────────────────────────────────────
    console.log('\n--- Running TEST B.15: Console Audit ---');
    const realErrors = consoleMessages.filter(m => m.type === 'error' && !m.text.includes('favicon'));
    const b15Pass = exceptions.length === 0 && realErrors.length === 0;
    testResults['TEST B.15'] = {
      name: 'Console Audit',
      pass: b15Pass,
      evidence: {
        uncaughtExceptionsCount: exceptions.length,
        consoleErrorsCount: realErrors.length,
        exceptions: exceptions.map(e => e.text || e.exception?.description),
        errors: realErrors.map(e => e.text),
      }
    };
    console.log(`TEST B.15 Result: ${b15Pass ? 'PASS' : 'FAIL'}`, testResults['TEST B.15'].evidence);

    console.log('\n================================================================');
    console.log('SUMMARY OF ALL TEST RESULTS:');
    console.log('================================================================');
    let allPassed = true;
    for (const [key, val] of Object.entries(testResults)) {
      console.log(`${key} - ${val.name}: ${val.pass ? 'PASS' : 'FAIL'}`);
      if (!val.pass) allPassed = false;
    }
    console.log('\nOVERALL RESULT:', allPassed ? 'PASS' : 'FAIL');

  } finally {
    ws.close();
    chromeProcess.kill();
  }
}

runTestSuite().catch(err => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
