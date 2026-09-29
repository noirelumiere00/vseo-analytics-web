# TikTok提案資料スキル 一式インストーラ（Windows / PowerShell）
$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dest = Join-Path $env:USERPROFILE ".claude\skills"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Write-Host "▶ スキルを $Dest に配置します"
foreach ($s in @("tiktok-intake","tiktok-acquire","tiktok-analyze","tiktok-deck","review-scraper")) {
  Write-Host "  - $s"
  $t = Join-Path $Dest $s
  if (Test-Path $t) { Remove-Item -Recurse -Force $t }
  Copy-Item -Recurse (Join-Path $Here $s) $t
}
Write-Host "▶ 依存をインストールします（Node / Python が必要）"
if (Get-Command npm -ErrorAction SilentlyContinue) {
  Push-Location (Join-Path $Dest "tiktok-acquire\scripts"); npm install --silent; Pop-Location
  Push-Location (Join-Path $Dest "tiktok-deck"); npm install --silent; Pop-Location
  Write-Host "  npm OK"
} else { Write-Host "  ! Node.js 20+ が見つかりません（https://nodejs.org）" }
$py = if (Get-Command py -ErrorAction SilentlyContinue) { "py -3.12" } elseif (Get-Command python -ErrorAction SilentlyContinue) { "python" } else { $null }
if ($py) {
  Invoke-Expression "$py -m venv `"$Dest\.venv`""
  & "$Dest\.venv\Scripts\pip.exe" install -q -r "$Dest\tiktok-analyze\scripts\requirements.txt"
  Write-Host "  pip OK"
} else { Write-Host "  ! Python 3.10〜3.12 が見つかりません" }
Write-Host "✅ 完了。Claude Code を再起動してください（review-scraper は追加インストール不要）"
