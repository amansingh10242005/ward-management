-- 001_enable_postgis.sql
-- Enables the PostGIS extension on the database.
-- Run this as a superuser (or database owner) before creating any spatial tables.

CREATE EXTENSION IF NOT EXISTS postgis;
