/**
 * pool.js — PostGIS / PostgreSQL connection module.
 *
 * Responsibilities:
 *  - Create and export a single shared pg.Pool instance.
 *  - Read all connection parameters from environment variables (never hardcode).
 *  - This module is the ONLY place in the codebase that imports `pg`.
 *    All service/repository modules import from here.
 *
 * Note: In the read path, GeoServer holds its own separate JDBC connection to
 * PostGIS. This pool is exclusively for the write path (Express -> PostGIS).
 */

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// Pool connection tuning to prevent exhaustion
export const pool = new Pool({
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     Number(process.env.DB_PORT ?? 5432),
  user:     process.env.DB_USER     ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME     ?? 'ward_db',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Emit a warning on connection errors so they surface in the server log.
pool.on('error', (err) => {
  console.error('[pg pool] unexpected client error', err);
});
