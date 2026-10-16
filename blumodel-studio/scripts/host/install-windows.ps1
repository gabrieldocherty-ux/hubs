<#
  Installs BluModel Studio on Windows 10 or 11 (including Windows 10 IoT Enterprise on a Dell Wyse
  5070), or brings an existing install up to date. Safe to run again: each step checks first.
  docs/HOSTING.md is the runbook.

    powershell -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1 [-DryRun]
        [-HomeDir <folder>] [-Branch blumodel-studio] [-Repo https://github.com/gabrieldocherty-ux/hubs.git]
        [-Port 8790] [-SkipTasks]

  What it does, in order:
    1. checks for Node.js 24 or newer, git and cloudflared. If one is missing it prints the winget
       command that installs it and stops: it never installs software itself.
    2. the code: a sparse, partial clone of just blumodel-studio\ on the branch into <home>\repo,
       or a fast-forward of the one already there
    3. npm ci and the build (scripts\host\build.mjs, with its memory guard)
    4. the deploy (scripts\deploy-local.mjs): backs up an existing database first, keeps the old app
       as app.previous, writes the settings template only if there is no blumodel.env, starts the
       server and checks http://127.0.0.1:<port>/api/health
    5. the tunnel files (scripts\tunnel\setup-tunnel.mjs --validate, an offline check). The tunnel
       is NOT started: that is the cutover (docs/HOSTING.md).
    6. the BluModelStudioServer task, run when Windows starts whether or not anyone signs in
       (scripts\register-tasks.mjs --at-startup --only server). schtasks asks for your Windows
       password, and this step needs PowerShell run as administrator; without that it prints the
       command to run there. -SkipTasks leaves the tasks alone. The BluModelTunnel task is
       registered at the cutover.
  It never opens blumodel.env or the tunnel's credentials and never copies anything from another
  machine. -DryRun prints every command (the lines starting with +) and runs none of them.
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [string]$HomeDir = (Join-Path $env:USERPROFILE 'Projects\BluModelStudio'),
  [string]$Branch = 'blumodel-studio',
  [string]$Repo = 'https://github.com/gabrieldocherty-ux/hubs.git',
  [int]$Port = 8790,
  [switch]$SkipTasks
)
$ErrorActionPreference = 'Stop'
$NodeMajor = 24

function Say([string]$t) { Write-Host ''; Write-Host "==> $t" }
function Note([string]$t) { Write-Host "    $t" }
function Quote([string]$a) { if ($a -match '[\s"]' -or $a -eq '') { return '"' + ($a -replace '"', '\"') + '"' } return $a }
# Prints a command, then runs it (not in a dry run). Returns its exit code (0 in a dry run).
function Run([string]$exe, [string[]]$argList, [string]$cwd) {
  $line = '+ ' + ((@($exe) + $argList | ForEach-Object { Quote $_ }) -join ' ')
  if ($cwd) { $line += "    (in $cwd)" }
  Write-Host $line
  if ($DryRun) { return 0 }
  if ($cwd) { Push-Location -LiteralPath $cwd }
  try {
    & $exe @argList | Out-Host
    $code = $LASTEXITCODE
  } finally {
    if ($cwd) { Pop-Location }
  }
  if ($null -eq $code) { $code = 0 }
  return $code
}
function Must([string]$what, [string]$exe, [string[]]$argList, [string]$cwd) {
  $code = Run $exe $argList $cwd
  if ($code -ne 0) { throw "$what failed (exit $code)." }
}

if ($HomeDir -notmatch '^[A-Za-z]:\\' -and $HomeDir -notmatch '^\\\\') { throw "-HomeDir must be a full path (got $HomeDir)." }
if ($Branch -notmatch '^[A-Za-z0-9._/-]+$') { throw "Not a branch name: $Branch" }
$HomeDir = $HomeDir.TrimEnd('\')
$RepoDir = Join-Path $HomeDir 'repo'
$AppSrc = Join-Path $RepoDir 'blumodel-studio'
if ($DryRun) { Write-Host 'DRY RUN: every command is printed (+) and none is run.' }

# 1. the machine
Say 'Checking this machine'
$missing = @()
$node = Get-Command node -ErrorAction SilentlyContinue
$major = 0
if ($node) {
  $v = (& node --version) | Select-Object -First 1
  if ($v -match '^v(\d+)\.') { $major = [int]$Matches[1] }
}
if ($major -ge $NodeMajor) { Note "Node.js ${v}: ok" } else { $missing += "Node.js $NodeMajor or newer (found: $(if ($node) { $v } else { 'none' })):  winget install --id OpenJS.NodeJS.LTS -e" }
if (Get-Command git -ErrorAction SilentlyContinue) { Note "$((& git --version) | Select-Object -First 1): ok" } else { $missing += 'git:  winget install --id Git.Git -e' }
$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf -and (Test-Path -LiteralPath 'C:\Program Files (x86)\cloudflared\cloudflared.exe')) { $cf = 'C:\Program Files (x86)\cloudflared\cloudflared.exe' }
if ($cf) { Note 'cloudflared: ok' } else { $missing += 'cloudflared:  winget install --id Cloudflare.cloudflared -e' }
if ($missing.Count -gt 0) {
  Write-Host ''
  Write-Host 'Missing. Install them (this script does not install software), open a NEW PowerShell window so PATH is fresh, and run this again:'
  foreach ($m in $missing) { Write-Host "  $m" }
  if (-not $DryRun) { exit 1 }
}
$ramMb = [math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)
Note "RAM: $ramMb MB"
$drive = Split-Path -Qualifier $HomeDir
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$drive'" -ErrorAction SilentlyContinue
if ($disk) {
  $freeMb = [math]::Floor($disk.FreeSpace / 1MB)
  Note "Free disk on ${drive}: $freeMb MB"
  if ($freeMb -lt 4096) { Note 'WARNING: under 4 GB free. The code and its dependencies take about 500 MB, and the database, uploads and their backups grow from there.' }
}
if (Get-Command uwfmgr.exe -ErrorAction SilentlyContinue) {
  Note 'WARNING: this Windows has the Unified Write Filter (Dell Wyse images ship with it on). If it is on, every'
  Note 'file written (the install, the database) is thrown away at the next restart. Check from an administrator'
  Note 'prompt: uwfmgr get-config. Turn it off before going on (docs/HOSTING.md, "Windows on the Wyse").'
}

# 2. the code
Say "The code: $Repo, branch $Branch, only blumodel-studio\"
if (Test-Path -LiteralPath (Join-Path $RepoDir '.git')) {
  if (-not $DryRun) {
    $changes = (& git -C $RepoDir status --porcelain --untracked-files=no)
    if ($changes) { throw "The checkout in $RepoDir has local changes (git -C $RepoDir status). Undo them, then run this again." }
  }
  Must 'git sparse-checkout' git @('-C', $RepoDir, 'sparse-checkout', 'set', 'blumodel-studio')
  Must 'git fetch' git @('-C', $RepoDir, 'fetch', 'origin', "+refs/heads/${Branch}:refs/remotes/origin/$Branch")
  $hasBranch = $true
  if (-not $DryRun) { & git -C $RepoDir show-ref --verify --quiet "refs/heads/$Branch"; $hasBranch = ($LASTEXITCODE -eq 0) }
  if ($hasBranch) { Must 'git checkout' git @('-C', $RepoDir, 'checkout', $Branch) }
  else { Must 'git checkout' git @('-C', $RepoDir, 'checkout', '--track', '-b', $Branch, "origin/$Branch") }
  Must 'git merge --ff-only' git @('-C', $RepoDir, 'merge', '--ff-only', "origin/$Branch")
} else {
  Write-Host "+ New-Item -ItemType Directory -Force $(Quote $HomeDir)"
  if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null }
  Must 'git clone' git @('clone', '--filter=blob:none', '--sparse', '--branch', $Branch, '--single-branch', $Repo, $RepoDir)
  Must 'git sparse-checkout' git @('-C', $RepoDir, 'sparse-checkout', 'set', 'blumodel-studio')
}
$commit = '<commit>'
if (-not $DryRun) { $commit = ((& git -C $RepoDir rev-parse --short HEAD) | Select-Object -First 1).Trim() }
Note "commit $commit"

# 3. dependencies and the build
Say 'Dependencies (npm ci) and the build'
Must 'npm ci' 'npm.cmd' @('ci', '--no-audit', '--no-fund') $AppSrc
Must 'The build' node @('scripts\host\build.mjs', '--out', 'dist') $AppSrc

# 4. the deploy
Say 'The deploy (backs up an existing database first, starts the server, checks its health)'
Write-Host "+ `$env:BLUMODEL_HOME = $(Quote $HomeDir); `$env:BLUMODEL_PORT = $Port"
if (-not $DryRun) { $env:BLUMODEL_HOME = $HomeDir; $env:BLUMODEL_PORT = "$Port" }
$code = Run node @('scripts\deploy-local.mjs', '--dist', (Join-Path $AppSrc 'dist'), '--commit', $commit) $AppSrc
if ($code -ne 0) {
  throw "The deploy did not finish healthy (exit $code). Look at $HomeDir\logs\server.log and $HomeDir\logs\console.log. If an older app was there: node scripts\deploy-local.mjs --rollback"
}

# 5. the tunnel's files
Say "The tunnel's files (written, checked offline; the tunnel is NOT started)"
$tunnelArgs = @('scripts\tunnel\setup-tunnel.mjs', '--home', $HomeDir, '--port', "$Port", '--validate')
if ($cf -is [string]) { $tunnelArgs += @('--cloudflared', $cf) }
if ((Run node $tunnelArgs $AppSrc) -ne 0) { Note 'WARNING: the tunnel files did not validate; see the lines above (docs/HOSTING.md, "Move the tunnel").' }

# 6. start at boot
Say 'Starting at boot, with nobody signed in'
$taskCmd = "node `"$AppSrc\scripts\register-tasks.mjs`" --home `"$HomeDir`" --at-startup --only server"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($SkipTasks) {
  Note "Skipped (-SkipTasks). Later, from PowerShell run as administrator: $taskCmd"
} elseif (-not $isAdmin -and -not $DryRun) {
  Note 'This PowerShell is not elevated, so the startup task was not registered. Open PowerShell as administrator and run:'
  Note "  $taskCmd"
} else {
  if ((Run node @('scripts\register-tasks.mjs', '--home', $HomeDir, '--at-startup', '--only', 'server') $AppSrc) -ne 0) {
    Note "The task was not registered; run it again from PowerShell run as administrator: $taskCmd"
  } else {
    # The deploy started the server in this sign-in session, which ends it at sign-out: restart it
    # through the task (start-server.cmd does that now that startup-tasks lists it).
    Note 'Restarting the server through its task, so it keeps running after you sign out'
    [void](Run 'cmd.exe' @('/d', '/c', (Join-Path $HomeDir 'stop-server.cmd')) $HomeDir)
    [void](Run 'cmd.exe' @('/d', '/c', (Join-Path $HomeDir 'start-server.cmd')) $HomeDir)
  }
}

# 7. what is left
$tunnelId = '064671cd-a658-4240-8626-c697b9f148ac'
Say 'Installed. What is left (docs/HOSTING.md has each step):'
Write-Host "  The site runs on this machine at http://127.0.0.1:$Port (open http://127.0.0.1:$Port/api/health)."
Write-Host '  It is NOT public yet: the tunnel is off until the cutover.'
Write-Host ''
Write-Host "  1. Settings: notepad `"$HomeDir\blumodel.env`"   (paste a NEW Stripe key here, nowhere else), then"
Write-Host "     `"$HomeDir\stop-server.cmd`" and `"$HomeDir\start-server.cmd`""
Write-Host "  2. The tunnel's credentials: copy $tunnelId.json yourself into $env:USERPROFILE\.cloudflared\"
Write-Host '  3. The data from the old machine: docs/MOVING_DATA.md'
Write-Host '  4. The cutover (stop the old machine''s server and tunnel FIRST), from PowerShell run as administrator:'
Write-Host "       node `"$AppSrc\scripts\register-tasks.mjs`" --home `"$HomeDir`" --at-startup --only tunnel"
Write-Host '       schtasks /Run /TN BluModelTunnel'
Write-Host '  Power: never sleep on mains power: powercfg /change standby-timeout-ac 0'
Write-Host "  Updates later: node `"$AppSrc\scripts\host\update.mjs`""
if ($DryRun) { Write-Host ''; Write-Host 'Dry run: nothing was installed, written, started or changed.' }
