@echo off
title ESP32 Motion Sensor Monitor
echo ============================================================
echo   ESP32 Motion Sensor - Live Serial Monitor (COM3 @ 230400)
echo   Wave your hand in front of the sensor to see triggers!
echo   (Press Ctrl+C to exit)
echo ============================================================
echo.
"C:\Users\herma\AppData\Local\Python\pythoncore-3.14-64\Scripts\pio.exe" device monitor -p COM3 -b 230400
pause
