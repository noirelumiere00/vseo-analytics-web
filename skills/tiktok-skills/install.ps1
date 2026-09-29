# TikTok提案資料スキル 一式インストーラ（Windows / PowerShell）
#
# 実行: powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
# （ZIP由来のスクリプトは既定の実行ポリシーで拒否されるため、上の形で起動する）
# このファイルは BOM 付き UTF-8。BOM が無いと Windows PowerShell 5.1 は cp932 で読み、日本語が化けて構文エラーになる。
# 外部コマンド（npm / pip）の失敗は $ErrorActionPreference では止まらないので、終了コードを毎回見る。
$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dest = Join-Path $env:USERPROFILE ".claude\skills"
$Skills = @("tiktok-intake","tiktok-acquire","tiktok-analyze","tiktok-deck","review-scraper")
$Results = New-Object System.Collections.Generic.List[string]
$Failed = $false
function Remove-Safely($path) {
  # シンボリックリンク・ジャンクションは中身ではなくリンクだけを消す。
  # Windows PowerShell 5.1 の Remove-Item -Recurse はジャンクションの先まで辿って消すことがある
  if (-not (Test-Path $path)) { return }
  $item = Get-Item $path -Force
  if ($item.LinkType) { [System.IO.Directory]::Delete($path) } else { Remove-Item -Recurse -Force $path }
}
function Ok($m) { $script:Results.Add("  OK  $m") }
function Ng($m) { $script:Results.Add("  NG  $m"); $script:Failed = $true }

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Write-Host "▶ スキルを $Dest に配置します"
if ((Resolve-Path $Here).Path -eq (Resolve-Path $Dest).Path) {
  # ZIP を ~/.claude/skills に直接展開した場合。消してからコピーすると元が消える
  Ok "配置（展開先がそのまま配置先）"
} else {
  foreach ($s in $Skills) {
    $src = Join-Path $Here $s
    if (-not (Test-Path $src)) { Ng "配置: $s がZIPの中にありません"; continue }
    Write-Host "  - $s"
    $tmp = Join-Path $Dest ".$s.tmp"
    $t = Join-Path $Dest $s
    try {
      Remove-Safely $tmp
      Copy-Item -Recurse $src $tmp
      Remove-Safely $t
      Move-Item $tmp $t
      Ok "配置: $s"
    } catch {
      Ng "配置: $s（$($_.Exception.Message)）"
    }
  }
}

Write-Host "▶ Node の依存（Node.js 20 以上）"
if (Get-Command npm -ErrorAction SilentlyContinue) {
  foreach ($d in @("tiktok-acquire\scripts","tiktok-deck")) {
    Push-Location (Join-Path $Dest $d)
    npm install --silent
    if ($LASTEXITCODE -eq 0) { Ok "npm: $d" } else { Ng "npm: $d（後で cd して npm install）" }
    Pop-Location
  }
} else { Ng "Node.js が見つかりません（https://nodejs.org から 20 以上）" }

Write-Host "▶ Python の依存（Python 3.10〜3.12 の venv を1つ作って全スキルで共有）"
$py = $null
$check = "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)"
if (Get-Command py -ErrorAction SilentlyContinue) {
  foreach ($v in @("-3.12","-3.11","-3.10")) {
    & py $v -c $check 2>$null
    if ($LASTEXITCODE -eq 0) { $py = @("py", $v); break }
  }
}
if (-not $py -and (Get-Command python -ErrorAction SilentlyContinue)) {
  & python -c $check 2>$null
  if ($LASTEXITCODE -eq 0) { $py = @("python") }
}
if (-not $py) {
  Ng "Python 3.10〜3.12 が見つかりません（3.13 以上では計測モジュールが動きません）"
} else {
  $venv = Join-Path $Dest ".venv"
  $exe = $py[0]; $pyArgs = @(); if ($py.Count -gt 1) { $pyArgs = $py[1..($py.Count - 1)] }
  & $exe @pyArgs -m venv $venv
  $vpy = Join-Path $venv "Scripts\python.exe"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $vpy)) {
    Ng "venv を作れませんでした（$venv）"
  } else {
    & $vpy -m pip install -q -r (Join-Path $Dest "tiktok-analyze\scripts\requirements.txt")
    if ($LASTEXITCODE -eq 0) { Ok "pip: $venv" } else { Ng "pip: 依存を入れられませんでした（$vpy -m pip install -r ...requirements.txt を手で実行）" }
  }
}

Write-Host ""
Write-Host "結果:"
$Results | ForEach-Object { Write-Host $_ }
Write-Host ""
Write-Host "Python のツールは $Dest\.venv\Scripts\python.exe で実行してください（初訪の一覧シートは Pillow を使います）。"
Write-Host "review-scraper は追加インストール不要。PDF が要るときだけ LibreOffice を入れてください。"
if ($Failed) {
  Write-Host "⚠ 失敗した手順があります（上の NG）。直してから Claude Code を再起動してください。"
  exit 1
}
Write-Host "✅ 完了。Claude Code を再起動してください。"
