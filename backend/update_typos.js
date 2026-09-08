import pg from 'pg';
const pool = new pg.Pool({
  host: 'localhost',
  port: 5432,
  user: 'admin',
  password: 'geoserver',
  database: 'ward_db',
});

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Update States
    const stateRes = await client.query(`
      UPDATE states 
      SET "STATE" = 'CHHATTISGARH' 
      WHERE "STATE" = 'CHHAtTISGARH'
    `);
    console.log(`Updated ${stateRes.rowCount} states: CHHAtTISGARH -> CHHATTISGARH`);

    // Update Districts
    const distRes1 = await client.query(`
      UPDATE districts 
      SET "STATE" = 'DISPUTED (RAJASTHAN & GUJARAT)' 
      WHERE "STATE" = 'DISPUTED (RAJATHAN & GUJARAT)'
    `);
    console.log(`Updated ${distRes1.rowCount} districts: DISPUTED (RAJATHAN & GUJARAT) -> DISPUTED (RAJASTHAN & GUJARAT)`);

    const distRes2 = await client.query(`
      UPDATE districts 
      SET "STATE" = 'DISPUTED (WEST BENGAL, BIHAR & JHARKHAND)' 
      WHERE "STATE" = 'DISPUTED (WEST BENGAL , BIHAR & JHARKHAND)'
    `);
    console.log(`Updated ${distRes2.rowCount} districts: DISPUTED (WEST BENGAL , BIHAR & JHARKHAND) -> DISPUTED (WEST BENGAL, BIHAR & JHARKHAND)`);

    await client.query('COMMIT');
    console.log('Transaction committed successfully.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Transaction rolled back due to error:', e.message);
  } finally {
    client.release();
    pool.end();
  }
}

run();
