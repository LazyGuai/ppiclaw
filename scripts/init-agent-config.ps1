param(
    [string]$AgentDir,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Expand-HomePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathValue
    )

    if ($PathValue -eq "~") {
        return $HOME
    }

    if ($PathValue.StartsWith("~/") -or $PathValue.StartsWith("~\")) {
        return Join-Path $HOME $PathValue.Substring(2)
    }

    return $PathValue
}

function Resolve-AgentConfigDir {
    param(
        [string]$InputDir
    )

    if (-not [string]::IsNullOrWhiteSpace($InputDir)) {
        return Expand-HomePath -PathValue $InputDir.Trim()
    }

    if (-not [string]::IsNullOrWhiteSpace($env:PI_CODING_AGENT_DIR)) {
        return Expand-HomePath -PathValue $env:PI_CODING_AGENT_DIR.Trim()
    }

    if (-not [string]::IsNullOrWhiteSpace($env:PI_AGENT_DIR)) {
        return Expand-HomePath -PathValue $env:PI_AGENT_DIR.Trim()
    }

    return Join-Path $HOME ".pi\agent"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$templateDir = Join-Path $repoRoot "config-templates"

if (-not (Test-Path -LiteralPath $templateDir)) {
    throw "Template directory not found: $templateDir"
}

$resolvedAgentDir = Resolve-AgentConfigDir -InputDir $AgentDir
if (-not [System.IO.Path]::IsPathRooted($resolvedAgentDir)) {
    $resolvedAgentDir = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $resolvedAgentDir))
}

if (-not (Test-Path -LiteralPath $resolvedAgentDir)) {
    New-Item -ItemType Directory -Path $resolvedAgentDir -Force | Out-Null
}

$files = @(
    @{ Source = "auth.json.example"; Target = "auth.json" },
    @{ Source = "channels.json.example"; Target = "channels.json" },
    @{ Source = "settings.json.example"; Target = "settings.json" },
    @{ Source = "models.json.example"; Target = "models.json" }
)

$copied = @()
$skipped = @()

foreach ($file in $files) {
    $sourcePath = Join-Path $templateDir $file.Source
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        throw "Template file not found: $sourcePath"
    }

    $targetPath = Join-Path $resolvedAgentDir $file.Target
    if ((Test-Path -LiteralPath $targetPath) -and (-not $Force.IsPresent)) {
        $skipped += $file.Target
        continue
    }

    Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
    $copied += $file.Target
}

Write-Host "Agent config directory: $resolvedAgentDir"

if ($copied.Count -gt 0) {
    Write-Host "Created/updated files:"
    foreach ($item in $copied) {
        Write-Host "  - $item"
    }
}

if ($skipped.Count -gt 0) {
    Write-Host "Skipped existing files (use -Force to overwrite):"
    foreach ($item in $skipped) {
        Write-Host "  - $item"
    }
}

Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Open auth.json and fill in API keys."
Write-Host "2. Open channels.json and fill bot settings if you use Feishu."
Write-Host "3. Start pi, then run /model (or /login for OAuth providers)."
