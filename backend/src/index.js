/**
 * index.js — Express application entry point.
 *
 * Responsibilities:
 *  - Load environment variables (.env via dotenv)
 *  - Instantiate the Express app
 *  - Register global middleware (CORS, JSON body parsing)
 *  - Mount feature routers under /api
 *  - Attach centralized error-handling middleware (must be last)
 *  - Start the HTTP server on the configured port
 *
 * This file should stay thin. No business logic lives here.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { streetlightsRouter } from './routes/streetlights.routes.js';
import { roadsRouter } from './routes/roads.routes.js';
import { zonesRouter } from './routes/zones.routes.js';
import { districtsRouter } from './routes/districts.routes.js';
import { statesRouter } from './routes/states.routes.js';
import { errorHandler } from './middleware/error-handler.middleware.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

// ─── Global middleware ────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }));
app.use(express.json({ limit: '50mb' }));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ward-management-api' });
});

// ─── Feature routes ───────────────────────────────────────────────────────────
// WRITE PATH: all mutations to PostGIS go through these routers.
// The read path (WMS/WFS) bypasses this server entirely — OpenLayers talks
// directly to GeoServer, which reads from PostGIS as its datastore.
app.use('/api/streetlights', streetlightsRouter);
app.use('/api/roads', roadsRouter);
app.use('/api/zones', zonesRouter);
app.use('/api/districts', districtsRouter);
app.use('/api/states', statesRouter);

// ─── Centralized error handler (must be registered last) ─────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Ward Management API listening on http://localhost:${PORT}`);
});
