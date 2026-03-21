@echo off
REM Chrome Extension Package Script for Windows
REM Usage: build.bat [version]

setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set PROJECT_ROOT=%SCRIPT_DIR%..
set SRC_DIR=%PROJECT_ROOT%\src
set DIST_DIR=%PROJECT_ROOT%\dist

REM Get version from argument or manifest.json
if not "%~1"=="" (
    set VERSION=%~1
) else (
    REM Simple version extraction from manifest.json
    for /f "tokens=2 delims=:, " %%a in ('findstr /c:"\"version\"" "%SRC_DIR%\manifest.json"') do (
        set VERSION=%%a
        set VERSION=!VERSION:"=!
        goto :got_version
    )
    :got_version
)

set EXTENSION_NAME=tab-sleep
set PACKAGE_NAME=%EXTENSION_NAME%-v%VERSION%
set PACKAGE_DIR=%DIST_DIR%\%PACKAGE_NAME%
set ZIP_FILE=%DIST_DIR%\%PACKAGE_NAME%.zip

echo ========================================
echo Chrome Extension Package Builder
echo ========================================
echo Project: %PROJECT_ROOT%
echo Version: %VERSION%
echo Package: %PACKAGE_NAME%
echo ========================================

REM Clean dist directory
echo [1/4] Cleaning dist directory...
if exist "%DIST_DIR%" rmdir /s /q "%DIST_DIR%"
mkdir "%DIST_DIR%"

REM Copy extension files
echo [2/4] Copying extension files...
mkdir "%PACKAGE_DIR%"
xcopy /s /e /i /q "%SRC_DIR%\*" "%PACKAGE_DIR%\" > nul

REM Remove unnecessary files
echo [3/4] Removing unnecessary files...
del /s /q "%PACKAGE_DIR%\*.map" 2>nul
del /s /q "%PACKAGE_DIR%\.DS_Store" 2>nul
del /s /q "%PACKAGE_DIR%\Thumbs.db" 2>nul

REM Create zip file using PowerShell
echo [4/4] Creating zip file...
powershell -Command "Compress-Archive -Path '%PACKAGE_DIR%\*' -DestinationPath '%ZIP_FILE%' -Force"

REM Cleanup
rmdir /s /q "%PACKAGE_DIR%"

echo ========================================
echo Build completed successfully!
echo Output: %ZIP_FILE%
echo ========================================

REM Show file info
dir "%ZIP_FILE%"
