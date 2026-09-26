param([switch]$Resume)
$ErrorActionPreference = 'Stop'
# A separate MySQL process with a new data directory; never reuse the installed service.
$sandboxRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.cache/ingredient-taxonomy-sandbox'))
$mysqlBinary = 'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqld.exe'
if ($Resume) {
    $sandboxConfig = Get-Content -Raw -LiteralPath (Join-Path $sandboxRoot 'local.json') | ConvertFrom-Json
    $sandboxUri = [Uri]$sandboxConfig.url
    if ($sandboxUri.Host -ne '127.0.0.1' -or $sandboxUri.AbsolutePath -ne '/ingredient_taxonomy_rehearsal') { throw 'Invalid sandbox target.' }
    $databaseDirectory = [IO.Path]::GetFullPath($sandboxConfig.dataDirectory)
    if ($databaseDirectory -ne [IO.Path]::GetFullPath((Join-Path $sandboxRoot 'data'))) { throw 'Invalid sandbox data directory.' }
    $resumeArguments = @('--no-defaults', "--datadir=`"$databaseDirectory`"", '--bind-address=127.0.0.1', "--port=$($sandboxUri.Port)", '--mysqlx=OFF', "--log-error=`"$sandboxRoot/server.log`"")
    $sandboxProcess = Start-Process -FilePath $mysqlBinary -ArgumentList $resumeArguments -WindowStyle Hidden -PassThru
    $sandboxConfig.processId = $sandboxProcess.Id
    $sandboxConfig | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sandboxRoot 'local.json') -Encoding ascii
    Write-Output "Isolated MySQL resuming on loopback port $($sandboxUri.Port)."
    exit
}
if (Test-Path -LiteralPath $sandboxRoot) { throw 'Sandbox already exists. Use -Resume only after checking that its previous process has stopped.' }
New-Item -ItemType Directory -Path $sandboxRoot | Out-Null
$databaseDirectory = Join-Path $sandboxRoot 'data'
& $mysqlBinary --no-defaults --initialize-insecure "--datadir=$databaseDirectory" "--log-error=$sandboxRoot/initialize.log"
if ($LASTEXITCODE -ne 0) { throw 'MySQL initialization failed; see the private initialize.log.' }
$portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portProbe.Start()
$sandboxPort = $portProbe.LocalEndpoint.Port
$portProbe.Stop()
$sandboxPassword = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
$initFile = Join-Path $sandboxRoot 'init.sql'
@"
ALTER USER 'root'@'localhost' IDENTIFIED BY '$sandboxPassword';
CREATE DATABASE ingredient_taxonomy_rehearsal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
"@ | Set-Content -LiteralPath $initFile -Encoding ascii
$mysqlArguments = @('--no-defaults', "--datadir=`"$databaseDirectory`"", '--bind-address=127.0.0.1', "--port=$sandboxPort", '--mysqlx=OFF', "--init-file=`"$initFile`"", "--log-error=`"$sandboxRoot/server.log`"")
$sandboxProcess = Start-Process -FilePath $mysqlBinary -ArgumentList $mysqlArguments -WindowStyle Hidden -PassThru
$sandboxConfig = @{ url = "mysql://root:$sandboxPassword@127.0.0.1:$sandboxPort/ingredient_taxonomy_rehearsal"; processId = $sandboxProcess.Id; dataDirectory = $databaseDirectory }
$sandboxConfig | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sandboxRoot 'local.json') -Encoding ascii
Write-Output "Isolated MySQL starting on loopback port $sandboxPort (PID $($sandboxProcess.Id)); credentials remain in the ignored .cache directory."
