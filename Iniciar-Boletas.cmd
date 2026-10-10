@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
    py -3 servidor_correo.py --open
    goto end
)
where python >nul 2>nul
if not errorlevel 1 (
    python servidor_correo.py --open
    goto end
)
echo Necesitas Python 3.10 o posterior para conectar el correo.
echo Descargalo desde https://www.python.org/downloads/
echo En el instalador marca Add Python to PATH.
echo Despues vuelve a abrir este archivo.
:end
pause
