import 'dotenv/config';
import { pool } from './src/db/pool.js';

async function measure() {
  console.log('====================================================');
  console.log('PHASE 3: PERFORMANCE BASELINE MEASUREMENTS');
  console.log('====================================================\n');

  // 1. PostGIS Geometry Complexity & Sizes
  console.log('1. PostGIS Geometry Complexity & Storage Size:');
  const tables = ['states', 'districts', 'zones', 'roads', 'streetlights'];

  for (const tbl of tables) {
    const query = `
      SELECT 
        count(*) as row_count,
        ROUND(AVG(ST_NPoints(geom))) as avg_points,
        MAX(ST_NPoints(geom)) as max_points,
        SUM(ST_NPoints(geom)) as total_points,
        pg_size_pretty(SUM(ST_MemSize(geom))::bigint) as mem_size,
        pg_size_pretty(SUM(octet_length(ST_AsGeoJSON(geom)))::bigint) as geojson_text_size,
        ROUND(AVG(octet_length(ST_AsGeoJSON(geom)))) as avg_geojson_bytes
      FROM "${tbl}"
    `;
    const res = await pool.query(query);
    console.log(`Table '${tbl}':`);
    console.table(res.rows);
  }

  // 2. GeoServer WFS Payload Sizes & Latencies
  console.log('\n2. GeoServer WFS GetFeature Payloads (Raw vs Filtered):');
  const geoserverUrl = 'http://localhost:8080/geoserver/ward/ows';

  const wfsQueries = [
    {
      name: 'States Full WFS (current)',
      url: `${geoserverUrl}?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:states&outputFormat=application/json&srsname=EPSG:3857`
    },
    {
      name: 'States BBOX WFS (Chennai bbox, current)',
      url: `${geoserverUrl}?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:states&outputFormat=application/json&srsname=EPSG:3857&bbox=8926000,1455000,8945000,1475000,EPSG:3857`
    },
    {
      name: 'Districts Full WFS (current)',
      url: `${geoserverUrl}?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:districts&outputFormat=application/json&srsname=EPSG:3857`
    },
    {
      name: 'Districts BBOX WFS (Chennai bbox, current)',
      url: `${geoserverUrl}?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:districts&outputFormat=application/json&srsname=EPSG:3857&bbox=8926000,1455000,8945000,1475000,EPSG:3857`
    },
    {
      name: 'Zones BBOX WFS (Chennai bbox)',
      url: `${geoserverUrl}?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:zones&outputFormat=application/json&srsname=EPSG:3857&bbox=8926000,1455000,8945000,1475000,EPSG:3857`
    },
    {
      name: 'Roads BBOX WFS (Chennai bbox)',
      url: `${geoserverUrl}?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:roads&outputFormat=application/json&srsname=EPSG:3857&bbox=8926000,1455000,8945000,1475000,EPSG:3857`
    },
    {
      name: 'Streetlights BBOX WFS (Chennai bbox)',
      url: `${geoserverUrl}?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:streetlights&outputFormat=application/json&srsname=EPSG:3857&bbox=8926000,1455000,8945000,1475000,EPSG:3857`
    },
    {
      name: 'Districts Property-Limited WFS (id, District, STATE)',
      url: `${geoserverUrl}?service=WFS&version=1.1.0&request=GetFeature&typeName=ward:districts&outputFormat=application/json&srsname=EPSG:3857&propertyName=id,District,STATE&maxFeatures=200`
    }
  ];

  for (const q of wfsQueries) {
    const t0 = Date.now();
    try {
      const resp = await fetch(q.url);
      const text = await resp.text();
      const elapsed = Date.now() - t0;
      const sizeKb = (text.length / 1024).toFixed(1);
      let featureCount = 0;
      try {
        const json = JSON.parse(text);
        featureCount = json.features?.length ?? 0;
      } catch (e) {}
      console.log(`  ${q.name}: ${elapsed}ms | ${sizeKb} KB | ${featureCount} features | HTTP ${resp.status}`);
    } catch (err) {
      console.log(`  ${q.name}: FAILED - ${err.message}`);
    }
  }

  // 3. GeoServer WMS Tile vs Untiled Payload Sizes & Latencies
  console.log('\n3. GeoServer WMS GetMap Latencies & Sizes:');
  const wmsQueries = [
    {
      name: 'States WMS Tile (256x256)',
      url: 'http://localhost:8080/geoserver/ward/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=ward%3Astates&TILED=true&SRS=EPSG%3A3857&BBOX=8922880.88,1408887.35,9001152.88,1487159.35&WIDTH=256&HEIGHT=256'
    },
    {
      name: 'Districts WMS Tile (256x256)',
      url: 'http://localhost:8080/geoserver/ward/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=ward%3Adistricts&TILED=true&SRS=EPSG%3A3857&BBOX=8922880.88,1408887.35,9001152.88,1487159.35&WIDTH=256&HEIGHT=256'
    },
    {
      name: 'Zones WMS (Untiled single-image viewport 1280x600)',
      url: 'http://localhost:8080/geoserver/ward/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=ward%3Azones&SRS=EPSG%3A3857&BBOX=8920000,1450000,8950000,1480000&WIDTH=1280&HEIGHT=600'
    },
    {
      name: 'Zones WMS Tile (256x256, TILED=false in TileWMS currently)',
      url: 'http://localhost:8080/geoserver/ward/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=ward%3Azones&TILED=false&SRS=EPSG%3A3857&BBOX=8922880.88,1408887.35,9001152.88,1487159.35&WIDTH=256&HEIGHT=256'
    }
  ];

  for (const q of wmsQueries) {
    const t0 = Date.now();
    try {
      const resp = await fetch(q.url);
      const buf = await resp.arrayBuffer();
      const elapsed = Date.now() - t0;
      const sizeKb = (buf.byteLength / 1024).toFixed(1);
      console.log(`  ${q.name}: ${elapsed}ms | ${sizeKb} KB | HTTP ${resp.status}`);
    } catch (err) {
      console.log(`  ${q.name}: FAILED - ${err.message}`);
    }
  }

  // 4. Backend Search API Latency & Query Plan
  console.log('\n4. Backend Search API & Query Plan:');
  const searchTerms = ['Tamil', 'Chen', 'Zone', 'Road'];
  for (const term of searchTerms) {
    const t0 = Date.now();
    const res = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS) SELECT id, "state", "state_lgd" FROM states WHERE "state" ILIKE $1`,
      [`%${term}%`]
    );
    const elapsed = Date.now() - t0;
    console.log(`  States ILIKE '%${term}%': ${elapsed}ms`);
  }

  for (const term of searchTerms) {
    const t0 = Date.now();
    const res = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS) SELECT id, "district", "state" FROM districts WHERE "district" ILIKE $1 OR "state" ILIKE $1 LIMIT 50`,
      [`%${term}%`]
    );
    const elapsed = Date.now() - t0;
    console.log(`  Districts ILIKE '%${term}%' (742 rows): ${elapsed}ms | ${res.rows[0]['QUERY PLAN']}`);
  }

  await pool.end();
}

measure().catch(console.error);
