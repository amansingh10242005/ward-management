import { Router } from 'express';
import { districtsService } from '../services/districts.service.js';
import { validateBboxQuery } from '../validators/geojson.validator.js';

export const districtsRouter = Router();

districtsRouter.get('/', validateBboxQuery, async (req, res, next) => {
  try {
    const data = await districtsService.getAll(req.bbox);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

districtsRouter.put('/:id', async (req, res, next) => {
  try {
    const updated = await districtsService.update(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

districtsRouter.delete('/:id', async (req, res, next) => {
  try {
    await districtsService.delete(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
