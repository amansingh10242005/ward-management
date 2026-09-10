import { Router } from 'express';

export const geoserverRouter = Router();

const GEOSERVER_URL = process.env.GEOSERVER_URL || 'http://localhost:8080/geoserver';
const GEOSERVER_USER = process.env.GEOSERVER_USER || 'admin';
const GEOSERVER_PASSWORD = process.env.GEOSERVER_PASSWORD || 'geoserver';
const WORKSPACE = 'ward';

// Cache for layer schemas and workspace URI
const schemaCache = new Map();
let cachedWorkspaceUri = 'http://ward.local';

async function getWorkspaceUri() {
  try {
    const authHeader = 'Basic ' + Buffer.from(`${GEOSERVER_USER}:${GEOSERVER_PASSWORD}`).toString('base64');
    const res = await fetch(`${GEOSERVER_URL}/rest/namespaces/${WORKSPACE}.json`, {
      headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.namespace?.uri) {
        cachedWorkspaceUri = data.namespace.uri;
      }
    }
  } catch (err) {
    console.warn('[GeoServer] Could not fetch namespace URI, using fallback:', cachedWorkspaceUri);
  }
  return cachedWorkspaceUri;
}

// Fetch and cache dynamic schema from GeoServer DescribeFeatureType
async function fetchSchemaInternal(layerName) {
  const qualifiedName = `${WORKSPACE}:${layerName}`;
  if (schemaCache.has(qualifiedName)) {
    return schemaCache.get(qualifiedName);
  }

  const authHeader = 'Basic ' + Buffer.from(`${GEOSERVER_USER}:${GEOSERVER_PASSWORD}`).toString('base64');
  const headers = { 'Authorization': authHeader };

  const describeUrl = `${GEOSERVER_URL}/ows?service=wfs&version=2.0.0&request=DescribeFeatureType&typeName=${qualifiedName}&outputFormat=application/json`;
  const describeRes = await fetch(describeUrl, { headers });

  if (!describeRes.ok) {
    throw new Error(`GeoServer DescribeFeatureType error: ${describeRes.status}`);
  }

  const schemaData = await describeRes.json();
  const featureType = schemaData.featureTypes?.[0];
  if (!featureType) {
    throw new Error(`No featureType found in schema for ${layerName}`);
  }

  const schema = {
    layerName: layerName,
    qualifiedName: qualifiedName,
    properties: (featureType.properties || []).map(p => ({
      name: p.name,
      type: p.type, // e.g. "gml:MultiPolygon", "xsd:string", "xsd:int"
      localType: p.localType // e.g. "MultiPolygon", "string", "int"
    }))
  };

  schemaCache.set(qualifiedName, schema);
  return schema;
}

// 1. Layer Discovery (pre-warms schema cache for all discovered layers)
geoserverRouter.get('/layers', async (req, res, next) => {
  try {
    const authHeader = 'Basic ' + Buffer.from(`${GEOSERVER_USER}:${GEOSERVER_PASSWORD}`).toString('base64');
    const headers = { 
      'Authorization': authHeader, 
      'Accept': 'application/json' 
    };

    // Ensure workspace URI is initialized
    await getWorkspaceUri();

    // Fetch list of layers in the workspace
    const layersUrl = `${GEOSERVER_URL}/rest/workspaces/${WORKSPACE}/layers.json`;
    const layersRes = await fetch(layersUrl, { headers });
    
    if (!layersRes.ok) {
      if (layersRes.status === 404) {
        return res.json({ layers: [] });
      }
      throw new Error(`GeoServer layers error: ${layersRes.status} ${layersRes.statusText}`);
    }

    const layersData = await layersRes.json();
    let rawLayers = [];
    if (layersData.layers && layersData.layers.layer) {
      if (Array.isArray(layersData.layers.layer)) {
        rawLayers = layersData.layers.layer;
      } else {
        rawLayers = [layersData.layers.layer];
      }
    }

    // Fetch detailed featuretype metadata for each layer in parallel
    const discoveryPromises = rawLayers.map(async (l) => {
      try {
        const layerName = l.name;
        const ftUrl = `${GEOSERVER_URL}/rest/workspaces/${WORKSPACE}/featuretypes/${layerName}.json`;
        const ftRes = await fetch(ftUrl, { headers });
        
        if (!ftRes.ok) {
          return null; 
        }
        
        const ftData = await ftRes.json();
        const featureType = ftData.featureType;

        // Pre-warm schema cache in parallel (non-blocking)
        fetchSchemaInternal(layerName).catch(err => {
          console.warn(`[GeoServer] Schema pre-cache failed for ${layerName}:`, err.message);
        });

        return {
          workspace: WORKSPACE,
          name: layerName,
          qualifiedName: `${WORKSPACE}:${layerName}`,
          title: featureType.title || layerName,
          abstract: featureType.abstract || '',
          srs: featureType.srs || 'EPSG:4326',
          nativeBoundingBox: featureType.nativeBoundingBox,
          latLonBoundingBox: featureType.latLonBoundingBox,
        };
      } catch (err) {
        console.warn(`Failed to fetch metadata for layer ${l.name}`, err);
        return null;
      }
    });

    const discoveredLayers = (await Promise.all(discoveryPromises)).filter(Boolean);
    res.json({ layers: discoveredLayers });
  } catch (error) {
    console.error('GeoServer discovery failed:', error);
    res.status(503).json({ layers: [], error: 'GeoServer discovery unavailable' });
  }
});

// 2. Schema Endpoint
geoserverRouter.get('/schema/:layerName', async (req, res, next) => {
  try {
    const { layerName } = req.params;
    if (!/^[A-Za-z0-9_.-]+$/.test(layerName)) {
      return res.status(400).json({ error: 'Invalid layer name' });
    }

    const schema = await fetchSchemaInternal(layerName);
    res.json(schema);
  } catch (error) {
    console.error('GeoServer schema fetch failed:', error);
    res.status(500).json({ error: 'Failed to fetch layer schema' });
  }
});

// Helper to format coordinates into GML posList (longitude latitude in EPSG:4326 for WFS 1.1.0)
function formatPosList(coords) {
  return coords.map(c => `${c[0]} ${c[1]}`).join(' ');
}

// Helper to ensure linear ring is closed
function ensureClosedRing(ring) {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...ring, first];
  }
  return ring;
}

// Convert GeoJSON geometry to GML 3 with geometry normalization according to target schema
function serializeGeometryToGML(geom, targetGeomType) {
  if (!geom || !geom.type || !geom.coordinates) return '';

  const clientType = geom.type;
  const coords = geom.coordinates;
  const normalizedTarget = (targetGeomType || '').toLowerCase();

  const isMultiPolygonTarget = normalizedTarget.includes('multipolygon');
  const isPolygonTarget = normalizedTarget.includes('polygon') && !isMultiPolygonTarget;
  const isMultiLineTarget = normalizedTarget.includes('multiline');
  const isLineTarget = normalizedTarget.includes('line') && !isMultiLineTarget;
  const isMultiPointTarget = normalizedTarget.includes('multipoint');
  const isPointTarget = normalizedTarget.includes('point') && !isMultiPointTarget;

  // 1. Polygon / MultiPolygon serialization
  if (isMultiPolygonTarget || clientType === 'MultiPolygon' || (clientType === 'Polygon' && !isPolygonTarget)) {
    // Treat as MultiPolygon
    let polygonRingsList = [];
    if (clientType === 'MultiPolygon') {
      polygonRingsList = coords; // [ [ [ [lon, lat], ... ] ] ]
    } else if (clientType === 'Polygon') {
      polygonRingsList = [coords]; // [ [ [lon, lat], ... ] ]
    }

    const polygonMembers = polygonRingsList.map(polygonCoords => {
      const closedRings = polygonCoords.map(ensureClosedRing);
      const linearRings = closedRings.map(ring => {
        return `<gml:LinearRing><gml:posList>${formatPosList(ring)}</gml:posList></gml:LinearRing>`;
      });
      return `<gml:polygonMember>
        <gml:Polygon srsName="EPSG:4326">
          <gml:exterior>${linearRings[0]}</gml:exterior>
          ${linearRings.slice(1).map(r => `<gml:interior>${r}</gml:interior>`).join('')}
        </gml:Polygon>
      </gml:polygonMember>`;
    }).join('');

    return `<gml:MultiPolygon srsName="EPSG:4326">${polygonMembers}</gml:MultiPolygon>`;
  }

  if (isPolygonTarget || clientType === 'Polygon') {
    let polygonCoords = coords;
    if (clientType === 'MultiPolygon') {
      polygonCoords = coords[0] || [];
    }
    const closedRings = polygonCoords.map(ensureClosedRing);
    const linearRings = closedRings.map(ring => {
      return `<gml:LinearRing><gml:posList>${formatPosList(ring)}</gml:posList></gml:LinearRing>`;
    });
    return `<gml:Polygon srsName="EPSG:4326">
      <gml:exterior>${linearRings[0]}</gml:exterior>
      ${linearRings.slice(1).map(r => `<gml:interior>${r}</gml:interior>`).join('')}
    </gml:Polygon>`;
  }

  // 2. LineString / MultiLineString serialization
  if (isMultiLineTarget || clientType === 'MultiLineString') {
    let linesList = [];
    if (clientType === 'MultiLineString') {
      linesList = coords;
    } else if (clientType === 'LineString') {
      linesList = [coords];
    }
    const lineMembers = linesList.map(lineCoords => {
      return `<gml:lineStringMember><gml:LineString srsName="EPSG:4326"><gml:posList>${formatPosList(lineCoords)}</gml:posList></gml:LineString></gml:lineStringMember>`;
    }).join('');
    return `<gml:MultiLineString srsName="EPSG:4326">${lineMembers}</gml:MultiLineString>`;
  }

  if (isLineTarget || clientType === 'LineString') {
    let lineCoords = coords;
    if (clientType === 'MultiLineString') {
      lineCoords = coords[0] || [];
    }
    return `<gml:LineString srsName="EPSG:4326"><gml:posList>${formatPosList(lineCoords)}</gml:posList></gml:LineString>`;
  }

  // 3. Point / MultiPoint serialization
  if (isMultiPointTarget || clientType === 'MultiPoint') {
    let pointsList = [];
    if (clientType === 'MultiPoint') {
      pointsList = coords;
    } else if (clientType === 'Point') {
      pointsList = [coords];
    }
    const pointMembers = pointsList.map(pt => {
      return `<gml:pointMember><gml:Point srsName="EPSG:4326"><gml:pos>${pt[0]} ${pt[1]}</gml:pos></gml:Point></gml:pointMember>`;
    }).join('');
    return `<gml:MultiPoint srsName="EPSG:4326">${pointMembers}</gml:MultiPoint>`;
  }

  if (isPointTarget || clientType === 'Point') {
    let pt = coords;
    if (clientType === 'MultiPoint') {
      pt = coords[0] || [0, 0];
    }
    return `<gml:Point srsName="EPSG:4326"><gml:pos>${pt[0]} ${pt[1]}</gml:pos></gml:Point>`;
  }

  return '';
}

// 3. Proxy WFS-T structured JSON payload to GeoServer WFS-T XML
geoserverRouter.post('/wfs/transaction', async (req, res, next) => {
  try {
    const { layerName, featureId, action, feature } = req.body;

    if (action !== 'update' && action !== 'delete' && action !== 'insert') {
      return res.status(400).json({ error: 'Action must be update, delete, or insert' });
    }

    if (!layerName || typeof layerName !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(layerName)) {
      return res.status(400).json({ error: 'Invalid layerName' });
    }

    // For update and delete, featureId is required
    if (action !== 'insert') {
      if (!featureId || typeof featureId !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(featureId)) {
        return res.status(400).json({ error: 'Invalid featureId' });
      }

      // Cross-layer protection: if featureId is qualified with a layer prefix (e.g. tl_layer_1.36),
      // ensure prefix matches layerName exactly.
      if (featureId.includes('.')) {
        const idPrefix = featureId.split('.')[0];
        if (idPrefix !== layerName) {
          return res.status(400).json({
            error: `Cross-layer violation: feature ID '${featureId}' does not belong to layer '${layerName}'`
          });
        }
      }
    }

    const qualifiedName = `${WORKSPACE}:${layerName}`;
    const wsUri = cachedWorkspaceUri || await getWorkspaceUri();
    const authHeader = 'Basic ' + Buffer.from(`${GEOSERVER_USER}:${GEOSERVER_PASSWORD}`).toString('base64');
    const headers = { 
      'Authorization': authHeader,
      'Content-Type': 'text/xml'
    };
    const wfsUrl = `${GEOSERVER_URL}/${WORKSPACE}/ows`;

    // ── 3A. HANDLE INSERT ACTION ──────────────────────────────────────────
    if (action === 'insert') {
      if (!feature || typeof feature !== 'object') {
        return res.status(400).json({ error: 'Missing or invalid feature payload' });
      }

      let schema = schemaCache.get(qualifiedName);
      if (!schema) {
        schema = await fetchSchemaInternal(layerName);
      }

      const geomProp = schema.properties.find(p => 
        p.type.startsWith('gml:') || 
        p.localType.toLowerCase().includes('geom') || 
        p.localType.toLowerCase().includes('polygon') || 
        p.localType.toLowerCase().includes('point') || 
        p.localType.toLowerCase().includes('line')
      );
      const geomName = geomProp ? geomProp.name : 'geom';
      const targetGeomType = geomProp ? geomProp.localType : 'MultiPolygon';

      let propertyElements = '';
      if (feature.properties && typeof feature.properties === 'object') {
        for (const [key, value] of Object.entries(feature.properties)) {
          const inSchema = schema.properties.some(p => p.name === key && !p.type.startsWith('gml:') && p.name !== geomName);
          if (!inSchema) continue;

          // Exclude generated primary key columns
          if (key === 'id' || key === 'fid') continue;

          const valStr = value === null || value === undefined ? '' : String(value);
          const escapedValue = valStr
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

          propertyElements += `
          <${WORKSPACE}:${key}>${escapedValue}</${WORKSPACE}:${key}>`;
        }
      }

      let geometryElement = '';
      if (feature.geometry) {
        const gmlString = serializeGeometryToGML(feature.geometry, targetGeomType);
        if (gmlString) {
          geometryElement = `
          <${WORKSPACE}:${geomName}>
            ${gmlString}
          </${WORKSPACE}:${geomName}>`;
        }
      }

      const wfsInsertPayload = `
      <wfs:Transaction service="WFS" version="1.1.0"
          xmlns:wfs="http://www.opengis.net/wfs"
          xmlns:gml="http://www.opengis.net/gml"
          xmlns:${WORKSPACE}="${wsUri}"
          xmlns:ogc="http://www.opengis.net/ogc">
        <wfs:Insert>
          <${WORKSPACE}:${layerName}>
            ${geometryElement}
            ${propertyElements}
          </${WORKSPACE}:${layerName}>
        </wfs:Insert>
      </wfs:Transaction>`;

      const wfsRes = await fetch(wfsUrl, {
        method: 'POST',
        headers,
        body: wfsInsertPayload
      });

      const wfsText = await wfsRes.text();

      if (!wfsRes.ok || wfsText.includes('ExceptionReport') || wfsText.includes('ServiceException') || wfsText.includes('FAILED')) {
        console.error('[WFS-T Insert Error]:', wfsText);
        const exMsg = wfsText.match(/<ows:ExceptionText>([^<]+)<\/ows:ExceptionText>/)?.[1] ||
                      wfsText.match(/<ServiceException>([^<]+)<\/ServiceException>/)?.[1] ||
                      'GeoServer rejected insert transaction';
        return res.status(400).json({ error: exMsg });
      }

      const insertMatch = wfsText.match(/<(?:wfs:)?totalInserted>(\d+)<\/(?:wfs:)?totalInserted>/i);
      const totalInserted = insertMatch ? parseInt(insertMatch[1], 10) : 0;

      if (totalInserted !== 1) {
        console.warn(`[WFS-T Zero-Insert] totalInserted: ${totalInserted}`);
        return res.status(400).json({
          success: false,
          error: `GeoServer transaction inserted 0 features.`,
          totalInserted
        });
      }

      const fidMatch = wfsText.match(/<(?:ogc|wfs):FeatureId\s+fid="([^"]+)"/i);
      const insertedFid = fidMatch ? fidMatch[1] : null;

      return res.json({
        success: true,
        message: 'Feature inserted successfully',
        totalInserted: 1,
        action: 'insert',
        featureId: insertedFid
      });
    }

    // ── 3B. HANDLE DELETE ACTION ──────────────────────────────────────────
    if (action === 'delete') {
      const wfsDeletePayload = `
      <wfs:Transaction service="WFS" version="1.1.0"
          xmlns:wfs="http://www.opengis.net/wfs"
          xmlns:gml="http://www.opengis.net/gml"
          xmlns:${WORKSPACE}="${wsUri}"
          xmlns:ogc="http://www.opengis.net/ogc">
        <wfs:Delete typeName="${qualifiedName}">
          <ogc:Filter>
            <ogc:FeatureId fid="${featureId}"/>
          </ogc:Filter>
        </wfs:Delete>
      </wfs:Transaction>`;

      const wfsRes = await fetch(wfsUrl, {
        method: 'POST',
        headers,
        body: wfsDeletePayload
      });

      const wfsText = await wfsRes.text();

      if (!wfsRes.ok || wfsText.includes('ExceptionReport') || wfsText.includes('ServiceException') || wfsText.includes('FAILED')) {
        console.error('[WFS-T Delete Error]:', wfsText);
        const exMsg = wfsText.match(/<ows:ExceptionText>([^<]+)<\/ows:ExceptionText>/)?.[1] ||
                      wfsText.match(/<ServiceException>([^<]+)<\/ServiceException>/)?.[1] ||
                      'GeoServer rejected delete transaction';
        return res.status(400).json({ error: exMsg });
      }

      // Parse totalDeleted from WFS-T TransactionResponse
      const deleteMatch = wfsText.match(/<(?:wfs:)?totalDeleted>(\d+)<\/(?:wfs:)?totalDeleted>/i);
      const totalDeleted = deleteMatch ? parseInt(deleteMatch[1], 10) : 0;

      if (totalDeleted !== 1) {
        console.warn(`[WFS-T Zero-Delete] totalDeleted: ${totalDeleted} for fid: ${featureId}`);
        return res.status(400).json({
          success: false,
          error: `GeoServer transaction deleted 0 features. Feature ID '${featureId}' was not found or could not be deleted.`,
          totalDeleted
        });
      }

      return res.json({
        success: true,
        message: 'Feature deleted successfully',
        totalDeleted: 1,
        action: 'delete',
        featureId
      });
    }

    // ── 3B. HANDLE UPDATE ACTION ──────────────────────────────────────────
    if (!feature || typeof feature !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid feature payload' });
    }

    // Schema cache fallback: if cold, auto-fetch schema so transaction never fails with 400
    let schema = schemaCache.get(qualifiedName);
    if (!schema) {
      schema = await fetchSchemaInternal(layerName);
    }

    // Determine geometry column and expected target geometry type
    const geomProp = schema.properties.find(p => 
      p.type.startsWith('gml:') || 
      p.localType.toLowerCase().includes('geom') || 
      p.localType.toLowerCase().includes('polygon') || 
      p.localType.toLowerCase().includes('point') || 
      p.localType.toLowerCase().includes('line')
    );
    const geomName = geomProp ? geomProp.name : 'geom';
    const targetGeomType = geomProp ? geomProp.localType : 'MultiPolygon';

    // Construct Property Updates with XML escaping and schema validation
    let propertyUpdates = '';
    if (feature.properties && typeof feature.properties === 'object') {
      for (const [key, value] of Object.entries(feature.properties)) {
        // Must exist in schema and not be geometry
        const inSchema = schema.properties.some(p => p.name === key && !p.type.startsWith('gml:') && p.name !== geomName);
        if (!inSchema) continue;

        if (key === 'id' || key === 'fid') continue;

        const valStr = value === null || value === undefined ? '' : String(value);
        const escapedValue = valStr
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');

        propertyUpdates += `
        <wfs:Property>
          <wfs:Name>${key}</wfs:Name>
          <wfs:Value>${escapedValue}</wfs:Value>
        </wfs:Property>`;
      }
    }

    // Convert and normalize geometry
    let geometryUpdate = '';
    if (feature.geometry) {
      const gmlString = serializeGeometryToGML(feature.geometry, targetGeomType);
      if (gmlString) {
        geometryUpdate = `
        <wfs:Property>
          <wfs:Name>${geomName}</wfs:Name>
          <wfs:Value>${gmlString}</wfs:Value>
        </wfs:Property>`;
      }
    }

    if (!propertyUpdates && !geometryUpdate) {
      return res.status(400).json({ error: 'No valid property or geometry updates provided' });
    }

    // Construct WFS-T Payload targeting GeoServer
    const wfsPayload = `
    <wfs:Transaction service="WFS" version="1.1.0"
        xmlns:wfs="http://www.opengis.net/wfs"
        xmlns:gml="http://www.opengis.net/gml"
        xmlns:${WORKSPACE}="${wsUri}"
        xmlns:ogc="http://www.opengis.net/ogc">
      <wfs:Update typeName="${qualifiedName}">
        ${propertyUpdates}
        ${geometryUpdate}
        <ogc:Filter>
          <ogc:FeatureId fid="${featureId}"/>
        </ogc:Filter>
      </wfs:Update>
    </wfs:Transaction>`;

    const wfsRes = await fetch(wfsUrl, {
      method: 'POST',
      headers,
      body: wfsPayload
    });

    const wfsText = await wfsRes.text();

    if (!wfsRes.ok || wfsText.includes('ExceptionReport') || wfsText.includes('ServiceException') || wfsText.includes('FAILED')) {
      console.error('[WFS-T Error]:', wfsText);
      const exMsg = wfsText.match(/<ows:ExceptionText>([^<]+)<\/ows:ExceptionText>/)?.[1] ||
                    wfsText.match(/<ServiceException>([^<]+)<\/ServiceException>/)?.[1] ||
                    'GeoServer rejected transaction';
      return res.status(400).json({ error: exMsg });
    }

    // Parse totalUpdated from WFS-T TransactionResponse
    const updateMatch = wfsText.match(/<wfs:totalUpdated>(\d+)<\/wfs:totalUpdated>/i);
    const totalUpdated = updateMatch ? parseInt(updateMatch[1], 10) : 0;

    if (totalUpdated !== 1) {
      console.warn(`[WFS-T Zero-Update] totalUpdated: ${totalUpdated} for fid: ${featureId}`);
      return res.status(400).json({
        success: false,
        error: `GeoServer transaction updated 0 features. Feature ID '${featureId}' was not found or could not be updated.`,
        totalUpdated: 0
      });
    }

    res.json({ success: true, message: 'Transaction successful', totalUpdated: 1 });
  } catch (error) {
    console.error('GeoServer WFS-T failed:', error);
    res.status(500).json({ error: error.message || 'WFS transaction failed' });
  }
});
