import { runCore } from './lib/suite_core.mjs';
import { runAttributeTable } from './lib/suite_attribute_table.mjs';
import { runDiscovery } from './lib/suite_dynamic_discovery.mjs';
import { runCleanup } from './lib/suite_cleanup.mjs';
import { pool } from '../backend/src/db/pool.js';

const HISTORICAL_SKIPS = [
  'Stage B E2E',
  'Stage C Re-Audit',
  'Stage D Validation',
  'Stage E1 Validation',
  'Stage E2 Validation',
  'Stage E3 Validation',
  'Stage E4 Validation (In-Session Undo/Redo & Network Audit)',
  'Stage F Rehearsal'
];

async function main() {
  console.log('================================================================');
  console.log('WARD MANAGEMENT SYSTEM — MASTER VALIDATION SUITE');
  console.log('================================================================\n');

  const startTime = Date.now();
  let failCount = 0;

  // 1. NON-BROWSER SETUP / DISCOVERY
  console.log('=== PHASE 1: GENERIC DYNAMIC DISCOVERY ===');
  try {
    await runDiscovery();
    console.log('✅ CURRENT PASS: Generic Dynamic Discovery');
  } catch (err) {
    console.error('❌ FAIL: Generic Dynamic Discovery', err);
    failCount++;
  }

  // 2. BROWSER E2E SUITES (Each maintains own pristine CDP session)
  console.log('\n=== PHASE 2: BROWSER CDP VALIDATION ===');
  
  // 2A. Core Layer Attribute Editing
  try {
    console.log('\n[Suite] Core Layer Attribute Editing');
    await runCore();
    console.log('✅ CURRENT PASS: Core Layer Attribute Editing');
  } catch (err) {
    console.error('❌ FAIL: Core Layer Attribute Editing', err);
    failCount++;
  }

  // 2B. Attribute Table Validation
  try {
    console.log('\n[Suite] Attribute Table Validation');
    await runAttributeTable();
    console.log('✅ CURRENT PASS: Attribute Table Validation');
  } catch (err) {
    console.error('❌ FAIL: Attribute Table Validation', err);
    failCount++;
  }

  // 3. FINAL CLEANUP AUDIT
  console.log('\n=== PHASE 3: FINAL CLEANUP VALIDATION ===');
  try {
    await runCleanup();
    console.log('✅ CURRENT PASS: Demo Layer Cleanup');
  } catch (err) {
    console.error('❌ FAIL: Demo Layer Cleanup', err);
    failCount++;
  }

  // 4. HISTORICAL REPORTING
  console.log('\n================================================================');
  console.log('HISTORICAL VALIDATION EVIDENCE');
  console.log('================================================================');
  HISTORICAL_SKIPS.forEach(skip => {
    console.log(`⚠️ EXPECTED_HISTORICAL_SKIP: ${skip} (Historical regression constraints preserved in docs/TL-TECHNICAL-ASSESSMENT.md)`);
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n================================================================');
  console.log('MASTER RUN SUMMARY');
  console.log('================================================================');
  if (failCount === 0) {
    console.log(`✅ ALL TESTS PASSED IN ${duration}s`);
    await pool.end();
    process.exit(0);
  } else {
    console.log(`❌ ${failCount} TEST(S) FAILED (Total time: ${duration}s)`);
    await pool.end();
    process.exit(1);
  }
}

main();
