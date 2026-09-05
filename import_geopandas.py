#!/usr/bin/env python3
"""
import_geopandas.py — Safe, Transactional Administrative Boundary Importer.

Imports States and Districts shapefiles into PostGIS with:
 - Safe non-destructive behavior: never drops tables (replaces 'if_exists=replace')
 - Transaction safety: atomic all-or-nothing database transactions with rollback on failure
 - Environment-driven configuration: loads DB credentials from backend/.env or environment
 - Robust geometry validation & repair: enforces EPSG:4326 and MultiPolygon, fixes self-intersections
 - Explicit attribute mapping: maps source shapefile fields to application schema
 - CLI options: supports --mode [append|replace], --layer [all|states|districts], --dry-run
"""

import os
import sys
import argparse
import urllib.parse
import pandas as pd
import geopandas as gpd
from shapely.validation import make_valid
from shapely.geometry import Polygon, MultiPolygon, GeometryCollection
from sqlalchemy import create_engine, text

# Load environment configuration
try:
    from dotenv import load_dotenv
    # Priority: backend/.env -> local .env
    if os.path.exists(os.path.join('backend', '.env')):
        load_dotenv(os.path.join('backend', '.env'))
    elif os.path.exists('.env'):
        load_dotenv('.env')
except ImportError:
    pass


def get_db_engine():
    """Builds SQLAlchemy engine using environment variables with project defaults."""
    host = os.environ.get('DB_HOST', 'localhost')
    port = os.environ.get('DB_PORT', '5432')
    user = os.environ.get('DB_USER', 'admin')
    password = os.environ.get('DB_PASSWORD', os.environ.get('PGPASSWORD', 'geoserver'))
    dbname = os.environ.get('DB_NAME', os.environ.get('PGDATABASE', 'ward_db'))

    encoded_password = urllib.parse.quote_plus(password)
    connection_url = f"postgresql://{user}:{encoded_password}@{host}:{port}/{dbname}"
    return create_engine(connection_url)


def clean_to_multipolygon(geom):
    """Ensures geometry is valid and cast to MultiPolygon."""
    if geom is None or geom.is_empty:
        return None

    if not geom.is_valid:
        geom = make_valid(geom)

    if isinstance(geom, Polygon):
        return MultiPolygon([geom])
    elif isinstance(geom, MultiPolygon):
        return geom
    elif isinstance(geom, GeometryCollection):
        polys = []
        for g in geom.geoms:
            if isinstance(g, Polygon):
                polys.append(g)
            elif isinstance(g, MultiPolygon):
                polys.extend(g.geoms)
        return MultiPolygon(polys) if polys else None
    return None


def process_states_gdf(shp_path):
    """Loads, validates, reprojects, and repairs States shapefile."""
    print(f"Reading States shapefile from: {shp_path}")
    if not os.path.exists(shp_path):
        raise FileNotFoundError(f"States shapefile not found: {shp_path}")

    gdf = gpd.read_file(shp_path)
    print(f"  Loaded {len(gdf)} raw records. Source CRS: {gdf.crs}")

    if gdf.crs is None:
        raise ValueError("States shapefile is missing CRS definition.")

    if gdf.crs.to_epsg() != 4326:
        print("  Re-projecting States to EPSG:4326...")
        gdf = gdf.to_crs(epsg=4326)

    # Geometry validation and cleaning
    invalid_count = (~gdf.geometry.is_valid).sum()
    if invalid_count > 0:
        print(f"  Repairing {invalid_count} invalid geometries in States...")

    cleaned_geoms = [clean_to_multipolygon(g) for g in gdf.geometry]
    gdf['geom'] = cleaned_geoms

    null_or_empty = gdf['geom'].isna().sum()
    if null_or_empty > 0:
        raise ValueError(f"States data contains {null_or_empty} empty or unrepairable geometries.")

    # Explicit attribute mapping
    state_col = next((c for c in gdf.columns if c.lower() == 'state'), None)
    if not state_col:
        raise ValueError(f"Required column 'STATE' not found in States shapefile. Available: {gdf.columns.tolist()}")

    lgd_col = next((c for c in gdf.columns if 'lgd' in c.lower()), None)

    clean_records = []
    for idx, row in gdf.iterrows():
        state_name = str(row[state_col]).strip() if pd.notna(row[state_col]) else None
        if not state_name:
            continue

        state_lgd = None
        if lgd_col and pd.notna(row[lgd_col]):
            try:
                state_lgd = int(row[lgd_col])
            except (ValueError, TypeError):
                state_lgd = None

        clean_records.append({
            'state': state_name,
            'state_lgd': state_lgd,
            'geom_wkb': row['geom'].wkb
        })

    print(f"  States validation complete: {len(clean_records)} valid records prepared.")
    return clean_records


def process_districts_gdf(shp_path):
    """Loads, validates, reprojects, and repairs Districts shapefile."""
    print(f"Reading Districts shapefile from: {shp_path}")
    if not os.path.exists(shp_path):
        raise FileNotFoundError(f"Districts shapefile not found: {shp_path}")

    gdf = gpd.read_file(shp_path)
    print(f"  Loaded {len(gdf)} raw records. Source CRS: {gdf.crs}")

    if gdf.crs is None:
        raise ValueError("Districts shapefile is missing CRS definition.")

    if gdf.crs.to_epsg() != 4326:
        print("  Re-projecting Districts to EPSG:4326...")
        gdf = gdf.to_crs(epsg=4326)

    # Geometry validation and cleaning
    invalid_count = (~gdf.geometry.is_valid).sum()
    if invalid_count > 0:
        print(f"  Repairing {invalid_count} invalid geometries in Districts...")

    cleaned_geoms = [clean_to_multipolygon(g) for g in gdf.geometry]
    gdf['geom'] = cleaned_geoms

    null_or_empty = gdf['geom'].isna().sum()
    if null_or_empty > 0:
        raise ValueError(f"Districts data contains {null_or_empty} empty or unrepairable geometries.")

    # Explicit attribute mapping
    dist_col = next((c for c in gdf.columns if c.lower() == 'district'), None)
    if not dist_col:
        raise ValueError(f"Required column 'District' not found in Districts shapefile. Available: {gdf.columns.tolist()}")

    state_col = next((c for c in gdf.columns if c.lower() == 'state'), None)
    if not state_col:
        raise ValueError(f"Required column 'STATE' not found in Districts shapefile. Available: {gdf.columns.tolist()}")

    lgd_col = next((c for c in gdf.columns if 'district_l' in c.lower() or 'dist_lgd' in c.lower() or 'lgd' in c.lower()), None)

    clean_records = []
    for idx, row in gdf.iterrows():
        district_name = str(row[dist_col]).strip() if pd.notna(row[dist_col]) else None
        state_name = str(row[state_col]).strip() if pd.notna(row[state_col]) else None
        if not district_name or not state_name:
            continue

        district_lgd = str(row[lgd_col]).strip() if (lgd_col and pd.notna(row[lgd_col])) else None

        clean_records.append({
            'district': district_name,
            'state': state_name,
            'district_l': district_lgd,
            'geom_wkb': row['geom'].wkb
        })

    print(f"  Districts validation complete: {len(clean_records)} valid records prepared.")
    return clean_records


def import_states(engine, records, mode='append'):
    """Imports States into PostGIS safely inside an atomic transaction."""
    print(f"\nImporting States (mode='{mode}')...")
    with engine.connect() as conn:
        with conn.begin():
            # Verify table exists
            table_check = conn.execute(text("SELECT 1 FROM information_schema.tables WHERE table_name = 'states'")).fetchone()
            if not table_check:
                raise RuntimeError("Table 'states' does not exist. Please run database migrations first.")

            records_to_insert = records

            if mode == 'replace':
                print("  Truncating existing 'states' table (preserving constraints & indexes)...")
                conn.execute(text("TRUNCATE TABLE states RESTART IDENTITY;"))
            elif mode == 'append':
                existing_states = set(r[0] for r in conn.execute(text("SELECT state FROM states")).fetchall())
                records_to_insert = [r for r in records if r['state'] not in existing_states]
                print(f"  Found {len(existing_states)} existing states. New states to append: {len(records_to_insert)}")

            if records_to_insert:
                insert_stmt = text("""
                    INSERT INTO states (state, state_lgd, geom)
                    VALUES (:state, :state_lgd, ST_Multi(ST_GeomFromWKB(:geom_wkb, 4326)))
                """)
                # Batch execution
                conn.execute(insert_stmt, records_to_insert)
                print(f"  Successfully inserted {len(records_to_insert)} state records.")
            else:
                print("  No new states to insert.")

            # Post-import count check
            final_count = conn.execute(text("SELECT count(*) FROM states")).scalar()
            print(f"  Current 'states' row count in database: {final_count}")


def import_districts(engine, records, mode='append'):
    """Imports Districts into PostGIS safely inside an atomic transaction."""
    print(f"\nImporting Districts (mode='{mode}')...")
    with engine.connect() as conn:
        with conn.begin():
            table_check = conn.execute(text("SELECT 1 FROM information_schema.tables WHERE table_name = 'districts'")).fetchone()
            if not table_check:
                raise RuntimeError("Table 'districts' does not exist. Please run database migrations first.")

            records_to_insert = records

            if mode == 'replace':
                print("  Truncating existing 'districts' table (preserving constraints & indexes)...")
                conn.execute(text("TRUNCATE TABLE districts RESTART IDENTITY;"))
            elif mode == 'append':
                existing_districts = set((r[0], r[1]) for r in conn.execute(text("SELECT district, state FROM districts")).fetchall())
                records_to_insert = [r for r in records if (r['district'], r['state']) not in existing_districts]
                print(f"  Found {len(existing_districts)} existing districts. New districts to append: {len(records_to_insert)}")

            if records_to_insert:
                insert_stmt = text("""
                    INSERT INTO districts (district, state, district_l, geom)
                    VALUES (:district, :state, :district_l, ST_Multi(ST_GeomFromWKB(:geom_wkb, 4326)))
                """)
                # Batch execution
                conn.execute(insert_stmt, records_to_insert)
                print(f"  Successfully inserted {len(records_to_insert)} district records.")
            else:
                print("  No new districts to insert.")

            final_count = conn.execute(text("SELECT count(*) FROM districts")).scalar()
            print(f"  Current 'districts' row count in database: {final_count}")


def verify_postgis_integrity(engine):
    """Verifies PostGIS indexes, validity, and SRID post-import."""
    print("\n--- POST-IMPORT INTEGRITY CHECK ---")
    with engine.connect() as conn:
        for tbl in ['states', 'districts']:
            res = conn.execute(text(f"""
                SELECT 
                    count(*) as total,
                    count(CASE WHEN NOT ST_IsValid(geom) THEN 1 END) as invalid,
                    count(CASE WHEN ST_SRID(geom) != 4326 THEN 1 END) as wrong_srid,
                    count(CASE WHEN ST_GeometryType(geom) != 'ST_MultiPolygon' THEN 1 END) as wrong_type
                FROM {tbl}
            """)).fetchone()
            print(f"  Table '{tbl}': total={res[0]}, invalid={res[1]}, wrong_srid={res[2]}, wrong_type={res[3]}")

            # Verify GiST index
            idx_name = f"idx_{tbl}_geom"
            idx_exists = conn.execute(text(f"""
                SELECT 1 FROM pg_indexes WHERE tablename = '{tbl}' AND indexname = '{idx_name}'
            """)).fetchone()
            print(f"  GiST Index '{idx_name}': {'EXISTS (GiST)' if idx_exists else 'MISSING'}")


def main():
    parser = argparse.ArgumentParser(description="Safe GIS administrative data import pipeline for PostGIS.")
    parser.add_argument('--mode', choices=['append', 'replace'], default='append',
                        help="Import mode: 'append' adds new records without deleting; 'replace' truncates safely without dropping tables.")
    parser.add_argument('--layer', choices=['all', 'states', 'districts'], default='all',
                        help="Layer to import (default: all).")
    parser.add_argument('--states-shp', default=r"data\administrative\states\India_State_Boundary.shp",
                        help="Path to States shapefile.")
    parser.add_argument('--districts-shp', default=r"data\administrative\districts\India_District_Boundary.shp",
                        help="Path to Districts shapefile.")
    parser.add_argument('--dry-run', action='store_true',
                        help="Validate and process files without writing to database.")
    args = parser.parse_args()

    print("==================================================")
    print("WARD MANAGEMENT — GIS ADMINISTRATIVE DATA IMPORTER")
    print(f"Mode: {args.mode.upper()} | Target Layer: {args.layer.upper()} | Dry Run: {args.dry_run}")
    print("==================================================")

    states_records = None
    districts_records = None

    if args.layer in ['all', 'states']:
        states_records = process_states_gdf(args.states_shp)

    if args.layer in ['all', 'districts']:
        districts_records = process_districts_gdf(args.districts_shp)

    if args.dry_run:
        print("\nDry run completed successfully. No database modifications made.")
        return

    engine = get_db_engine()

    try:
        if states_records is not None:
            import_states(engine, states_records, mode=args.mode)
        if districts_records is not None:
            import_districts(engine, districts_records, mode=args.mode)

        verify_postgis_integrity(engine)
        print("\nGIS import pipeline completed successfully.")
    except Exception as e:
        print(f"\n[FATAL ERROR] Import failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
