# Copia de seguridad semanal. La ejecuta el Programador de tareas de Windows
# (tarea "Bitacora - Copia de seguridad semanal"). Deja el resultado en
# respaldo.log dentro de la carpeta de copias y, si falla, muestra un aviso
# en pantalla para que no pase desapercibido.

$repo = Split-Path -Parent $PSScriptRoot
$destino = Join-Path $env:USERPROFILE "Documents\HUBER\Respaldos_Bitacora"
New-Item -ItemType Directory -Force $destino | Out-Null
$log = Join-Path $destino "respaldo.log"

Set-Location $repo
$salida = & node scripts/respaldo.mjs 2>&1 | Out-String
$ok = ($LASTEXITCODE -eq 0)

$estado = "FALLO"
if ($ok) { $estado = "OK" }
$linea = "[{0}] {1}`r`n{2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm"), $estado, $salida.Trim()
Add-Content -Path $log -Value $linea -Encoding utf8

if (-not $ok) {
  $aviso = "La copia de seguridad semanal de la Bitacora NO se hizo.`n`nRevisa: $log"
  (New-Object -ComObject WScript.Shell).Popup($aviso, 0, "Bitacora - copia de seguridad", 48) | Out-Null
  exit 1
}
