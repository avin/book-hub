param(
    [Parameter(Mandatory=$true)][string]$RepoRoot,
    [string]$RunnerName = 'book-hub-storage-test-runner',
    [string[]]$GoArguments = @('test', '-p', '2', '-race', './...'),
    [hashtable]$TestEnv = @{}
)
$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'backend/go.mod'))) {
    throw "Not a Book Hub source root: $sourceRoot"
}
$sourceSlug = (Split-Path -Leaf $sourceRoot) -replace '[^a-zA-Z0-9_-]', '-'
$runID = [guid]::NewGuid().ToString('N')
# Fresh snapshots prevent stale deleted files and parallel-worktree collisions.
$runRoot = '/worktrees/' + $sourceSlug + '-' + $runID.Substring(0,8)
$localScratch = Join-Path ([IO.Path]::GetTempPath()) ('book-storage-source-' + $runID)
New-Item -ItemType Directory -Path $localScratch | Out-Null
$listPath = Join-Path $localScratch 'files.txt'
$archivePath = Join-Path $localScratch 'source.tar'
try {
    Push-Location -LiteralPath $sourceRoot
    try {
        # Respect gitignore: no runtime books, .env, build artifacts or node_modules.
        $sourceFiles = @(& rg --files backend)
        if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate backend sources' }
        @($sourceFiles + 'Makefile') | Set-Content -LiteralPath $listPath -Encoding utf8
        & tar -C $sourceRoot -cf $archivePath -T $listPath
        if ($LASTEXITCODE -ne 0) { throw 'Cannot archive backend sources' }
    } finally { Pop-Location }
    & docker exec $RunnerName mkdir -p $runRoot
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create runner worktree directory' }
    & docker cp $archivePath ($RunnerName + ':' + $runRoot + '/source.tar')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot copy backend source archive' }
    & docker exec $RunnerName tar -xf ($runRoot + '/source.tar') -C $runRoot
    if ($LASTEXITCODE -ne 0) { throw 'Cannot extract backend source archive' }
} finally {
    if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath }
    if (Test-Path -LiteralPath $listPath) { Remove-Item -LiteralPath $listPath }
    Remove-Item -LiteralPath $localScratch
}
$execArguments = @('exec')
foreach ($entry in $TestEnv.GetEnumerator()) { $execArguments += @('-e', ($entry.Key + '=' + $entry.Value)) }
$execArguments += @($RunnerName, 'go', '-C', ($runRoot + '/backend'))
Write-Host "Linux source snapshot: $runRoot/backend"
& docker @execArguments @GoArguments
$testExitCode = $LASTEXITCODE
if ($testExitCode -eq 0 -and $runRoot -match '^/worktrees/[a-zA-Z0-9_-]+-[a-f0-9]{8}$') {
    & docker exec $RunnerName rm -rf -- $runRoot
}
exit $testExitCode

