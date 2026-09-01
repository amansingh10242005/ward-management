-- 002_create_streetlights.sql
-- Table for the Streetlights layer.
-- Geometry type: Point (SRID 4326).

CREATE TABLE IF NOT EXISTS streetlights (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) DEFAULT 'standard',
    geom geometry(Point, 4326) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS streetlights_geom_idx ON streetlights USING GIST (geom);
