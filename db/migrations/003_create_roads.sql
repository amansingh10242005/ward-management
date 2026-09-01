-- 003_create_roads.sql
-- Table for the Roads layer.
-- Geometry type: LineString (SRID 4326).

CREATE TABLE IF NOT EXISTS roads (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) DEFAULT 'local',
    geom geometry(LineString, 4326) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS roads_geom_idx ON roads USING GIST (geom);
