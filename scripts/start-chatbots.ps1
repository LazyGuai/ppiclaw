param(
	[string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

function Test-BotRunning {
	param(
		[Parameter(Mandatory = $true)]
		[string]$EntryPath
	)

	$escapedPath = [Regex]::Escape($EntryPath.Replace("/", "\\"))
	$processes = Get-CimInstance Win32_Process | Where-Object {
		$_.Name -eq "node.exe" -and $_.CommandLine -match $escapedPath
	}
	return @($processes).Count -gt 0
}

function Ensure-Build {
	param(
		[Parameter(Mandatory = $true)]
		[string]$WorkspaceName
	)

	Write-Host "[launcher] Building $WorkspaceName ..."
	Push-Location $ProjectRoot
	try {
		& npm run build --workspace $WorkspaceName
		if ($LASTEXITCODE -ne 0) {
			throw "Build failed for $WorkspaceName."
		}
	} finally {
		Pop-Location
	}
}

function Start-BotProcess {
	param(
		[Parameter(Mandatory = $true)]
		[string]$Label,
		[Parameter(Mandatory = $true)]
		[string]$EntryPath
	)

	if (Test-BotRunning -EntryPath $EntryPath) {
		Write-Host "[launcher] $Label is already running."
		return
	}

	Start-Process -FilePath "node.exe" -ArgumentList @($EntryPath) -WorkingDirectory $ProjectRoot | Out-Null

	Write-Host "[launcher] Started $Label."
}

$qqEntry = Join-Path $ProjectRoot "packages\qqbot\dist\main.js"
$feishuEntry = Join-Path $ProjectRoot "packages\feishu\dist\main.js"

Ensure-Build -WorkspaceName "@mariozechner/pi-qqbot"
Ensure-Build -WorkspaceName "@mariozechner/pi-feishu"

Start-BotProcess -Label "QQ Bot" -EntryPath $qqEntry
Start-BotProcess -Label "Feishu Bot" -EntryPath $feishuEntry
