-- 009_add_state_district_id_sequences.sql
-- Ensures states and districts tables have default sequence generators for their primary key id column,
-- preventing null constraint violations on inserts and ensuring stable, unique IDs.

DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'states') THEN
        CREATE SEQUENCE IF NOT EXISTS states_id_seq;
        PERFORM setval('states_id_seq', COALESCE((SELECT MAX(id) FROM states), 0) + 1, false);
        ALTER TABLE states ALTER COLUMN id SET DEFAULT nextval('states_id_seq');
    END IF;

    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'districts') THEN
        CREATE SEQUENCE IF NOT EXISTS districts_id_seq;
        PERFORM setval('districts_id_seq', COALESCE((SELECT MAX(id) FROM districts), 0) + 1, false);
        ALTER TABLE districts ALTER COLUMN id SET DEFAULT nextval('districts_id_seq');
    END IF;
END $$;
