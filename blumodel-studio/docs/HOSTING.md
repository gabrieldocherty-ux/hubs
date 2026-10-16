# Run BluModel Studio on another computer (Dell Wyse 5070)

How to move https://blumodel.studio from the Windows PC that serves it today to a Dell Wyse 5070 thin
client (or any small x86-64 machine), and how to run it there: install, settings, data, tunnel,
cutover, checks, rollback, updates, backups and logs.

The server is plain Node: Node's own `http`, `crypto` and built-in `node:sqlite`, no other runtime
dependencies. Everything 3D runs in each visitor's browser, so the machine only serves files, the
API and one SQLite database. A Wyse 5070 (4-core Celeron J4105 or Pentium Silver J5005, 4-8 GB of
RAM) is plenty.

Everything needed comes from two places:

- **GitHub** (public): the repo `gabrieldocherty-ux/hubs`, branch **`blumodel-studio`**, folder
  `blumodel-studio/`. The install scripts check out only that folder (plus the few files at the top
  of the repo, which git always includes). The branch is what the Wyse runs: section 10, *Publishing
  a version*, says how a version gets onto it, and it must exist before the install can start.
- **You**, and nobody else: the settings file's values (the Stripe key and the rest), the tunnel's
  credentials file, and the data bundle from the old machine. None of them is ever in git, and no
  script copies them between machines.

Related pages: [MOVING_DATA.md](MOVING_DATA.md) (the data and the two secret files, step by step),
[OPERATIONS.md](OPERATIONS.md) (day-to-day running on the Windows PC), [LAUNCH.md](LAUNCH.md)
(Stripe, Cloudflare and the settings values).

Contents: [1 Choose the OS](#1-choose-the-operating-system) ·
[2 Prepare the Wyse](#2-prepare-the-wyse-bios-power-network) ·
[3 Install](#3-install-blumodel-studio) · [4 Settings](#4-the-settings-file) ·
[5 Data](#5-move-the-data) · [6 Tunnel](#6-move-the-tunnel) · [7 Cutover](#7-the-cutover-step-by-step) ·
[8 Verify](#8-verify) · [9 Roll back](#9-roll-back) · [10 Update](#10-update-from-github) ·
[11 Backups](#11-backups) · [12 Logs](#12-logs-and-status) · [13 Disk and memory](#13-disk-and-memory) ·
[14 Troubleshooting](#14-troubleshooting) · [Reference](#reference-the-scripts)

## 1. Choose the operating system

A Wyse 5070 ships with either **Wyse ThinOS** or **Windows 10 IoT Enterprise**. ThinOS is a locked-down
remote-desktop client: it **cannot** run this app. Replace it.

**Recommended: Ubuntu Server 24.04 LTS** (no desktop).

- Security updates until 2029 (longer with Ubuntu Pro, free for personal use), installed
  automatically by `unattended-upgrades`, which is on by default.
- No desktop: on a 4 GB machine the memory goes to the server and the build, not to a GUI.
- systemd starts the server and the tunnel at boot with **nobody logged in**, restarts them if they
  exit, and sandboxes them (the server can write only its data and logs).
- Node.js 24 (from NodeSource) and cloudflared (from Cloudflare) both publish apt repositories for
  it, so `apt upgrade` keeps them current. `scripts/host/install-linux.sh` is written for it.
- You manage it over SSH from your PC; the Ubuntu installer offers to set SSH up.

**Debian 12** works the same way, with the same script.

**Windows 10/11 (including the Wyse's Windows 10 IoT Enterprise)** also works, with
`scripts/host/install-windows.ps1`. Choose it if you'd rather keep the Windows the Wyse came with. Know
that:

- Dell's Windows images for Wyse thin clients turn on the **Unified Write Filter**: everything
  written to the disk (the install, the database) is thrown away at each restart until you turn it
  off (*Windows on the Wyse*, below).
- IoT/LTSC editions have no Microsoft Store, so often no `winget`: install Node.js, Git and
  cloudflared from their websites instead.
- To start with nobody signed in, Task Scheduler stores your Windows password (it asks once, when
  the tasks are registered). If you change that password, register the tasks again.
- Windows itself uses more of the 4 GB, and Windows Update restarts the machine when it likes (the
  tasks bring the site back after each restart).

|  | Linux (recommended) | Windows |
| --- | --- | --- |
| The home | `/srv/blumodel-studio` | `%USERPROFILE%\Projects\BluModelStudio` |
| Runs as | the `blumodel` system account (no login) | your Windows account |
| Starts at boot | `blumodel-studio.service`, `blumodel-tunnel.service` (systemd) | tasks `BluModelStudioServer`, `BluModelTunnel` "at startup" |
| Restart | `sudo systemctl restart blumodel-studio` | in the home (cmd): `stop-server.cmd`, then `start-server.cmd` |
| Logs | `logs/server.log`, `journalctl -u blumodel-studio` | `logs\server.log`, `logs\console.log`, `logs\tunnel.log` |
| Update | `sudo bash /srv/blumodel-studio/repo/blumodel-studio/scripts/host/update-linux.sh` | `node %USERPROFILE%\Projects\BluModelStudio\repo\blumodel-studio\scripts\host\update.mjs` (cmd) |

## 2. Prepare the Wyse (BIOS, power, network)

**BIOS.** Press **F2** at the Dell logo to open the BIOS setup (**F12** gives the one-time boot menu,
for the installer USB stick). If it asks for an administrator password, Dell documents the
default for Wyse thin clients as `Fireport`; change it.

- *Power Management > AC Recovery*: **Power On**, so the Wyse starts by itself when power comes back
  after an outage (with nobody there to press the button).
- *Power Management > Wake on LAN*: **LAN Only** if you want to wake it from another machine
  (optional; the site needs it on all the time anyway). If there is a *Deep Sleep Control*, turn it
  off for Wake on LAN to work.
- After installing, put the internal drive first in the boot order (or unplug the stick).
- Secure Boot can stay on: Ubuntu boots with it.

**Power and network.** Use the Ethernet port (not Wi-Fi). The site needs no open port on your router
and no fixed public address: the tunnel connects out to Cloudflare. A small UPS keeps it up through
short power cuts. Give the Wyse a fixed address on your network (a DHCP reservation in your router)
so `ssh` always finds it.

**Install Ubuntu Server 24.04 LTS.** Write the ISO from ubuntu.com to a USB stick (Rufus or
balenaEtcher on your PC), boot the Wyse from it (F12), and choose: use the entire disk, **Install
OpenSSH server**, no extra snaps. The user you create is your admin account (it uses `sudo`). Then,
over SSH (`ssh you@wyse`):

```
sudo apt update && sudo apt full-upgrade -y
timedatectl                      # "System clock synchronized: yes" (Stripe rejects webhooks more than 5 minutes off)
free -h && lsblk                 # RAM, swap and the disk (section 13)
```

Optional but sensible: a firewall that only lets SSH in (the server listens on 127.0.0.1 and the
tunnel only connects out, so nothing else needs to be open):

```
sudo ufw allow OpenSSH && sudo ufw enable
```

(Ubuntu ships `ufw`; on Debian 12 install it first: `sudo apt-get install -y ufw`.)

**Windows on the Wyse** (if you keep Windows instead):

- **Turn the write filter off.** In an administrator prompt `uwfmgr get-config`; if it says the filter
  is ON for the next session, use Dell's *Disable Write Filter* desktop shortcut, or `uwfmgr filter
  disable`, and restart. Check again before installing.
- Never sleep on mains power: `powercfg /change standby-timeout-ac 0` and
  `powercfg /change hibernate-timeout-ac 0` (administrator prompt).
- Sign in with a **local account** (its password is what Task Scheduler stores).

## 3. Install BluModel Studio

### On Linux (Ubuntu 24.04 / Debian 12)

Over SSH, as your admin user:

```
sudo apt-get update && sudo apt-get install -y curl
curl -fsSLO https://raw.githubusercontent.com/gabrieldocherty-ux/hubs/blumodel-studio/blumodel-studio/scripts/host/install-linux.sh
sudo bash install-linux.sh --dry-run      # prints every command it would run; runs none
sudo bash install-linux.sh
```

It takes 5-15 minutes on a Wyse (most of it `npm ci` and the build). What it does, in order (the
script's header says the same): checks the machine; installs `ca-certificates curl gnupg git`,
**Node.js 24 from NodeSource's apt repository** (unless Node 24+ is there) and **cloudflared from
Cloudflare's apt repository**; creates the **`blumodel` system account** and the home
`/srv/blumodel-studio` (with `data/`, `logs/`, `.cloudflared/`, all owned by `blumodel`); makes a
**sparse clone of `blumodel-studio/`** on the `blumodel-studio` branch in `/srv/blumodel-studio/repo`
(git also checks out the handful of files at the top of the repo; nothing uses them); runs `npm ci`
and the build (`scripts/host/build.mjs`) as
`blumodel`; installs the systemd units (the server **enabled**, the tunnel installed but **not
enabled**); deploys (starts the server and checks `http://127.0.0.1:8790/api/health`); writes
`cloudflared.yml` and checks it offline; and prints what is left.

Run it again any time: each step checks first, so a second run only repairs or updates. Options:
`--home <dir>`, `--branch <name>`, `--repo <url>`, `--port <n>`, `--dry-run`. A home installed with
`--port` (Windows: `-Port`) keeps that port: later deploys, updates, rollbacks and the data scripts read
it back from the home (`blumodel-studio.service`, or `run-server.cmd` on Windows) unless told otherwise.

It **never** starts the tunnel, never opens the settings file or the tunnel's credentials, and
never copies anything from another machine. At the end the site runs on the Wyse at
`http://127.0.0.1:8790`, with payments off ("Payments open soon") and an empty database, visible only
on the Wyse itself.

The home it makes:

| Path | What |
| --- | --- |
| `/srv/blumodel-studio/app/` | the deployed code (`dist/`, `server/`, `src/data/*.json`, `DEPLOYED.txt`), root's, read-only to the server |
| `/srv/blumodel-studio/app.previous/` | the app the last deploy replaced, for a rollback |
| `/srv/blumodel-studio/repo/` | the git checkout builds come from (owned by `blumodel`) |
| `/srv/blumodel-studio/data/` | `blumodel.db`, `uploads/`, `backups/` |
| `/srv/blumodel-studio/logs/` | `server.log` |
| `/srv/blumodel-studio/blumodel.env` | the private settings, mode 600, owned by `blumodel` |
| `/srv/blumodel-studio/cloudflared.yml` | the tunnel's config |
| `/srv/blumodel-studio/.cloudflared/` | the tunnel's credentials JSON, which you copy in (mode 700) |
| `/etc/systemd/system/blumodel-studio.service`, `blumodel-tunnel.service` | the units |

The server unit runs `node --no-warnings /srv/blumodel-studio/app/server/index.mjs --prod` as
`blumodel` with `NODE_ENV=production`, restarts it 5 seconds after any exit, and sandboxes it
(`ProtectSystem=strict` with only `data/` and `logs/` writable, `ProtectHome`, `PrivateTmp`,
`NoNewPrivileges`, no capabilities). Read them with `systemctl cat blumodel-studio blumodel-tunnel`.

### On Windows 10/11

1. Install Node.js 24 or newer, Git and cloudflared. With `winget` (in PowerShell):

   ```
   winget install --id OpenJS.NodeJS.LTS -e
   winget install --id Git.Git -e
   winget install --id Cloudflare.cloudflared -e
   ```

   Without `winget` (IoT/LTSC editions): the Windows installers from nodejs.org and git-scm.com, and
   `cloudflared-windows-amd64.msi` from Cloudflare's cloudflared releases page on GitHub. Then open a
   **new** PowerShell window, so `node`, `git` and `cloudflared` are on its PATH.

2. Open **PowerShell as administrator** (needed for the startup task in the last step) and run:

   ```
   $u = 'https://raw.githubusercontent.com/gabrieldocherty-ux/hubs/blumodel-studio/blumodel-studio/scripts/host/install-windows.ps1'
   Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile "$env:TEMP\install-windows.ps1"
   powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\install-windows.ps1" -DryRun
   powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\install-windows.ps1"
   ```

It checks Node 24+/git/cloudflared (when one is missing it prints the `winget` command and stops: it
never installs software itself), clones just `blumodel-studio\` into
`%USERPROFILE%\Projects\BluModelStudio\repo`, runs `npm ci` and the build, deploys into
`%USERPROFILE%\Projects\BluModelStudio`, writes the tunnel's files and checks them offline, and
registers **`BluModelStudioServer` to run when Windows starts** (`register-tasks.mjs --at-startup
--only server`). `schtasks` then asks for **your Windows password**: Windows needs it to start the
task when nobody is signed in. Nothing passes the password on a command line. Last, it restarts the
server through that task, so it keeps running after you sign out. Options: `-HomeDir`, `-Branch`,
`-Repo`, `-Port`, `-SkipTasks`, `-DryRun`.

The tunnel's task, `BluModelTunnel`, is registered at the cutover, not before.

## 4. The settings file

**Make it fresh on the Wyse; don't copy the old one.** The live Stripe key in the PC's settings file
has been pasted into a chat, so treat it as exposed: create a **new** key in Stripe and put the new
one **only** in the Wyse's file.

1. Stripe Dashboard → *Developers → API keys*: create a new restricted key exactly as in
   [LAUNCH.md](LAUNCH.md) B3 (or roll the secret key as in B1). Copy it straight into the file below:
   never into a chat, email, screenshot or git.
2. Edit the template the install made:
   - Linux: `sudo nano /srv/blumodel-studio/blumodel.env`, save, then `sudo systemctl restart blumodel-studio`.
   - Windows, in a **Command Prompt** (cmd; `%USERPROFILE%` means nothing to PowerShell):

     ```
     notepad %USERPROFILE%\Projects\BluModelStudio\blumodel.env
     cd /d %USERPROFILE%\Projects\BluModelStudio
     stop-server.cmd
     start-server.cmd
     ```

     In PowerShell the same is `notepad "$env:USERPROFILE\Projects\BluModelStudio\blumodel.env"`,
     `cd "$env:USERPROFILE\Projects\BluModelStudio"`, `.\stop-server.cmd`, `.\start-server.cmd`.

   The values are listed in LAUNCH.md B6: `STRIPE_SECRET_KEY` (the **new** key),
   `STRIPE_WEBHOOK_SECRET` (the endpoint `https://blumodel.studio/api/webhooks/stripe` doesn't change,
   so its signing secret doesn't either), `PUBLIC_URL=https://blumodel.studio`, `DEMO_PAYMENTS=0`,
   `TRUST_PROXY=1`, `LEGAL_NAME`, `SUPPORT_EMAIL`, `LEGAL_JURISDICTION`, and the optional email and photo
   keys. A new template's `ADMIN_EMAILS` is empty: put your address there (it only reserves it;
   admins come with the data, or from `make-admin`).
3. Check: the newest start in the server's log says `Stripe: LIVE mode` (or why Stripe is not on),
   never a key:
   - Linux: `sudo grep -E 'Stripe|Payments' /srv/blumodel-studio/logs/server.log | tail -n 5` (the
     log is mode 600, the server's account's only, so reading it takes `sudo`).
   - Windows (cmd): `findstr /C:"Stripe:" /C:"Payments:" %USERPROFILE%\Projects\BluModelStudio\logs\server.log`;
     the last line is the newest start.
   - Read-only Stripe check (it calls Stripe; you run it): Linux
     `sudo -u blumodel node /srv/blumodel-studio/repo/blumodel-studio/scripts/stripe-check.mjs`;
     Windows, in `%USERPROFILE%\Projects\BluModelStudio\repo\blumodel-studio`: `npm run stripe:check`.
4. Once the Wyse is live (after the cutover), **delete the old key in Stripe**, so the copy on the old
   PC is worthless.

The file is readable only by the server's account: on Linux mode 600 owned by `blumodel` (the deploy
set it; `sudo nano` keeps it), on Windows your account only (`icacls`). If you'd rather copy the old
file anyway, [MOVING_DATA.md](MOVING_DATA.md) step 5 B shows how, with the right permissions.

## 5. Move the data

[MOVING_DATA.md](MOVING_DATA.md) is the whole procedure: one bundle (`blumodel-data-<time>.tar`) carries
the database and every upload, made by `node server\scripts\export-data.mjs` on the PC and put in
place by `import-data.mjs` on the Wyse, both checked file by file. In short:

- On the PC, in the repo's `blumodel-studio` folder (cmd), with a USB stick as `E:`:
  `node server\scripts\export-data.mjs --home %USERPROFILE%\Projects\BluModelStudio --out E:\`
- On the Wyse (Linux), check, then import with the server stopped:

  ```
  sudo node /srv/blumodel-studio/app/server/scripts/import-data.mjs /mnt/usb/blumodel-data-<time>.tar --check
  sudo systemctl stop blumodel-studio
  sudo node /srv/blumodel-studio/app/server/scripts/import-data.mjs /mnt/usb/blumodel-data-<time>.tar --home /srv/blumodel-studio
  sudo systemctl start blumodel-studio
  ```

Do it twice: a **rehearsal** while the PC keeps serving (nothing on the PC changes), and the real one
at the cutover with the PC's server stopped, so nothing written in between is lost. The second
import needs `--replace` (MOVING_DATA.md explains; what it replaces is kept, never deleted).

## 6. Move the tunnel

The tunnel `blumodel` (ID `064671cd-a658-4240-8626-c697b9f148ac`) keeps its name, its ID and its DNS
for blumodel.studio. Nothing in Cloudflare changes. Only **where the connector runs** moves, and the
connector needs the tunnel's credentials. The install already wrote the Wyse's `cloudflared.yml`
(`blumodel.studio` → `http://127.0.0.1:8790`, anything else 404), naming the credentials file where
the Wyse expects it. Two ways to give the Wyse the credentials:

**A. Copy the credentials file (recommended).** On the PC the file is
`%USERPROFILE%\.cloudflared\064671cd-a658-4240-8626-c697b9f148ac.json`. Copy it yourself, by hand, to a
USB stick (or with `scp`): no script does this. **Do not copy `cert.pem`** next to it: running a
tunnel doesn't need it (it is for creating, routing and deleting tunnels; leave it on the PC).

- Wyse on Linux:

  ```
  sudo install -m 600 -o blumodel -g blumodel /mnt/usb/064671cd-a658-4240-8626-c697b9f148ac.json /srv/blumodel-studio/.cloudflared/
  ```

- Wyse on Windows: copy it into `%USERPROFILE%\.cloudflared\` of the account the tasks run as.

Then delete it from the stick. `cloudflared.yml` names it; `setup-tunnel.mjs --credentials <file>`
names another place if you keep it elsewhere.

**B. A tunnel token and Cloudflare's own service.** Instead of the file, run the tunnel from a token
with the service cloudflared installs for itself. You do this, by hand:

1. The token runs the tunnel, but **not our `cloudflared.yml`**: the hostname must then be
   configured in Cloudflare. Zero Trust dashboard → *Networks → Tunnels* → `blumodel` → migrate it
   to dashboard-managed configuration (Cloudflare documents this as one-way: read its warning
   first), then add the public hostname `blumodel.studio` → `http://127.0.0.1:8790`.
2. On the PC, where cloudflared is logged in: `cloudflared tunnel token blumodel` prints the token.
   It is a secret, like the credentials file.
3. On the Wyse: Linux `sudo cloudflared service install <token>` (type a space before `sudo`, so
   bash doesn't keep the token in its history); Windows, administrator prompt:
   `cloudflared service install <token>`.
   That installs and **starts** Cloudflare's own service (`cloudflared` on Linux, `Cloudflared` on
   Windows), so do it only at the cutover, in place of step 7's "start the Wyse's tunnel".
4. Then leave `blumodel-tunnel.service` disabled (or don't register `BluModelTunnel`): one connector
   per machine. Stop and start it with `sudo systemctl stop|start cloudflared` (Windows:
   `Stop-Service Cloudflared` / `Start-Service Cloudflared`).

Way A keeps the configuration in the repo and needs no change in Cloudflare; prefer it.

### The split-brain rule

**Two machines must never serve the tunnel at the same time with different databases.** Cloudflare
spreads visitors across every connector that runs the tunnel, so with the PC and the Wyse both
connected, some visitors would sign up, save kitchens and pay on the PC's database and some on the
Wyse's, and Stripe's webhooks would land on either. Untangling that afterwards is manual and lossy.

- At the cutover: **stop the PC's tunnel and server first**, then start the Wyse's tunnel.
- Going back: **stop the Wyse's tunnel first**, then start the PC's.
- The Wyse's tunnel is installed **disabled** and stays that way until the cutover. Don't enable it
  to "test": test the Wyse locally (section 8) instead.
- To see who is connected: Zero Trust dashboard → *Networks → Tunnels* → `blumodel` lists each
  connector and where it runs; or on the PC (logged in to cloudflared) `cloudflared tunnel info
  blumodel`. With both machines stopped the site shows Cloudflare's error 1033.

## 7. The cutover, step by step

**Any day before:** the Wyse is installed (section 3), its settings file has the new key (section 4),
the credentials file is in place (section 6), a rehearsal import went well (section 5) and the Wyse
passes the local checks in section 8. Pick a quiet hour; the site is down for the minutes between
steps 1 and 9.

**On the PC** (a terminal, cmd):

```
cd /d %USERPROFILE%\Projects\BluModelStudio
stop-tunnel.cmd
stop-server.cmd
schtasks /Change /TN BluModelTunnel /Disable
schtasks /Change /TN BluModelStudioServer /Disable
netstat -ano -p tcp | findstr LISTENING | findstr :8790
```

1. `stop-tunnel.cmd` takes the site off the internet (Cloudflare shows error 1033); `stop-server.cmd`
   stops the server gracefully. Both leave markers (`tunnel.stopped`, `stopped`), and disabling the
   two tasks keeps a reboot or a sign-in from bringing them back.
2. The `netstat` line must print nothing, and the dashboard must show no connector for `blumodel`.
3. Export the data (the server is stopped, so this is the final copy). `cd /d` to your checkout's
   `blumodel-studio` folder (one with `server\scripts\export-data.mjs` in it; MOVING_DATA.md step 0),
   then:
   `node server\scripts\export-data.mjs --home %USERPROFILE%\Projects\BluModelStudio --out E:\`

**On the Wyse** (Linux, over SSH), with the stick mounted at `/mnt/usb` (MOVING_DATA.md step 2):

```
sudo node /srv/blumodel-studio/app/server/scripts/import-data.mjs /mnt/usb/blumodel-data-<time>.tar --check
sudo systemctl stop blumodel-studio
sudo node /srv/blumodel-studio/app/server/scripts/import-data.mjs /mnt/usb/blumodel-data-<time>.tar --home /srv/blumodel-studio --replace
sudo systemctl start blumodel-studio
curl -s http://127.0.0.1:8790/api/health
sudo systemctl enable --now blumodel-tunnel
journalctl -u blumodel-tunnel -n 30 --no-pager
```

4. `--check` must pass; the import's table counts must equal the export's (`--replace` because the
   rehearsal left data; without a rehearsal leave it out).
5. `curl` must print `{"ok":true,…,"db":"ok"}`.
6. `enable --now` starts the tunnel and makes it start at every boot. The journal shows
   `Registered tunnel connection` lines within a few seconds.
7. Check from outside (section 8).

**A Wyse on Windows** instead (cmd; the tunnel's task needs an administrator prompt):

```
node "%USERPROFILE%\Projects\BluModelStudio\app\server\scripts\import-data.mjs" E:\blumodel-data-<time>.tar --check
cd /d %USERPROFILE%\Projects\BluModelStudio
stop-server.cmd
node app\server\scripts\import-data.mjs E:\blumodel-data-<time>.tar --home %USERPROFILE%\Projects\BluModelStudio --replace
start-server.cmd
node "%USERPROFILE%\Projects\BluModelStudio\repo\blumodel-studio\scripts\register-tasks.mjs" --home "%USERPROFILE%\Projects\BluModelStudio" --at-startup --only tunnel
schtasks /Run /TN BluModelTunnel
```

`logs\tunnel.log` then shows `Registered tunnel connection`.

**After it works** (a day or two later): delete the old Stripe key (section 4), and keep the PC's
data as it is for a while (it is the rollback).

## 8. Verify

On the Wyse, before the cutover and after any change:

- `curl -s http://127.0.0.1:8790/api/health` (Windows: open it in a browser) →
  `{"ok":true,"version":"0.1.0","uptimeSec":…,"db":"ok"}`. A 503 means the database failed its check
  at start (`"db":"corrupt"`) or can't answer.
- `systemctl is-enabled blumodel-studio blumodel-tunnel` → `enabled`, and before the cutover
  `disabled` for the tunnel. `systemctl status blumodel-studio` → `active (running)`.
- The site itself, from your PC, through SSH (port 8791 on the PC, since the PC's own server may hold
  8790): `ssh -L 8791:127.0.0.1:8790 you@wyse`, then open http://127.0.0.1:8791. Sign in, open a
  kitchen, check a photo or model shows, open Admin > Users.
- **Reboot test:** `sudo reboot`; a minute later, without logging in,
  `curl -s http://127.0.0.1:8790/api/health` over SSH answers again (and after the cutover, so does
  https://blumodel.studio/api/health). On Windows: restart and don't sign in; check from another
  machine.

After the cutover, from outside (a phone on mobile data):

- https://blumodel.studio loads; https://blumodel.studio/api/health answers `{"ok":true,…}`.
- Sign in, open a kitchen, export something you've paid for.
- Stripe Dashboard → *Developers → Webhooks* → the endpoint: recent deliveries answer **200**
  (Stripe retries the ones that failed during the downtime, for up to 3 days).
- `https://blumodel.studio/robots.txt` is served.

## 9. Roll back

**The cutover** (back to the PC). Split-brain rule: the Wyse's tunnel stops first.

- Wyse, Linux: `sudo systemctl disable --now blumodel-tunnel`. Windows: in its home `stop-tunnel.cmd`,
  then `schtasks /Change /TN BluModelTunnel /Disable`.
- If customers used the site on the Wyse since the cutover, their changes are only there: carry them
  back the same way (export on the Wyse, `import-data … --replace` on the PC; MOVING_DATA.md).
- PC (cmd, in `%USERPROFILE%\Projects\BluModelStudio`):

  ```
  schtasks /Change /TN BluModelStudioServer /Enable
  schtasks /Change /TN BluModelTunnel /Enable
  start-server.cmd
  start-tunnel.cmd
  ```

**An update** that doesn't come up: the update rolls back by itself (section 10). By hand, either OS,
the previous app goes back with:

- Linux: `sudo node /srv/blumodel-studio/repo/blumodel-studio/scripts/deploy-local.mjs --rollback`
- Windows (cmd), in `%USERPROFILE%\Projects\BluModelStudio\repo\blumodel-studio`: `node scripts\deploy-local.mjs --rollback`

It swaps `app.previous` back in (keeping the failed one as `app.failed`), restarts the server and
checks its health. It doesn't touch the database; if the newer version ran a migration the older one
can't read, it prints the `restore.mjs --from data/backups/<time>/blumodel.db` command for the copy
the deploy made just before.

A rollback (by hand or by the update) changes only `app/`: the checkout in `repo/` stays on the newer
commit, so the **next update deploys that commit again**. Fix it (or revert it) on the
`blumodel-studio` branch first (section 10, *Publishing a version*), then update.

**The database** (a bad import, a corrupt file): OPERATIONS.md, *Backups and restore*, and
MOVING_DATA.md, *Roll back*. On Linux:

```
sudo systemctl stop blumodel-studio
sudo -u blumodel node /srv/blumodel-studio/app/server/scripts/restore.mjs --list
sudo -u blumodel node /srv/blumodel-studio/app/server/scripts/restore.mjs --latest
sudo systemctl start blumodel-studio
```

## 10. Update from GitHub

New versions reach the Wyse through the `blumodel-studio` branch on GitHub. One command:

- Linux: `sudo bash /srv/blumodel-studio/repo/blumodel-studio/scripts/host/update-linux.sh`
- Windows (cmd): `node %USERPROFILE%\Projects\BluModelStudio\repo\blumodel-studio\scripts\host\update.mjs`
  (or `npm run host:update` in that folder)

Add `--dry-run` to see the plan first; `--force` redeploys the commit already running. What it does
(`scripts/host/update.mjs`), stopping at the first step that fails:

1. refuses if the checkout has local changes;
2. `git pull --ff-only` (if the update script itself changed, it runs the new one);
3. stops if `app/DEPLOYED.txt` already has this commit ("Already deployed");
4. `npm ci`, then the build (as `blumodel` on Linux); until here the site keeps running untouched;
5. the deploy: stops the server, **copies the database to `data/backups/<time>/` first**, puts the new
   app in place keeping the old one as `app.previous`, starts the server and checks
   `http://127.0.0.1:8790/api/health`;
6. if that check fails: `deploy-local.mjs --rollback`, the previous app back and checked again.
   It ends with `Updated: commit <sha> is running.`, or `ROLLED BACK: …` and the logs to read.

The site is down for a few seconds during step 5 (Cloudflare shows its 502 page); the tunnel keeps
running. Keep the system current too: `sudo apt update && sudo apt upgrade` now and then (Node.js and
cloudflared come from their own apt repositories, which `unattended-upgrades` leaves alone), then
`sudo systemctl restart blumodel-studio blumodel-tunnel` if either was upgraded.

### Publishing a version

The Wyse installs and updates from the **`blumodel-studio` branch** of `gabrieldocherty-ux/hubs` and
nothing else: development happens on other branches, and a version reaches the Wyse only when you
move that branch to it. From any checkout of the repo, once the commit has passed `npm test` and
`npm run build` and you have tried it:

```
git push origin <commit>:refs/heads/blumodel-studio
```

The first push creates the branch. **Until it exists on GitHub, the install commands in section 3
fail** (`curl` gets a 404 for the script; `git clone` says the remote branch was not found). Move
the branch only forward: git refuses a push that isn't a fast-forward unless you force it, and a
forced one would make the Wyse's update (`git pull --ff-only`) refuse in turn. To undo a version,
push a commit that reverts it. `--branch` (`-Branch` on Windows) installs from another branch instead, and the
update then follows that branch.

## 11. Backups

Automatic, on the Wyse's own disk (OPERATIONS.md, *Backups and restore*): a daily copy of the database
in `data/backups/daily/` (14 kept), a mirror of the uploads in `data/backups/uploads-mirror/`, and the
deploy's copy before every deploy in `data/backups/<time>/` (5 kept).

**A Wyse's eMMC can fail like any disk, and takes those with it.** Take a data bundle off the machine
regularly (monthly, and before anything risky). It is safe while the server runs:

```
sudo mkdir -p /mnt/usb && sudo mount /dev/sdb1 /mnt/usb        # the stick, as lsblk shows it
sudo node /srv/blumodel-studio/app/server/scripts/export-data.mjs --home /srv/blumodel-studio --out /mnt/usb
sudo umount /mnt/usb
```

Keep the stick somewhere else. The settings file and the tunnel's credentials aren't in the bundle
(they can be recreated from Stripe and Cloudflare; MOVING_DATA.md has `--include-secrets` if you want
them, with its warning).

## 12. Logs and status

Linux:

| What | Command |
| --- | --- |
| The server's own log (requests' errors, starts, payments, warnings) | `sudo tail -f /srv/blumodel-studio/logs/server.log` |
| Starts, stops and crashes of the server | `journalctl -u blumodel-studio -f` |
| The tunnel (`Registered tunnel connection` = connected) | `journalctl -u blumodel-tunnel -f` |
| Both at once, since the last boot | `journalctl -b -u blumodel-studio -u blumodel-tunnel` |
| Status | `systemctl status blumodel-studio blumodel-tunnel` |
| Restart after a settings change | `sudo systemctl restart blumodel-studio` |
| Stop / start | `sudo systemctl stop blumodel-studio` / `sudo systemctl start blumodel-studio` |

`server.log` is mode 600, readable only by `blumodel` (it names accounts and addresses), so reading
it takes `sudo`; it rotates itself at 10 MB, 5 kept. `journalctl` needs `sudo` unless your user is in
the `adm` or `systemd-journal` group (Ubuntu's first user is in `adm`; Debian's isn't).

Windows: `logs\server.log`, `logs\console.log` (the supervisor, and anything printed before the log
opened), `logs\tunnel.log`, in `%USERPROFILE%\Projects\BluModelStudio`; status with
`schtasks /Query /TN BluModelStudioServer /V /FO LIST` and http://127.0.0.1:8790/api/health.

## 13. Disk and memory

- **Disk.** The code, its `node_modules` and the build take about 500 MB under
  `/srv/blumodel-studio/repo`; each copy of the app (`app`, `app.previous`) a few MB. What grows is the
  data: the database plus 14 daily copies of it, the uploads twice (they are mirrored) and 5 pre-deploy
  copies of the database. A 16 GB eMMC holds Ubuntu Server and a young site, but watch it; 32 GB or more
  (or an M.2 SATA drive, if your unit has the slot) is comfortable. Check with `df -h /` and
  `sudo du -sh /srv/blumodel-studio/data/*`. On a small disk, cap the journal: `SystemMaxUse=200M` in
  `/etc/systemd/journald.conf`, then `sudo systemctl restart systemd-journald`.
- **Memory.** Serving needs little (a Node process of 100-200 MB). The **build** is the heavy part:
  `scripts/host/build.mjs` gives it half the RAM (1-2 GB of heap) and refuses, with this fix, when RAM
  plus swap is under 2 GB. A 4 GB Wyse builds without swap. With 2 GB of RAM add swap first:

  ```
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```

  Or build on another computer: in a checkout of the same commit there,
  `node scripts/host/build.mjs --out <folder>`; copy `<folder>` to the Wyse; then on the Wyse make the
  small export kit (it needs no memory to speak of) and deploy that build:

  ```
  sudo -u blumodel node /srv/blumodel-studio/repo/blumodel-studio/scripts/build-kit.mjs
  sudo node /srv/blumodel-studio/repo/blumodel-studio/scripts/deploy-local.mjs --dist <folder> --commit <sha>
  ```

## 14. Troubleshooting

| Symptom | Look at | Usually |
| --- | --- | --- |
| The install stops at "RAM + swap" | `free -h` | add the swap file (section 13) |
| `apt-get update` fails for `deb.nodesource.com` or `pkg.cloudflare.com` (`NO_PUBKEY`, `EXPKEYSIG`, "is not signed") | the error's URL | the vendor changed its signing key: install that package (Node.js or cloudflared) by the vendor's current instructions (github.com/nodesource/distributions, pkg.cloudflare.com), which replace the same list file, then run the install again: it skips what is already installed |
| `blumodel-studio.service` keeps restarting | `journalctl -u blumodel-studio -n 50`, then `logs/server.log` | `blumodel.env` missing or unreadable (`Can't read the settings file …`), a bad `PUBLIC_URL`, port 8790 taken |
| status `226/NAMESPACE` | `ls -ld /srv/blumodel-studio/data /srv/blumodel-studio/logs` | one of them is missing: `sudo install -d -m 0750 -o blumodel -g blumodel /srv/blumodel-studio/data /srv/blumodel-studio/logs` |
| blumodel.studio shows Cloudflare 1033 | `systemctl status blumodel-tunnel`, `journalctl -u blumodel-tunnel` | the tunnel isn't running, or its credentials file is missing (`ls -l /srv/blumodel-studio/.cloudflared/`) |
| blumodel.studio shows Cloudflare 502 | `curl -s http://127.0.0.1:8790/api/health` | the tunnel runs but the server doesn't |
| Some visitors see old data | the dashboard's connectors for `blumodel` | **two machines run the tunnel**: stop one now (section 6, split brain) |
| Stripe webhooks fail with *Invalid signature* | `timedatectl` | the clock is off, or the wrong `STRIPE_WEBHOOK_SECRET` |
| The update says "local changes" | `git -C /srv/blumodel-studio/repo status` | someone edited a file in the checkout: `sudo -u blumodel git -C /srv/blumodel-studio/repo checkout -- .` |
| Windows: the site is down after a restart | `uwfmgr get-config`, Task Scheduler's history | the write filter is on, or the task's stored password is out of date (register it again) |

## Reference: the scripts

All in the repo's `blumodel-studio/` folder. Each has the full details in its header.

| Script | What |
| --- | --- |
| `scripts/host/install-linux.sh` | install or repair on Ubuntu 24.04 / Debian 12 (`--dry-run`, `--home`, `--branch`, `--repo`, `--port`) |
| `scripts/host/install-windows.ps1` | install or repair on Windows 10/11 (`-DryRun`, `-HomeDir`, `-Branch`, `-Repo`, `-Port`, `-SkipTasks`) |
| `scripts/host/update-linux.sh` | the update on Linux, with sudo (runs `update.mjs`) |
| `scripts/host/update.mjs` | the update (`npm run host:update`; `--dry-run`, `--force`, `--no-pull`, `--home`) |
| `scripts/host/build.mjs` | the build with the memory guard (`npm run host:build`; `--out`, `--dry-run`) |
| `scripts/deploy-local.mjs` | deploy a build into the home (`--dist`, `--commit`), or `--rollback`; on Linux with sudo |
| `scripts/register-tasks.mjs` | Linux: install the systemd units (`--enable-tunnel` at the cutover); Windows: the tasks (`--at-startup`); `--dry-run` |
| `scripts/tunnel/setup-tunnel.mjs` | write `cloudflared.yml` (and the Windows supervisor) and check it offline (`--validate`, `--credentials`) |
| `server/scripts/export-data.mjs`, `import-data.mjs` | the data bundle (MOVING_DATA.md) |
| `server/scripts/restore.mjs`, `make-admin.mjs` | restore a backup; make an admin (OPERATIONS.md) |

Making an admin on Linux (the account must exist; it usually comes with the data):

```
sudo -u blumodel env DB_PATH=/srv/blumodel-studio/data/blumodel.db node /srv/blumodel-studio/app/server/scripts/make-admin.mjs you@example.com
```
