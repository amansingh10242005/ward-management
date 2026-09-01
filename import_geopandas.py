import os
import sys
import geopandas as gpd
from sqlalchemy import create_engine

import urllib.parse

def main():
    password = os.environ.get('PGPASSWORD', 'postgres')
    encoded_password = urllib.parse.quote_plus(password)
    engine = create_engine(f'postgresql://postgres:{encoded_password}@127.0.0.1:5432/ward_db')
    
    print("Reading and re-projecting states shapefile to EPSG:4326...")
    states_gdf = gpd.read_file(r"data\administrative\states\India_State_Boundary.shp")
    states_gdf = states_gdf.to_crs(epsg=4326)
    states_gdf.rename_geometry('geom', inplace=True)
    
    print("Importing states into PostGIS...")
    states_gdf.to_postgis('states', engine, if_exists='replace', index=True, index_label='id')

    print("Reading and re-projecting districts shapefile to EPSG:4326...")
    districts_gdf = gpd.read_file(r"data\administrative\districts\India_District_Boundary.shp")
    districts_gdf = districts_gdf.to_crs(epsg=4326)
    districts_gdf.rename_geometry('geom', inplace=True)
    
    print("Importing districts into PostGIS...")
    districts_gdf.to_postgis('districts', engine, if_exists='replace', index=True, index_label='id')
    
    print("Python import completed successfully.")

if __name__ == "__main__":
    main()
