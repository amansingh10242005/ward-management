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
    const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'states'");
    console.log('states cols:', res.rows.map(r => r.column_name));
    
    const res2 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'districts'");
    console.log('districts cols:', res2.rows.map(r => r.column_name));
  } catch (e) {
    console.error(e.message);
  } finally {
    pool.end();
  }
}
run();
