# GeoServer Setup Guide

Since we are following a strict architecture where the read path goes through GeoServer directly, you must configure GeoServer manually to point to the `ward_db` PostGIS database.

This is a complete, step-by-step checklist to configure a fresh GeoServer instance for the Ward Management application.

## Prerequisites
- GeoServer running (e.g., at `http://localhost:8080/geoserver`)
- PostGIS database `ward_db` created and migrated.

---

## 1. Enable CORS in GeoServer
GeoServer does not allow Cross-Origin Resource Sharing (CORS) by default. Without this, your React frontend (`http://localhost:5173`) cannot fetch maps or WFS data.

1. Open your GeoServer installation directory (e.g., `C:\geoserver` or `/opt/geoserver`).
2. Navigate to `webapps/geoserver/WEB-INF/web.xml`.
3. Open `web.xml` in a text editor.
4. Search for the `cross-origin` filters. Uncomment the two filter blocks related to CORS:
   ```xml
   <filter>
     <filter-name>cross-origin</filter-name>
     <filter-class>org.eclipse.jetty.servlets.CrossOriginFilter</filter-class>
     <!-- ... options ... -->
   </filter>
   ```
   and the filter mapping block:
   ```xml
   <filter-mapping>
     <filter-name>cross-origin</filter-name>
     <url-pattern>/*</url-pattern>
   </filter-mapping>
   ```
5. Restart GeoServer.

---

## 2. Create a Workspace
1. Log in to the GeoServer Web Administration Interface.
2. Go to **Data > Workspaces**.
3. Click **Add new workspace**.
4. **Name**: `ward`
5. **Namespace URI**: `http://ward.local`
6. Check **Default Workspace**.
7. Save.

---

## 3. Create a Store (Connect to PostGIS)
1. Go to **Data > Stores**.
2. Click **Add new Store**.
3. Select **PostGIS**.
4. **Workspace**: `ward`
5. **Data Source Name**: `ward_db`
6. **Connection Parameters**:
   - **host**: `localhost`
   - **port**: `5432`
   - **database**: `ward_db`
   - **user**: `postgres` (or your db user)
   - **passwd**: `postgres` (or your db password)
7. **Expose primary keys**: ⚠️ Check this box! This is critical for OpenLayers WFS edit interactions to uniquely identify features (e.g., `streetlights.1`).
8. Save.

---

## 4. Publish Layers
GeoServer will show a list of tables from the database. Click **Publish** for each of the following (`streetlights`, `roads`, `zones`):

1. **Declared SRS**: Enter `EPSG:4326`.
2. **Bounding Boxes**: 
   - Click **Compute from data**.
   - Click **Compute from native bounds**.
3. Go to the **Publishing** tab to assign styles (see Step 5).
4. Save.

---

## 5. Add Custom SLD Styling
By default, GeoServer uses basic grey styles. You can upload custom SLD (Styled Layer Descriptor) files located in the `/geoserver_styles/` folder of this project repository.

1. Go to **Data > Styles**.
2. Click **Add a new style**.
3. Name it (e.g., `ward_streetlights_style`).
4. Select the `ward` workspace.
5. Under **Style Content**, upload the `.sld` file from `/geoserver_styles/` or paste its XML content.
6. Click **Validate** to ensure no syntax errors.
7. Click **Apply** / **Submit**.
8. Go back to your Layer (**Layers > streetlights**), click the **Publishing** tab, and set this new style as the **Default Style**.

---

## 6. Verify the Map (WMS / WFS)
Test that GeoServer is correctly serving the layers using these URLs. The example bounding boxes are centered over **Chennai, India**.

### Test WMS (Image Tiles)
Paste this into your browser (replace `8080` if your GeoServer port differs):
```
http://localhost:8080/geoserver/ward/wms?service=WMS&version=1.1.0&request=GetMap&layers=ward:streetlights&styles=&bbox=80.1,12.9,80.3,13.1&width=768&height=768&srs=EPSG:4326&format=image/png
```
You should see a PNG image with streetlight points.

### Test WFS (Raw GeoJSON)
Paste this into your browser:
```
http://localhost:8080/geoserver/ward/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=ward:streetlights&outputFormat=application/json
```
You should see a raw JSON payload containing the feature geometries.

---

## 7. Troubleshooting

If things aren't working, check the following:

- **Blank/Empty Image on GetMap**: 
  - Check your Bounding Boxes. The `bbox` in the URL might be looking at an area where you have no data. Verify that your layer's "Lat/Lon Bounding Box" in GeoServer makes sense.
- **`401 Unauthorized` or Browser CORS errors**: 
  - Did you forget to uncomment the `cross-origin` filter in `web.xml` (Step 1)? Ensure GeoServer was fully restarted after saving `web.xml`.
- **Connection Refused in GeoServer UI**: 
  - Check your PostGIS credentials in the Store setup (Step 3). Ensure PostgreSQL is running on port 5432 and the `ward_db` actually exists.
- **Cannot Select/Edit features in OpenLayers UI**: 
  - Did you forget to check "Expose primary keys" in the PostGIS Store configuration? Without primary keys, OpenLayers WFS cannot track individual features across modifications.
