@echo off
REM Codecks MCP Setup Script (Windows)

echo === Codecks MCP Setup ===
echo.

REM Install dependencies
echo Installing dependencies...
call npm install
echo.

REM Create .env if it doesn't exist
if exist .env (
  echo .env already exists, skipping.
) else (
  copy .env.example .env
  echo Created .env from .env.example
  echo Open .env in your editor and fill in your Codecks credentials.
  echo.
  echo You'll need:
  echo   1. CODECKS_TOKEN  - the 'at' cookie from your browser (see README)
  echo   2. CODECKS_URL    - your org URL, e.g. myteam.codecks.io
  echo   3. CODECKS_USER_ID - your user ID (see README for how to find it)
)

echo.
echo Setup complete! Edit .env with your credentials, then add the MCP server to your Claude config.
echo See README.md for configuration details.
pause
