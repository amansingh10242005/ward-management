-- 005_add_hierarchy_relationships.sql
-- Adds hierarchy relationships: Zone -> Road -> Streetlight

-- Add zone_id to roads
ALTER TABLE roads
ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES zones(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS roads_zone_id_idx ON roads(zone_id);

-- Add zone_id and road_id to streetlights
ALTER TABLE streetlights
ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES zones(id) ON DELETE RESTRICT,
ADD COLUMN IF NOT EXISTS road_id INTEGER REFERENCES roads(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS streetlights_zone_id_idx ON streetlights(zone_id);
CREATE INDEX IF NOT EXISTS streetlights_road_id_idx ON streetlights(road_id);
