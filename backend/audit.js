import pg from 'pg';
const pool = new pg.Pool({
  host: 'localhost',
  port: 5432,
  user: 'admin',
  password: 'geoserver',
  database: 'ward_db',
});
async function run() {
  try {
    console.log('--- AVAILABLE STATES ---');
    const statesRes = await pool.query('SELECT "STATE" FROM states ORDER BY "STATE"');
    const available = statesRes.rows.map(r => r.STATE);
    console.log(available);
    
    console.log('\n--- MISMATCHED DISTRICTS ---');
    const mismatchRes = await pool.query(`
      SELECT d."District" as district, d."STATE" AS district_state
      FROM districts d
      LEFT JOIN states s ON d."STATE" = s."STATE"
      WHERE s."STATE" IS NULL
      ORDER BY d."STATE", d."District"
    `);
    
    for (const row of mismatchRes.rows) {
       console.log(`District: ${row.district}, District_STATE: '${row.district_state}'`);
    }
  } catch (e) {
    console.error(e.message);
  } finally {
    pool.end();
  }
}
run();
