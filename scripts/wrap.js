const fs = require('fs');

function wrap(inFile, outFile, funcName) {
  let file = fs.readFileSync(inFile, 'utf8');
  
  file = file.replace(/async function runTest\(\) \{/g, 'export async function ' + funcName + '() {');
  file = file.replace(/async function runValidation\(\) \{/g, 'export async function ' + funcName + '() {');
  file = file.replace(/async function main\(\) \{/g, 'export async function ' + funcName + '() {');
  
  file = file.replace(/runTest\(\)\.catch\([\s\S]*?\);/g, '');
  file = file.replace(/runValidation\(\)\.catch\([\s\S]*?\);/g, '');
  file = file.replace(/main\(\)\.catch\([\s\S]*?\);/g, '');
  
  file = file.replace(/process\.exit\(1\);/g, 'throw new Error("Test failed in ' + funcName + '");');
  file = file.replace(/process\.exit\(0\);/g, 'return;');
  
  file = file.replace(/import \{ pool \} from '\.\.\/backend\/src\/db\/pool\.js';/g, 'import { pool } from \'../../backend/src/db/pool.js\';');
  
  fs.writeFileSync(outFile, file);
  fs.unlinkSync(inFile);
}

wrap('scripts/test_generic_dynamic_discovery.mjs', 'scripts/lib/suite_dynamic_discovery.mjs', 'runDiscovery');
wrap('scripts/test_core_layer_attribute_editing.mjs', 'scripts/lib/suite_core.mjs', 'runCore');
wrap('scripts/run_attribute_table_validation.mjs', 'scripts/lib/suite_attribute_table.mjs', 'runAttributeTable');
wrap('scripts/run_demo_layer_cleanup_validation.mjs', 'scripts/lib/suite_cleanup.mjs', 'runCleanup');
