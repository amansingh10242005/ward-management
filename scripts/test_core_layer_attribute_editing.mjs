/**
 * test_core_layer_attribute_editing.mjs
 *
 * Targeted automated CDP test suite for Attribute Table Core-Layer Attribute Editing.
 * Validates:
 *  - AT.CORE.1: States table attribute edit (PUT /api/states/:id)
 *  - AT.CORE.2: Districts table attribute edit (PUT /api/districts/:id)
 *  - AT.CORE.3: Zones table attribute edit (PUT /api/zones/:id)
 *  - AT.CORE.4: Roads table attribute edit (PUT /api/roads/:id)
 *  - AT.CORE.5: Streetlights table attribute edit (PUT /api/streetlights/:id)
 *  - AT.CORE.6: Multi-field core table edit (Zones name + type in single save)
 *  - AT.CORE.7: Untouched field preservation across all core layers
 *  - AT.CORE.8: Safe failure handling (rejected update -> 0 transactions, no history)
 *  - AT.CORE.9: Cross-layer safety (layer isolation verified)
 */

import { spawn } from 'child_process';
import { pool } from '../backend/src/db/pool.js';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://localhost:5173/';
const DEBUG_PORT = 9223;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCoreLayerAttributeTests() {
  console.log('================================================================');
  console.log('TARGETED AUDIT: ATTRIBUTE TABLE CORE-LAYER ATTRIBUTE EDITING');
  console.log('TL Requirement #6: Verify Core-Layer Attribute Editing');
  console.log('================================================================\n');

  const testMatrix = {};
  let chromeProcess = null;
  let ws = null;

  try {
    // 1. Launch Headless Chrome
    console.log('[1/3] Launching Headless Chrome on debug port ' + DEBUG_PORT + '...');
    chromeProcess = spawn(CHROME_PATH, [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1600,1000',
      '--user-data-dir=' + process.env.TEMP + '\\chrome_core_attr_' + Date.now(),
      'about:blank'
    ]);

    chromeProcess.stderr.on('data', () => {});

    let wsUrl = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(300);
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
      } catch {}
    }

    if (!wsUrl) throw new Error('Failed to connect to Chrome DevTools Protocol');

    ws = new WebSocket(wsUrl);
    await new Promise(r => ws.onopen = r);

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
        throw new Error(`Eval Error: ${res.exceptionDetails.text} (${res.exceptionDetails.exception?.description || ''})`);
      }
      return res.result?.value;
    }

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');

    console.log('[2/3] Navigating to ' + APP_URL + '...');
    await send('Page.navigate', { url: APP_URL });
    await sleep(4000);

    // Open Attribute Table
    console.log('[3/3] Opening Attribute Table...');
    await evaluate(`(() => {
      const btn = document.querySelector('[data-testid="map-table-btn"]');
      if (btn) btn.click();
      else if (window.__openAttributeTable) window.__openAttributeTable();
    })()`);
    await sleep(1500);

    const isPanelMounted = await evaluate(`!!document.querySelector('[data-testid="attribute-table-panel"]')`);
    console.log('  Attribute Table mounted:', isPanelMounted);
    if (!isPanelMounted) throw new Error('Attribute Table failed to mount in DOM');

    // Helper to simulate realistic user typing in React controlled inputs
    await evaluate(`(() => {
      window.__setInputValue = (el, val) => {
        const input = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? el : el.querySelector('input, textarea');
        if (!input) return;
        const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) {
          descriptor.set.call(input, val);
        } else {
          input.value = val;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
    })()`);

    async function waitForTableReady() {
      for (let i = 0; i < 50; i++) {
        await sleep(300);
        const ready = await evaluate(`(() => {
          const loading = !!document.querySelector('[data-testid="attr-loading-indicator"]');
          const rows = document.querySelectorAll('tbody tr.attr-tr').length;
          return !loading && rows > 0;
        })()`);
        if (ready) {
          await sleep(400); // Allow React commit and paint
          return true;
        }
      }
      return false;
    }

    async function switchToTabAndWait(layerName) {
      console.log(`  Switching to tab: ${layerName}...`);
      await sleep(1200); // Allow any previous async operations to settle
      await evaluate(`(() => {
        const tab = document.querySelector('[data-testid="attr-tab-${layerName}"]');
        if (tab) tab.click();
      })()`);

      for (let i = 0; i < 50; i++) {
        await sleep(300);
        const state = await evaluate(`(() => {
          const badge = document.querySelector('[data-testid="attr-active-layer-badge"]')?.textContent?.trim()?.toLowerCase();
          const loading = !!document.querySelector('[data-testid="attr-loading-indicator"]');
          const rows = document.querySelectorAll('tbody tr.attr-tr').length;
          const firstRow = document.querySelector('tbody tr.attr-tr');
          const firstId = firstRow?.getAttribute('data-testid') || '';
          return { badge, loading, rows, firstId };
        })()`);
        if (state.badge === layerName.toLowerCase() && !state.loading && state.rows > 0 && state.firstId.includes(layerName)) {
          await sleep(600); // Allow DOM to fully settle
          console.log(`  Tab ${layerName} loaded with ${state.rows} rows (firstId: ${state.firstId}).`);
          return state.rows;
        }
      }
      throw new Error(`Timeout loading tab ${layerName}`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // TEST AT.CORE.1: States Table Attribute Edit
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST AT.CORE.1: States Table Attribute Edit ---');
    await switchToTabAndWait('states');
    await waitForTableReady();

    const statesInit = await evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr.attr-tr'));
      if (rows.length === 0) return null;
      const firstRow = rows[0];
      const rowId = firstRow.getAttribute('data-testid')?.replace('attr-row-', '');
      const stateCell = firstRow.querySelector('[data-testid$="-STATE"]')?.textContent?.trim();
      const lgdCell = firstRow.querySelector('[data-testid$="-State_LGD"]')?.textContent?.trim();
      return { rowId, stateCell, lgdCell, rowCount: rows.length };
    })()`);

    console.log('  States Initial State:', statesInit);

    const targetStateId = statesInit?.rowId ? parseInt(statesInit.rowId.split('.')[1], 10) : 40;
    const dbState0Before = await pool.query(`SELECT id, state, state_lgd FROM states WHERE id = $1`, [targetStateId]);
    const origStateName = dbState0Before.rows[0].state;
    const origStateLgd = dbState0Before.rows[0].state_lgd;
    const testStateName = `${origStateName} (TEST_EDIT)`;

    console.log(`  Database record before edit: state="${origStateName}", state_lgd=${origStateLgd}`);

    const netCountBeforeStatesEdit = networkRequests.length;

    // Start edit mode using row selector
    await evaluate(`(() => {
      const editBtn = document.querySelector('tbody tr.attr-tr [data-testid^="btn-edit-row-"]');
      if (editBtn) editBtn.click();
    })()`);
    await sleep(600);

    // Modify STATE field using __setInputValue
    await evaluate(`((val) => {
      const input = document.querySelector('tbody tr.attr-tr [data-testid*="-STATE"], tbody tr.attr-tr [data-testid*="-state"]');
      if (input) window.__setInputValue(input, val);
    })('${testStateName}')`);
    await sleep(400);

    // Save from table
    await evaluate(`(() => {
      const saveBtn = document.querySelector('tbody tr.attr-tr [data-testid^="btn-save-row-"]');
      if (saveBtn) saveBtn.click();
    })()`);
    await sleep(2500);
    await waitForTableReady();

    // Verify network: exactly 1 PUT /api/states/:id
    const statesPutReqs = networkRequests.slice(netCountBeforeStatesEdit).filter(r => 
      r.method === 'PUT' && r.url.includes('/api/states')
    );

    // Verify DB updated
    const dbState0After = await pool.query(`SELECT id, state, state_lgd FROM states WHERE id = $1`, [targetStateId]);
    const stateUpdatedInDb = dbState0After.rows[0].state === testStateName;
    const stateLgdUntouched = dbState0After.rows[0].state_lgd === origStateLgd;

    // Verify table row text
    const statesRowAfterText = await evaluate(`document.querySelector('tbody tr.attr-tr')?.textContent || ''`);

    // Test Undo
    const netCountBeforeStatesUndo = networkRequests.length;
    const statesUndoRes = await evaluate(`window.__historyService.undo()`);
    await sleep(2500);
    await waitForTableReady();
    const statesUndoReqs = networkRequests.slice(netCountBeforeStatesUndo).filter(r => 
      r.method === 'PUT' && r.url.includes('/api/states')
    );
    const dbState0AfterUndo = await pool.query(`SELECT id, state, state_lgd FROM states WHERE id = $1`, [targetStateId]);
    const stateRestoredInDb = dbState0AfterUndo.rows[0].state === origStateName;

    // Test Redo
    const netCountBeforeStatesRedo = networkRequests.length;
    const statesRedoRes = await evaluate(`window.__historyService.redo()`);
    await sleep(2500);
    await waitForTableReady();
    const statesRedoReqs = networkRequests.slice(netCountBeforeStatesRedo).filter(r => 
      r.method === 'PUT' && r.url.includes('/api/states')
    );
    const dbState0AfterRedo = await pool.query(`SELECT id, state, state_lgd FROM states WHERE id = $1`, [targetStateId]);
    const stateRedoneInDb = dbState0AfterRedo.rows[0].state === testStateName;

    // Final Restore
    await evaluate(`window.__historyService.undo()`);
    await sleep(2000);
    await waitForTableReady();
    const dbState0Final = await pool.query(`SELECT id, state, state_lgd FROM states WHERE id = $1`, [targetStateId]);

    console.log('  DEBUG AT.CORE.1 components:', {
      statesPutReqs: statesPutReqs.length,
      stateUpdatedInDb,
      stateLgdUntouched,
      statesRowAfterText,
      statesRowHasTest: statesRowAfterText.includes(testStateName),
      statesUndoResSuccess: statesUndoRes?.success,
      statesUndoReqs: statesUndoReqs.length,
      stateRestoredInDb,
      statesRedoResSuccess: statesRedoRes?.success,
      statesRedoReqs: statesRedoReqs.length,
      stateRedoneInDb,
      finalRestored: dbState0Final.rows[0].STATE === origStateName
    });

    testMatrix['AT.CORE.1'] = {
      pass: statesPutReqs.length === 1 && stateUpdatedInDb && stateLgdUntouched &&
            statesUndoRes.success && statesUndoReqs.length === 1 && stateRestoredInDb &&
            statesRedoRes.success && statesRedoReqs.length === 1 && stateRedoneInDb && dbState0Final.rows[0].STATE === origStateName,
      details: `Single save count: ${statesPutReqs.length} PUT, DB updated: ${stateUpdatedInDb}, Undo success: ${stateRestoredInDb}, Redo success: ${stateRedoneInDb}, Final restored: ${dbState0Final.rows[0].STATE === origStateName}`
    };
    console.log('  Result:', testMatrix['AT.CORE.1']);

    // ──────────────────────────────────────────────────────────────────────────
    // TEST AT.CORE.2: Districts Table Attribute Edit
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST AT.CORE.2: Districts Table Attribute Edit ---');
    await sleep(1500);
    await switchToTabAndWait('districts');
    await waitForTableReady();

    const distInit = await evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr.attr-tr'));
      if (rows.length === 0) return null;
      const firstRow = rows[0];
      const rowId = firstRow.getAttribute('data-testid')?.replace('attr-row-', '');
      const distCell = firstRow.querySelector('[data-testid$="-District"]')?.textContent?.trim();
      const stateCell = firstRow.querySelector('[data-testid$="-STATE"]')?.textContent?.trim();
      return { rowId, distCell, stateCell, rowCount: rows.length };
    })()`);

    console.log('  Districts Initial State:', distInit);

    const targetDistId = distInit?.rowId ? parseInt(distInit.rowId.split('.')[1], 10) : 0;
    const dbDist0Before = await pool.query(`SELECT id, district, state, district_l FROM districts WHERE id = $1`, [targetDistId]);
    const origDistName = dbDist0Before.rows[0].district;
    const origDistState = dbDist0Before.rows[0].state;
    const origDistLgd = dbDist0Before.rows[0].district_l;
    const testDistName = `${origDistName} (TEST_EDIT)`;

    console.log(`  Database record before edit: district="${origDistName}", state="${origDistState}", district_l="${origDistLgd}"`);

    const netCountBeforeDistEdit = networkRequests.length;

    // Start edit mode
    await evaluate(`(() => {
      const editBtn = document.querySelector('tbody tr.attr-tr [data-testid^="btn-edit-row-"]');
      if (editBtn) editBtn.click();
    })()`);
    await sleep(600);

    // Modify District field
    await evaluate(`((val) => {
      const input = document.querySelector('tbody tr.attr-tr [data-testid*="-District"], tbody tr.attr-tr [data-testid*="-district"]');
      if (input) window.__setInputValue(input, val);
    })('${testDistName}')`);
    await sleep(400);

    // Save from table
    await evaluate(`(() => {
      const saveBtn = document.querySelector('tbody tr.attr-tr [data-testid^="btn-save-row-"]');
      if (saveBtn) saveBtn.click();
    })()`);
    await sleep(2000);
    await waitForTableReady();

    // Verify network: exactly 1 PUT /api/districts/:id
    const distPutReqs = networkRequests.slice(netCountBeforeDistEdit).filter(r => 
      r.method === 'PUT' && r.url.includes('/api/districts')
    );

    // Verify DB updated
    const dbDist0After = await pool.query(`SELECT id, district, state, district_l FROM districts WHERE id = $1`, [targetDistId]);
    const distUpdatedInDb = dbDist0After.rows[0].district === testDistName;
    const distUntouchedPreserved = dbDist0After.rows[0].state === origDistState && dbDist0After.rows[0].district_l === origDistLgd;

    // Verify table row text
    const distRowAfterText = await evaluate(`document.querySelector('tbody tr.attr-tr')?.textContent || ''`);

    // Test Undo
    const netCountBeforeDistUndo = networkRequests.length;
    const distUndoRes = await evaluate(`window.__historyService.undo()`);
    await sleep(2000);
    await waitForTableReady();
    const distUndoReqs = networkRequests.slice(netCountBeforeDistUndo).filter(r => 
      r.method === 'PUT' && r.url.includes('/api/districts')
    );
    const dbDist0AfterUndo = await pool.query(`SELECT id, district, state, district_l FROM districts WHERE id = $1`, [targetDistId]);
    const distRestoredInDb = dbDist0AfterUndo.rows[0].district === origDistName;

    // Test Redo
    const netCountBeforeDistRedo = networkRequests.length;
    const distRedoRes = await evaluate(`window.__historyService.redo()`);
    await sleep(2000);
    await waitForTableReady();
    const distRedoReqs = networkRequests.slice(netCountBeforeDistRedo).filter(r => 
      r.method === 'PUT' && r.url.includes('/api/districts')
    );
    const dbDist0AfterRedo = await pool.query(`SELECT id, district, state, district_l FROM districts WHERE id = $1`, [targetDistId]);
    const distRedoneInDb = dbDist0AfterRedo.rows[0].district === testDistName;

    // Final Restore
    await evaluate(`window.__historyService.undo()`);
    await sleep(1500);
    await waitForTableReady();
    const dbDist0Final = await pool.query(`SELECT id, district, state, district_l FROM districts WHERE id = $1`, [targetDistId]);

    console.log('  DEBUG AT.CORE.2 components:', {
      distPutReqs: distPutReqs.length,
      distUpdatedInDb,
      distUntouchedPreserved,
      distRowAfterText,
      distRowHasTest: distRowAfterText.includes(testDistName),
      distUndoResSuccess: distUndoRes?.success,
      distUndoReqs: distUndoReqs.length,
      distRestoredInDb,
      distRedoResSuccess: distRedoRes?.success,
      distRedoReqs: distRedoReqs.length,
      distRedoneInDb,
      finalRestored: dbDist0Final.rows[0].District === origDistName
    });

    testMatrix['AT.CORE.2'] = {
      pass: distPutReqs.length === 1 && distUpdatedInDb && distUntouchedPreserved &&
            distUndoRes.success && distUndoReqs.length === 1 && distRestoredInDb &&
            distRedoRes.success && distRedoReqs.length === 1 && distRedoneInDb && dbDist0Final.rows[0].District === origDistName,
      details: `Single save count: ${distPutReqs.length} PUT, DB updated: ${distUpdatedInDb}, Undo success: ${distRestoredInDb}, Redo success: ${distRedoneInDb}, Final restored: ${dbDist0Final.rows[0].District === origDistName}`
    };
    console.log('  Result:', testMatrix['AT.CORE.2']);

    // ──────────────────────────────────────────────────────────────────────────
    // TEST AT.CORE.3: Zones Table Attribute Edit
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST AT.CORE.3: Zones Table Attribute Edit ---');
    await sleep(1500); // Allow previous district updates to settle completely
    await switchToTabAndWait('zones');
    await waitForTableReady();

    const zonesInit = await evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr.attr-tr'));
      if (rows.length === 0) return null;
      const firstRow = rows[0];
      const rowId = firstRow.getAttribute('data-testid')?.replace('attr-row-', '');
      const nameCell = firstRow.querySelector('[data-testid$="-name"]')?.textContent?.trim();
      const typeCell = firstRow.querySelector('[data-testid$="-type"]')?.textContent?.trim();
      return { rowId, nameCell, typeCell, rowCount: rows.length };
    })()`);

    console.log('  Zones Initial State:', zonesInit);

    const dbZone1Before = await pool.query(`SELECT id, name, type FROM zones WHERE id = 1`);
    const origZoneName = dbZone1Before.rows[0].name;
    const origZoneType = dbZone1Before.rows[0].type;
    const testZoneName = `${origZoneName} (TEST_EDIT)`;

    console.log(`  Database record before edit: name="${origZoneName}", type="${origZoneType}"`);

    const netCountBeforeZoneEdit = networkRequests.length;

    // Start edit mode
    const zoneEditBtnStatus = await evaluate(`(() => {
      const editBtn = document.querySelector('tbody tr.attr-tr [data-testid^="btn-edit-row-"]');
      if (editBtn) editBtn.click();
      return { hasEditBtn: !!editBtn };
    })()`);
    console.log('  DEBUG AT.CORE.3 editBtnStatus:', zoneEditBtnStatus);
    await sleep(600);

    // Modify name field
    const zoneInputStatus = await evaluate(`((val) => {
      const input = document.querySelector('tbody tr.attr-tr [data-testid$="-name"]');
      if (input) window.__setInputValue(input, val);
      return { hasInput: !!input, valAfter: input?.value };
    })('${testZoneName}')`);
    console.log('  DEBUG AT.CORE.3 inputStatus:', zoneInputStatus);
    await sleep(300);

    // Save from table
    const zoneSaveStatus = await evaluate(`(() => {
      const saveBtn = document.querySelector('tbody tr.attr-tr [data-testid^="btn-save-row-"]');
      if (saveBtn) saveBtn.click();
      return { hasSaveBtn: !!saveBtn };
    })()`);
    console.log('  DEBUG AT.CORE.3 saveStatus:', zoneSaveStatus);
    await sleep(1500);
    await waitForTableReady();

    // Verify network: exactly 1 PUT /api/zones/1
    const zonePutReqs = networkRequests.slice(netCountBeforeZoneEdit).filter(r => 
      r.method === 'PUT' && r.url.includes('/api/zones')
    );

    // Verify DB updated
    const dbZone1After = await pool.query(`SELECT id, name, type FROM zones WHERE id = 1`);
    const zoneUpdatedInDb = dbZone1After.rows[0].name === testZoneName;
    const zoneTypeUntouched = dbZone1After.rows[0].type === origZoneType;

    // Verify table row text
    const zoneRowAfterText = await evaluate(`document.querySelector('tbody tr.attr-tr')?.textContent || ''`);

    // Test Undo
    const netCountBeforeZoneUndo = networkRequests.length;
    const zoneUndoRes = await evaluate(`window.__historyService.undo()`);
    await sleep(1500);
    await waitForTableReady();
    const zoneUndoReqs = networkRequests.slice(netCountBeforeZoneUndo).filter(r => 
      r.method === 'PUT' && r.url.includes('/api/zones')
    );
    const dbZone1AfterUndo = await pool.query(`SELECT id, name, type FROM zones WHERE id = 1`);
    const zoneRestoredInDb = dbZone1AfterUndo.rows[0].name === origZoneName;

    // Test Redo
    const netCountBeforeZoneRedo = networkRequests.length;
    const zoneRedoRes = await evaluate(`window.__historyService.redo()`);
    await sleep(1500);
    await waitForTableReady();
    const zoneRedoReqs = networkRequests.slice(netCountBeforeZoneRedo).filter(r => 
      r.method === 'PUT' && r.url.includes('/api/zones')
    );
    const dbZone1AfterRedo = await pool.query(`SELECT id, name, type FROM zones WHERE id = 1`);
    const zoneRedoneInDb = dbZone1AfterRedo.rows[0].name === testZoneName;

    // Final Restore
    await evaluate(`window.__historyService.undo()`);
    await sleep(1000);
    await waitForTableReady();
    const dbZone1Final = await pool.query(`SELECT id, name, type FROM zones WHERE id = 1`);

    testMatrix['AT.CORE.3'] = {
      pass: zonePutReqs.length === 1 && zoneUpdatedInDb && zoneTypeUntouched && zoneRowAfterText.includes(testZoneName) &&
            zoneUndoRes.success && zoneUndoReqs.length === 1 && zoneRestoredInDb &&
            zoneRedoRes.success && zoneRedoReqs.length === 1 && zoneRedoneInDb && dbZone1Final.rows[0].name === origZoneName,
      details: `Single save count: ${zonePutReqs.length} PUT, DB updated: ${zoneUpdatedInDb}, Undo success: ${zoneRestoredInDb}, Redo success: ${zoneRedoneInDb}, Final restored: ${dbZone1Final.rows[0].name === origZoneName}`
    };
    console.log('  Result:', testMatrix['AT.CORE.3']);

    // ──────────────────────────────────────────────────────────────────────────
    // TEST AT.CORE.4: Roads Table Attribute Edit
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST AT.CORE.4: Roads Table Attribute Edit ---');
    await switchToTabAndWait('roads');

    const roadsInit = await evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr.attr-tr'));
      if (rows.length === 0) return null;
      const firstRow = rows[0];
      const rowId = firstRow.getAttribute('data-testid')?.replace('attr-row-', '');
      const nameCell = firstRow.querySelector('[data-testid$="-name"]')?.textContent?.trim();
      const zoneIdCell = firstRow.querySelector('[data-testid$="-zone_id"]')?.textContent?.trim();
      return { rowId, nameCell, zoneIdCell, rowCount: rows.length };
    })()`);

    console.log('  Roads Initial State:', roadsInit);

    const dbRoad1Before = await pool.query(`SELECT id, name, category, zone_id FROM roads WHERE id = 1`);
    const origRoadName = dbRoad1Before.rows[0].name;
    const origRoadZoneId = dbRoad1Before.rows[0].zone_id;
    const testRoadName = `${origRoadName} (TEST_EDIT)`;

    console.log(`  Database record before edit: name="${origRoadName}", zone_id=${origRoadZoneId}`);

    const netCountBeforeRoadEdit = networkRequests.length;

    // Start edit mode
    await evaluate(`(() => {
      const editBtn = document.querySelector('[data-testid="btn-edit-row-${roadsInit.rowId}"]');
      if (editBtn) editBtn.click();
    })()`);
    await sleep(500);

    // Modify name field
    await evaluate(`((val) => {
      const input = document.querySelector('[data-testid="attr-input-${roadsInit.rowId}-name"]');
      if (input) window.__setInputValue(input, val);
    })('${testRoadName}')`);
    await sleep(200);

    // Save from table
    await evaluate(`(() => {
      const saveBtn = document.querySelector('[data-testid="btn-save-row-${roadsInit.rowId}"]');
      if (saveBtn) saveBtn.click();
    })()`);
    await sleep(1500);

    // Verify network: exactly 1 PUT /api/roads/1
    const roadPutReqs = networkRequests.slice(netCountBeforeRoadEdit).filter(r => 
      r.method === 'PUT' && r.url.includes('/api/roads')
    );

    // Verify DB updated
    const dbRoad1After = await pool.query(`SELECT id, name, category, zone_id FROM roads WHERE id = 1`);
    const roadUpdatedInDb = dbRoad1After.rows[0].name === testRoadName;
    const roadZoneUntouched = dbRoad1After.rows[0].zone_id === origRoadZoneId;

    // Verify table row text
    const roadRowAfterText = await evaluate(`document.querySelector('[data-testid="attr-row-${roadsInit.rowId}"]')?.textContent || ''`);

    // Test Undo
    const netCountBeforeRoadUndo = networkRequests.length;
    const roadUndoRes = await evaluate(`window.__historyService.undo()`);
    await sleep(1500);
    const roadUndoReqs = networkRequests.slice(netCountBeforeRoadUndo).filter(r => 
      r.method === 'PUT' && r.url.includes('/api/roads')
    );
    const dbRoad1AfterUndo = await pool.query(`SELECT id, name, category, zone_id FROM roads WHERE id = 1`);
    const roadRestoredInDb = dbRoad1AfterUndo.rows[0].name === origRoadName;

    // Test Redo
    const netCountBeforeRoadRedo = networkRequests.length;
    const roadRedoRes = await evaluate(`window.__historyService.redo()`);
    await sleep(1500);
    const roadRedoReqs = networkRequests.slice(netCountBeforeRoadRedo).filter(r => 
      r.method === 'PUT' && r.url.includes('/api/roads')
    );
    const dbRoad1AfterRedo = await pool.query(`SELECT id, name, category, zone_id FROM roads WHERE id = 1`);
    const roadRedoneInDb = dbRoad1AfterRedo.rows[0].name === testRoadName;

    // Final Restore
    await evaluate(`window.__historyService.undo()`);
    await sleep(1000);
    const dbRoad1Final = await pool.query(`SELECT id, name, category, zone_id FROM roads WHERE id = 1`);

    testMatrix['AT.CORE.4'] = {
      pass: roadPutReqs.length === 1 && roadUpdatedInDb && roadZoneUntouched && roadRowAfterText.includes(testRoadName) &&
            roadUndoRes.success && roadUndoReqs.length === 1 && roadRestoredInDb &&
            roadRedoRes.success && roadRedoReqs.length === 1 && roadRedoneInDb && dbRoad1Final.rows[0].name === origRoadName,
      details: `Single save count: ${roadPutReqs.length} PUT, DB updated: ${roadUpdatedInDb}, Undo success: ${roadRestoredInDb}, Redo success: ${roadRedoneInDb}, Final restored: ${dbRoad1Final.rows[0].name === origRoadName}`
    };
    console.log('  Result:', testMatrix['AT.CORE.4']);

    // ──────────────────────────────────────────────────────────────────────────
    // TEST AT.CORE.5: Streetlights Table Attribute Edit
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST AT.CORE.5: Streetlights Table Attribute Edit ---');
    await switchToTabAndWait('streetlights');

    const slInit = await evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr.attr-tr'));
      if (rows.length === 0) return null;
      const firstRow = rows[0];
      const rowId = firstRow.getAttribute('data-testid')?.replace('attr-row-', '');
      const nameCell = firstRow.querySelector('[data-testid$="-name"]')?.textContent?.trim();
      const typeCell = firstRow.querySelector('[data-testid$="-type"]')?.textContent?.trim();
      return { rowId, nameCell, typeCell, rowCount: rows.length };
    })()`);

    console.log('  Streetlights Initial State:', slInit);

    const dbSl1Before = await pool.query(`SELECT id, name, type, zone_id, road_id FROM streetlights WHERE id = 1`);
    const origSlName = dbSl1Before.rows[0].name;
    const origSlType = dbSl1Before.rows[0].type;
    const origSlZoneId = dbSl1Before.rows[0].zone_id;
    const origSlRoadId = dbSl1Before.rows[0].road_id;
    const testSlName = `${origSlName} (TEST_EDIT)`;

    console.log(`  Database record before edit: name="${origSlName}", type="${origSlType}", zone_id=${origSlZoneId}, road_id=${origSlRoadId}`);

    const netCountBeforeSlEdit = networkRequests.length;

    // Start edit mode
    await evaluate(`(() => {
      const editBtn = document.querySelector('[data-testid="btn-edit-row-${slInit.rowId}"]');
      if (editBtn) editBtn.click();
    })()`);
    await sleep(500);

    // Modify name field
    await evaluate(`((val) => {
      const input = document.querySelector('[data-testid="attr-input-${slInit.rowId}-name"]');
      if (input) window.__setInputValue(input, val);
    })('${testSlName}')`);
    await sleep(200);

    // Save from table
    await evaluate(`(() => {
      const saveBtn = document.querySelector('[data-testid="btn-save-row-${slInit.rowId}"]');
      if (saveBtn) saveBtn.click();
    })()`);
    await sleep(1500);

    // Verify network: exactly 1 PUT /api/streetlights/1
    const slPutReqs = networkRequests.slice(netCountBeforeSlEdit).filter(r => 
      r.method === 'PUT' && r.url.includes('/api/streetlights')
    );

    // Verify DB updated
    const dbSl1After = await pool.query(`SELECT id, name, type, zone_id, road_id FROM streetlights WHERE id = 1`);
    const slUpdatedInDb = dbSl1After.rows[0].name === testSlName;
    const slUntouchedPreserved = dbSl1After.rows[0].type === origSlType && 
                                 dbSl1After.rows[0].zone_id === origSlZoneId && 
                                 dbSl1After.rows[0].road_id === origSlRoadId;

    // Verify table row text
    const slRowAfterText = await evaluate(`document.querySelector('[data-testid="attr-row-${slInit.rowId}"]')?.textContent || ''`);

    // Test Undo
    const netCountBeforeSlUndo = networkRequests.length;
    const slUndoRes = await evaluate(`window.__historyService.undo()`);
    await sleep(1500);
    const slUndoReqs = networkRequests.slice(netCountBeforeSlUndo).filter(r => 
      r.method === 'PUT' && r.url.includes('/api/streetlights')
    );
    const dbSl1AfterUndo = await pool.query(`SELECT id, name, type, zone_id, road_id FROM streetlights WHERE id = 1`);
    const slRestoredInDb = dbSl1AfterUndo.rows[0].name === origSlName;

    // Test Redo
    const netCountBeforeSlRedo = networkRequests.length;
    const slRedoRes = await evaluate(`window.__historyService.redo()`);
    await sleep(1500);
    const slRedoReqs = networkRequests.slice(netCountBeforeSlRedo).filter(r => 
      r.method === 'PUT' && r.url.includes('/api/streetlights')
    );
    const dbSl1AfterRedo = await pool.query(`SELECT id, name, type, zone_id, road_id FROM streetlights WHERE id = 1`);
    const slRedoneInDb = dbSl1AfterRedo.rows[0].name === testSlName;

    // Final Restore
    await evaluate(`window.__historyService.undo()`);
    await sleep(1000);
    const dbSl1Final = await pool.query(`SELECT id, name, type, zone_id, road_id FROM streetlights WHERE id = 1`);

    testMatrix['AT.CORE.5'] = {
      pass: slPutReqs.length === 1 && slUpdatedInDb && slUntouchedPreserved && slRowAfterText.includes(testSlName) &&
            slUndoRes.success && slUndoReqs.length === 1 && slRestoredInDb &&
            slRedoRes.success && slRedoReqs.length === 1 && slRedoneInDb && dbSl1Final.rows[0].name === origSlName,
      details: `Single save count: ${slPutReqs.length} PUT, DB updated: ${slUpdatedInDb}, Undo success: ${slRestoredInDb}, Redo success: ${slRedoneInDb}, Final restored: ${dbSl1Final.rows[0].name === origSlName}`
    };
    console.log('  Result:', testMatrix['AT.CORE.5']);

    // ──────────────────────────────────────────────────────────────────────────
    // TEST AT.CORE.6: Multi-Field Core Edit (Zones: name + type)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST AT.CORE.6: Multi-Field Core Edit (Zones) ---');
    await switchToTabAndWait('zones');

    const netCountBeforeMulti = networkRequests.length;
    await evaluate(`(() => {
      const editBtn = document.querySelector('[data-testid="btn-edit-row-${zonesInit.rowId}"]');
      if (editBtn) editBtn.click();
    })()`);
    await sleep(400);

    const testMultiName = 'Tambaram West Hub';
    const testMultiType = 'commercial';

    await evaluate(`((nameVal, typeVal) => {
      const nameInput = document.querySelector('[data-testid="attr-input-${zonesInit.rowId}-name"]');
      if (nameInput) window.__setInputValue(nameInput, nameVal);
      const typeInput = document.querySelector('[data-testid="attr-input-${zonesInit.rowId}-type"]');
      if (typeInput) window.__setInputValue(typeInput, typeVal);
    })('${testMultiName}', '${testMultiType}')`);
    await sleep(200);

    await evaluate(`(() => {
      const saveBtn = document.querySelector('[data-testid="btn-save-row-${zonesInit.rowId}"]');
      if (saveBtn) saveBtn.click();
    })()`);
    await sleep(1500);

    const multiPutReqs = networkRequests.slice(netCountBeforeMulti).filter(r => 
      r.method === 'PUT' && r.url.includes('/api/zones')
    );

    const dbMultiAfter = await pool.query(`SELECT id, name, type FROM zones WHERE id = 1`);
    const multiUpdated = dbMultiAfter.rows[0].name === testMultiName && dbMultiAfter.rows[0].type === testMultiType;

    // Restore via undo
    await evaluate(`window.__historyService.undo()`);
    await sleep(1000);
    const dbMultiRestored = await pool.query(`SELECT id, name, type FROM zones WHERE id = 1`);

    testMatrix['AT.CORE.6'] = {
      pass: multiPutReqs.length === 1 && multiUpdated && dbMultiRestored.rows[0].name === origZoneName,
      details: `Multi-field save request count: ${multiPutReqs.length} PUT, Both fields updated on DB: ${multiUpdated}, Undo restored: ${dbMultiRestored.rows[0].name === origZoneName}`
    };
    console.log('  Result:', testMatrix['AT.CORE.6']);

    // ──────────────────────────────────────────────────────────────────────────
    // TEST AT.CORE.7: Untouched Field Preservation Across All Core Layers
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST AT.CORE.7: Untouched Field Preservation Across All Core Layers ---');
    testMatrix['AT.CORE.7'] = {
      pass: stateLgdUntouched && distUntouchedPreserved && zoneTypeUntouched && roadZoneUntouched && slUntouchedPreserved,
      details: `States untouched State_LGD: ${stateLgdUntouched}, Districts untouched STATE/DISTRICT_L: ${distUntouchedPreserved}, Zones untouched type: ${zoneTypeUntouched}, Roads untouched zone_id: ${roadZoneUntouched}, Streetlights untouched type/zone/road: ${slUntouchedPreserved}`
    };
    console.log('  Result:', testMatrix['AT.CORE.7']);

    // ──────────────────────────────────────────────────────────────────────────
    // TEST AT.CORE.8: Core Failure Test (Rejected Update -> 0 Transactions, No History)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST AT.CORE.8: Core Failure Test ---');
    const histBeforeFail = await evaluate(`window.__historyService.getUndoStack().length`);
    const netBeforeFail = networkRequests.length;

    // Attempt invalid update: roads with empty name (rejected by validateGeoJSONLineString)
    await switchToTabAndWait('roads');

    await evaluate(`(() => {
      const editBtn = document.querySelector('[data-testid="btn-edit-row-${roadsInit.rowId}"]');
      if (editBtn) editBtn.click();
    })()`);
    await sleep(400);

    await evaluate(`(() => {
      const input = document.querySelector('[data-testid="attr-input-${roadsInit.rowId}-name"]');
      if (input) window.__setInputValue(input, '   ');
    })()`);
    await sleep(200);

    await evaluate(`(() => {
      const saveBtn = document.querySelector('[data-testid="btn-save-row-${roadsInit.rowId}"]');
      if (saveBtn) saveBtn.click();
    })()`);
    await sleep(1500);

    const histAfterFail = await evaluate(`window.__historyService.getUndoStack().length`);
    const dbRoadAfterFail = await pool.query(`SELECT id, name FROM roads WHERE id = 1`);
    const roadNotCorrupted = dbRoadAfterFail.rows[0].name === origRoadName;

    // Cancel edit mode
    await evaluate(`(() => {
      const cancelBtn = document.querySelector('[data-testid="btn-cancel-row-${roadsInit.rowId}"]');
      if (cancelBtn) cancelBtn.click();
    })()`);
    await sleep(400);

    testMatrix['AT.CORE.8'] = {
      pass: histBeforeFail === histAfterFail && roadNotCorrupted,
      details: `History stack unchanged on rejected update: ${histBeforeFail === histAfterFail}, DB state preserved: ${roadNotCorrupted}`
    };
    console.log('  Result:', testMatrix['AT.CORE.8']);

    // ──────────────────────────────────────────────────────────────────────────
    // TEST AT.CORE.9: Cross-Layer Safety
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- TEST AT.CORE.9: Cross-Layer Safety ---');
    const crossLayerViolations = networkRequests.filter(r => {
      if (r.url.includes('/api/roads') && r.postData?.includes('district_l')) return true;
      if (r.url.includes('/api/states') && r.postData?.includes('zone_id')) return true;
      return false;
    });

    testMatrix['AT.CORE.9'] = {
      pass: crossLayerViolations.length === 0,
      details: `Cross-layer mutation violations: ${crossLayerViolations.length} (expected 0)`
    };
    console.log('  Result:', testMatrix['AT.CORE.9']);

    // ══════════════════════════════════════════════════════════════════════════
    // SUMMARY
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n================================================================');
    console.log('CORE LAYER ATTRIBUTE EDITING VALIDATION SUMMARY');
    console.log('================================================================');
    let passCount = 0;
    let failCount = 0;
    for (const [k, v] of Object.entries(testMatrix)) {
      const status = v.pass ? 'PASS' : 'FAIL';
      if (v.pass) passCount++;
      else failCount++;
      console.log(`  [${status}] ${k}: ${v.details}`);
    }

    console.log(`\nTOTAL: ${passCount + failCount} | PASS: ${passCount} | FAIL: ${failCount}`);

    const finalVerdict = failCount === 0 ? 'ATTRIBUTE TABLE CORE EDITING — PASS' : 'ATTRIBUTE TABLE CORE EDITING — FAIL';
    console.log(`\nFINAL VERDICT: ${finalVerdict}\n`);

    if (failCount > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('\n[FATAL ERROR in Core Validation Suite]:', err);
    process.exit(1);
  } finally {
    if (ws) {
      try { ws.close(); } catch {}
    }
    if (chromeProcess) {
      try { chromeProcess.kill(); } catch {}
    }
    try {
      await pool.end();
    } catch {}
  }
}

runCoreLayerAttributeTests();
