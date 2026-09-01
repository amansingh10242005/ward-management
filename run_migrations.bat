@echo off
set /p PGPASSWORD="Enter PostgreSQL password for user 'postgres': "
set PGUSER=postgres
set PGDATABASE=ward_db
set PSQL="C:\Program Files\PostgreSQL\16\bin\psql.exe"
set SHP2PGSQL="C:\Program Files\PostgreSQL\16\bin\shp2pgsql.exe"

echo.
echo Running baseline migrations...
%PSQL% -f "db\migrations\001_enable_postgis.sql"
%PSQL% -f "db\migrations\002_create_streetlights.sql"
%PSQL% -f "db\migrations\003_create_roads.sql"
%PSQL% -f "db\migrations\004_create_zones.sql"

echo.
echo Importing and re-projecting shapefiles using Python...
python import_geopandas.py

echo.
echo Running relationship and constraints migrations...
%PSQL% -f "db\migrations\005_add_hierarchy_relationships.sql"
%PSQL% -f "db\migrations\006_enforce_state_district_pks.sql"

echo.
echo Database setup is completely automated and finished!
pause
