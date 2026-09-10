import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '../backend/.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > -1) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        process.env[k] = v;
      }
    }
  }
}

import { pool } from '../backend/src/db/pool.js';

async function run() {
  const res1 = await pool.query('SELECT count(*) FROM tl_layer_1');
  const res2 = await pool.query('SELECT count(*) FROM "Example_1"');
  console.log('tl_layer_1 count:', res1.rows[0].count);
  console.log('Example_1 count:', res2.rows[0].count);
  await pool.end();
}

run().catch(console.error);
