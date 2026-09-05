@echo off
:: Ensure script runs with Administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ==============================================================
    echo ERROR: Please right-click this file and select "Run as administrator"
    echo ==============================================================
    pause
    exit /b 1
)

echo [1/4] Stopping PostgreSQL 17...
net stop postgresql-x64-17

echo [2/4] Disabling PostgreSQL 17 automatic startup...
sc config postgresql-x64-17 start= disabled

echo [3/4] Starting PostgreSQL 16...
net start postgresql-x64-16

echo [4/4] Setting PostgreSQL 16 to Automatic startup...
sc config postgresql-x64-16 start= auto

echo.
echo ==============================================================
echo SUCCESS: PostgreSQL 16 is now active on port 5432!
echo PostgreSQL 17 is stopped and disabled.
echo ==============================================================
pause
