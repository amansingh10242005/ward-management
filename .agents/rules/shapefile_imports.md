---
description: Critical rules for handling shapefile imports, PostGIS, and GeoServer compatibility in this repository.
---

# Shapefile Import & GeoServer Compatibility Rules

Whenever working on database migrations, shapefile imports, or GeoServer configurations in this project, you MUST adhere to the following rules:

### 1. Shapefile Projections
- Do **not** use `shp2pgsql -s 4326` blindly. The raw shapefiles in this repository (e.g., India State/District boundaries) use a **Lambert Conformal Conic (LCC)** projection natively.
- Using `shp2pgsql -s 4326` will incorrectly assign Lat/Lon degrees to LCC meters, causing geometries to fall outside the [-180, 180] bound and rendering invisible in GeoServer.
- **Fix:** Always use Python's `geopandas` to properly transform the coordinates before importing:
  ```python
  gdf = gpd.read_file('shapefile.shp')
  gdf = gdf.to_crs(epsg=4326)
  ```

### 2. Geometry Column Naming for GeoServer
- GeoPandas defaults to naming the spatial column `geometry`. 
- GeoServer in this project is strictly configured to look for the column named `geom`.
- **Fix:** Always rename the geometry column to `geom` before pushing to PostGIS:
  ```python
  gdf.rename_geometry('geom', inplace=True)
  ```

### 3. Connection String Safety (Password Encoding)
- User passwords in this project often contain special characters (like `@` in `Postgres@123`).
- Passing raw passwords into SQLAlchemy connection strings (e.g., `postgresql://user:pass@host/db`) will break URL parsing and cause `Non-recoverable failure in name resolution` errors.
- **Fix:** Always URL-encode the password using `urllib.parse.quote_plus()`:
  ```python
  import urllib.parse
  encoded_password = urllib.parse.quote_plus(password)
  engine = create_engine(f'postgresql://postgres:{encoded_password}@127.0.0.1:5432/ward_db')
  ```

### 4. Consolidated Migrations
- All setup scripts must be consolidated into `run_migrations.bat` to prevent the user from having to run multiple fragmented scripts.
- Only prompt the user for their password **once** at the beginning of the batch file and pass it down to scripts via environment variables (e.g., `set PGPASSWORD=...`).
