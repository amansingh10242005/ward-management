import { Router } from 'express';
import { statesService } from '../services/states.service.js';
import { validateBboxQuery } from '../validators/geojson.validator.js';

export const statesRouter = Router();

statesRouter.get('/', validateBboxQuery, async (req, res, next) => {
  try {
    const data = await statesService.getAll(req.bbox);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

statesRouter.put('/:id', async (req, res, next) => {
  try {
    const updated = await statesService.update(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

statesRouter.delete('/:id', async (req, res, next) => {
  try {
    await statesService.delete(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
