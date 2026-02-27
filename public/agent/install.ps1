$ErrorActionPreference = 'Stop'

$BaseUrl = if ($env:TOOLSPEC_BASE_URL) { $env:TOOLSPEC_BASE_URL } else { 'https://toolspec.dev' }
$ConfigDir = if ($env:TOOLSPEC_CONFIG_DIR) { $env:TOOLSPEC_CONFIG_DIR } else { Join-Path $HOME '.toolspec' }
$BinDir = Join-Path $ConfigDir 'bin'
$CliVersion = if ($env:TOOLSPEC_CLI_VERSION) { $env:TOOLSPEC_CLI_VERSION } else { '0.1.0' }

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  Write-Error 'ToolSpec install failed: npx is required to run the ToolSpec CLI.'
  exit 1
}

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

$env:TOOLSPEC_BASE_URL = $BaseUrl
$env:TOOLSPEC_CONFIG_DIR = $ConfigDir
$env:TOOLSPEC_INSTALL_DIR = $BinDir

npx -y "toolspec-cli@$CliVersion" install
