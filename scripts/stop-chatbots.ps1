param(
	[string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

function Stop-BotByEntry {
	param(
		[Parameter(Mandatory = $true)]
		[string]$Label,
		[Parameter(Mandatory = $true)]
		[string]$EntryPath
	)

	$escapedPath = [Regex]::Escape($EntryPath.Replace("/", "\\"))
	$processes = Get-CimInstance Win32_Process | Where-Object {
		$_.Name -eq "node.exe" -and $_.CommandLine -match $escapedPath
	}

	if (@($processes).Count -eq 0) {
		Write-Host "[launcher] $Label is not running."
		return
	}

	$processes | ForEach-Object {
		Stop-Process -Id $_.ProcessId -Force
	}

	Write-Host "[launcher] Stopped $Label."
}

$qqEntry = Join-Path $ProjectRoot "packages\qqbot\dist\main.js"
$feishuEntry = Join-Path $ProjectRoot "packages\feishu\dist\main.js"

Stop-BotByEntry -Label "QQ Bot" -EntryPath $qqEntry
Stop-BotByEntry -Label "Feishu Bot" -EntryPath $feishuEntry
