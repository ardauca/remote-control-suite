$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$artifactRoot = Join-Path $repoRoot 'artifacts'
$publishDir = Join-Path $artifactRoot 'RemoteSuite-win-x64'
$archivePath = Join-Path $artifactRoot 'RemoteSuite-win-x64.zip'
$projectPath = Join-Path $repoRoot 'server/RemoteAgent/RemoteAgent.csproj'
$clientPath = Join-Path $repoRoot 'client'
$installGuide = Join-Path $repoRoot 'docs/INSTALL_WINDOWS.md'

$sdkVersion = (& dotnet --version).Trim()
if ([version]$sdkVersion.Split('-')[0] -lt [version]'10.0.100') {
    throw "The .NET 10 SDK is required to package Remote Suite. Found SDK $sdkVersion."
}

Push-Location $clientPath
try {
    npm ci
    npm run build
}
finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
if (Test-Path -LiteralPath $publishDir) {
    $artifactRootFull = [System.IO.Path]::GetFullPath($artifactRoot).TrimEnd('\') + '\'
    $publishDirFull = [System.IO.Path]::GetFullPath($publishDir)
    if (-not $publishDirFull.StartsWith($artifactRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean a publish directory outside artifacts: $publishDirFull"
    }
    Remove-Item -LiteralPath $publishDirFull -Recurse -Force
}

if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}

dotnet publish $projectPath -c Release -r win-x64 --self-contained true -p:UseAppHost=true -o $publishDir
Copy-Item -LiteralPath $installGuide -Destination (Join-Path $publishDir 'INSTALL.md')
Compress-Archive -Path (Join-Path $publishDir '*') -DestinationPath $archivePath -CompressionLevel Optimal

Write-Host "Portable Windows x64 package created: $archivePath"
