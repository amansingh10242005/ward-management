# Live QGIS → PostGIS Import Workflow

## 1. Purpose
This workflow details the exact manual steps for importing arbitrary, unfamiliar vector data into the `ward_db` PostGIS database using QGIS during a live demonstration. It ensures the data is safely persisted, indexed, and handed off to GeoServer for publication without writing new backend/frontend code.

## 2. Prerequisites
- QGIS 3.x installed locally.
- Access to the local PostgreSQL database (`ward_db`).
- GeoServer running locally on port `8080`.
- TL-provided vector datasets (Shapefile, GeoJSON, or KML).

## 3. QGIS PostgreSQL Connection
In QGIS, create a new PostgreSQL connection in the Browser panel:
- **Connection Name**: `ward_db_local`
- **Host**: `localhost` (or as defined in your `.env` `DB_HOST`)
- **Port**: `5432` (or as defined in your `.env` `DB_PORT`)
- **Database**: `ward_db` (or as defined in your `.env` `DB_NAME`)
- **Username**: `admin` (or as defined in your `.env` `DB_USER`)
- **Password**: `geoserver` (or as defined in your `.env` `DB_PASSWORD`)

*Note: Use the environment credentials configured in your project. Do not hardcode production secrets.*

## 4. Loading Vector Data
1. Open QGIS.
2. Drag and drop the TL-provided vector file (e.g., `.shp`, `.geojson`) into the QGIS Layers panel.
3. The data will render in the QGIS canvas.

## 5. Inspecting CRS and Geometry
Before importing, you must verify the source data:
1. **Right-click** the layer in the QGIS Layers panel -> **Properties**.
2. **Information Tab**: 
   - Note the **Geometry type** (e.g., Point, LineString, Polygon, MultiPolygon).
   - Note the **CRS** (Coordinate Reference System, e.g., EPSG:4326, EPSG:32644).
3. **Fields Tab**: Note the available attribute columns.

## 6. Importing into PostGIS
1. In QGIS, navigate to **Database** -> **DB Manager**.
2. Expand **PostGIS** -> `ward_db_local` -> `public`.
3. Click the **Import Layer/File** button (downward arrow icon).
4. **Input layer**: Select the loaded TL vector layer.
5. **Table name**: Enter a safe, lowercase PostgreSQL identifier without spaces (e.g., `tl_layer_1`).
6. **Primary key**: Check the box and use `id`.
7. **Geometry column**: Check the box and use `geom`.
8. **Target SRID**: Check the box and enter `4326` (QGIS will automatically transform the CRS to standard EPSG:4326 WGS84 for you).
9. **Spatial Index**: Uncheck this box (we will create it manually to ensure correctness).
10. Click **OK** to execute the import.

## 7. Verifying Table and Geometry
In QGIS DB Manager (or `psql`), open the SQL Window and run these read-only queries. Substitute `tl_layer_1` with your actual table name:

```sql
-- 1. Verify row count
SELECT count(*) FROM public.tl_layer_1;

-- 2. Verify SRID (Should return 4326)
SELECT DISTINCT ST_SRID(geom) FROM public.tl_layer_1;

-- 3. Verify Geometry Type (e.g., ST_MultiPolygon, ST_Point)
SELECT DISTINCT ST_GeometryType(geom) FROM public.tl_layer_1;

-- 4. Verify Geometry Validity (Should return 0)
SELECT count(*) FROM public.tl_layer_1 WHERE ST_IsValid(geom) = false;
```

## 8. Creating GiST Index
A spatial index is required for performant bounding box queries. In the QGIS DB Manager SQL Window (or `psql`), execute:

```sql
CREATE INDEX tl_layer_1_geom_gist_idx
ON public.tl_layer_1
USING GIST (geom);
```
*(Ensure you replace `tl_layer_1` and `geom` with your actual table and geometry column names if different).*

## 9. Verifying GiST Index
Run this read-only query to confirm the index exists and is associated with the geometry column:

```sql
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'tl_layer_1';
```

## 10. Publishing in GeoServer
1. Open GeoServer Admin (`http://localhost:8080/geoserver`).
2. Navigate to **Layers** -> **Add a new layer**.
3. Choose the `ward:ward_db` store.
4. Locate `tl_layer_1` in the list and click **Publish**.
5. **Coordinate Reference System**: 
   - Native SRS should show `EPSG:4326`.
   - Set Declared SRS to `EPSG:4326`.
6. **Bounding Boxes**:
   - Click **Compute from data**.
   - Click **Compute from native bounds**.
7. Navigate to the **Publishing** tab.

## 11. Applying Style
1. In the **Publishing** tab of the GeoServer layer configuration, scroll to **WMS Settings**.
2. Under **Default Style**, select the style provided by the TL (you may need to upload the TL's `.sld` file via **Styles** -> **Add a new style** beforehand).
3. Click **Save**.

## 12. WMS/WFS Preview
1. In GeoServer, navigate to **Layer Preview**.
2. Find `ward:tl_layer_1`.
3. Click **OpenLayers** to preview the WMS rendering in a new tab.
4. Click **GeoJSON** in the WFS dropdown to verify feature data returns correctly.

## 13. Handoff to Frontend
At this stage, the GIS backend is fully prepped. 
*Note: In Phase 7A, the frontend application is currently hardcoded to 5 layers. The application will not automatically discover `tl_layer_1`. Phase 7B/7C will introduce dynamic GeoServer GetCapabilities polling so the React frontend automatically registers and displays newly published layers.*

---

# TL Live Demo Procedure

Follow this script during the live assessment when the TL hands over new vector datasets:

**STEP 1** — Open QGIS and load the TL vector data (drag and drop).
**STEP 2** — Right-click layer -> Properties -> Verify CRS and Geometry Type.
**STEP 3** — Open DB Manager -> Connect to `ward_db_local`.
**STEP 4** — Import Layer -> Target `tl_layer_1`, SRID `4326`, Geometry column `geom`.
**STEP 5** — Run SQL: `SELECT count(*), ST_SRID(geom) FROM tl_layer_1;` to verify.
**STEP 6** — Run SQL: `CREATE INDEX tl_layer_1_geom_gist_idx ON tl_layer_1 USING GIST(geom);`
**STEP 7** — Open GeoServer -> Layers -> Add new layer -> `ward_db` -> Publish `tl_layer_1`.
**STEP 8** — Set Declared SRS to `EPSG:4326` and Compute Bounding Boxes.
**STEP 9** — Go to Publishing tab -> Apply the TL-provided SLD/style -> Save.
**STEP 10** — Go to Layer Preview -> Click OpenLayers to verify visual rendering.
**STEP 11** — (Repeat Steps 1-10 for Vector Dataset 2).
**STEP 12** — Wait for Phase 7B/7C implementation to demonstrate dynamic rendering in the React frontend.
