const fs = require('fs');

// Fix suite_core.mjs SQL case sensitivity
let core = fs.readFileSync('scripts/lib/suite_core.mjs', 'utf8');
core = core.replace(/SELECT id, state, state_lgd/g, 'SELECT id, "STATE", "STATE_LGD"');
core = core.replace(/\.rows\[0\]\.state(?!_)/g, '.rows[0].STATE');
core = core.replace(/\.rows\[0\]\.state_lgd/g, '.rows[0].STATE_LGD');
core = core.replace(/SELECT id, district, state, district_l/g, 'SELECT id, "DISTRICT", "STATE", "DISTRICT_L"');
core = core.replace(/\.rows\[0\]\.district(?!_)/g, '.rows[0].DISTRICT');
core = core.replace(/\.rows\[0\]\.district_l/g, '.rows[0].DISTRICT_L');
fs.writeFileSync('scripts/lib/suite_core.mjs', core);

// Remove await pool.end(); from all suites
['suite_core.mjs', 'suite_attribute_table.mjs', 'suite_dynamic_discovery.mjs', 'suite_cleanup.mjs'].forEach(f => {
  let file = fs.readFileSync('scripts/lib/' + f, 'utf8');
  file = file.replace(/await pool\.end\(\);/g, '// await pool.end();');
  fs.writeFileSync('scripts/lib/' + f, file);
});

// Add await pool.end() to run_all_validations.mjs
let runAll = fs.readFileSync('scripts/run_all_validations.mjs', 'utf8');
if (!runAll.includes('pool.end()')) {
  runAll = runAll.replace(/import \{ runCleanup \} from '\.\/lib\/suite_cleanup\.mjs';/, 
    'import { runCleanup } from \'./lib/suite_cleanup.mjs\';\nimport { pool } from \'../backend/src/db/pool.js\';');
  runAll = runAll.replace(/process\.exit\(\d+\);/g, match => 'await pool.end();\n    ' + match);
  fs.writeFileSync('scripts/run_all_validations.mjs', runAll);
}
