param(
    [string]$Prefix = 'book-hub-storage-test',
    [string]$Image = 'book-hub-storage-tests:local',
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
if ($Prefix -notmatch '^[a-z0-9][a-z0-9-]+$') { throw 'Prefix must contain lowercase letters, numbers and hyphens' }
function Invoke-Docker {
    param([string[]]$Arguments)
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw ('Docker failed: ' + ($Arguments -join ' ')) }
}
function Test-Container([string]$Name) {
    & docker inspect $Name *> $null
    return $LASTEXITCODE -eq 0
}
$network = $Prefix
$runner = $Prefix + '-runner'
$postgres = $Prefix + '-postgres'
$ftp = $Prefix + '-ftp'
$s3 = $Prefix + '-s3'
& docker network inspect $network *> $null
if ($LASTEXITCODE -ne 0) { Invoke-Docker @('network','create',$network) }
if (-not $SkipBuild) { Invoke-Docker @('build','-t',$Image,$PSScriptRoot) }
if (-not (Test-Container $postgres)) {
    Invoke-Docker @('create','--name',$postgres,'--label','book-hub.storage-test=true','--network',$network,'--network-alias','postgres','--tmpfs','/var/lib/postgresql/data:rw,size=384m','-e','POSTGRES_PASSWORD=storage-test-password','-e','POSTGRES_DB=book_hub_test','postgres:17-alpine')
}
Invoke-Docker @('start',$postgres)
if (-not (Test-Container $runner)) {
    Invoke-Docker @('create','--name',$runner,'--label','book-hub.storage-test=true','--network',$network,'--tmpfs','/tmp:rw,exec,size=768m','--tmpfs','/root/.cache/go-build:rw,exec,size=768m','-v',($Prefix+'-modules:/go/pkg/mod'),'-e','BOOK_HUB_TEST_DATABASE_URL=postgres://postgres:storage-test-password@postgres:5432/book_hub_test?sslmode=disable','-e','BOOK_HUB_TEST_FTP_ADDR=storage-fixtures:2121','-e','BOOK_HUB_TEST_FTPS_EXPLICIT_ADDR=storage-fixtures:2122','-e','BOOK_HUB_TEST_FTPS_IMPLICIT_ADDR=storage-fixtures:2990','-e','BOOK_HUB_TEST_FTPS_CA_FILE=/fixtures/server.pem','-e','BOOK_HUB_TEST_S3_ENDPOINT=http://storage-s3:3900',$Image,'tail','-f','/dev/null')
}
Invoke-Docker @('start',$runner)
Invoke-Docker @('exec',$runner,'mkdir','-p','/fixtures')
foreach ($file in @('ftp_fixture.py','garage.toml','smoke.py')) { Invoke-Docker @('cp',(Join-Path $PSScriptRoot $file),($runner+':/fixtures/'+$file)) }
Invoke-Docker @('exec',$runner,'sh','-c','test -f /fixtures/server.pem || openssl req -x509 -newkey rsa:2048 -nodes -keyout /fixtures/server.key -out /fixtures/server.pem -days 30 -subj /CN=storage-fixtures -addext subjectAltName=DNS:storage-fixtures,DNS:localhost,IP:127.0.0.1')
$runtime = Join-Path $PSScriptRoot '.runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
foreach ($file in @('server.pem','server.key')) { Invoke-Docker @('cp',($runner+':/fixtures/'+$file),(Join-Path $runtime $file)) }
if (-not (Test-Container $ftp)) {
    Invoke-Docker @('create','--name',$ftp,'--label','book-hub.storage-test=true','--network',$network,'--network-alias','storage-fixtures',$Image,'python','/fixtures/ftp_fixture.py')
    Invoke-Docker @('cp',(Join-Path $PSScriptRoot '.'),($ftp+':/fixtures'))
    foreach ($file in @('server.pem','server.key')) { Invoke-Docker @('cp',(Join-Path $runtime $file),($ftp+':/fixtures/'+$file)) }
}
Invoke-Docker @('start',$ftp)
if (-not (Test-Container $s3)) {
    Invoke-Docker @('create','--name',$s3,'--label','book-hub.storage-test=true','--network',$network,'--network-alias','storage-s3','-e','GARAGE_DEFAULT_ACCESS_KEY=GK00000000000000000000000000000001','-e','GARAGE_DEFAULT_SECRET_KEY=codex-bookhub-s3-test-secret-000000000000000000000000000000000000','-e','GARAGE_DEFAULT_BUCKET=bookhub-test','dxflrs/garage:v2.5.0','/garage','server','--single-node','--default-bucket')
    Invoke-Docker @('cp',(Join-Path $PSScriptRoot 'garage.toml'),($s3+':/etc/garage.toml'))
}
Invoke-Docker @('start',$s3)
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & docker exec $runner python /fixtures/smoke.py
    if ($LASTEXITCODE -eq 0) { break }
    if ($attempt -eq 29) { throw 'Storage services did not become ready' }
    Start-Sleep -Seconds 1
}
Write-Host "Services ready. Runner: $runner. This is disposable test data, not a production stack."
