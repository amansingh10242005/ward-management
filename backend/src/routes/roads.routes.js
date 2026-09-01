import { Router } from 'express';
import { roadsService } from '../services/roads.service.js';
import { validateGeoJSONLineString, validateBboxQuery } from '../validators/geojson.validator.js';

export const roadsRouter = Router();

/**
 * roads.routes.js — Express router for the roads layer (LineString geometries).
 * Structure mirrors streetlights.routes.js.
 */

roadsRouter.get('/', validateBboxQuery, async (req, res, next) => {
  try {
    const data = await roadsService.getAll(req.bbox);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

roadsRouter.post('/', validateGeoJSONLineString, async (req, res, next) => {
  try {
    const newFeature = await roadsService.create(req.body);
    res.status(201).json(newFeature);
  } catch (err) {
    next(err);
  }
});

roadsRouter.put('/:id', validateGeoJSONLineString, async (req, res, next) => {
  try {
    const updatedFeature = await roadsService.update(req.params.id, req.body);
    res.json(updatedFeature);
  } catch (err) {
    next(err);
  }
});

roadsRouter.delete('/:id', async (req, res, next) => {
  try {
    await roadsService.delete(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
