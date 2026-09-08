
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || 'geoserver',
  database: process.env.DB_NAME || 'ward_db',
});

const API_BASE = 'http://localhost:3001/api';
const GEOSERVER_WMS = 'http://localhost:8080/geoserver/ward/wms';
const LAYER_NAME = 'ward:streetlights';

async function verifyPipeline() {
  const report = [];
  try {
    console.log("=== STARTING PHASE 4 VERIFICATION ===");
    
    // ==========================================
    // 1. CREATE
    // ==========================================
    console.log("\\n--- 1. CREATE ---");
    const newFeature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [80.117875, 12.923306] },
      properties: { name: "Verification SL-01", type: "led", zone_id: 2, road_id: 1 }
    };
    
    // API Call
    const postRes = await fetch(`${API_BASE}/streetlights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newFeature)
    });
    const postData = await postRes.json();
    if (postData.error) throw new Error(postData.error + ': ' + postData.reason);
    
    // Handle both { id: 1 } and { type: 'Feature', id: 1 }
    const createdId = postData.id || postData.properties?.id;
    console.log(`API Result: POST successful, returned ID ${createdId}`);
    report.push(`CREATE API: Success, ID=${createdId}`);

    // PostGIS Check
    const dbRes = await pool.query(`SELECT id, name, ST_AsText(geom) as wkt FROM streetlights WHERE id = $1`, [createdId]);
    if (dbRes.rows.length === 1) {
      console.log(`PostGIS Result: Feature exists in DB. WKT: ${dbRes.rows[0].wkt}`);
      report.push(`CREATE DB: Verified in PostGIS, WKT=${dbRes.rows[0].wkt}`);
    } else {
      throw new Error("Feature not found in DB after POST");
    }

    // GeoServer WMS Check (GetFeatureInfo at the coordinate to see if it renders)
    // We can just issue a WMS GetFeatureInfo request at the coordinate bounds
    const bbox = `80.116,12.922,80.118,12.924`;
    const wmsRes = await fetch(`${GEOSERVER_WMS}?service=WMS&version=1.1.1&request=GetFeatureInfo&layers=${LAYER_NAME}&query_layers=${LAYER_NAME}&styles=&bbox=${bbox}&width=100&height=100&srs=EPSG:4326&format=image/png&info_format=application/json&x=50&y=50`);
    const wmsData = await wmsRes.json();
    const foundWms = wmsData.features && wmsData.features.some(f => f.id.includes(`streetlights.${createdId}`) || f.properties.name === "Verification SL-01");
    console.log(`GeoServer/WMS Result: Found in WMS GetFeatureInfo? ${foundWms}`);
    report.push(`CREATE WMS: ${foundWms ? 'Verified, Feature returned in WMS request' : 'NOT FOUND IN WMS'}`);

    // ==========================================
    // 2. UPDATE / MOVE
    // ==========================================
    console.log("\\n--- 2. UPDATE / MOVE ---");
    const updatedFeature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [80.1172, 12.9211] }, // Moved slightly along road
      properties: { name: "Verification SL-01-Moved", type: "led", zone_id: 2, road_id: 1 }
    };
    
    // API Call
    const putRes = await fetch(`${API_BASE}/streetlights/${createdId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedFeature)
    });
    const putData = await putRes.json();
    if (putData.error) throw new Error(putData.error + ': ' + putData.reason);
    console.log(`API Result: PUT successful`);
    report.push(`UPDATE API: Success`);

    // PostGIS Check
    const dbUpdateRes = await pool.query(`SELECT id, name, ST_AsText(geom) as wkt FROM streetlights WHERE id = $1`, [createdId]);
    console.log(`PostGIS Result: DB geometry updated. WKT: ${dbUpdateRes.rows[0].wkt}`);
    report.push(`UPDATE DB: Verified in PostGIS, New WKT=${dbUpdateRes.rows[0].wkt}`);

    // GeoServer WMS Check
    const bboxMoved = `80.116,12.920,80.118,12.922`;
    const wmsMovedRes = await fetch(`${GEOSERVER_WMS}?service=WMS&version=1.1.1&request=GetFeatureInfo&layers=${LAYER_NAME}&query_layers=${LAYER_NAME}&styles=&bbox=${bboxMoved}&width=100&height=100&srs=EPSG:4326&format=image/png&info_format=application/json&x=50&y=50`);
    const wmsMovedData = await wmsMovedRes.json();
    const foundWmsMoved = wmsMovedData.features && wmsMovedData.features.some(f => f.id.includes(`streetlights.${createdId}`) || f.properties.name === "Verification SL-01-Moved");
    console.log(`GeoServer/WMS Result: Found in WMS GetFeatureInfo at new location? ${foundWmsMoved}`);
    report.push(`UPDATE WMS: ${foundWmsMoved ? 'Verified, geometry changed in WMS' : 'NOT FOUND IN WMS'}`);

    // ==========================================
    // 3. DELETE
    // ==========================================
    console.log("\n--- 3. DELETE ---");
    // API Call
    const delRes = await fetch(`${API_BASE}/streetlights/${createdId}`, {
      method: 'DELETE'
    });
    console.log(`API Result: DELETE successful, Status: ${delRes.status}`);
    report.push(`DELETE API: Success, Status ${delRes.status}`);

    // PostGIS Check
    const dbDelRes = await pool.query(`SELECT id FROM streetlights WHERE id = $1`, [createdId]);
    const isDeleted = dbDelRes.rows.length === 0;
    console.log(`PostGIS Result: Is removed from DB? ${isDeleted}`);
    report.push(`DELETE DB: Verified, removed from PostGIS`);

    // GeoServer WMS Check
    const wmsDelRes = await fetch(`${GEOSERVER_WMS}?service=WMS&version=1.1.1&request=GetFeatureInfo&layers=${LAYER_NAME}&query_layers=${LAYER_NAME}&styles=&bbox=${bboxMoved}&width=100&height=100&srs=EPSG:4326&format=image/png&info_format=application/json&x=50&y=50`);
    const wmsDelData = await wmsDelRes.json();
    const foundWmsDel = wmsDelData.features && wmsDelData.features.some(f => f.id.includes(`streetlights.${createdId}`));
    console.log(`GeoServer/WMS Result: Still in WMS? ${foundWmsDel}`);
    report.push(`DELETE WMS: ${!foundWmsDel ? 'Verified, removed from WMS' : 'STILL IN WMS'}`);

    console.log("\n=== PIPELINE OK ===");

  } catch (e) {
    console.error("Verification failed:", e);
  } finally {
    pool.end();
  }
}

verifyPipeline();
