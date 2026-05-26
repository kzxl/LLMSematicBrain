@echo off
title Semantic Brain & Proxy Launcher
echo ===================================================
echo Starting Semantic Brain Services...
echo ===================================================

:: Chuyển đến thư mục chứa file bat này (thư mục gốc project)
cd /d "%~dp0"

:: Mở Server trong cửa sổ mới
echo [1/2] Starting Semantic Brain Server...
start "Semantic Brain Server" cmd /c "title Semantic Brain Server && node server.js"

:: Chờ 2 giây để server khởi động trước (đảm bảo port sẵn sàng)
timeout /t 2 /nobreak >nul

:: Mở Proxy trong cửa sổ mới
echo [2/2] Starting OpenAI Proxy...
start "OpenAI Proxy" cmd /c "title OpenAI Proxy && node openai-proxy.js"

echo.
echo ===================================================
echo DONE! Services are running in separate windows.
echo You can create a shortcut of this file to your Desktop.
echo ===================================================
timeout /t 3 >nul
