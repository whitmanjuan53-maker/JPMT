@echo off
REM JPMT Tracking Server Startup Script

echo Starting JPMT Tracking Server...
echo.

REM Check if node_modules exists in tracking-server
if not exist "tracking-server\node_modules" (
    echo Installing dependencies...
    cd tracking-server
    call npm install
    cd ..
)

REM Build TypeScript
echo Building TypeScript...
cd tracking-server
call npm run build

REM Start the server
echo.
echo Starting server on port 3001...
echo API will be available at: http://localhost:3001
echo.
echo Press Ctrl+C to stop the server
echo.

node dist/index.js
