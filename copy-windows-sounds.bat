@echo off
chcp 65001 >nul
title Copy Windows sounds for GameVault
rem ------------------------------------------------------------
rem  Double-click this file from the project folder.
rem  It copies the Windows sounds from C:\Windows\Media into assets\sounds
rem ------------------------------------------------------------
set "SRC=%SystemRoot%\Media"
set "DST=%~dp0assets\sounds"
if not exist "%DST%" mkdir "%DST%"
set FOUND=0
set LOST=0
for %%F in ("Windows Logon Sound.wav" "Windows Logoff Sound.wav" "Windows Navigation Start.wav" "Windows Notify.wav" "Windows Error.wav" "Windows Exclamation.wav" "Windows Balloon.wav" "Windows Recycle.wav" "Windows Menu Command.wav") do (
  if exist "%SRC%\%%~F" (
    copy /Y "%SRC%\%%~F" "%DST%\" >nul
    echo   [OK]      %%~F
    set /a FOUND+=1
  ) else (
    echo   [MISSING] %%~F
    set /a LOST+=1
  )
)
echo.
echo Copied: %FOUND%   Missing: %LOST%
if %LOST% GTR 0 (
  echo.
  echo Some files were not found on this PC. Windows 10/11 does not include
  echo all the Windows 7 sounds. Put the missing files manually inside:
  echo   %DST%
  echo using exactly the same names shown above.
)
echo.
pause
