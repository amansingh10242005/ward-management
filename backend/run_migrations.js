const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const client = new Client({
  user: 'admin',
  host: 'localhost',
  database: 'ward_db',
  password: 'geoserver',
  port: 5432,
});

async function run() {
  try {
    await client.connect();
    console.log('Connected to DB');
    
    const migrations = [
      '../db/migrations/001_enable_postgis.sql',
      '../db/migrations/002_create_streetlights.sql',
      '../db/migrations/003_create_roads.sql',
      '../db/migrations/004_create_zones.sql'
    ];
    
    for (const file of migrations) {
      const sql = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
      await client.query(sql);
      console.log('Executed', file);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
run();
