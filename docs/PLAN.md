# Ward Infrastructure Manager — Implementation Plan

> **Status**: Planning only. No code has been written. Each stage must be completed and
> verified before the next stage begins. This plan is grounded in the scaffold that already
> exists in this repository.

---

## Repository Map (current scaffold)

```
ward-management/
├── frontend/                        React + OpenLayers SPA (Vite + TypeScript)
│   └── src/
│       ├── App.tsx                  Layout shell — state TODOs marked
│       ├── components/
│       │   ├── MapContainer.tsx     OL DOM anchor — initializes olService on mount
│       │   ├── LayerControl.tsx     Stub checkboxes — not wired to OL yet
│       │   └── FeatureForm.tsx      Stub form — no handler yet
│       ├── features/
│       │   ├── streetlights/        Empty — interaction components go here
│       │   ├── roads/               Empty
│       │   └── zones/               Empty
│       ├── hooks/                   Empty — custom React hooks go here
│       ├── lib/
│       │   ├── api.ts               Stub apiClient — CRUD methods commented out
│       │   └── openlayers.ts        OpenLayersService stub — WMS + interactions commented out
│       ├── services/                Empty
│       ├── types/                   Empty — GeoJSON type aliases go here
│       └── utils/                   Empty
│
├── backend/                         Node.js + Express REST API (ES Modules)
│   └── src/
│       ├── index.js                 App entry — routers mounted, errorHandler last
│       ├── db/
│       │   └── pool.js              pg.Pool — reads from .env, exported singleton
│       ├── routes/
│       │   ├── streetlights.routes.js  All 4 CRUD stubs (returns empty responses)
│       │   ├── roads.routes.js         Same pattern, thinner scaffold
│       │   └── zones.routes.js         Same pattern
│       ├── services/
│       │   └── streetlights.service.js  Stub — SQL TODOs, no pool import yet
│       ├── middleware/
│       │   └── error-handler.middleware.js  Skeleton — statusCode mapping TODO
│       ├── validators/              Empty — geojson.validator.js import is commented out
│       └── utils/                   Empty
│
├── db/
│   ├── migrations/
│   │   ├── 001_enable_postgis.sql   CREATE EXTENSION IF NOT EXISTS postgis
│   │   ├── 002_create_streetlights.sql  Table + GIST index — schema complete
│   │   ├── 003_create_roads.sql         Table + GIST index — schema complete
│   │   └── 004_create_zones.sql         Table + GIST index — schema complete
│   └── seeds/
│       └── seed_sample_data.sql     London coords — will need updating to Chennai
│
└── docs/
    ├── geoserver-setup.md           Checklist skeleton (steps 1-5)
    └── PLAN.md                      This file (output to workspace docs/ folder)
```

> **Architecture reminder (from README)**
>
> - **READ PATH**: OpenLayers -> GeoServer (WMS/WFS) -> PostGIS. The Express backend is
>   **never** involved in map display.
> - **WRITE PATH**: OpenLayers event -> React state -> fetch() -> Express API -> PostGIS.
>   GeoServer receives **no WFS-T writes** from the frontend.
> - After every successful write the frontend must force OpenLayers to re-fetch the WMS
>   tile for that layer (cache-busting) so the map reflects the saved change.

---

## Stage 1 — Database Schema

**Goal**: Run all four migrations, load seed data, and confirm that PostGIS is healthy and
all three spatial tables exist with correct geometry columns and indexes.

---

### Step 1.1 — Create the ward_db database

**Accomplishes**: Provides the target database before any migration can run.

**Files involved**: None (psql shell only).

**Key decisions**:
- Owner: use postgres superuser or a dedicated app user. Using the superuser simplifies
  the PostGIS extension install (requires superuser); you can restrict privileges after.
- Encoding: UTF8 (default on modern PostgreSQL — nothing to change, just confirm).

**Verification (done when)**:
```sql
-- Run in psql connected to any database:
\l ward_db
-- Should show the database in the list.
```

---

### Step 1.2 — Run 001_enable_postgis.sql

**Accomplishes**: Installs the PostGIS extension into ward_db so geometry types and
spatial functions are available for the subsequent migrations.

**Files involved**: `db/migrations/001_enable_postgis.sql`

**Key decisions**:
- The migration already uses CREATE EXTENSION IF NOT EXISTS postgis — idempotent and
  safe to re-run.
- The user running this command must be a PostgreSQL superuser (or the database owner who
  has the CREATE privilege on ward_db). If you use a non-superuser app role you will
  get ERROR: must be superuser to create this extension.

**Verification**:
```sql
-- In psql connected to ward_db:
SELECT PostGIS_Full_Version();
-- Must return a version string without error.
\dx postgis
-- Should list postgis in the installed extensions.
```

---

### Step 1.3 — Run 002_create_streetlights.sql

**Accomplishes**: Creates the streetlights table with a typed geometry column
(geometry(Point, 4326)) and a GIST spatial index.

**Files involved**: `db/migrations/002_create_streetlights.sql`

**Key decisions / trade-offs**:
- **SRID 4326 (WGS 84)**: Chosen because OpenLayers default projection for WMS and GeoJSON
  is 4326/EPSG:4326. If you later need metric queries (e.g., distance in metres) you would
  either cast to EPSG:3857 inside the query or reproject at the DB level. Changing SRID later
  is expensive — confirm 4326 is correct before proceeding.
- **geometry(Point, 4326) vs geography**: The geometry type is used (as per the
  migration). geography would give true spherical distance calculations for free but is
  slightly slower for other operations. For urban-ward scale (Chennai) geometry + EPSG:4326
  is sufficient.
- **GIST index streetlights_geom_idx**: Already defined. A GIST index accelerates
  bounding-box queries (&& operator) and nearest-neighbor searches. No B-tree index on
  geom is needed or useful.
- **updated_at trigger**: The migration creates the column but does **not** create a
  BEFORE UPDATE trigger to auto-set updated_at. Decide now: either add such a trigger
  in a follow-up migration 005_add_update_triggers.sql, or update the column manually in
  every UPDATE SQL statement in the service layer. Doing it at the DB level is safer.

**Verification**:
```sql
\d streetlights
-- Columns: id, name, type, geom, created_at, updated_at
SELECT type, srid FROM geometry_columns WHERE f_table_name = 'streetlights';
-- type=POINT, srid=4326
\di streetlights_geom_idx
-- Index should appear.
```

---

### Step 1.4 — Run 003_create_roads.sql and 004_create_zones.sql

**Accomplishes**: Creates the roads (LineString/4326 + GIST) and zones (Polygon/4326
+ GIST) tables using the same pattern.

**Files involved**:
- `db/migrations/003_create_roads.sql`
- `db/migrations/004_create_zones.sql`

**Key decisions**:
- Same SRID and index decisions as Step 1.3.
- zones.type defaults to 'commercial'; roads.category defaults to 'local'. These
  are the only domain-specific enums in the schema. Consider whether you want to enforce
  these as CHECK constraints or PostgreSQL ENUM types (adds rigidity). For now, the
  plain VARCHAR default is flexible enough.
- Polygon validity: PostGIS will accept any polygon insert even if self-intersecting. You
  may want to add a CHECK (ST_IsValid(geom)) constraint to zones to prevent garbage
  data at the DB level. Decide before Stage 4 because it affects error handling.

**Verification**:
```sql
\d roads
\d zones
SELECT f_table_name, type, srid FROM geometry_columns
  WHERE f_table_name IN ('roads','zones');
-- Both should show correct geometry type and srid=4326.
```

---

### Step 1.5 — Update and run seed_sample_data.sql

**Accomplishes**: Populates all three tables with realistic sample data so GeoServer and
OpenLayers have visible features to display during development.

**Files involved**: `db/seeds/seed_sample_data.sql`

**Key decisions**:
- The existing seed uses **London coordinates** (approx -0.1276, 51.5074). The map is
  centered on **Chennai** (80.2707, 13.0827 — from openlayers.ts). You must update the
  seed coordinates to fall within Chennai's bounding box or the seeded features will never
  be visible on the map.
- Aim for at least 3-5 points (streetlights), 2-3 line segments (roads), and 1-2 polygons
  (zones) spread across a representative area of Chennai.
- Use ST_SetSRID(ST_MakePoint(lon, lat), 4326) for points and
  ST_GeomFromText('LINESTRING(...)', 4326) / POLYGON(...) for lines and polygons.
- The seed script is **not** idempotent — re-running it will duplicate rows. Either add
  TRUNCATE ... CASCADE; at the top, or use INSERT ... ON CONFLICT DO NOTHING with a
  unique constraint on name.

**Verification**:
```sql
SELECT id, name, ST_AsText(geom) FROM streetlights;
SELECT id, name, ST_AsText(geom) FROM roads;
SELECT id, name, ST_AsText(geom) FROM zones;
-- Coordinates should be in the Chennai area (lon ~80, lat ~13).
SELECT COUNT(*) FROM streetlights; -- >= 3
SELECT COUNT(*) FROM roads;        -- >= 2
SELECT COUNT(*) FROM zones;        -- >= 1
```

---

### Stage 1 — Done Criteria

All four migrations have run without errors. Seed data is loaded and all three tables return
Chennai-area coordinates in ST_AsText. GeoServer can only read the tables in Stage 2 if
this is complete.

---

## Stage 2 — GeoServer Configuration

**Goal**: Install GeoServer, create the ward workspace, connect it to ward_db, publish
all three tables as named layers with distinct SLD styles, and confirm each layer renders
via a browser WMS request.

---

### Step 2.1 — Install GeoServer

**Accomplishes**: Gets a running GeoServer instance accessible at
http://localhost:8080/geoserver.

**Files involved**: None in this repo. External download.

**Key decisions**:
- **Version**: README requires GeoServer 2.25+. Use the binary (platform-independent)
  installer, **not** the WAR file, unless you already have a servlet container running.
  The binary installer bundles Jetty; simpler for local dev.
- **Default credentials**: username admin, password geoserver. Change the password
  immediately after first login; update backend/.env (GEOSERVER_USER, GEOSERVER_PASSWORD)
  to match.
- **CORS**: GeoServer's WMS endpoint must accept requests from the frontend origin
  (http://localhost:5173 for Vite). Enable CORS in GeoServer Web Admin ->
  Security -> Services -> CORS (or edit web.xml in the WEB-INF directory for the WAR
  deployment). Without this, the browser will block WMS tile requests.

**Verification**:
Open http://localhost:8080/geoserver/web/ in a browser. The GeoServer admin UI must load
and the login must succeed.

---

### Step 2.2 — Create the ward workspace

**Accomplishes**: Creates the GeoServer namespace under which all three layers will live
(ward:streetlights, ward:roads, ward:zones).

**Files involved**: `docs/geoserver-setup.md` (checklist Step 1)

**Key decisions**:
- **Namespace URI**: The checklist uses http://ward.local. This is arbitrary but must be
  a valid URI. It does not need to resolve to anything.
- **Default workspace**: Checking "Default Workspace" means GeoServer uses ward when no
  workspace prefix is specified. This simplifies WMS URLs during testing.

**Verification**:
Navigate to Data -> Workspaces. The ward workspace must appear in the list.

---

### Step 2.3 — Create the PostGIS datastore

**Accomplishes**: Tells GeoServer how to connect to ward_db so it can read geometry
from PostGIS.

**Files involved**: `docs/geoserver-setup.md` (checklist Step 2), `backend/.env.example`

**Key decisions**:
- **Connection parameters**: Use the same host/port/database/user/password values as in
  backend/.env. Both GeoServer and Express talk to the same PostGIS database but via
  independent connections (JDBC vs pg pool).
- **Expose primary keys**: In the PostGIS connection parameters, set
  Expose primary keys = true. This allows GeoServer WFS responses to include the id
  column, which you will need in Stage 5-8 to match OL-selected features to API IDs.
- **Max connections**: Leave at default (10) for local dev. Production tuning is out of
  scope.
- **SSL**: Leave disabled for localhost dev. Enable for any non-localhost deployment.

**Verification**:
Navigate to Data -> Stores. The ward_db store must appear with a green status indicator.
Click "Edit" and use the "Test connection" button — it must return "Connection successful".

---

### Step 2.4 — Publish the streetlights layer

**Accomplishes**: Makes the streetlights PostGIS table available as the GeoServer layer
ward:streetlights over WMS and WFS.

**Files involved**: `docs/geoserver-setup.md` (checklist Step 3)

**Key decisions**:
- **Declared SRS**: Must be EPSG:4326 to match the table geometry.
- **Bounding Box**: Always click both "Compute from data" and "Compute from native bounds"
  after pointing to the store. If you forget, the layer will not render on a WMS GetMap
  request (GeoServer will return a blank image or error).
- **Feature type name**: Confirm it matches exactly streetlights (lowercase, no schema
  prefix unless the table is in a non-public schema).

**Verification** (done after Step 2.7 for all three layers, but can be done per layer):
```
http://localhost:8080/geoserver/ward/wms?service=WMS&version=1.1.1&request=GetMap
  &layers=ward:streetlights
  &bbox=<minx>,<miny>,<maxx>,<maxy>  (use Chennai bounds)
  &width=512&height=512
  &srs=EPSG:4326
  &styles=
  &format=image/png
```
The response must be a PNG image with point symbols visible (not a blank or error XML).

---

### Step 2.5 — Publish the roads and zones layers

**Accomplishes**: Makes ward:roads and ward:zones available over WMS/WFS using the same
publish workflow.

**Files involved**: `docs/geoserver-setup.md`

**Key decisions**: Same as Step 2.4. Geometry type differences (LineString vs Polygon) are
handled automatically by GeoServer's PostGIS datastore reader — no special configuration
needed beyond selecting the correct table.

**Verification**: Same GetMap request as Step 2.4, substituting ward:roads and
ward:zones respectively.

---

### Step 2.6 — Author and apply SLD styles

**Accomplishes**: Replaces GeoServer's default grey rendering with distinct, recognizable
styles for each geometry type.

**Files involved**:
- New file: `docs/sld/streetlights.sld` (Point — yellow circle, WellKnownName=circle)
- New file: `docs/sld/roads.sld` (LineString — blue stroke)
- New file: `docs/sld/zones.sld` (Polygon — semi-transparent fill + colored border)

**Key decisions**:
- **SLD 1.0 vs SE 1.1**: GeoServer supports both. SLD 1.0 is simpler for basic styling.
  Use SLD 1.0 for now.
- **Style naming convention**: Name styles ward_streetlights, ward_roads, ward_zones
  to avoid clashing with GeoServer's built-in point, line, polygon styles.
- Upload each SLD via Data -> Styles -> Add a new style. Assign each style to its
  corresponding layer in the layer's Publishing tab -> Default Style.
- **Trade-off**: Complex rule-based or thematic styling (e.g., color by type) is possible
  but should be deferred to Stage 10. Keep styles simple here.

**Verification**:
Use GeoServer's "Layer Preview" -> OpenLayers preview for each layer. Features must render
with the correct symbol/color. Run the same GetMap URL from Step 2.4 and confirm the
updated style is visible in the returned PNG.

---

### Step 2.7 — Verify WFS GetFeature (optional but recommended)

**Accomplishes**: Confirms GeoServer can return JSON features from PostGIS, which is needed
in Stage 3 for any WFS-based interactions.

**Files involved**: None.

**Verification**:
```
http://localhost:8080/geoserver/ward/ows?service=WFS&version=2.0.0&request=GetFeature
  &typeName=ward:streetlights
  &outputFormat=application/json
  &count=5
```
The response must be a GeoJSON FeatureCollection containing the seeded streetlight points.

---

### Stage 2 — Done Criteria

All three layers (ward:streetlights, ward:roads, ward:zones) return styled PNG images
from a direct browser WMS GetMap URL. GeoServer Layer Preview for each layer shows features
rendered over a base map. WFS GetFeature returns valid GeoJSON. Only then move to Stage 3.

---

## Stage 3 — OpenLayers Read Path

**Goal**: Wire the three GeoServer WMS layers into OpenLayersService, make them visible
on the map, and connect the existing LayerControl checkboxes to real layer visibility
toggling.

---

### Step 3.1 — Add environment variables for GeoServer

**Accomplishes**: Makes the GeoServer base URL and workspace name available to the Vite
frontend without hardcoding.

**Files involved**:
- New file: `frontend/.env.development` (copy from .env.example)
- `frontend/src/lib/openlayers.ts` (will read import.meta.env values)

**Key decisions**:
- Variables to set:
  - VITE_GEOSERVER_BASE_URL=http://localhost:8080/geoserver
  - VITE_GEOSERVER_WORKSPACE=ward
  - VITE_API_BASE_URL=http://localhost:3001
- All VITE_ prefixed variables are bundled into the client. Do **not** put secrets
  (GeoServer admin password) in VITE_ variables.
- The Vite dev proxy is an alternative to CORS for the backend API (VITE_API_BASE_URL),
  but GeoServer WMS requests need to go directly from the browser — the proxy approach only
  works if you also proxy GeoServer through Vite (add to vite.config.ts). Decide: use
  CORS on GeoServer directly (simpler, already decided in Step 2.1), or proxy through Vite.

**Verification**:
```ts
// In browser dev tools console, after Vite restarts:
import.meta.env.VITE_GEOSERVER_BASE_URL
// Must return 'http://localhost:8080/geoserver'
```

---

### Step 3.2 — Import TileWMS and TileLayer, add WMS sources in OpenLayersService

**Accomplishes**: Adds the three GeoServer WMS layers to the OpenLayers Map instance as
TileLayer / TileWMS sources alongside the existing OSM base layer.

**Files involved**: `frontend/src/lib/openlayers.ts`

**Key decisions**:
- **TileWMS vs ImageWMS**: TileWMS divides the viewport into a grid of tiles and
  caches them independently (faster for pan/zoom). ImageWMS requests a single image per
  view extent (useful for map labels that should not be cut at tile edges). For polygon/line
  layers where feature labels may span tiles, ImageWMS can look cleaner. For streetlights
  (points) TileWMS is fine. Either works; TileWMS is the more common choice for public
  tile caches.
- **Layer naming**: Store each WMS layer in a private Map<string, TileLayer> inside
  OpenLayersService keyed by 'streetlights', 'roads', 'zones'. This is needed in
  Step 3.4 and Stage 5 for refresh and toggle operations.
- **Layer order (z-index)**: Render in this order (bottom to top): OSM basemap -> zones
  (polygon) -> roads (line) -> streetlights (point). Points must render on top or they will
  be obscured by polygon fills.
- **crossOrigin: 'anonymous'**: Must be set on TileWMS source if you plan to use
  map.getCanvas() for screenshot export. Set it now to avoid a hard-to-debug "Tainted
  canvas" error later.

**Verification**:
Open the frontend dev server (npm run dev in frontend/). The map must display three
additional styled layers over the OSM basemap. Open browser DevTools -> Network tab: filter
by "wms" — you should see tile requests to localhost:8080/geoserver returning 200 with
image/png content type.

---

### Step 3.3 — Implement toggleLayer(layerName, visible) in OpenLayersService

**Accomplishes**: Adds the method that LayerControl will call to show/hide a WMS layer.

**Files involved**: `frontend/src/lib/openlayers.ts`

**Key decisions**:
- The method must call layer.setVisible(visible) on the TileLayer stored in the private
  map from Step 3.2.
- This is a pure OL operation — it does not trigger a network request for hidden layers.

---

### Step 3.4 — Wire LayerControl checkboxes to toggleLayer

**Accomplishes**: Makes the three existing stub checkboxes in LayerControl.tsx actually
control WMS layer visibility.

**Files involved**: `frontend/src/components/LayerControl.tsx`

**Key decisions**:
- **State management**: The defaultChecked on each checkbox must be replaced with
  controlled checked state. Two options:
  - **Local state in LayerControl**: Simple — useState for each checkbox, call
    olService.toggleLayer(name, checked) in the onChange handler. Works if the
    layer visibility state is only ever driven from LayerControl.
  - **Lifted state in App.tsx**: Necessary if other components (e.g., the draw toolbar
    in Stage 5) also need to know which layer is active. Lift state now to avoid refactoring
    later — recommended.
- The olService singleton (import { olService } from '../lib/openlayers') is already
  imported in MapContainer.tsx; import it in LayerControl.tsx the same way.

**Verification**:
- Uncheck "Zones" -> zone polygons must disappear from the map.
- Re-check "Zones" -> zone polygons must reappear without a page reload.
- Confirm in DevTools -> Network that no new WMS requests are made when a layer is hidden,
  and new tile requests appear when a hidden layer is re-enabled.

---

### Stage 3 — Done Criteria

Three styled WMS layers are visible on the map. Each LayerControl checkbox correctly
toggles its corresponding layer. The OSM base layer is unaffected. The map is centered on
Chennai and the seeded features are visible. Only then move to Stage 4.

---

## Stage 4 — Backend Write Path: Streetlights (GET / POST / PUT / DELETE)

**Goal**: Implement a fully functional CRUD API for streetlights at POST/GET/PUT/DELETE
/api/streetlights, with PostGIS geometry handling in the service layer, input validation,
and verification via curl/Postman — before touching any frontend code.

---

### Step 4.1 — Wire pool.js into streetlights.service.js

**Accomplishes**: Uncomments the pool import and establishes the actual database
connection for the service layer.

**Files involved**:
- `backend/src/db/pool.js` (already complete — no changes needed here)
- `backend/src/services/streetlights.service.js`

**Key decisions**:
- pool.js is already a fully working exported singleton that reads DB_* env vars. All
  service files must import from '../db/pool.js' — never create a new Pool instance
  elsewhere.
- Confirm backend/.env is configured with the correct ward_db credentials (copied from
  .env.example) before running any service code.

**Verification**:
Run curl http://localhost:3001/health after npm run dev. The /health route does not
touch the DB but confirms the server starts. Then temporarily add a test log in
getAll() to confirm the pool connects — or verify in Step 4.2.

---

### Step 4.2 — Implement getAll() in streetlights.service.js

**Accomplishes**: Returns all streetlights from PostGIS as a GeoJSON FeatureCollection.

**Files involved**: `backend/src/services/streetlights.service.js`

**Key decisions**:
- **ST_AsGeoJSON(geom)**: The canonical way to convert PostGIS geometry to a GeoJSON
  geometry string. Parse the returned string with JSON.parse() in JavaScript.
- **Row-to-Feature mapping**: Write a private mapRowToGeoJSONFeature(row) helper inside
  the service module that converts a DB row to a valid GeoJSON Feature object. All four
  CRUD methods will reuse this helper. Structure:
  ```js
  {
    type: 'Feature',
    id: row.id,
    geometry: JSON.parse(row.geom),
    properties: { name: row.name, type: row.type, ... }
  }
  ```
- **Column alias**: Use ST_AsGeoJSON(geom) AS geom in the SELECT to keep the column name
  consistent with the helper.

**Verification**:
```bash
curl http://localhost:3001/api/streetlights
# Must return:
# { "type": "FeatureCollection", "features": [ { "type": "Feature", ... }, ... ] }
# Features array must include the seeded data.
```

---

### Step 4.3 — Implement create(feature) in streetlights.service.js

**Accomplishes**: Inserts a new streetlight Point into PostGIS using the GeoJSON geometry
from the request body.

**Files involved**: `backend/src/services/streetlights.service.js`

**Key decisions**:
- **ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)**: This is the canonical pattern for
  inserting a geometry from a GeoJSON string. ST_GeomFromGeoJSON parses the GeoJSON
  geometry object; ST_SetSRID enforces the correct SRID (otherwise inserts default to
  SRID 0).
- **Parameter**: Pass JSON.stringify(feature.geometry) as $1. Never interpolate
  geometry directly into the SQL string (SQL injection risk).
- **RETURNING clause**: Use INSERT ... RETURNING id, name, type, ST_AsGeoJSON(geom) AS
  geom, created_at, updated_at and pass the returned row through mapRowToGeoJSONFeature to
  return the complete saved Feature to the client. This avoids a separate SELECT.

**Verification**:
```bash
curl -X POST http://localhost:3001/api/streetlights \
  -H "Content-Type: application/json" \
  -d '{"type":"Feature","geometry":{"type":"Point","coordinates":[80.2707,13.0827]},"properties":{"name":"Test Light","type":"solar"}}'
# Must return HTTP 201 with the saved Feature including a real id.
```
Then verify in psql:
```sql
SELECT id, name, ST_AsText(geom) FROM streetlights ORDER BY id DESC LIMIT 1;
```

---

### Step 4.4 — Implement update(id, feature) in streetlights.service.js

**Accomplishes**: Updates an existing streetlight's geometry and/or attributes by ID.

**Files involved**: `backend/src/services/streetlights.service.js`

**Key decisions**:
- **Not-found handling**: If UPDATE ... WHERE id = $1 RETURNING ... returns zero rows,
  throw a NotFoundError (a custom error class you will create in Step 4.7) with HTTP 404.
  The error handler already reads err.statusCode.
- **updated_at**: If you did not create a DB trigger (Step 1.3 decision), set
  updated_at = NOW() explicitly in the UPDATE statement.
- **Partial vs full update**: A PUT semantics means replace all fields. Accept the full
  GeoJSON Feature in the body. If you want to support partial updates (PATCH), that is a
  separate design decision — defer to Stage 10.

**Verification**:
```bash
curl -X PUT http://localhost:3001/api/streetlights/1 \
  -H "Content-Type: application/json" \
  -d '{"type":"Feature","geometry":{"type":"Point","coordinates":[80.275,13.085]},"properties":{"name":"Updated Light","type":"standard"}}'
# Must return HTTP 200 with updated Feature.
```
Verify in psql that the row's geom and updated_at changed.

---

### Step 4.5 — Implement delete(id) in streetlights.service.js

**Accomplishes**: Deletes a streetlight row by primary key.

**Files involved**: `backend/src/services/streetlights.service.js`

**Key decisions**:
- Check rowCount after the DELETE query. If rowCount === 0, the ID did not exist —
  throw a NotFoundError with HTTP 404.
- Return HTTP 204 No Content on success (already stubbed in the route).

**Verification**:
```bash
curl -X DELETE http://localhost:3001/api/streetlights/1
# Must return HTTP 204 with empty body.
curl -X DELETE http://localhost:3001/api/streetlights/9999
# Must return HTTP 404 with JSON error body.
```

---

### Step 4.6 — Uncomment and wire service calls in streetlights.routes.js

**Accomplishes**: Connects the completed service methods to the route handlers, removing
all the stub responses.

**Files involved**: `backend/src/routes/streetlights.routes.js`

**Key decisions**:
- Uncomment the streetlightsService import and the service calls in each route handler.
- The route layer should remain thin: extract params, call service, return result. No SQL
  belongs in route files.
- Each handler already has try/catch with next(err) — this correctly funnels errors to
  the centralized errorHandler.

---

### Step 4.7 — Create geojson.validator.js and a custom NotFoundError

**Accomplishes**:
- Validates that POST/PUT request bodies are valid GeoJSON Features with a Point geometry
  before the service layer is called.
- Creates a named error class (NotFoundError) for 404 scenarios.

**Files involved**:
- New file: `backend/src/validators/geojson.validator.js`
- New file: `backend/src/utils/errors.js`

**Key decisions**:
- **Validation depth**: At minimum, check:
  1. body.type === 'Feature'
  2. body.geometry is not null/undefined
  3. body.geometry.type === 'Point' (for streetlights; 'LineString' for roads, 'Polygon' for zones)
  4. body.geometry.coordinates is a non-empty array of numbers
  5. body.properties.name is a non-empty string
- **Library vs manual**: You can use a JSON Schema library (ajv) or write manual checks.
  For 5 checks, manual is fine and avoids a new dependency. Decide before Stage 9 because
  roads and zones will reuse a similar validator.
- **Validator as middleware vs service-layer check**: Validate as Express middleware
  (already referenced but commented out in the route). This is cleaner — invalid input
  never reaches the service or database.
- **NotFoundError**: Extend Error, set this.statusCode = 404. The errorHandler
  already reads err.statusCode ?? err.status ?? 500.

**Verification**:
```bash
# Missing geometry — should get 400:
curl -X POST http://localhost:3001/api/streetlights \
  -H "Content-Type: application/json" \
  -d '{"type":"Feature","geometry":null,"properties":{"name":"Bad"}}'
# Returns HTTP 400 with descriptive error message.
```

---

### Step 4.8 — Enhance error-handler.middleware.js

**Accomplishes**: Makes the error handler properly distinguish between ValidationError
(400), NotFoundError (404), and unexpected errors (500).

**Files involved**: `backend/src/middleware/error-handler.middleware.js`

**Key decisions**:
- The scaffold already reads err.statusCode ?? err.status ?? 500. If your custom error
  classes set this.statusCode, this already works without modification — but add a comment
  documenting the contract so it's clear.
- Add a specific check for PostgreSQL error codes (e.g., err.code === '23502' for
  NOT NULL violation, err.code === '22023' for invalid geometry). Map these to HTTP
  400 with a useful message rather than a raw 500.
- Keep stack traces out of production responses (already handled by the NODE_ENV check).

**Verification**:
- Send a request that causes a DB constraint violation (e.g., missing name). Must return
  HTTP 400, not 500.
- Kill the database connection and send any request. Must return HTTP 500 with a safe
  message (no stack trace in production mode).

---

### Stage 4 — Done Criteria

curl or Postman can successfully perform all four operations on /api/streetlights:
- GET returns the seeded FeatureCollection.
- POST creates a new feature and returns 201 with a real id.
- PUT updates it and returns 200.
- DELETE removes it and returns 204.
- Invalid input returns 400. Non-existent ID returns 404.

The backend server must be running and fully functional before Stage 5.

---

## Stage 5 — Frontend Write Path: Create (Streetlights)

**Goal**: Allow the user to draw a new streetlight point on the map, fill in its attributes
in the form, submit to the backend API, and see it appear on the WMS layer without a page
reload.

---

### Step 5.1 — Define TypeScript types for GeoJSON features

**Accomplishes**: Adds strongly-typed interfaces for streetlight features so the API client
and interaction handlers have compile-time safety.

**Files involved**: `frontend/src/types/` (create new file, e.g. index.ts or streetlights.ts)

**Key decisions**:
- The ol package ships with its own GeoJSON types. You can also define your own lean
  interface matching the API shape:
  ```ts
  interface StreetlightProperties { name: string; type: string; }
  interface StreetlightFeature extends GeoJSON.Feature<GeoJSON.Point, StreetlightProperties> {}
  ```
- Prefer lean domain types over re-using ol's feature format (ol/Feature) in non-OL
  code. OL Feature objects are mutable and contain rendering state — they should not escape
  the OL service layer.

---

### Step 5.2 — Implement apiClient.streetlights.create() in api.ts

**Accomplishes**: Adds the typed fetch() wrapper for POST /api/streetlights.

**Files involved**: `frontend/src/lib/api.ts`

**Key decisions**:
- The API_BASE constant is already defined as '/api'. This works because Vite is
  configured to proxy /api requests to http://localhost:3001. Verify vite.config.ts
  has this proxy — if not, add it now.
- All API methods must return the parsed JSON body (or throw on non-2xx responses). Create
  a private handleResponse(res: Response) helper that checks res.ok and throws an
  ApiError with the status and message from the error envelope.
- Similarly implement update(id, feature) and delete(id) in this step (all three will
  be needed by Stage 6-8, and it is more efficient to implement them together).

---

### Step 5.3 — Implement activateDraw('Point') in OpenLayersService

**Accomplishes**: Adds a Draw interaction to the OpenLayers map that lets the user click
to place a new Point.

**Files involved**: `frontend/src/lib/openlayers.ts`

**Key decisions**:
- **VectorSource + VectorLayer**: The Draw interaction requires a VectorSource to store
  the drawn geometry temporarily before it is sent to the API. This is a transient/scratch
  layer — it is not a WMS layer. Add it on top of all WMS layers.
- **Interaction lifecycle**: Only one interaction should be active at a time. Implement an
  activateInteraction(interaction) private method that removes any previously active
  interaction before adding the new one.
- **drawend callback**: When the user finishes drawing a point, the draw.on('drawend',
  event => ...) callback fires with the drawn ol/Feature. Extract the geometry from the
  feature, convert it to GeoJSON using new GeoJSON().writeFeatureObject(event.feature),
  and pass it to a callback function provided by the caller (the React component).
- **Coordinate order**: OpenLayers internally uses [lon, lat] in EPSG:4326. The GeoJSON
  spec also uses [lon, lat]. PostGIS ST_GeomFromGeoJSON expects [lon, lat]. This is
  consistent — but verify when debugging unexpected coordinate placements.

---

### Step 5.4 — Update FeatureForm.tsx for "Create Streetlight" mode

**Accomplishes**: When a Draw interaction completes, opens a form in the sidebar to capture
the streetlight's name and type attributes before submitting.

**Files involved**:
- `frontend/src/components/FeatureForm.tsx`
- `frontend/src/App.tsx`

**Key decisions**:
- **State flow**: The drawn geometry from the drawend callback must reach FeatureForm.
  Options:
  - **Callback via props (App.tsx as orchestrator)**: App holds pendingGeometry state
    and passes it as a prop to FeatureForm. The drawend callback updates App state via
    a function prop passed to OpenLayersService. This keeps all state in one place.
  - **React Context**: Useful if the interaction state needs to be shared widely. Overkill
    for this stage — use lifted state in App.tsx first.
- **Form fields**: name (text, required) and type (select: standard | solar | LED).
  Match the type enum values to what you will validate in the backend.
- **Submit handler**: On form submit, call apiClient.streetlights.create({ type: 'Feature',
  geometry: pendingGeometry, properties: { name, type } }), await the response, then call
  Step 5.5.

---

### Step 5.5 — Implement refreshLayer(layerName) and call it after a successful write

**Accomplishes**: Forces OpenLayers to discard cached WMS tiles for the streetlights layer
and re-fetch fresh tiles from GeoServer, making the newly created feature appear on the map.

**Files involved**: `frontend/src/lib/openlayers.ts`

**Key decisions**:
- **WMS cache busting**: TileWMS caches tiles in the browser. To force a re-fetch, the
  standard technique is to update the source's params with a unique timestamp:
  ```ts
  source.updateParams({ _ts: Date.now() })
  ```
  This appends _ts=<timestamp> to the WMS URL, making it a new (uncached) request.
- **Alternative — GeoServer tile cache**: If you are using GeoServer's built-in tile cache
  (GeoWebCache), you also need to call GeoServer's REST API to invalidate the tile cache.
  The backend has GEOSERVER_URL / GEOSERVER_USER / GEOSERVER_PASSWORD env vars for
  exactly this purpose. For local dev without GeoWebCache, the updateParams approach is
  sufficient.
- **Clearing the scratch vector layer**: After the API call succeeds, remove the temporary
  drawn feature from the VectorSource (call vectorSource.clear()).

**Verification**:
1. Draw a point on the map.
2. Fill in the form and submit.
3. The sidebar form should clear or show a success message.
4. Within 1-2 seconds, the new streetlight symbol should appear on the map (from the
   refreshed WMS layer) without a page reload.
5. Verify in psql that a new row was inserted.

---

### Stage 5 — Done Criteria

A user can: click a "Draw Streetlight" button -> click on the map to place a point -> fill
in the form -> submit -> see the point appear on the WMS layer. The round-trip from draw to
visible feature on map works. Only then move to Stage 6.

---

## Stage 6 — Frontend Write Path: Edit (Modify geometry + attributes)

**Goal**: Allow the user to click an existing streetlight on the map, edit its geometry
(by dragging control points) and/or its attributes in the form, and submit a PUT request.

---

### Step 6.1 — Implement activateSelect() in OpenLayersService

**Accomplishes**: Adds an OL Select interaction that lets the user click on a WMS feature
to select it.

**Files involved**: `frontend/src/lib/openlayers.ts`

**Key decisions**:
- **WMS vs WFS selection**: WMS is raster tiles — you cannot click on them to get feature
  attributes directly. To identify a clicked feature, use OL's GetFeatureInfo request
  (TileWMS.getFeatureInfoUrl()) which asks GeoServer for the feature under a click
  coordinate. Alternatively, switch the streetlights layer from WMS to WFS
  (ol/source/Vector + ol/format/GeoJSON + GeoServer WFS endpoint) — this loads actual
  vector data and enables native OL Select interaction on features.
  - **Trade-off**: WMS is simpler and scales (server renders tiles); WFS vector for Select
    means the browser holds all features in memory (problematic for thousands of features).
    For a ward-scale deployment (hundreds of streetlights), WFS Select is fine.
  - **Decision**: For the select/edit/delete interactions, add a secondary VectorSource
    backed by a WFS endpoint alongside the existing WMS layer. The WMS layer handles visual
    rendering; the WFS layer enables selection. This is the standard pattern for editable
    WMS layers in OpenLayers.
- **Feature identity**: The selected OL feature must carry the PostGIS id as a property
  (this is why Step 2.3 required "Expose primary keys" on the PostGIS datastore).

---

### Step 6.2 — Implement activateModify() in OpenLayersService

**Accomplishes**: Adds an OL Modify interaction on top of the Select interaction, which
allows dragging the control points of the selected feature's geometry.

**Files involved**: `frontend/src/lib/openlayers.ts`

**Key decisions**:
- Modify requires a VectorSource — it works on the WFS vector features.
- Modify and Select must be active simultaneously. The interaction lifecycle method
  from Step 5.3 should support activating a combination of interactions.
- Attach a modifyend event handler to capture the modified geometry.

---

### Step 6.3 — Populate FeatureForm with selected feature's attributes

**Accomplishes**: When a feature is selected (Step 6.1), the sidebar form auto-populates
with the feature's current name and type values for editing.

**Files involved**:
- `frontend/src/components/FeatureForm.tsx`
- `frontend/src/App.tsx`

**Key decisions**:
- The select interaction's select event provides the selected ol/Feature. Extract the
  feature's properties (feature.getProperties()) and pass them up to App.tsx as
  selectedFeature state. FeatureForm renders in "edit mode" when selectedFeature is
  non-null.
- The form must distinguish between "creating a new feature" (Step 5.4) and "editing an
  existing feature". Use a mode: 'create' | 'edit' | 'idle' state in App.tsx.

---

### Step 6.4 — Wire the PUT request on form submit in edit mode

**Accomplishes**: On form submit in edit mode, call apiClient.streetlights.update(id,
feature) with the (possibly modified) geometry and updated attributes, then refresh the
WMS layer.

**Files involved**:
- `frontend/src/lib/api.ts`
- `frontend/src/components/FeatureForm.tsx`

**Key decisions**:
- The feature ID comes from the selected OL feature's id property.
- The geometry comes from the modifyend event (if the user dragged a control point) or
  the original selected feature's geometry (if only attributes changed).
- After a successful PUT: call olService.refreshLayer('streetlights'), clear the selection
  (deactivate interactions), and reset the form to idle mode.

**Verification**:
1. Click an existing streetlight on the map.
2. The form populates with its attributes.
3. Change the name and drag the point to a new location.
4. Submit.
5. The WMS layer refreshes and the streetlight appears at the new position.
6. In psql, confirm the row's geom and name changed.

---

### Stage 6 — Done Criteria

A user can select an existing streetlight, edit its name/type in the form, optionally drag
its position, submit, and see the change reflected on the map.

---

## Stage 7 — Frontend Write Path: Move (Translate interaction)

**Goal**: Provide a dedicated "Move" mode that lets the user drag an entire streetlight
feature to a new position without activating the vertex-editing Modify interaction.

---

### Step 7.1 — Implement activateTranslate() in OpenLayersService

**Accomplishes**: Adds an OL Translate interaction that moves the entire selected feature
when dragged.

**Files involved**: `frontend/src/lib/openlayers.ts`

**Key decisions**:
- **Translate vs Modify**: Both interactions change geometry, but Translate moves the
  whole feature as a unit (no vertex editing), while Modify edits individual vertices.
  For a Point geometry they are functionally identical (a Point has only one vertex). For
  Roads (LineString) the distinction matters: Translate moves the whole road; Modify lets
  you reshape it.
- **Why a separate mode?**: Having a dedicated "Move" mode with the Translate interaction
  provides better UX (cursor changes to a grab icon; clicking doesn't accidentally edit
  attributes). It also keeps the OL interaction code modular.
- Translate needs the same WFS VectorSource as Select/Modify. A Select
  interaction must be active alongside Translate so the user first clicks to select, then
  drags to move.
- Attach a translateend event to capture the new geometry after the drag completes.

---

### Step 7.2 — Wire translateend to a PUT request

**Accomplishes**: After a drag completes, automatically sends a PUT request with the new
geometry (without requiring the user to fill in the form or press Submit).

**Files involved**:
- `frontend/src/lib/openlayers.ts` (translateend callback)
- `frontend/src/lib/api.ts`

**Key decisions**:
- **Optimistic vs confirmed update**: Two choices:
  - **Optimistic**: The feature moves on the map immediately (OL already shows it at the
    new position after the drag), and the API call happens in the background. If the API
    call fails, you must undo the move by reverting the OL feature geometry. Hard to
    implement cleanly.
  - **Confirmed**: After the drag, send the PUT request. On success, call
    refreshLayer('streetlights'). On failure, revert by re-fetching the WFS layer. This
    is simpler and safer for a write-critical GIS application. Use confirmed updates.
- **Attribute preservation**: The PUT body must include the existing name and type
  values alongside the new geometry. Read them from the selected feature's properties.

**Verification**:
1. Activate "Move" mode.
2. Click a streetlight, then drag it to a new position.
3. Release the mouse.
4. The API is called automatically.
5. The WMS layer refreshes; the light appears at the new position.
6. In psql, confirm the geom changed and updated_at is updated.

---

### Stage 7 — Done Criteria

A user can move a streetlight by dragging and the position is persisted to PostGIS
automatically on drag end.

---

## Stage 8 — Frontend Write Path: Delete

**Goal**: Allow the user to select a streetlight and delete it via the DELETE endpoint,
with a confirmation step to prevent accidental deletion.

---

### Step 8.1 — Add a "Delete" button to FeatureForm (edit mode)

**Accomplishes**: In edit mode (an existing feature is selected), shows a "Delete" button
alongside the "Save" button.

**Files involved**: `frontend/src/components/FeatureForm.tsx`

**Key decisions**:
- **Confirmation UX**: Never delete without confirmation. Options:
  - Browser window.confirm(): Simple, accessible, but ugly. Acceptable for an internal tool.
  - A small inline confirmation state (the button first becomes "Click again to confirm"):
    slightly better UX, no extra dependencies.
  - A modal dialog: best UX but requires more code. Choose based on your preference.
- The delete button should only appear when mode === 'edit' and selectedFeature is not null.

---

### Step 8.2 — Wire the DELETE request and cleanup

**Accomplishes**: On confirmed delete, calls apiClient.streetlights.delete(id), removes
the feature from the WFS VectorSource, refreshes the WMS layer, and resets the UI.

**Files involved**:
- `frontend/src/lib/api.ts`
- `frontend/src/components/FeatureForm.tsx`
- `frontend/src/lib/openlayers.ts`

**Key decisions**:
- After successful DELETE: clear the OL selection, remove the feature from the WFS
  VectorSource (so it disappears immediately without waiting for the WMS refresh), call
  refreshLayer('streetlights'), and reset App.tsx state to idle mode.
- On 404 (feature already deleted by another user): show a user-visible error and refresh
  the layer to sync the map with the current DB state.

**Verification**:
1. Select an existing streetlight.
2. Click "Delete" and confirm.
3. The feature disappears from the map immediately.
4. In psql, confirm the row no longer exists.
5. Attempt to delete a non-existent ID via curl and confirm 404 is returned.

---

### Stage 8 — Done Criteria

All four CRUD operations (Create, Edit, Move, Delete) are functional for the streetlights
layer. The complete write path from OpenLayers interaction -> React state -> API -> PostGIS
-> WMS refresh is verified end-to-end.

---

## Stage 9 — Repeat Pattern for Roads and Zones

**Goal**: Apply the same migration -> backend route -> OpenLayers wiring pattern to the
roads (LineString) and zones (Polygon) layers, calling out geometry-specific differences.

---

### Step 9.1 — Implement roads.service.js

**Accomplishes**: Adds the service layer for roads, mirroring streetlights.service.js.

**Files involved**: New file: `backend/src/services/roads.service.js`

**Geometry differences from streetlights**:
- The SQL column type is geometry(LineString, 4326), so PostGIS will reject Point or
  Polygon geometries at the DB level (good constraint).
- ST_GeomFromGeoJSON($1) works identically for LineString GeoJSON — no geometry-specific
  change needed in the SQL.
- The mapRowToGeoJSONFeature helper can be shared or copied — if copied, consider
  extracting it to a shared utility in backend/src/utils/geojson.utils.js to avoid
  duplication across three service files.

**Validation differences**:
- Create validateGeoJSONLineString middleware in geojson.validator.js.
- Minimum check: geometry.type === 'LineString' and coordinates is an array of at
  least 2 [number, number] pairs.

**Verification**: Same curl tests as Stage 4 but for /api/roads.

---

### Step 9.2 — Implement zones.service.js

**Accomplishes**: Adds the service layer for zones.

**Files involved**: New file: `backend/src/services/zones.service.js`

**Geometry differences from streetlights**:
- Column type is geometry(Polygon, 4326).
- **Ring closure**: A valid GeoJSON Polygon's coordinates[0] (exterior ring) must have
  the first and last coordinate be identical (closed ring). OpenLayers' Draw interaction
  automatically closes the ring, but manually constructed GeoJSON in tests/curl may not.
  Add a validation check: first coordinate equals last coordinate.
- **Winding order**: GeoJSON spec (RFC 7946) requires exterior rings to be
  counter-clockwise and holes to be clockwise. PostGIS accepts both but ST_IsValid may
  return false for invalid winding in some edge cases. If you added a CHECK (ST_IsValid(geom))
  constraint in Step 1.4, PostGIS will reject invalid polygons at the DB level with an
  interpretable error code.

**Validation differences**:
- Create validateGeoJSONPolygon middleware: check geometry.type === 'Polygon', exterior
  ring has >= 4 coordinates, first equals last.

**Verification**: Same curl tests for /api/zones.

---

### Step 9.3 — Wire roads.routes.js and zones.routes.js

**Accomplishes**: Removes the stub responses and connects the service calls, mirroring
what was done in Step 4.6 for streetlights.

**Files involved**:
- `backend/src/routes/roads.routes.js`
- `backend/src/routes/zones.routes.js`

**Note**: Both route files are currently thinner scaffolds than streetlights.routes.js
(they have no comments for validator middleware). Add the validator middleware imports and
attach them in the same pattern.

---

### Step 9.4 — Add WFS Vector sources for roads and zones in OpenLayersService

**Accomplishes**: Extends the OL service to manage WFS vector sources for roads and zones
so the same Select/Modify/Translate interactions can work on all three layers.

**Files involved**: `frontend/src/lib/openlayers.ts`

**Geometry differences**:
- **Draw interaction for LineString**: type: 'LineString' in new Draw({...}). The user
  clicks to add each vertex; double-clicks to finish. Ensure this is communicated in the UI
  ("double-click to finish drawing").
- **Draw interaction for Polygon**: type: 'Polygon'. The user clicks to add vertices;
  double-clicks to close. OpenLayers automatically closes the ring.
- **Modify for LineString**: Dragging a control point reshapes the line. Adding vertices
  by clicking on an edge is supported by OL Modify automatically.
- **Modify for Polygon**: Same as LineString — vertices are draggable, new vertices can be
  added by clicking on an edge.
- **Translate**: Works identically for all geometry types.

---

### Step 9.5 — Implement feature forms for roads and zones

**Accomplishes**: Extends FeatureForm.tsx (or creates per-feature-type form components)
to handle the attribute fields for roads (name, category) and zones (name, type).

**Files involved**:
- `frontend/src/components/FeatureForm.tsx`
- New files: `frontend/src/features/roads/RoadsForm.tsx`,
  `frontend/src/features/zones/ZonesForm.tsx`

**Key decisions**:
- **One generic form vs per-layer forms**: A single FeatureForm that renders different
  fields based on selectedLayerType prop is simpler but mixes concerns. Separate
  per-layer form components (in the features/ directories — already scaffolded) are
  cleaner and extensible. Recommended: create StreetlightsForm.tsx, RoadsForm.tsx,
  ZonesForm.tsx in their respective feature directories, and have FeatureForm.tsx act
  as a router/switcher that renders the correct form component based on the active layer.

---

### Stage 9 — Done Criteria

All three layers support full CRUD via both the API (curl-verified) and the map UI (end-to-
end interaction tested). The read path (WMS display) and write path (API + WMS refresh) are
functional for streetlights, roads, and zones.

---

## Stage 10 — Error Handling, Performance, and Polish

**Goal**: Harden the application against edge cases, optimize spatial queries, improve UX
around error states, and prepare documentation for explaining the architecture.

---

### Step 10.1 — Frontend error state and user feedback

**Accomplishes**: Surfaces API errors to the user instead of silently failing.

**Files involved**:
- `frontend/src/components/FeatureForm.tsx`
- Potentially new: `frontend/src/components/Toast.tsx` or similar notification component

**Key decisions**:
- Any apiClient call that throws (network error, 4xx, 5xx) must be caught in the React
  component and shown to the user. Unhandled promise rejections are silent in production.
- Show inline error messages for form validation errors (400 from the API) and a toast/
  banner for unexpected errors (500, network failure).
- Disable the Submit button and show a loading spinner while the fetch is in flight to
  prevent double-submissions.

---

### Step 10.2 — Bounding-box-limited WFS requests

**Accomplishes**: Prevents loading all features in the WFS VectorSource when the dataset
is large by limiting WFS GetFeature requests to the current map viewport.

**Files involved**: `frontend/src/lib/openlayers.ts`

**Key decisions**:
- OL VectorSource with strategy: bbox sends a WFS GetFeature request with a bbox
  parameter matching the current viewport on every pan/zoom. GeoServer applies a bounding-
  box filter server-side (using the GIST index). This is the correct scalability pattern.
- Add loadingstrategy: bbox when creating the WFS VectorSources in Step 6.1 / 9.4.
  If you deferred this, add it now.
- **Trade-off**: With bbox strategy, features that scroll out of view are removed from the
  VectorSource and reloaded on scroll-back. This means selections may be lost on pan. For
  edit interactions this is acceptable behavior; just deselect and re-select after panning.

---

### Step 10.3 — Backend bounding-box query optimization

**Accomplishes**: Adds an optional bbox query parameter to GET endpoints so the frontend
can request only features in the current viewport.

**Files involved**:
- `backend/src/routes/streetlights.routes.js` (and roads, zones)
- `backend/src/services/streetlights.service.js` (and roads, zones)

**Key decisions**:
- Accept ?bbox=minx,miny,maxx,maxy in the query string (matching WFS bbox conventions).
- In the SQL, use the PostGIS && operator with ST_MakeEnvelope(minx, miny, maxx, maxy, 4326):
  ```sql
  WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
  ```
  The && operator uses the GIST index — this is an O(log n) bounding-box query.
- Validate that bbox values are numbers and within valid coordinate ranges (lon: -180/180,
  lat: -90/90). Reject with 400 if invalid.
- **Note**: The GET endpoints are not used by the WMS read path (GeoServer handles that).
  These optimized GET endpoints are used by the WFS VectorSource for the edit interactions.

---

### Step 10.4 — PostGIS geometry validation in the backend

**Accomplishes**: Adds a server-side check that inserted/updated geometries are
topologically valid before writing to the database.

**Files involved**:
- `backend/src/services/zones.service.js` (most critical for polygons)
- Optionally streetlights.service.js and roads.service.js

**Key decisions**:
- For Polygon inserts, use ST_IsValid(ST_GeomFromGeoJSON($1)) in a pre-check query.
  If false, return HTTP 400 with a meaningful error message rather than letting the DB
  constraint (if any) bubble up as a 500.
- Alternatively: use ST_MakeValid() to attempt auto-repair of invalid geometries before
  inserting. Trade-off: auto-repair may produce unexpected results (e.g., splitting a
  self-intersecting polygon). For a professional GIS tool, reject and ask the user to fix
  the geometry rather than silently repairing it.
- ST_IsValid is less critical for Points and LineStrings (which have fewer validity rules).

---

### Step 10.5 — Pool connection tuning

**Accomplishes**: Adds connection pool configuration to prevent pool exhaustion under load.

**Files involved**: `backend/src/db/pool.js`

**Key decisions**:
- The pool.js comment already flags this TODO. Recommended settings for a single-server
  local deployment:
  - max: 10 (max pool size)
  - idleTimeoutMillis: 30000 (release idle clients after 30s)
  - connectionTimeoutMillis: 5000 (fail fast if no client available within 5s)
- connectionTimeoutMillis will cause the API to return a 500 (handled by errorHandler)
  rather than hanging indefinitely when the DB is unreachable.

---

### Step 10.6 — CORS hardening

**Accomplishes**: Restricts CORS to the known frontend origin instead of allowing all
origins.

**Files involved**: `backend/src/index.js`

**Key decisions**:
- Replace app.use(cors()) with:
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }))
- Add CORS_ORIGIN to .env.example.
- For production, set CORS_ORIGIN to the actual deployed frontend URL.

---

### Step 10.7 — Update docs/geoserver-setup.md to a complete, verified checklist

**Accomplishes**: Expands the existing thin checklist into a complete, step-by-step setup
guide that a new developer can follow from scratch, including all decisions made during
Stage 2.

**Files involved**: `docs/geoserver-setup.md`

**Key decisions**:
- Add the CORS configuration step.
- Add the "Expose primary keys" step.
- Include the SLD file locations and instructions for uploading them.
- Include the verification GetMap URLs with example Chennai bounding boxes.
- Include a troubleshooting section (blank image -> check bounding boxes; 401 -> check CORS;
  connection refused -> check PostGIS credentials in the datastore).

---

### Step 10.8 — Architecture diagram and README update

**Accomplishes**: Adds a diagram that visually explains the two-path architecture and
updates the README Quick Start with any corrections discovered during implementation.

**Files involved**: `README.md`

**Key decisions**:
- The README architecture diagram is already excellent text art. Supplement it with a
  sequence diagram showing the exact message flow for a Create operation:
  User -> OL Draw -> React -> apiClient -> Express -> PostGIS -> response -> OL refresh.
- Update the seed coordinate note (London -> Chennai).
- Update the Quick Start with any prerequisites added during implementation (GeoServer
  version, CORS setup step).

---

### Stage 10 — Done Criteria

- All API errors are surfaced to the user.
- WFS requests are viewport-limited.
- GET endpoints accept optional bbox parameter and use GIST-indexed bounding-box queries.
- Invalid polygon geometries are rejected with a 400.
- Pool is tuned and CORS is restricted.
- docs/geoserver-setup.md is complete enough that a new developer can set up GeoServer
  without assistance.
- The README accurately reflects the current implementation.

---

## Overall Dependency Graph

```
Stage 1  (Database schema)
   |
   v
Stage 2  (GeoServer — requires tables to exist)
   |
   v
Stage 3  (OL read path — requires GeoServer layers to be published)
   |
   v
Stage 4  (Backend write path, streetlights — requires database)
   |
   v
Stage 5  (Frontend create — requires Stage 3 + 4)
   |
   v
Stage 6  (Frontend edit — requires Stage 5)
   |
   v
Stage 7  (Frontend move — requires Stage 6)
   |
   v
Stage 8  (Frontend delete — requires Stage 6)
   |
   v
Stage 9  (Roads + zones — requires all of Stages 1-8 as a pattern)
   |
   v
Stage 10 (Hardening — can start partially in parallel with Stage 9)
```

---

## Key Files Quick Reference

| File | Stage | Status |
|------|-------|--------|
| `db/migrations/001_enable_postgis.sql` | 1 | Ready to run |
| `db/migrations/002_create_streetlights.sql` | 1 | Ready to run |
| `db/migrations/003_create_roads.sql` | 1 | Ready to run |
| `db/migrations/004_create_zones.sql` | 1 | Ready to run |
| `db/seeds/seed_sample_data.sql` | 1 | Update coords to Chennai |
| `docs/geoserver-setup.md` | 2 | Expand during Stage 2 |
| `docs/sld/*.sld` | 2 | Create new |
| `frontend/.env.development` | 3 | Create from .env.example |
| `frontend/src/lib/openlayers.ts` | 3, 5, 6, 7, 8 | Implement staged |
| `frontend/src/components/LayerControl.tsx` | 3 | Wire to olService |
| `frontend/src/types/index.ts` | 5 | Create new |
| `frontend/src/lib/api.ts` | 5 | Implement CRUD |
| `frontend/src/components/FeatureForm.tsx` | 5, 6, 8 | Implement |
| `frontend/src/App.tsx` | 5 | Add state |
| `backend/src/db/pool.js` | 4 | Ready (tune in Stage 10) |
| `backend/src/services/streetlights.service.js` | 4 | Implement SQL |
| `backend/src/services/roads.service.js` | 9 | Create new |
| `backend/src/services/zones.service.js` | 9 | Create new |
| `backend/src/routes/streetlights.routes.js` | 4 | Uncomment service calls |
| `backend/src/routes/roads.routes.js` | 9 | Same as streetlights |
| `backend/src/routes/zones.routes.js` | 9 | Same as streetlights |
| `backend/src/validators/geojson.validator.js` | 4 | Create new |
| `backend/src/utils/errors.js` | 4 | Create new |
| `backend/src/middleware/error-handler.middleware.js` | 4, 10 | Add error type mapping |
| `backend/src/index.js` | 10 | Harden CORS |

---

*End of plan. Do not implement any stage until the previous stage's Done Criteria are met.*
