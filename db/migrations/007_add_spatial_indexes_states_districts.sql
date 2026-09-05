-- 007_add_spatial_indexes_states_districts.sql
-- Formally tracks and enforces GiST spatial indexes on states and districts tables.

DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'states') THEN
        CREATE INDEX IF NOT EXISTS idx_states_geom ON states USING GIST (geom);
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'districts') THEN
        CREATE INDEX IF NOT EXISTS idx_districts_geom ON districts USING GIST (geom);
    END IF;
END $$;
