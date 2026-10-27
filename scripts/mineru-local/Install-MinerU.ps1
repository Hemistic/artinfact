[CmdletBinding()]
param(
    [string]$WorkspaceDir = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Artinfact'),
    [string]$InstallDir = '',
    [ValidateSet('auto','modelscope','huggingface')][string]$ModelSource = 'auto',
    [string]$SamplePdf = '',
    [switch]$Repair,
    [switch]$DependenciesOnly,
    [string]$InstallId = ([Guid]::NewGuid().ToString())
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$taskWorkspaceRoot = [IO.Path]::GetFullPath($WorkspaceDir)
if (!$InstallDir) { $InstallDir = Join-Path $taskWorkspaceRoot 'processors\mineru' }
$taskInstallRoot = [IO.Path]::GetFullPath($InstallDir)
New-Item -ItemType Directory -Path $taskInstallRoot -Force | Out-Null
$taskLog = Join-Path $taskInstallRoot ('install-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
Start-Transcript -LiteralPath $taskLog | Out-Null
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE): $Program $($Arguments -join ' ')" }
}
function Write-AtomicJson([string]$Path, $Value) {
    $temporary = "$Path.$([Guid]::NewGuid()).tmp"
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}
function Set-InstallProgress([string]$Phase, [string]$Label) {
    Write-AtomicJson (Join-Path $taskInstallRoot 'installation-progress.json') @{ phase=$Phase; label=$Label; pid=$PID; operationId=$InstallId; log=$taskLog; updatedAt=[DateTime]::UtcNow.ToString('o') }
}
try {
    $taskInstallLock = [IO.File]::Open((Join-Path $taskInstallRoot 'install.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    Set-InstallProgress 'installing' 'Installing base dependencies'
    Write-Host 'Artinfact: installing independent MinerU 4.0.10, Standard edition with automatic acceleration (no Torch).'
    Write-Host "Runtime and models: $taskInstallRoot"
    $taskUv = Join-Path $taskInstallRoot 'tools\uv.exe'
    if (!(Test-Path -LiteralPath $taskUv)) {
        New-Item -ItemType Directory -Path (Split-Path $taskUv) -Force | Out-Null
        $env:UV_INSTALL_DIR = Split-Path $taskUv
        $env:UV_NO_MODIFY_PATH = '1'
        $taskBootstrap = Join-Path $taskInstallRoot 'install-uv.ps1'
        Invoke-WebRequest -Uri 'https://astral.sh/uv/0.12.23/install.ps1' -OutFile $taskBootstrap -UseBasicParsing -TimeoutSec 120
        & $taskBootstrap
        if (!(Test-Path -LiteralPath $taskUv)) { throw 'Official uv installer did not produce uv.exe.' }
    }
    $env:UV_CACHE_DIR = Join-Path $taskInstallRoot 'cache'
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $taskInstallRoot 'python'
    $taskVenv = Join-Path $taskInstallRoot 'cpu-env'
    $taskPython = Join-Path $taskVenv 'Scripts\python.exe'
    $taskKit = Join-Path $taskVenv 'Scripts\mineru-kit.exe'
    if (!(Test-Path -LiteralPath $taskPython)) { Invoke-Checked $taskUv @('venv','--python','3.12.15','--managed-python',$taskVenv) }
    $taskPackages = @('pip','install','--python',$taskPython,'mineru==4.0.10')
    if ($Repair) { $taskPackages += '--reinstall' }
    Invoke-Checked $taskUv $taskPackages
    Invoke-Checked $taskUv @('pip','check','--python',$taskPython)
    $taskMineruHome = Join-Path $taskInstallRoot 'home'
    New-Item -ItemType Directory -Path $taskMineruHome -Force | Out-Null
    # Dedicated configuration prevents inherited cloud endpoints and other MinerU installations from affecting local parsing.
    [IO.File]::WriteAllText((Join-Path $taskMineruHome 'config.yaml'), "model:`n  source: local`n  small_backend: onnx`n  vlm:`n    engine: llama-cpp`n", [Text.UTF8Encoding]::new($false))
    $env:MINERU_HOME = $taskMineruHome
    $env:MINERU_CONFIG = Join-Path $taskMineruHome 'config.yaml'
    $env:MINERU_MODEL_SMALL_BACKEND = 'onnx'
    $env:MINERU_MODEL_VLM_ENGINE = 'llama-cpp'
    $env:LLAMA_ARG_N_PARALLEL = '1'
    foreach ($taskName in @('MINERU_API_URL','MINERU_API_KEY','MINERU_MODEL_VLM_SERVER_URL','MINERU_MODEL_VLM_API_KEY')) { [Environment]::SetEnvironmentVariable($taskName,$null,'Process') }
    Invoke-Checked $taskKit @('--version')
    $taskLlama = Join-Path $taskVenv 'Lib\site-packages\mineru_llama_cpp\bin\llama-server.exe'
    $taskDeviceOut = Join-Path $taskInstallRoot 'available-devices.txt'; $taskDeviceErr = Join-Path $taskInstallRoot 'available-devices-stderr.txt'
    $taskDeviceCheck = Start-Process -FilePath $taskLlama -ArgumentList '--list-devices' -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $taskDeviceOut -RedirectStandardError $taskDeviceErr
    $taskDevices = [IO.File]::ReadAllText($taskDeviceOut) + [IO.File]::ReadAllText($taskDeviceErr)
    if ($taskDeviceCheck.ExitCode -ne 0) { throw 'Backend device discovery failed.' }
    Write-Host $taskDevices
    if ($DependenciesOnly) { Set-InstallProgress 'dependencies-only' 'Models and PDF test have not completed'; Write-Host 'Dependencies installed only. Models and PDF smoke test have NOT completed. Plugin is not marked ready.'; exit 0 }
    Write-Host 'Downloading Standard models (ONNX + llama.cpp; automatic acceleration). Repeated installs reuse cached downloads.'
    Set-InstallProgress 'downloading' 'Downloading ONNX and llama.cpp VLM models'
    Invoke-Checked $taskKit @('models','download','--tier','standard','--small-backend','onnx','--vlm-engine','llama-cpp','--source',$ModelSource)
    $env:MINERU_MODEL_SOURCE = 'local'
    Invoke-Checked $taskKit @('models','verify','--tier','standard','--small-backend','onnx','--vlm-engine','llama-cpp')
    Invoke-Checked $taskKit @('models','show')
    $taskSmoke = Join-Path $taskInstallRoot ('smoke-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $taskSmoke | Out-Null
    if (!$SamplePdf) {
        $SamplePdf = Join-Path $taskSmoke 'sample.pdf'
        $taskStream = 'BT /F1 20 Tf 72 700 Td (Artinfact MinerU installation test) Tj ET'
        $taskObjects = @('<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',("<< /Length $($taskStream.Length) >>`nstream`n$taskStream`nendstream"))
        $taskPdf = "%PDF-1.7`n"; $taskOffsets = @()
        for ($taskIndex=0; $taskIndex -lt $taskObjects.Count; $taskIndex++) { $taskOffsets += [Text.Encoding]::ASCII.GetByteCount($taskPdf); $taskPdf += "$($taskIndex+1) 0 obj`n$($taskObjects[$taskIndex])`nendobj`n" }
        $taskXref = [Text.Encoding]::ASCII.GetByteCount($taskPdf)
        $taskPdf += "xref`n0 6`n0000000000 65535 f `n"
        foreach ($taskOffset in $taskOffsets) { $taskPdf += ('{0:D10} 00000 n ' -f $taskOffset) + "`n" }
        $taskPdf += "trailer`n<< /Size 6 /Root 1 0 R >>`nstartxref`n$taskXref`n%%EOF`n"
        [IO.File]::WriteAllBytes($SamplePdf,[Text.Encoding]::ASCII.GetBytes($taskPdf))
    }
    if (!(Test-Path -LiteralPath $SamplePdf -PathType Leaf)) { throw "Test PDF does not exist: $SamplePdf" }
    $taskZip = Join-Path $taskSmoke 'result.zip'
    Set-InstallProgress 'testing' 'Parsing a real PDF and validating Markdown + JSON'
    Invoke-Checked $taskKit @('parse',([IO.Path]::GetFullPath($SamplePdf)),'-o',$taskZip,'--tier','standard','--format','zip','--pages','1')
    $taskOutput = Join-Path $taskSmoke 'output'; Expand-Archive -LiteralPath $taskZip -DestinationPath $taskOutput
    $taskMd = Get-ChildItem -LiteralPath $taskOutput -Recurse -Filter markdown.md | Select-Object -First 1
    $taskJson = Get-ChildItem -LiteralPath $taskOutput -Recurse -Filter middle_json.json | Select-Object -First 1
    if (!$taskMd -or !$taskJson -or !(Get-Content -LiteralPath $taskMd.FullName -Raw).Trim()) { throw 'Smoke test did not produce nonempty Markdown and Middle JSON.' }
    $taskStructure = Get-Content -LiteralPath $taskJson.FullName -Raw | ConvertFrom-Json
    if ($taskStructure.schema -ne 'docvortex.middle' -or $taskStructure.pages.Count -ne 1 -or $taskStructure.pages[0].blocks.Count -lt 1) { throw 'Smoke test returned invalid page/block structure.' }
    $taskReport = @{ testedAt=[DateTime]::UtcNow.ToString('o'); mineruVersion='4.0.10'; mode='auto'; tier='standard'; samplePdf=$SamplePdf; output=$taskOutput; markdownBytes=$taskMd.Length; jsonBytes=$taskJson.Length; blocks=$taskStructure.pages[0].blocks.Count }
    Write-AtomicJson (Join-Path $taskInstallRoot 'smoke-test.json') $taskReport
    # The plugin discovers this receipt only after dependencies, models and a real PDF parse pass.
    Write-AtomicJson (Join-Path $taskInstallRoot 'installation.json') @{ version=1; mode='auto'; tier='standard'; mineruVersion='4.0.10'; root=$taskInstallRoot; executable=$taskKit; home=$taskMineruHome; standardVerified=$true; testedAt=$taskReport.testedAt }
    $taskDiscovery = Join-Path $taskWorkspaceRoot '.artinfact\mineru-local.json'
    New-Item -ItemType Directory -Path (Split-Path $taskDiscovery) -Force | Out-Null
    $taskDefaultInstall = [IO.Path]::GetFullPath((Join-Path $taskWorkspaceRoot 'processors\mineru'))
    Write-AtomicJson $taskDiscovery @{ version=1; root=$taskInstallRoot; source=$(if ($taskInstallRoot -eq $taskDefaultInstall) { 'workspace-default' } else { 'custom' }) }
    Set-InstallProgress 'completed' 'Standard installation and PDF test passed'
    Write-Host "SUCCESS: Standard parser, Markdown and JSON verified. Test output: $taskOutput"
    Write-Host 'Return to Artinfact and click Layout parsing. No cloud token or server is required.'
} catch { if ($taskInstallLock) { Set-InstallProgress 'failed' $_.Exception.Message }; Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red; Write-Host "Log: $taskLog"; exit 1 }
finally { if ($taskInstallLock) { $taskInstallLock.Dispose() }; Stop-Transcript | Out-Null }
