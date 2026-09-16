import { Router } from 'express';
import { pool } from '../db/pool.js';

export const spatialRouter = Router();

const ALLOWED_LAYERS = ['zones', 'roads', 'streetlights', 'states', 'districts'];

spatialRouter.get('/extent/:layerName', async (req, res, next) => {
  try {
    const { layerName } = req.params;
    
    if (!ALLOWED_LAYERS.includes(layerName)) {
      return res.status(400).json({ error: 'Invalid layer name' });
    }

    // Get the extent of the layer in EPSG:3857 for direct frontend consumption
    const query = `
      SELECT ST_Extent(ST_Transform(geom, 3857)) as bbox 
      FROM ${layerName}
    `;
    
    const result = await pool.query(query);
    const bboxString = result.rows[0]?.bbox;
    
    if (!bboxString) {
      return res.json({ extent: null });
    }
    
    // Parse 'BOX(xmin ymin, xmax ymax)'
    const match = bboxString.match(/BOX\(([^ ]+) ([^,]+),([^ ]+) ([^)]+)\)/);
    if (!match) {
      return res.json({ extent: null });
    }

    const extent = [
      parseFloat(match[1]),
      parseFloat(match[2]),
      parseFloat(match[3]),
      parseFloat(match[4]),
    ];

    res.json({ extent });
  } catch (err) {
    next(err);
  }
});

spatialRouter.get('/extent/:layerName/:id', async (req, res, next) => {
  try {
    const { layerName, id } = req.params;
    
    // Allow dynamic layers, but sanitize layerName to prevent SQL injection
    if (!/^[a-zA-Z0-9_]+$/.test(layerName)) {
      return res.status(400).json({ error: 'Invalid layer name format' });
    }

    const query = `
      SELECT ST_Extent(ST_Transform(geom, 3857)) as bbox 
      FROM ${layerName} WHERE id = $1
    `;
    
    const result = await pool.query(query, [id]);
    const bboxString = result.rows[0]?.bbox;
    
    if (!bboxString) {
      return res.json({ extent: null });
    }
    
    const match = bboxString.match(/BOX\(([^ ]+) ([^,]+),([^ ]+) ([^)]+)\)/);
    if (!match) {
      return res.json({ extent: null });
    }

    const extent = [
      parseFloat(match[1]),
      parseFloat(match[2]),
      parseFloat(match[3]),
      parseFloat(match[4]),
    ];

    res.json({ extent });
  } catch (err) {
    next(err);
  }
});
