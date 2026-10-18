<#
  Installs BluModel Studio on Windows 10 or 11 (including Windows 10 IoT Enterprise on a Dell Wyse
  5070), or brings an existing install up to date. Safe to run again: each step checks first.
  docs/HOSTING.md is the runbook.

    powershell -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1 [-DryRun]
        [-HomeDir <folder>] [-Branch blumodel-studio] [-Repo git@github.com:gabrieldocherty-ux/hubs.git]
        [-Port 8790] [-SkipTasks] [-AutoUpdateTime 04:00] [-NoAutoUpdate] [-Build] [-HeapMb 384]
        [-NoShortcuts]

  What it does, in order:
    1. checks for Node.js 24 or newer, git and cloudflared. If one is missing it prints the winget
       command that installs it and stops: it never installs software itself.
    2. the code, over SSH with a read-only DEPLOY KEY (the repo is private): <home>\.ssh\id_ed25519,
       made here once and readable only by this account (the one the server's tasks run as, so
       the automatic update can use it), GitHub's published ed25519 host key pinned in
       <home>\.ssh\known_hosts, and the public key printed for GitHub > hubs > Settings > Deploy
       keys (read-only); it waits for Enter and checks the key works. Then a sparse, partial clone
       of just blumodel-studio\ on the branch into <home>\repo, or a fast-forward of the one
       already there; a checkout made over public HTTPS is switched to SSH once. The checkout's
       core.sshCommand names the key, so every update uses it.
    3. nothing is built: the branch carries the release prebuilt (dist\ and server\generated\, made
       by npm run release on a developer's machine). -Build (an emergency only) runs npm ci and
       scripts\host\build.mjs into .build\local instead.
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
    7. the automatic update (register-tasks.mjs --at-startup --only update): BluModelStudioUpdate
       daily at -AutoUpdateTime (04:00), and BluModelStudioUpdateNow, which every two minutes looks
       for Admin > System > Update now's trigger file and otherwise does nothing. schtasks asks for
       the password once for each. -NoAutoUpdate registers neither (and disables them if they exist).
    8. two desktop shortcuts (-NoShortcuts: none): 'BluModel Server' (http://127.0.0.1:8799, the
       server face: every site on or off, Update now) and 'Update BluModel' (<home>\update-now.cmd:
       the update run directly, in a window that stays open; the fallback when the server is down).
       The server runs with a 384 MB V8 heap cap (-HeapMb), written into run-server.cmd.
  It never opens blumodel.env or the tunnel's credentials and never copies anything from another
  machine. -DryRun prints every command (the lines starting with +) and runs none of them.
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [string]$HomeDir = (Join-Path $env:USERPROFILE 'Projects\BluModelStudio'),
  [string]$Branch = 'blumodel-studio',
  [string]$Repo = 'git@github.com:gabrieldocherty-ux/hubs.git',
  [int]$Port = 8790,
  [switch]$SkipTasks,
  [string]$AutoUpdateTime = '',
  [switch]$NoAutoUpdate,
  [switch]$Build,
  [int]$HeapMb = 0,
  [switch]$NoShortcuts
)
# GitHub's published SSH host key (docs.github.com, "GitHub's SSH key fingerprints":
# SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU), pinned rather than trusted on first use.
$GitHubHostKey = 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'
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
if ($AutoUpdateTime -and $AutoUpdateTime -notmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$') { throw "-AutoUpdateTime takes HH:MM, 24 hour (got $AutoUpdateTime)." }
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

# 2. the deploy key, then the code
$UseSsh = $Repo -match '^(git@github\.com:|ssh://git@github\.com/)'
$SshDir = Join-Path $HomeDir '.ssh'
$Key = Join-Path $SshDir 'id_ed25519'
$Known = Join-Path $SshDir 'known_hosts'
$HomeFwd = $HomeDir -replace '\\', '/'
if ($HomeFwd -match '[\s"'']') { throw "-HomeDir can't have spaces or quotes (ssh reads the key's path): $HomeDir" }
$SshCmd = "ssh -i $HomeFwd/.ssh/id_ed25519 -o IdentitiesOnly=yes -o UserKnownHostsFile=$HomeFwd/.ssh/known_hosts -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=ssh-ed25519"
if ($UseSsh) {
  Say 'The deploy key (read-only access to the private repo)'
  Write-Host "+ New-Item -ItemType Directory -Force $(Quote $SshDir)"
  Write-Host "+ write $Known (GitHub's pinned ed25519 host key)"
  if (-not $DryRun) {
    New-Item -ItemType Directory -Force -Path $SshDir | Out-Null
    Set-Content -LiteralPath $Known -Value $GitHubHostKey -Encoding ASCII
  }
  if (Test-Path -LiteralPath $Key) { Note "deploy key: $Key (exists)" }
  else {
    $keygen = Get-Command ssh-keygen -ErrorAction SilentlyContinue
    if (-not $keygen -and -not $DryRun) { throw 'ssh-keygen was not found (Windows has it in System32\OpenSSH; Git for Windows in usr\bin).' }
    # An empty passphrase: Windows PowerShell 5.1 drops an empty argument, so it is passed as '""'
    # there (ssh-keygen reads that as empty); PowerShell 7.3+ passes '' as it is.
    $empty = if ($PSVersionTable.PSVersion.Major -ge 7) { '' } else { '""' }
    Must 'ssh-keygen' 'ssh-keygen' @('-q', '-t', 'ed25519', '-N', $empty, '-C', "blumodel-deploy@$env:COMPUTERNAME", '-f', $Key)
  }
  # The key and the .ssh folder: this account only (the server's tasks run as it).
  Must 'icacls' 'icacls.exe' @($SshDir, '/inheritance:r', '/grant:r', "${env:USERDOMAIN}\${env:USERNAME}:(OI)(CI)F")
  if ($DryRun) { Note '(a real run prints the public key here and waits until it works on GitHub)' }
  else {
    function KeyWorks { & git -c "core.sshCommand=$SshCmd" ls-remote --heads $Repo $Branch *> $null; return ($LASTEXITCODE -eq 0) }
    if (-not (KeyWorks)) {
      Write-Host ''
      Write-Host '    Add this key on GitHub: github.com/gabrieldocherty-ux/hubs > Settings > Deploy keys > Add deploy key,'
      Write-Host "    title 'Wyse', READ-ONLY (leave 'Allow write access' unchecked):"
      Write-Host ''
      Write-Host ("    " + (Get-Content -LiteralPath "$Key.pub" -Raw).Trim())
      Write-Host ''
      for ($i = 0; $i -lt 5 -and -not (KeyWorks); $i++) {
        [void](Read-Host '    Press Enter once it is added')
        if (-not (KeyWorks)) { Write-Host "    GitHub doesn't accept it yet (not added, or added to another repo)." }
      }
      if (-not (KeyWorks)) { throw "The deploy key still doesn't work. Add $Key.pub as a read-only deploy key of gabrieldocherty-ux/hubs, then run this again." }
    }
    Note 'deploy key: accepted by GitHub'
  }
}

Say "The code: $Repo, branch $Branch, only blumodel-studio\"
if (Test-Path -LiteralPath (Join-Path $RepoDir '.git')) {
  if (-not $DryRun) {
    $changes = (& git -C $RepoDir status --porcelain --untracked-files=no)
    if ($changes) { throw "The checkout in $RepoDir has local changes (git -C $RepoDir status). Undo them, then run this again." }
  }
  if ($UseSsh) {
    # Once: a checkout made over public HTTPS switches to the private repo's SSH address.
    $origin = ''
    if (-not $DryRun) { $origin = ((& git -C $RepoDir remote get-url origin) | Select-Object -First 1) }
    if ($DryRun -or $origin -ne $Repo) { Must 'git remote set-url' git @('-C', $RepoDir, 'remote', 'set-url', 'origin', $Repo) }
    Must 'git config core.sshCommand' git @('-C', $RepoDir, 'config', 'core.sshCommand', $SshCmd)
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
  if ($UseSsh) {
    Must 'git clone' git @('-c', "core.sshCommand=$SshCmd", 'clone', '--filter=blob:none', '--sparse', '--branch', $Branch, '--single-branch', $Repo, $RepoDir)
    Must 'git config core.sshCommand' git @('-C', $RepoDir, 'config', 'core.sshCommand', $SshCmd)
  } else {
    Must 'git clone' git @('clone', '--filter=blob:none', '--sparse', '--branch', $Branch, '--single-branch', $Repo, $RepoDir)
  }
  Must 'git sparse-checkout' git @('-C', $RepoDir, 'sparse-checkout', 'set', 'blumodel-studio')
}
$commit = '<commit>'
if (-not $DryRun) { $commit = ((& git -C $RepoDir rev-parse --short HEAD) | Select-Object -First 1).Trim() }
Note "commit $commit"

# 3. the build: prebuilt (or, -Build, made here)
$Dist = Join-Path $AppSrc 'dist'
if ($Build) {
  Say 'Emergency build on this machine (-Build): npm ci and the build into .build\local'
  Must 'npm ci' 'npm.cmd' @('ci', '--no-audit', '--no-fund') $AppSrc
  Must 'The build' node @('scripts\host\build.mjs', '--out', '.build\local') $AppSrc
  $Dist = Join-Path $AppSrc '.build\local'
} else {
  Say 'The prebuilt release (nothing is installed or built on this machine)'
  if (-not $DryRun -and (-not (Test-Path -LiteralPath (Join-Path $Dist 'index.html')) -or -not (Test-Path -LiteralPath (Join-Path $AppSrc 'server\generated\export-kit.mjs')))) {
    throw "Branch $Branch has no prebuilt release (no $Dist\index.html or server\generated\export-kit.mjs). Publish one with npm run release on a developer's machine, or build here anyway with -Build."
  }
  Note "deploying $Dist, built by npm run release"
}

# 4. the deploy
Say 'The deploy (backs up an existing database first, starts the server, checks its health)'
Write-Host "+ `$env:BLUMODEL_HOME = $(Quote $HomeDir); `$env:BLUMODEL_PORT = $Port$(if ($HeapMb) { "; `$env:BLUMODEL_HEAP_MB = $HeapMb" })"
if (-not $DryRun) { $env:BLUMODEL_HOME = $HomeDir; $env:BLUMODEL_PORT = "$Port"; if ($HeapMb) { $env:BLUMODEL_HEAP_MB = "$HeapMb" } }
$code = Run node @('scripts\deploy-local.mjs', '--dist', $Dist, '--commit', $commit) $AppSrc
if ($code -ne 0) {
  throw "The deploy did not finish healthy (exit $code). Look at $HomeDir\logs\server.log and $HomeDir\logs\console.log. If an older app was there: node scripts\deploy-local.mjs --rollback"
}

# 5. the tunnel's files
Say "The tunnel's files (written, checked offline; the tunnel is NOT started)"
$tunnelArgs = @('scripts\tunnel\setup-tunnel.mjs', '--home', $HomeDir, '--port', "$Port", '--validate')
if ($cf -is [string]) { $tunnelArgs += @('--cloudflared', $cf) }
if ((Run node $tunnelArgs $AppSrc) -ne 0) { Note 'WARNING: the tunnel files did not validate; see the lines above (docs/HOSTING.md, "Move the tunnel").' }
# The tunnel's credentials: this account only (the BluModelTunnel task runs as it).
$cfDir = Join-Path $env:USERPROFILE '.cloudflared'
if ($DryRun -or (Test-Path -LiteralPath $cfDir)) { Must 'icacls' 'icacls.exe' @($cfDir, '/inheritance:r', '/grant:r', "${env:USERDOMAIN}\${env:USERNAME}:(OI)(CI)F") }

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

# 7. automatic updates
Say 'Automatic updates'
$updArgs = @('scripts\register-tasks.mjs', '--home', $HomeDir, '--at-startup', '--only', 'update')
if ($NoAutoUpdate) { $updArgs += '--no-auto-update' } elseif ($AutoUpdateTime) { $updArgs += @('--auto-update-time', $AutoUpdateTime) }
if ($SkipTasks) {
  Note "Skipped (-SkipTasks). Later, from PowerShell run as administrator: node `"$AppSrc\scripts\register-tasks.mjs`" $(($updArgs | Select-Object -Skip 1) -join ' ')"
} elseif (-not $isAdmin -and -not $DryRun) {
  Note 'This PowerShell is not elevated, so the update tasks were not registered. From PowerShell run as administrator:'
  Note "  node `"$AppSrc\scripts\register-tasks.mjs`" $(($updArgs | Select-Object -Skip 1) -join ' ')"
} elseif ((Run node $updArgs $AppSrc) -ne 0) {
  Note 'The update tasks were not registered; run the command above again from PowerShell run as administrator.'
}

# 8. the desktop shortcuts
if ($NoShortcuts) { Say 'Desktop shortcuts: skipped (-NoShortcuts)' }
else {
  Say 'Desktop shortcuts'
  $desk = [Environment]::GetFolderPath('Desktop')
  $url = Join-Path $desk 'BluModel Server.url'
  $lnk = Join-Path $desk 'Update BluModel.lnk'
  $ico = Join-Path $HomeDir 'blumodel.ico'
  Write-Host "+ write $(Quote $url): http://127.0.0.1:8799/ (the server face: every site on or off, Update now)"
  Write-Host "+ shortcut $(Quote $lnk) -> $(Join-Path $HomeDir 'update-now.cmd') (the update, directly)"
  if (-not $DryRun) {
    Set-Content -LiteralPath $url -Encoding ASCII -Value "[InternetShortcut]`r`nURL=http://127.0.0.1:8799/`r`nIconFile=$ico`r`nIconIndex=0"
    $ws = New-Object -ComObject WScript.Shell
    $s = $ws.CreateShortcut($lnk)
    $s.TargetPath = Join-Path $HomeDir 'update-now.cmd'
    $s.WorkingDirectory = $HomeDir
    $s.IconLocation = "$ico,0"
    $s.Description = 'Update BluModel Studio from GitHub now'
    $s.Save()
  }
}

# 9. what is left
$tunnelId = '064671cd-a658-4240-8626-c697b9f148ac'
Say 'Installed. What is left (docs/HOSTING.md has each step):'
Write-Host "  The site runs on this machine at http://127.0.0.1:$Port (open http://127.0.0.1:$Port/api/health)."
Write-Host '  It is NOT public yet: the tunnel is off until the cutover.'
Write-Host ''
Write-Host '  (These are PowerShell commands; in a Command Prompt leave out the leading "& ".)'
Write-Host "  1. Settings: notepad `"$HomeDir\blumodel.env`"   (paste a NEW Stripe key here, nowhere else), then"
Write-Host "       & `"$HomeDir\stop-server.cmd`""
Write-Host "       & `"$HomeDir\start-server.cmd`""
Write-Host "  2. The tunnel's credentials: copy $tunnelId.json yourself into $env:USERPROFILE\.cloudflared\"
Write-Host '  3. The data from the old machine: docs/MOVING_DATA.md'
Write-Host '  4. The cutover (stop the old machine''s server and tunnel FIRST), from PowerShell run as administrator:'
Write-Host "       node `"$AppSrc\scripts\register-tasks.mjs`" --home `"$HomeDir`" --at-startup --only tunnel"
Write-Host '       schtasks /Run /TN BluModelTunnel'
Write-Host '  5. Showrooms (once, in Cloudflare): the wildcard DNS record *.blumodel.studio for the tunnel, and the demo showroom:'
Write-Host "       cd `"$HomeDir\app`"; node server\scripts\seed-demo-tenant.mjs   (docs/ONBOARDING_A_COMPANY.md, `"Once: Cloudflare`")"
Write-Host '  Power: never sleep on mains power: powercfg /change standby-timeout-ac 0'
Write-Host "  Every site on or off, and Update now: the 'BluModel Server' shortcut (http://127.0.0.1:8799), or $HomeDir\blumodel.cmd sites status|on|off" 
if ($NoAutoUpdate) { Write-Host '  Updates: automatic updates are OFF (-NoAutoUpdate), and so is Admin > System > Update now.' }
else { Write-Host "  Updates: automatic, daily at $(if ($AutoUpdateTime) { $AutoUpdateTime } else { '04:00' }), and Admin > System > Update now applies a release at once." }
Write-Host "    By hand: node `"$AppSrc\scripts\host\update.mjs`"   Log: $HomeDir\logs\update.log"
if ($DryRun) { Write-Host ''; Write-Host 'Dry run: nothing was installed, written, started or changed.' }
