@echo off
echo Starting GeoServer...
set JAVA_HOME=C:\Program Files\Java\jdk-23
set GEOSERVER_HOME=C:\geoserver
set GEOSERVER_DATA_DIR=C:\geoserver\data_dir

netstat -ano | findstr :8080 | findstr LISTENING >nul
if %errorlevel%==0 (
    echo.
    echo [INFO] GeoServer is ALREADY running on port 8080.
    echo Accessible at: http://localhost:8080/geoserver
    exit /b 0
)

call C:\geoserver\bin\startup.bat

