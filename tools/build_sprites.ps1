# =====================================================================
# build_sprites.ps1 — 캐릭터 세트/배경 원본 → 게임 자산 자동 빌드 (재실행 가능)
#   입력:  assets/src/<set>/<key>.mov|mp4|webm   set = 캐릭터 세트명(robot, cho_mi, no_mi, gal_bi, seonsaeng …)
#                                               key = walk_down | walk_up | walk_left | walk_right | walk_side | work …
#          assets/src/bg_classroom.png            배경 원본
#   출력:  assets/<set>/<key>.png (64px 프레임 가로 스트립, 검정 배경 투명화), assets/bg_classroom.png (960x717)
#          assets/sprites_data.js  (window.SPRITE_SETS = {set:{key:dataURL}}, window.SPRITE_DATA = robot 호환)
#   실행:  powershell -ExecutionPolicy Bypass -File tools/build_sprites.ps1 [-Similarity 0.10] [-Size 64]
#   캐릭터를 수정/추가했으면 같은 규칙으로 assets/src/<set>/ 에 넣고 이 스크립트만 다시 돌리면 된다.
# =====================================================================
param([string]$Similarity = "0.10", [string]$Blend = "0.02", [int]$Size = 64, [string]$KeyColor = "0x000000", [int]$BgW = 960, [int]$BgH = 717)
$dir = Split-Path $PSScriptRoot -Parent
$src = Join-Path $dir "assets\src"
$ff = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ff) { $ff = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }
if (-not $ff) { Write-Error "ffmpeg 를 찾을 수 없습니다. winget install Gyan.FFmpeg"; exit 1 }
$fp = Join-Path (Split-Path $ff -Parent) "ffprobe.exe"
Write-Output "ffmpeg: $ff"
$sets = Get-ChildItem $src -Directory
foreach ($s in $sets) {
    $outDir = Join-Path $dir ("assets\" + $s.Name); New-Item -ItemType Directory -Force $outDir | Out-Null
    $clips = Get-ChildItem $s.FullName -File | Where-Object { $_.Extension -match '^\.(mov|mp4|webm|mkv)$' }
    foreach ($c in $clips) {
        $key = [IO.Path]::GetFileNameWithoutExtension($c.Name)
        $n = (& $fp -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of default=noprint_wrappers=1:nokey=1 $c.FullName).Trim()
        if (-not $n -or $n -eq "N/A") { $n = (& $fp -v error -select_streams v:0 -show_entries stream=nb_frames -of default=noprint_wrappers=1:nokey=1 $c.FullName).Trim() }
        $out = Join-Path $outDir "$key.png"
        & $ff -v error -y -i $c.FullName -vf "format=rgba,colorkey=${KeyColor}:${Similarity}:${Blend},scale=${Size}:${Size}:flags=area,tile=${n}x1" $out
        Write-Output ("  {0,-10} {1,-11} {2,3}f -> {3} ({4}B)" -f $s.Name, $key, $n, (Split-Path $out -Leaf), (Get-Item $out).Length)
    }
}
$bgSrc = Join-Path $src "bg_classroom.png"
if (Test-Path $bgSrc) {
    & $ff -v error -y -i $bgSrc -vf "scale=${BgW}:${BgH}:flags=lanczos" -frames:v 1 -update 1 (Join-Path $dir "assets\bg_classroom.png")
    Write-Output "  background -> assets\bg_classroom.png (${BgW}x${BgH})"
}
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "inject_sprites.ps1")
