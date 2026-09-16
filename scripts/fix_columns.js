const fs = require('fs');
let core = fs.readFileSync('scripts/lib/suite_core.mjs', 'utf8');

core = core.split('SELECT id, "STATE", "STATE_LGD"').join('SELECT id, "STATE", "State_LGD"');
core = core.split('.rows[0].STATE_LGD').join('.rows[0].State_LGD');

core = core.split('SELECT id, "DISTRICT", "STATE", "DISTRICT_L"').join('SELECT id, "District", "STATE", "DISTRICT_L"');
core = core.split('.rows[0].DISTRICT').join('.rows[0].District');

fs.writeFileSync('scripts/lib/suite_core.mjs', core);
