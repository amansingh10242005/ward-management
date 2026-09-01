export function validateGeoJSONPoint(req, res, next) {
  const { body } = req;

  if (!body || body.type !== 'Feature') {
    return res.status(400).json({ error: 'Invalid body: must be a GeoJSON Feature' });
  }

  if (!body.geometry || body.geometry.type !== 'Point') {
    return res.status(400).json({ error: 'Invalid geometry: must be a Point' });
  }

  if (!Array.isArray(body.geometry.coordinates) || body.geometry.coordinates.length < 2) {
    return res.status(400).json({ error: 'Invalid coordinates: must be a non-empty array of numbers' });
  }

  if (!body.properties || typeof body.properties.name !== 'string' || body.properties.name.trim() === '') {
    return res.status(400).json({ error: 'Invalid properties: name must be a non-empty string' });
  }

  next();
}

export function validateGeoJSONLineString(req, res, next) {
  const { body } = req;

  if (!body || body.type !== 'Feature') {
    return res.status(400).json({ error: 'Invalid body: must be a GeoJSON Feature' });
  }

  if (!body.geometry || body.geometry.type !== 'LineString') {
    return res.status(400).json({ error: 'Invalid geometry: must be a LineString' });
  }

  if (!Array.isArray(body.geometry.coordinates) || body.geometry.coordinates.length < 2) {
    return res.status(400).json({ error: 'Invalid coordinates: must be an array of at least 2 points' });
  }

  if (!body.properties || typeof body.properties.name !== 'string' || body.properties.name.trim() === '') {
    return res.status(400).json({ error: 'Invalid properties: name must be a non-empty string' });
  }

  next();
}

export function validateGeoJSONPolygon(req, res, next) {
  const { body } = req;

  if (!body || body.type !== 'Feature') {
    return res.status(400).json({ error: 'Invalid body: must be a GeoJSON Feature' });
  }

  if (!body.geometry || body.geometry.type !== 'Polygon') {
    return res.status(400).json({ error: 'Invalid geometry: must be a Polygon' });
  }

  if (!Array.isArray(body.geometry.coordinates) || body.geometry.coordinates.length === 0) {
    return res.status(400).json({ error: 'Invalid coordinates: must be a non-empty array of linear rings' });
  }

  const exteriorRing = body.geometry.coordinates[0];
  if (!Array.isArray(exteriorRing) || exteriorRing.length < 4) {
    return res.status(400).json({ error: 'Invalid exterior ring: must have at least 4 coordinates' });
  }

  const firstCoord = exteriorRing[0];
  const lastCoord = exteriorRing[exteriorRing.length - 1];
  if (firstCoord[0] !== lastCoord[0] || firstCoord[1] !== lastCoord[1]) {
    return res.status(400).json({ error: 'Invalid ring: first and last coordinates must match (closed ring)' });
  }

  if (!body.properties || typeof body.properties.name !== 'string' || body.properties.name.trim() === '') {
    return res.status(400).json({ error: 'Invalid properties: name must be a non-empty string' });
  }

  next();
}

export function validateBboxQuery(req, res, next) {
  if (req.query.bbox) {
    const parts = req.query.bbox.split(',');
    if (parts.length !== 4) {
      return res.status(400).json({ error: 'Invalid bbox: must be 4 comma-separated numbers (minLon,minLat,maxLon,maxLat)' });
    }
    
    const nums = parts.map(Number);
    if (nums.some(n => isNaN(n))) {
      return res.status(400).json({ error: 'Invalid bbox: all values must be numbers' });
    }
    
    const [minLon, minLat, maxLon, maxLat] = nums;
    if (minLon < -180 || minLon > 180 || maxLon < -180 || maxLon > 180) {
      return res.status(400).json({ error: 'Invalid bbox: longitudes must be between -180 and 180' });
    }
    if (minLat < -90 || minLat > 90 || maxLat < -90 || maxLat > 90) {
      return res.status(400).json({ error: 'Invalid bbox: latitudes must be between -90 and 90' });
    }
    if (minLon > maxLon || minLat > maxLat) {
      return res.status(400).json({ error: 'Invalid bbox: minimum values must be less than or equal to maximum values' });
    }
    
    req.bbox = nums;
  }
  next();
}
