# Windows PowerShell 5.1. Downloads only; never starts the EXE or changes policy.
param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$Sha256,
    [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$studioUri = [Uri]$Url
if ($studioUri.Scheme -ne 'https' -or $studioUri.Host -ne 'github.com' -or -not $studioUri.AbsolutePath.StartsWith('/wrightausername/Comic-Beatdowns/releases/download/')) {
    throw 'Use a fixed Comic Beatdowns GitHub release URL.'
}
$studioDirectory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Destination))
[IO.Directory]::CreateDirectory($studioDirectory) | Out-Null
# Unique temporary file prevents a failed transfer from replacing a usable download.
$studioPartial = Join-Path $studioDirectory ([IO.Path]::GetRandomFileName() + '.partial')
try {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $studioPartial
    if ((Get-FileHash -LiteralPath $studioPartial -Algorithm SHA256).Hash -ne $Sha256) {
        throw 'Download checksum did not match. The EXE was not saved.'
    }
    Move-Item -LiteralPath $studioPartial -Destination $Destination -Force
    Write-Host "Verified download saved to: $Destination"
} finally {
    if (Test-Path -LiteralPath $studioPartial) { Remove-Item -LiteralPath $studioPartial }
}
