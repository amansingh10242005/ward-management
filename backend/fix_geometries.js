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

    // Fix validity
    const sValid = await client.query(`
      UPDATE states SET geom = ST_MakeValid(geom) WHERE NOT ST_IsValid(geom)
    `);
    console.log(`Repaired ${sValid.rowCount} invalid states`);

    const dValid = await client.query(`
      UPDATE districts SET geom = ST_MakeValid(geom) WHERE NOT ST_IsValid(geom)
    `);
    console.log(`Repaired ${dValid.rowCount} invalid districts`);
    
    // Fix types (cast Polygon to MultiPolygon)
    const sType = await client.query(`
      UPDATE states SET geom = ST_Multi(geom) WHERE ST_GeometryType(geom) = 'ST_Polygon'
    `);
    console.log(`Cast ${sType.rowCount} states to MultiPolygon`);

    const dType = await client.query(`
      UPDATE districts SET geom = ST_Multi(geom) WHERE ST_GeometryType(geom) = 'ST_Polygon'
    `);
    console.log(`Cast ${dType.rowCount} districts to MultiPolygon`);

    await client.query('COMMIT');
    console.log('Geometry fixes committed successfully.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Geometry fixes failed:', e.message);
  } finally {
    client.release();
    pool.end();
  }
}

run();
