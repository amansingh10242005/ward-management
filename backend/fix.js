const { pool } = require('./src/db/pool.js');
async function fix() {
  await pool.query("UPDATE roads SET category = 'local' WHERE category IS NULL");
  console.log('Fixed roads category');
  process.exit(0);
}
fix();
