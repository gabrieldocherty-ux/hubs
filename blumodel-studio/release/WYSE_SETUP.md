# Setting up the Wyse (for a Claude Code session on this machine, and for Gabe)

**Run this** first (an ordinary, unelevated PowerShell on the Wyse; it prints every step of the
install and changes nothing):

```
git -C C:\Users\gdoch\hubs pull --ff-only; powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\gdoch\hubs\blumodel-studio\scripts\host\install-windows.ps1 -DryRun
```

This machine is a Dell Wyse 5070 on **Windows 11 Pro** (`COMPUTA`, Celeron J4105, 8 GB of RAM),
signed in as `gdoch`, with Git, the GitHub CLI (signed in as `gabrieldocherty-ux`), cloudflared and
Node.js 24 already installed, and a clone of the repo at `C:\Users\gdoch\hubs`. It runs the whole of
https://blumodel.studio: the sales site, `www.`, the demo showroom and every company's showroom, from
one Node server on `127.0.0.1:8790`, made public by a Cloudflare tunnel. Releases are **prebuilt** on
Gabe's PC (`npm run release`) and published to the `blumodel-studio` branch: nothing is built here.

Work through the numbered steps **in order**. Each is safe to repeat: it checks first and only does
what is missing. Stop at the first thing that doesn't match what a step says to expect, and tell Gabe
what you saw. Steps are marked:

- **[session]**: the Claude session runs it, in an ordinary PowerShell (no elevation).
- **[Gabe, admin]**: Gabe runs it himself in **PowerShell run as administrator** (right-click Start >
  Terminal (Admin)). The session can't elevate: print the exact command for him and wait.
- **[Gabe]**: Gabe does it by hand (a website, a settings screen, typing a secret).

The full runbook behind this page is `blumodel-studio\docs\HOSTING.md`; section numbers refer to it.
A Linux machine instead: HOSTING.md section 3, "On Linux" (the same steps with systemd).

## Safety rules for this session

- **Secrets: never open, read, print, `type`, `Get-Content`, `Select-String`, copy or ask for**
  `C:\Users\gdoch\Projects\BluModelStudio\blumodel.env`, the tunnel's credentials
  (`C:\Users\gdoch\.cloudflared\*.json`), the deploy key (`...\BluModelStudio\.ssh\id_ed25519`; the
  `.pub` file is fine), a data bundle's passphrase or any password. Never ask Gabe to paste a key,
  token, passphrase or password into the chat. You may check that a file exists (`Test-Path`), its
  size and its permissions (`icacls`), nothing more.
- **Never delete, move or overwrite anything in `C:\Users\gdoch\Projects\BluModelStudio\data\`**
  (the database, uploads, backups). Only the import in step 6 writes there, and it backs up first.
- **Git: never force-push, never `git reset --hard`, never `git checkout -- .` without asking, never
  edit or commit files in `...\BluModelStudio\repo\`.** Changes are made on Gabe's PC and published
  with `npm run release`; this machine only fast-forwards.
- **Ask Gabe before the cutover** (step 7: starting the tunnel here, or anything on the PC), before a
  restart of Windows, and before anything that stops the site (`stop-server.cmd`, an import, a
  rollback, turning the sites off).
- **One tunnel only** (the split-brain rule): never start or enable `BluModelTunnel` here while the
  PC's tunnel may be running.
- Never register, change or delete a scheduled task yourself: that is the installer's job, in Gabe's
  admin window.

## 1. Prerequisites [session]

```
node --version                  # v24 or newer
git --version
cloudflared --version
gh auth status                  # signed in as gabrieldocherty-ux
Get-CimInstance Win32_OperatingSystem | Select-Object Caption, FreePhysicalMemory   # Windows 11 Pro
Get-PSDrive C | Select-Object Free                                                  # 10 GB+ free
Get-NetAdapter | Where-Object Status -eq Up | Select-Object Name, InterfaceDescription, LinkSpeed
```

**Wired Ethernet is strongly recommended.** If the only adapter that is up is Wi-Fi, tell Gabe: a
Wi-Fi drop takes every site offline until it reconnects, and Wi-Fi often comes up only after someone
signs in. The tunnel survives short drops, but a cable is the fix.

## 2. Windows settings for a server [Gabe]

Tell Gabe these, once (none needs the session):

1. **Power (Gabe, admin):** never sleep or hibernate on mains power:
   ```
   powercfg /change standby-timeout-ac 0
   powercfg /change hibernate-timeout-ac 0
   powercfg /change monitor-timeout-ac 10
   ```
   And in the Wyse BIOS (F2 at power-on): *Power Management > AC Recovery* = **Power On**, so it comes
   back by itself after a power cut (HOSTING.md section 2).
2. **Windows Update (Gabe):** Settings > Windows Update > Advanced options > **Active hours**:
   *Manually*, 06:00 to 23:00 (Windows never restarts for updates inside them); turn **off** "Get me
   up to date" (it restarts as soon as possible) and turn **on** "Notify me when a restart is
   required". Restarts then happen overnight, outside the 04:00 update check's window. After any
   restart the server comes back by itself (step 11).
3. **Disk encryption, BitLocker (Gabe, admin; recommended):** Windows 11 Pro has it. Check the chip
   first: `Get-Tpm` (admin) should say `TpmPresent : True` (the Wyse 5070 has a TPM 2.0; if it is
   off, turn it on in the BIOS under *Security > TPM 2.0*). Then Settings > Privacy & security >
   Device encryption, or Control Panel > BitLocker Drive Encryption > *Turn on BitLocker* for C:.
   The plain trade-offs:
   - **With the TPM, no PIN at boot**: the Wyse still starts by itself after a power cut. What it
     protects against is the box or its disk being carried off: the data can't be read elsewhere.
   - **The recovery key is the one thing to keep safe.** Save it to the Microsoft account *and* print
     it; keep the paper away from the Wyse. Without it, a BIOS reset, a TPM clear or a moved disk
     means the data is gone (the encrypted off-site backups in HOSTING.md section 11 are the second
     line).
   - A startup PIN (TPM + PIN) is stronger, but then nobody can bring the site back after a power
     cut without typing it at the box: not recommended here.
   Check: `manage-bde -status C:` (admin) says `Protection On`.

## 3. Install [Gabe, admin]

Print this for Gabe to run in **PowerShell run as administrator**:

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\gdoch\hubs\blumodel-studio\scripts\host\install-windows.ps1
```

What it does (the script's header says the same):

- **The deploy key.** The repo is private, so the Wyse reads it with its own **read-only deploy
  key**: `C:\Users\gdoch\Projects\BluModelStudio\.ssh\id_ed25519`, made once and readable only by
  `gdoch`, with GitHub's published host key pinned next to it. It prints the public key and waits.
  *Why under Gabe's account:* the server, the tunnel and the update tasks already run as `gdoch` (with
  his stored password, so they start with nobody signed in), and the update has to read the key; a
  separate service account would need its own password and profile for no gain on a one-purpose box.
  The key can only read this one repo, and it is revocable on GitHub at any time.
  **Add it on GitHub** while the installer waits. Either Gabe pastes it at github.com >
  gabrieldocherty-ux/hubs > Settings > Deploy keys > Add deploy key (title `Wyse`, **leave "Allow
  write access" unchecked**), or **[session]** adds it with the signed-in GitHub CLI (read-only is
  the default; never pass `--allow-write`):
  ```
  gh repo deploy-key add C:\Users\gdoch\Projects\BluModelStudio\.ssh\id_ed25519.pub --repo gabrieldocherty-ux/hubs --title Wyse
  ```
  Then Gabe presses Enter in the admin window; the installer checks GitHub accepts the key.
- Clones the release branch over SSH into `C:\Users\gdoch\Projects\BluModelStudio\repo` (a checkout
  made earlier over HTTPS is switched to SSH once), **deploys the prebuilt release** (no npm, no
  build), starts the server and checks `http://127.0.0.1:8790/api/health`.
- The server runs with a **384 MB V8 heap cap** (`--max-old-space-size=384` in `run-server.cmd`;
  `-HeapMb` changes it). It idles at about 80 MB.
- Registers **`BluModelStudioServer`** (at startup, nobody signed in), and the automatic update's
  **`BluModelStudioUpdate`** (daily at 04:00) and **`BluModelStudioUpdateNow`** (every two minutes:
  `update-check.cmd` looks for the Update now file and exits; no Node, no window, unless it is there). `schtasks` asks for Gabe's Windows password **once for each
  of the three**: Windows needs it to run them while nobody is signed in. It is never on a command
  line. Options: `-AutoUpdateTime 05:30`, `-NoAutoUpdate`.
- Writes the tunnel's files and restricts `C:\Users\gdoch\.cloudflared` to `gdoch`. It does **not**
  start the tunnel.
- Puts two shortcuts on the desktop: **BluModel Server** (http://127.0.0.1:8799, the server face) and
  **Update BluModel** (`update-now.cmd`: the update run directly, in a window that stays open).

Expect it to end with `Installed. What is left`.

## 4. Check the install [session]

```
Invoke-RestMethod http://127.0.0.1:8790/api/health          # ok : True, db : ok
schtasks /Query /TN BluModelStudioServer /FO LIST | Select-String 'Status|Logon'
schtasks /Query /TN BluModelStudioUpdate /V /FO LIST | Select-String 'Next Run|Status'
schtasks /Query /TN BluModelStudioUpdateNow /FO LIST | Select-String 'Status'
C:\Users\gdoch\Projects\BluModelStudio\blumodel.cmd sites status   # All sites are ON
Get-Content C:\Users\gdoch\Projects\BluModelStudio\auto-update.conf  # AUTO_UPDATE=on, 04:00 (not secret)
icacls C:\Users\gdoch\Projects\BluModelStudio\blumodel.env          # gdoch only: do NOT open it
```

## 5. Gabe's secrets [Gabe]

Tell Gabe, word for word:

> Please open the settings file yourself and fill it in:
> `notepad C:\Users\gdoch\Projects\BluModelStudio\blumodel.env`
> (a NEW Stripe key and webhook secret, the rest per docs/LAUNCH.md; for the encrypted off-site
> backups BACKUP_OFFSITE_DIR and BACKUP_PASSPHRASE, keeping the passphrase in your password manager
> AND on paper; optionally SERVER_FACE_PIN for the BluModel Server page). Save it, then restart the
> server: `C:\Users\gdoch\Projects\BluModelStudio\stop-server.cmd`, then `start-server.cmd`.
> Don't paste any of it here.

Then check only that the server came back (`Invoke-RestMethod http://127.0.0.1:8790/api/health`).
The tunnel's credentials file (`064671cd-a658-4240-8626-c697b9f148ac.json`) is Gabe's to copy into
`C:\Users\gdoch\.cloudflared\` by USB (HOSTING.md section 6; MOVING_DATA.md step 6).

## 6. Move the data from the PC [Gabe, then session]

`blumodel-studio\docs\MOVING_DATA.md` has every step. The bundle is **encrypted** (`.tar.enc`):
Gabe exports it on the PC with `export-data.mjs` (it asks for, or reads, the passphrase), carries it
by USB stick, and the passphrase never goes through the chat. On the Wyse:

```
node C:\Users\gdoch\Projects\BluModelStudio\app\server\scripts\import-data.mjs E:\blumodel-data-<time>.tar.enc --check
```

`--check` must pass (Gabe types the passphrase when asked). A **rehearsal** import is fine before
the cutover; the real one happens inside the cutover (step 7), with the PC's server stopped. Ask Gabe
before the import itself (it stops the server for a moment):

```
C:\Users\gdoch\Projects\BluModelStudio\stop-server.cmd
node C:\Users\gdoch\Projects\BluModelStudio\app\server\scripts\import-data.mjs E:\blumodel-data-<time>.tar.enc --home C:\Users\gdoch\Projects\BluModelStudio
C:\Users\gdoch\Projects\BluModelStudio\start-server.cmd
```

(`--replace` when a rehearsal already left data here.)

## 7. The tunnel: the cutover (ask Gabe first)

**The split-brain rule: only one machine may run the tunnel.** With both connected, Cloudflare sends
some visitors to each machine's database. So, in this order:

1. **[Gabe, on the PC]** stop the PC's tunnel and server and disable their tasks (HOSTING.md section 7):
   `stop-tunnel.cmd`, `stop-server.cmd`, `schtasks /Change /TN BluModelTunnel /Disable`,
   `schtasks /Change /TN BluModelStudioServer /Disable`. Then the final export (step 6).
2. **[session]** the import (step 6), then `Invoke-RestMethod http://127.0.0.1:8790/api/health`.
3. **[Gabe, admin]** on the Wyse, register the tunnel's task and start it:
   ```
   node C:\Users\gdoch\Projects\BluModelStudio\repo\blumodel-studio\scripts\register-tasks.mjs --home C:\Users\gdoch\Projects\BluModelStudio --at-startup --only tunnel
   schtasks /Run /TN BluModelTunnel
   ```
4. **[session]** `Get-Content C:\Users\gdoch\Projects\BluModelStudio\logs\tunnel.log -Tail 20` shows
   `Registered tunnel connection`; from outside, https://blumodel.studio/api/health answers.

The tunnel runs as `gdoch` (the `BluModelTunnel` task), and only `gdoch` can read its credentials
(`C:\Users\gdoch\.cloudflared`, restricted by the installer). Going back to the PC is the reverse:
`stop-tunnel.cmd` and disable `BluModelTunnel` here **first**.

## 8. The daily update, Update now, and the sites switch

- **Daily at 04:00** the `BluModelStudioUpdate` task checks GitHub; when there is a newer release it
  deploys it (database backed up first) and rolls back by itself if the new version doesn't come up
  healthy, then doesn't retry that release until a newer one is published.
- **Update now**: the big button on the **BluModel Server** desktop shortcut (http://127.0.0.1:8799)
  or Admin > System > Update now. The page shows its progress live: checking GitHub, downloading,
  deploying, restarting and checking health, then *Updated*, *Already up to date* or *Rolled back*.
  `BluModelStudioUpdateNow` picks the request up within two minutes.
- **Update BluModel** (desktop shortcut): runs the update directly in a window that stays open with
  the result: the fallback when the server, and so the page, is down.
- **Every site on or off**: the same page's ON/OFF switch (with a confirm before OFF), Admin > System,
  or `C:\Users\gdoch\Projects\BluModelStudio\blumodel.cmd sites on|off|status`. OFF shows visitors
  "We'll be right back" everywhere; signed-in admins keep blumodel.studio/admin to turn it back on.
- Logs: `C:\Users\gdoch\Projects\BluModelStudio\logs\update.log` (one line per run).

## 9. Verify [session]

```
Invoke-RestMethod http://127.0.0.1:8790/api/health
Invoke-RestMethod http://127.0.0.1:8790/api/config -Headers @{ Host = 'blumodel.studio' } | Select-Object site        # sales
Invoke-RestMethod http://127.0.0.1:8790/api/config -Headers @{ Host = 'demo.blumodel.studio' } | Select-Object site   # showroom
C:\Users\gdoch\Projects\BluModelStudio\blumodel.cmd sites status
Get-Content C:\Users\gdoch\Projects\BluModelStudio\logs\update.log -Tail 5
Get-Process node, cloudflared | Select-Object Name, @{n='MB';e={[int]($_.WorkingSet64/1MB)}}
```

After the cutover, also from outside: https://blumodel.studio/api/health. HOSTING.md section 8 has
the full list.

## 10. Roll back

- **A bad update**: the update rolls back by itself. By hand **[session, ask Gabe]**:
  `node C:\Users\gdoch\Projects\BluModelStudio\repo\blumodel-studio\scripts\deploy-local.mjs --rollback`
  (with `$env:BLUMODEL_HOME = 'C:\Users\gdoch\Projects\BluModelStudio'`): the previous app back,
  restarted and checked; the database is untouched.
- **The cutover** (back to the PC): here first `stop-tunnel.cmd` and
  `schtasks /Change /TN BluModelTunnel /Disable` [Gabe, admin], then Gabe starts the PC's server and
  tunnel (HOSTING.md section 9). Data entered here since the cutover goes back with a bundle.
- **The database**: `node ...\app\server\scripts\restore.mjs --list`, and only with Gabe's go-ahead
  `--latest` (HOSTING.md section 9).

## 11. Finish: the desktop, boot, memory, and closing this session

The last step, once step 9 passes:

1. **The BluModel Server shortcut [session].** Check `BluModel Server.url` and `Update BluModel.lnk`
   are on the desktop (`[Environment]::GetFolderPath('Desktop')`; the installer made them, with the
   app's icon). Open the first (`Start-Process "$([Environment]::GetFolderPath('Desktop'))\BluModel Server.url"`)
   and confirm the page says **All websites are ON**, lists blumodel.studio, www, the demo and every
   showroom with green dots, and shows the deployed commit. Then check the switch answers without
   changing anything: `blumodel.cmd sites status` says ON. (Don't press OFF to test it unless Gabe
   says so: it takes every site down.)
2. **What starts by itself, plainly:** with **nobody signed in**, Windows starts
   `BluModelStudioServer` 30 seconds after boot, and after the cutover `BluModelTunnel` likewise (both
   registered "at startup" with Gabe's stored password). `BluModelStudioUpdate` runs at 04:00 every day
   and `BluModelStudioUpdateNow` every two minutes, also whether or not anyone is signed in; a 04:00
   missed while the Wyse was off runs when it is next on. Nothing needs a sign-in. Check after the next
   restart (with Gabe's go-ahead) that `Invoke-RestMethod http://127.0.0.1:8790/api/health` answers
   before anyone signs in (from another machine, or once signed in, `schtasks /Query /TN
   BluModelStudioServer /V /FO LIST` shows *Last Run Time* at boot).
3. **Memory to expect** on the 8 GB Wyse: the server idles at about **80 MB** (measured: under 90 MB
   through a burst of 1,000 requests; its heap is capped at 384 MB), cloudflared at roughly **30-60
   MB**, the update tasks nothing between runs (each run is a Node process of about 50 MB for a few
   seconds; the two-minute check is one cmd.exe `if exist` that exits at once, with no Node and no
   window unless Update now was pressed). About 150 MB in all, leaving more than 7 GB free.
4. **Report to Gabe, then close.** Send Gabe a short report: what passed, what is left for him
   (anything marked [Gabe] not yet done), and the three shortcuts/commands he needs (BluModel Server,
   Update BluModel, `blumodel.cmd sites status`). Then end this session and **quit the Claude desktop
   app** (File > Exit, or right-click its tray icon > Quit): it holds several hundred MB this server
   doesn't need. Tell Gabe how to keep it from starting at sign-in: Claude > Settings > General >
   turn off **Open at login** (or Task Manager > Startup apps > Claude > **Disable**).
