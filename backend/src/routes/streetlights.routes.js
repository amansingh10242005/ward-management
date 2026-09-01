import { Router } from 'express';
import { streetlightsService } from '../services/streetlights.service.js';
import { validateGeoJSONPoint, validateBboxQuery } from '../validators/geojson.validator.js';

export const streetlightsRouter = Router();

/**
 * streetlights.routes.js — Express router for the streetlights layer (Point geometries).
 *
 * Responsibilities:
 *  - Define CRUD routes for this specific layer
 *  - Route HTTP requests to the appropriate service layer functions
 *  - Attach validation middleware for incoming POST/PUT request bodies
 *
 * Note: These routes only implement the WRITE path (CRUD operations).
 * The map UI reads data by talking directly to GeoServer via WMS/WFS.
 */

// GET /api/streetlights
streetlightsRouter.get('/', validateBboxQuery, async (req, res, next) => {
  try {
    const features = await streetlightsService.getAll(req.bbox);
    res.json(features);
  } catch (err) {
    next(err);
  }
});

// POST /api/streetlights
streetlightsRouter.post('/', validateGeoJSONPoint, async (req, res, next) => {
  try {
    const newFeature = await streetlightsService.create(req.body);
    res.status(201).json(newFeature);
  } catch (err) {
    next(err);
  }
});

// PUT /api/streetlights/:id
streetlightsRouter.put('/:id', validateGeoJSONPoint, async (req, res, next) => {
  try {
    const updatedFeature = await streetlightsService.update(req.params.id, req.body);
    res.json(updatedFeature);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/streetlights/:id
streetlightsRouter.delete('/:id', async (req, res, next) => {
  try {
    await streetlightsService.delete(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
