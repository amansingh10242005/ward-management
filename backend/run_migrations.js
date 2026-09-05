import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Client } = pg;

const client = new Client({
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     Number(process.env.DB_PORT ?? 5432),
  user:     process.env.DB_USER     ?? 'admin',
  password: process.env.DB_PASSWORD ?? 'geoserver',
  database: process.env.DB_NAME     ?? 'ward_db',
});

async function run() {
  const startTime = Date.now();
  try {
    await client.connect();
    console.log(`Connected to PostgreSQL (${client.database}) on ${client.host}:${client.port} as ${client.user}`);

    const migrationsDir = path.resolve(__dirname, '../db/migrations');
    if (!fs.existsSync(migrationsDir)) {
      throw new Error(`Migrations directory not found at: ${migrationsDir}`);
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${files.length} migration files in ${migrationsDir}:`);

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      
      const fileStart = Date.now();
      process.stdout.write(`  Executing ${file}... `);
      await client.query(sql);
      const duration = Date.now() - fileStart;
      console.log(`OK (${duration}ms)`);
    }

    console.log(`\nAll migrations executed successfully in ${Date.now() - startTime}ms.`);
  } catch (err) {
    console.error(`\nMigration failed:`, err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
