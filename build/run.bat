@echo off
rem ============================================================
rem  sel2pw — Selenium Java/TestNG -> Playwright TypeScript
rem  Convenience wrapper around sel2pw.exe.
rem
rem  Usage:
rem    run.bat <input-selenium-project> [<output-playwright-project>]
rem
rem  If <output> is omitted, defaults to <input>-converted in the
rem  same parent directory.
rem ============================================================

setlocal enabledelayedexpansion

if "%~1"=="" (
  echo.
  echo Usage: run.bat ^<input-selenium-project^> [^<output-playwright-project^>]
  echo Example: run.bat C:\projects\my-selenium-suite
  echo.
  echo Set ANTHROPIC_API_KEY in env to enable LLM fallback for unconvertable files.
  exit /b 2
)

set "INPUT=%~1"
set "OUTPUT=%~2"
if "%OUTPUT%"=="" set "OUTPUT=%INPUT%-converted"

set "EXE_DIR=%~dp0"
set "EXE=%EXE_DIR%sel2pw.exe"

if not exist "%EXE%" (
  echo sel2pw.exe not found at: %EXE%
  echo Make sure sel2pw.exe and run.bat are in the same folder.
  exit /b 1
)

echo.
echo ============================================================
echo  sel2pw — converting
echo    input:  %INPUT%
echo    output: %OUTPUT%
echo ============================================================
echo.

"%EXE%" convert "%INPUT%" --out "%OUTPUT%" --validate

if errorlevel 1 (
  echo.
  echo Conversion exited with errors. See %OUTPUT%\CONVERSION_REVIEW.md
  echo and %OUTPUT%\conversion-result.json for the structured result.
  exit /b 1
)

echo.
echo ============================================================
echo  Done. Outputs:
echo    %OUTPUT%\pages\           — converted Page Objects
echo    %OUTPUT%\tests\           — converted spec files
echo    %OUTPUT%\CONVERSION_REVIEW.md  — manual-review punch list
echo    %OUTPUT%\MIGRATION_NOTES.md    — what to delete from pom.xml, CI changes
echo    %OUTPUT%\conversion-result.json — structured per-file outcome
echo ============================================================
echo.
echo Next:
echo   cd %OUTPUT%
echo   npm install
echo   npx playwright install
echo   npx playwright test
echo.
endlocal
