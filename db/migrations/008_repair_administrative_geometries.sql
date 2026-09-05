-- 008_repair_administrative_geometries.sql
-- Safely repairs self-intersecting polygon rings in administrative boundaries (e.g. states and districts)
-- using PostGIS ST_MakeValid, cast to ST_Multi to preserve MultiPolygon geometry type.
-- This operation is idempotent and only modifies rows where ST_IsValid(geom) is false.

DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'states') THEN
        UPDATE states
        SET geom = ST_Multi(ST_MakeValid(geom))
        WHERE geom IS NOT NULL AND NOT ST_IsValid(geom);
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'districts') THEN
        UPDATE districts
        SET geom = ST_Multi(ST_MakeValid(geom))
        WHERE geom IS NOT NULL AND NOT ST_IsValid(geom);
    END IF;
END $$;
