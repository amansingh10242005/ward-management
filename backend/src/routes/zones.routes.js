import { Router } from 'express';
import { zonesService } from '../services/zones.service.js';
import { validateGeoJSONPolygon, validateBboxQuery } from '../validators/geojson.validator.js';

export const zonesRouter = Router();

/**
 * zones.routes.js — Express router for the zones layer (Polygon geometries).
 * Structure mirrors streetlights.routes.js.
 */

zonesRouter.get('/', validateBboxQuery, async (req, res, next) => {
  try {
    const data = await zonesService.getAll(req.bbox);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

zonesRouter.post('/', validateGeoJSONPolygon, async (req, res, next) => {
  try {
    const newFeature = await zonesService.create(req.body);
    res.status(201).json(newFeature);
  } catch (err) {
    next(err);
  }
});

zonesRouter.put('/:id', validateGeoJSONPolygon, async (req, res, next) => {
  try {
    const updatedFeature = await zonesService.update(req.params.id, req.body);
    res.json(updatedFeature);
  } catch (err) {
    next(err);
  }
});

zonesRouter.delete('/:id', async (req, res, next) => {
  try {
    await zonesService.delete(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
