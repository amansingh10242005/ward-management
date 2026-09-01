-- Migration 006: Enforce Primary Keys on States and Districts
-- This migration corrects the schema created by the initial shapefile import
-- to ensure GeoServer generates stable WFS feature IDs.

DO $$
BEGIN
    -- Ensure states table exists before modifying
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'states') THEN
        -- Make ID column NOT NULL
        ALTER TABLE states ALTER COLUMN id SET NOT NULL;
        
        -- Add PRIMARY KEY if it doesn't already exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE table_name = 'states' AND constraint_type = 'PRIMARY KEY'
        ) THEN
            ALTER TABLE states ADD PRIMARY KEY (id);
        END IF;

        -- Drop redundant non-unique btree index created by geopandas
        DROP INDEX IF EXISTS ix_public_states_id;
    END IF;

    -- Ensure districts table exists before modifying
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'districts') THEN
        -- Make ID column NOT NULL
        ALTER TABLE districts ALTER COLUMN id SET NOT NULL;
        
        -- Add PRIMARY KEY if it doesn't already exist
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE table_name = 'districts' AND constraint_type = 'PRIMARY KEY'
        ) THEN
            ALTER TABLE districts ADD PRIMARY KEY (id);
        END IF;

        -- Drop redundant non-unique btree index created by geopandas
        DROP INDEX IF EXISTS ix_public_districts_id;
    END IF;
END $$;
