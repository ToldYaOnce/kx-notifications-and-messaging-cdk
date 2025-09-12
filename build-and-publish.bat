@echo off
REM Build and Publish Script for @toldyaonce/kx-notifications-and-messaging-cdk
REM Usage: build-and-publish.bat [version]
REM Example: build-and-publish.bat patch

setlocal enabledelayedexpansion

set VERSION_TYPE=%1
if "%VERSION_TYPE%"=="" set VERSION_TYPE=patch

echo [INFO] Starting build and publish process...
echo [INFO] Version bump type: %VERSION_TYPE%

REM Check if we're in the right directory
if not exist "package.json" (
    echo [ERROR] This script must be run from the project root directory
    exit /b 1
)

REM Step 1: Clean previous build
echo [INFO] Cleaning previous build...
call npm run clean 2>nul
if exist lib rmdir /s /q lib

REM Step 2: Install dependencies
echo [INFO] Installing dependencies...
call npm install
if errorlevel 1 (
    echo [ERROR] Failed to install dependencies
    exit /b 1
)

REM Step 3: Build the project
echo [INFO] Building TypeScript...
call npm run build
if errorlevel 1 (
    echo [ERROR] Build failed
    exit /b 1
)

REM Step 4: Verify build output
echo [INFO] Verifying build output...
if not exist "lib\index.js" (
    echo [ERROR] Build verification failed - missing lib/index.js
    exit /b 1
)

if not exist "lib\index.d.ts" (
    echo [ERROR] Build verification failed - missing lib/index.d.ts
    exit /b 1
)

echo [SUCCESS] Build verification completed successfully

REM Step 5: Version bump
echo [INFO] Bumping version (%VERSION_TYPE%)...
for /f "tokens=*" %%i in ('node -p "require('./package.json').version"') do set OLD_VERSION=%%i
call npm version %VERSION_TYPE% --no-git-tag-version
if errorlevel 1 (
    echo [ERROR] Version bump failed
    exit /b 1
)
for /f "tokens=*" %%i in ('node -p "require('./package.json').version"') do set NEW_VERSION=%%i
echo [SUCCESS] Version bumped from %OLD_VERSION% to %NEW_VERSION%

REM Step 6: Check npm authentication (skip for GitHub Packages)
echo [INFO] Checking npm configuration...
for /f "tokens=*" %%i in ('npm config get registry') do set REGISTRY=%%i
echo [SUCCESS] Registry: %REGISTRY%

REM Only check whoami for public npm registry
if "%REGISTRY%"=="https://registry.npmjs.org/" (
    call npm whoami >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Not logged in to npm. Please run 'npm login' first
        exit /b 1
    )
    for /f "tokens=*" %%i in ('npm whoami') do set NPM_USER=%%i
    echo [SUCCESS] Authenticated as: %NPM_USER%
) else (
    echo [SUCCESS] Using configured registry (GitHub Packages/private registry)
    set NPM_USER=configured-user
)

REM Step 7: Dry run publish
echo [INFO] Running publish dry-run...
call npm publish --dry-run
if errorlevel 1 (
    echo [ERROR] Publish dry-run failed
    exit /b 1
)

REM Step 8: Confirm publish
echo.
echo [WARNING] About to publish @toldyaonce/kx-notifications-and-messaging-cdk@%NEW_VERSION%
echo [WARNING] User: %NPM_USER%
echo.

REM Step 9: Publish to npm
echo [INFO] Publishing to npm...
call npm publish
if errorlevel 1 (
    echo [ERROR] Publish failed
    exit /b 1
)

echo [SUCCESS] Package published successfully!
echo [SUCCESS] @toldyaonce/kx-notifications-and-messaging-cdk@%NEW_VERSION% is now available

echo [INFO] Build and publish completed successfully!
echo.
echo Next steps:
echo   • Install: npm install @toldyaonce/kx-notifications-and-messaging-cdk@%NEW_VERSION%
echo   • Documentation: Update README.md if needed
echo   • Release notes: Consider creating a GitHub release

endlocal
