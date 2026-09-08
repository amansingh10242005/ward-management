import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || 'geoserver',
  database: process.env.DB_NAME || 'ward_db',
});

async function verifyDb() {
  try {
    console.log("=== DB INTEGRITY VERIFICATION ===");
    
    // States
    const stateRes = await pool.query(`
      SELECT 
        count(*) as total,
        count(CASE WHEN NOT ST_IsValid(geom) THEN 1 END) as invalid,
        count(CASE WHEN ST_SRID(geom) != 4326 THEN 1 END) as wrong_srid,
        count(CASE WHEN ST_GeometryType(geom) != 'ST_MultiPolygon' THEN 1 END) as wrong_type
      FROM states
    `);
    console.log("States:", stateRes.rows[0]);
    
    // Districts
    const distRes = await pool.query(`
      SELECT 
        count(*) as total,
        count(CASE WHEN NOT ST_IsValid(geom) THEN 1 END) as invalid,
        count(CASE WHEN ST_SRID(geom) != 4326 THEN 1 END) as wrong_srid,
        count(CASE WHEN ST_GeometryType(geom) != 'ST_MultiPolygon' THEN 1 END) as wrong_type
      FROM districts
    `);
    console.log("Districts:", distRes.rows[0]);

    // Indexes
    const idxRes = await pool.query(`
      SELECT tablename, indexname 
      FROM pg_indexes 
      WHERE tablename IN ('states', 'districts') AND indexdef LIKE '%gist%'
    `);
    console.log("GiST Indexes:");
    idxRes.rows.forEach(r => console.log(` - ${r.tablename}: ${r.indexname}`));

    // Foreign Keys
    const fkRes = await pool.query(`
      SELECT
        tc.table_name, kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE constraint_type = 'FOREIGN KEY' AND tc.table_name = 'districts';
    `);
    console.log("Foreign Keys on Districts:");
    fkRes.rows.forEach(r => console.log(` - ${r.table_name}(${r.column_name}) references ${r.foreign_table_name}(${r.foreign_column_name})`));

  } catch (e) {
    console.error("DB Verification failed:", e);
  } finally {
    pool.end();
  }
}

verifyDb();
