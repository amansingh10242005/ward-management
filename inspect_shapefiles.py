import geopandas as gpd

def inspect_shp(path, name):
    print(f"--- Inspecting {name} ---")
    try:
        gdf = gpd.read_file(path)
        print("CRS:", gdf.crs)
        print("Geometry Types:", gdf.geom_type.unique())
        print("Feature Count:", len(gdf))
        print("Columns:", gdf.columns.tolist())
    except Exception as e:
        print(f"Error inspecting {name}: {e}")
    print("\n")

inspect_shp("data/administrative/states/India_State_Boundary.shp", "States")
inspect_shp("data/administrative/districts/India_District_Boundary.shp", "Districts")
