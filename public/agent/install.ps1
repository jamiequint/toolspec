$ErrorActionPreference = 'Stop'

$BaseUrl = if ($env:TOOLSPEC_BASE_URL) { $env:TOOLSPEC_BASE_URL } else { 'https://toolspec.dev' }
$ConfigDir = if ($env:TOOLSPEC_CONFIG_DIR) { $env:TOOLSPEC_CONFIG_DIR } else { Join-Path $HOME '.toolspec' }
$BinDir = Join-Path $ConfigDir 'bin'
$CliScriptPath = Join-Path $ConfigDir 'toolspec-cli.js'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'ToolSpec install failed: node is required to run the ToolSpec CLI.'
  exit 1
}

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

Invoke-WebRequest -Uri "$BaseUrl/agent/toolspec-cli.js" -OutFile $CliScriptPath -UseBasicParsing

$env:TOOLSPEC_BASE_URL = $BaseUrl
$env:TOOLSPEC_CONFIG_DIR = $ConfigDir
$env:TOOLSPEC_INSTALL_DIR = $BinDir
$env:TOOLSPEC_CLI_SCRIPT = $CliScriptPath
$env:TOOLSPEC_INSTALL_AUTO_APPROVE = '1'

node $CliScriptPath install
