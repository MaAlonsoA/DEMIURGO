# Operación de la instancia estable

DEMIURGO se ejecuta en una única instancia local publicada en `127.0.0.1:8000`. La base SQLite y la autenticación de Codex permanecen fuera del repositorio, en `%LOCALAPPDATA%\Demiurgo\stable`.

## Arranque y actualización

Desde la raíz del repositorio, en PowerShell:

```powershell
$env:DEMIURGO_DATA_DIR = "$env:LOCALAPPDATA\Demiurgo\stable\data"
$env:DEMIURGO_CODEX_DIR = "$env:LOCALAPPDATA\Demiurgo\stable\codex"
$env:DEMIURGO_PORT = "8000"
$env:DEMIURGO_IMAGE_TAG = "stable"
New-Item -ItemType Directory -Force $env:DEMIURGO_DATA_DIR, $env:DEMIURGO_CODEX_DIR | Out-Null
docker compose -p demiurgo-stable up -d --build
Invoke-RestMethod http://127.0.0.1:8000/healthz
```

Antes de actualizar, crea una copia consistente con la API de copia de SQLite y comprueba `PRAGMA integrity_check`. El inicio aplica las migraciones pendientes. Después, verifica `/healthz`, `/api/state`, una ejecución y la integridad de la base. Si es necesario revertir una migración, detén el contenedor y restaura la copia anterior antes de arrancar la imagen previa.

Para iniciar sesión en Codex, usa `docker compose -p demiurgo-stable run --rm -it app codex login`. No guardes el directorio de autenticación en Git.

## Comprobaciones

```powershell
python -m pytest -q
cd frontend
npm.cmd run build
npm.cmd run test:e2e
```

Las pruebas de navegador y de Codex real usan bases temporales separadas de la base de trabajo.
