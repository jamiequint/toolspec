$ErrorActionPreference = 'Stop'

$BaseUrl = if ($env:TOOLSPEC_BASE_URL) { $env:TOOLSPEC_BASE_URL } else { 'https://toolspec.dev' }
$ConfigDir = if ($env:TOOLSPEC_CONFIG_DIR) { $env:TOOLSPEC_CONFIG_DIR } else { Join-Path $HOME '.toolspec' }
$BinDir = Join-Path $ConfigDir 'bin'
$CliScriptPath = Join-Path $BinDir 'toolspec.ps1'
$CliCmdPath = Join-Path $BinDir 'toolspec.cmd'
$InstallFile = Join-Path $ConfigDir 'install.json'

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  Write-Error 'ToolSpec install failed: npx is required to run the ToolSpec CLI.'
  exit 1
}

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

try {
  $register = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/installs/register" -ContentType 'application/json'
  $register | ConvertTo-Json -Depth 12 | Set-Content -Path $InstallFile -Encoding UTF8
} catch {
  $register = $null
}

$cli = @"
param([Parameter(ValueFromRemainingArguments = `$true)][string[]]`$ToolArgs)

`$ErrorActionPreference = 'Stop'
`$env:TOOLSPEC_BASE_URL = '$BaseUrl'
`$env:TOOLSPEC_CONFIG_DIR = '$ConfigDir'
`$env:TOOLSPEC_INSTALL_DIR = '$BinDir'

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  Write-Error 'ToolSpec CLI requires npx.'
  exit 1
}

npx -y toolspec-cli@latest @ToolArgs
"@

Set-Content -Path $CliScriptPath -Encoding UTF8 -Value $cli

$wrapper = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"" + $CliScriptPath + "`" %*`r`n"
Set-Content -Path $CliCmdPath -Encoding ASCII -Value $wrapper

Write-Output "ToolSpec installed: $CliCmdPath"
if ($register -and $register.post_install_prompt -and $register.post_install_prompt.message) {
  Write-Output $register.post_install_prompt.message
}
Write-Output 'Add this directory to PATH for global access:'
Write-Output "  $BinDir"
Write-Output 'Preparing local review draft (not submitting)...'

try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $CliScriptPath prepare
} catch {
  Write-Error 'Failed to prepare local draft during install.'
  exit 1
}

Write-Output 'REQUIRED NEXT STEP: toolspec approve'
Write-Output 'Optional: toolspec verify'
Write-Output ''
Write-Output 'Running post-install status check...'
try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $CliScriptPath status
} catch {
  Write-Output 'Could not run status automatically. Run: toolspec status'
}
