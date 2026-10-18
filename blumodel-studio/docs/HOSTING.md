# Run BluModel Studio on another computer (Dell Wyse 5070)

How to move https://blumodel.studio from the Windows PC that serves it today to a Dell Wyse 5070 thin
client (or any small x86-64 machine), and how to run it there: install, settings, data, tunnel,
cutover, checks, rollback, updates, backups and logs. The same one server serves the sales site
(blumodel.studio, www.), every company's showroom (`<slug>.blumodel.studio`) and companies' own
domains, picked by the request's `Host` (docs/SHOWROOM_PIVOT.md); nothing about that differs
between the PC and the Wyse. Setting up a company is [ONBOARDING_A_COMPANY.md](ONBOARDING_A_COMPANY.md).

The server is plain Node: Node's own `http`, `crypto` and built-in `node:sqlite`, no other runtime
dependencies. Everything 3D runs in each visitor's browser, so the machine only serves files, the
API and one SQLite database. A Wyse 5070 (4-core Celeron J4105 or Pentium Silver J5005, 4-8 GB of
RAM) is plenty.

**The Wyse runs Windows 11 Pro.** Its step-by-step guide, written for a Claude Code session on the
Wyse and for Gabe, is `WYSE_SETUP.md` at the top of the release branch (in the repo:
`release/WYSE_SETUP.md`); this runbook has the background for both Windows and Linux.

Everything needed comes from two places:

- **GitHub** (**private**, read on the server with a read-only deploy key: section 3, *The deploy
  key*): the repo `gabrieldocherty-ux/hubs`, branch **`blumodel-studio`**, folder
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

The repo is private, so the installer can't be downloaded anonymously. Copy it from a checkout you
already have (your PC), by USB stick or `scp`, then over SSH, as your admin user:

```
scp blumodel-studio/scripts/host/install-linux.sh you@wyse:~/      # from the PC's checkout
sudo bash install-linux.sh --dry-run      # prints every command it would run; runs none
sudo bash install-linux.sh
```

It makes the deploy key first, prints its public key and waits for you to add it on GitHub (*The
deploy key* below), then clones over SSH.

**Disk encryption (recommended):** install Ubuntu with *Encrypt the new installation* (LUKS). The
trade-off is plain: without TPM unlocking (Ubuntu 24.04 offers it only experimentally, and the Wyse
5070's firmware is old), the passphrase must be typed at the box at every boot, so after a power cut
the site stays down until someone does. Without encryption, a stolen box is a readable database. On
Windows, BitLocker with the TPM has no such cost (WYSE_SETUP.md, step 2). Either way, `blumodel.env`
is mode 600 for `blumodel`, the database and its backups are 600 in 750 folders, and the tunnel's
account can read none of them.

It takes a few minutes on a Wyse: **nothing is built there**. The branch carries each release
prebuilt (section 10, *Publishing a version*), so there is no `npm ci`, no vite and no
devDependencies on the machine. What it does, in order (the script's header says the same): checks
the machine; installs `ca-certificates curl gnupg git`,
**Node.js 24 from NodeSource's apt repository** (unless Node 24+ is there) and **cloudflared from
Cloudflare's apt repository**; creates the **`blumodel` system account** and the home
`/srv/blumodel-studio` (with `data/` and `logs/` owned by `blumodel`, and `.cloudflared/` by the tunnel's own account, `blumodel-tunnel`); makes a
**sparse clone of `blumodel-studio/`** on the `blumodel-studio` branch in `/srv/blumodel-studio/repo`
(plus `WYSE_SETUP.md` and `CLAUDE.md` at the top of a release: the setup guide for a Claude Code
session on the Wyse); checks the prebuilt release is there; installs the systemd units (the server
**enabled**, its Node heap capped; the tunnel installed but **not enabled**; the daily automatic
update **on**, see section 10); deploys (starts the server and checks `http://127.0.0.1:8790/api/health`); writes
`cloudflared.yml` and checks it offline; and prints what is left.

Run it again any time: each step checks first, so a second run only repairs or updates. Options:
`--home <dir>`, `--branch <name>`, `--repo <url>`, `--port <n>`, `--dry-run`, `--auto-update-time HH:MM`
(04:00), `--no-auto-update`, `--heap-mb <n>` (384), and `--build` (an emergency only: `npm ci` and the
build on the Wyse, which needs about 2 GB of RAM + swap). A home installed with
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
| `/srv/blumodel-studio/.cloudflared/` | the tunnel's credentials JSON, which you copy in (owned by `blumodel-tunnel`, mode 700; the file 600) |
| `/srv/blumodel-studio/.ssh/` | the deploy key and GitHub's pinned host key (`blumodel`'s, 700) |
| `/srv/blumodel-studio/auto-update.conf` | `AUTO_UPDATE=on\|off`, `AUTO_UPDATE_TIME=04:00` (not secret; section 10) |
| `/etc/systemd/system/blumodel-studio.service`, `blumodel-tunnel.service` | the server and the tunnel |
| `/etc/systemd/system/blumodel-update.service`, `.timer`, `.path` | the automatic update (section 10) |

The server unit runs `node --no-warnings /srv/blumodel-studio/app/server/index.mjs --prod` as
`blumodel` with `NODE_ENV=production`, restarts it 5 seconds after any exit, and sandboxes it
(`ProtectSystem=strict` with only `data/` and `logs/` writable, `ProtectHome`, `PrivateTmp`,
`NoNewPrivileges`, no capabilities). The tunnel runs as its own account, **`blumodel-tunnel`**, which can
read `cloudflared.yml` (root:blumodel-tunnel 640) and `.cloudflared/` (its own, 700) and nothing of
the site's: the home is 751 (it may pass through, not list), `data/` and `logs/` are 750 `blumodel`,
`blumodel.env` is 600 `blumodel`, and its unit makes them `InaccessiblePaths` besides. On a small
machine the server unit also caps Node's heap
(`--max-old-space-size=384`, `--heap-mb`) with `MemoryHigh=640M` and `MemoryMax=896M` above it.
Read them with `systemctl cat blumodel-studio blumodel-tunnel`.

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

2. Get the installer. The repo is private: on a machine where the GitHub CLI is signed in (the Wyse
   is), clone or update a checkout over HTTPS (`gh repo clone gabrieldocherty-ux/hubs
   $env:USERPROFILE\hubs -- --branch blumodel-studio`, or `git -C $env:USERPROFILE\hubs pull --ff-only`);
   otherwise copy `install-windows.ps1` from the PC by USB stick. Then open **PowerShell as
   administrator** (needed for the startup tasks) and run:

   ```
   $s = "$env:USERPROFILE\hubs\blumodel-studio\scripts\host\install-windows.ps1"
   powershell -NoProfile -ExecutionPolicy Bypass -File "$s" -DryRun
   powershell -NoProfile -ExecutionPolicy Bypass -File "$s"
   ```

   The dry run prints every step ("+ ...") and changes nothing.

It checks Node 24+/git/cloudflared (when one is missing it prints the `winget` command and stops: it
never installs software itself), clones just `blumodel-studio\` into
`%USERPROFILE%\Projects\BluModelStudio\repo` (nothing is built: the release is prebuilt; `-Build` is
the emergency exception), deploys into
`%USERPROFILE%\Projects\BluModelStudio`, writes the tunnel's files and checks them offline, and
registers **`BluModelStudioServer` to run when Windows starts** (`register-tasks.mjs --at-startup
--only server`). `schtasks` then asks for **your Windows password**: Windows needs it to start the
task when nobody is signed in. Nothing passes the password on a command line. Last, it restarts the
server through that task, so it keeps running after you sign out. Options: `-HomeDir`, `-Branch`,
`-Repo`, `-Port`, `-SkipTasks`, `-DryRun`, `-AutoUpdateTime 04:00`, `-NoAutoUpdate`, `-Build`. Last, it
registers the automatic update's two tasks (section 10), asking for the password once for each.

The tunnel's task, `BluModelTunnel`, is registered at the cutover, not before.

### The deploy key

The repo is private. Each server reads it with its **own read-only deploy key**, never a person's
credentials: the installer makes `<home>/.ssh/id_ed25519` once (Linux: the `blumodel` account's, the
folder 700 and the key 600; Windows: under the home, restricted to the account the server's tasks run
as, which the update also runs as), writes GitHub's published ed25519 host key into
`<home>/.ssh/known_hosts` (SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU, pinned, never a
first-use scan), prints the public key and waits:

- Add it at github.com > gabrieldocherty-ux/hubs > Settings > Deploy keys > *Add deploy key*, title
  the machine, and **leave "Allow write access" unchecked**. Or, where the GitHub CLI is signed in:
  `gh repo deploy-key add <home>/.ssh/id_ed25519.pub --repo gabrieldocherty-ux/hubs --title Wyse`
  (read-only unless `--allow-write`, which you never pass).
- Press Enter; the installer checks GitHub accepts it, then clones `git@github.com:gabrieldocherty-ux/hubs.git`.

The checkout's `core.sshCommand` names that key and that known_hosts file (`IdentitiesOnly`,
`StrictHostKeyChecking=yes`), so the updates, by hand or automatic, use it and nothing else.
**A checkout made over public HTTPS** (before the repo went private) is switched once: run the
installer again, which does `git remote set-url origin git@github.com:gabrieldocherty-ux/hubs.git`
and sets `core.sshCommand`. `--repo` / `-Repo` takes another address (an HTTPS one skips the key).
To revoke a machine, delete its key on GitHub.

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
(blumodel.studio, www and the wildcard `*` for the showrooms). Nothing in Cloudflare changes. Only
**where the connector runs** moves, and the connector needs the tunnel's credentials. The install
already wrote the Wyse's `cloudflared.yml`: `blumodel.studio`, `www.blumodel.studio`,
`*.blumodel.studio` and, last, any other host (companies' own domains through Cloudflare for SaaS)
→ `http://127.0.0.1:8790`, naming the credentials file where the Wyse expects it (OPERATIONS.md, *The
tunnel*, says why the last rule goes to the server). Two ways to give the Wyse the credentials:

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
   first), then add the public hostnames `blumodel.studio`, `www.blumodel.studio` and
   `*.blumodel.studio` (subdomain `*`), each → `http://127.0.0.1:8790`. A dashboard-managed tunnel's
   last rule is a 404, so each company's own domain then needs a public hostname of its own too.
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

**The showrooms' DNS** is Cloudflare's, not the machine's: the wildcard record `*` (a proxied CNAME to
`064671cd-a658-4240-8626-c697b9f148ac.cfargotunnel.com`) and, for companies' own domains, the
`tunnel` record and the Cloudflare for SaaS fallback origin. They point at the tunnel, not at a
machine, so moving the connector changes none of them. If they don't exist yet, they're made once:
ONBOARDING_A_COMPANY.md, *Once: Cloudflare*.

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
- Each kind of site, by `Host`: `curl -s -H "Host: blumodel.studio" http://127.0.0.1:8790/api/config`
  → `"site":"sales"`; `-H "Host: demo.blumodel.studio"` → `"site":"showroom"` with Northline in
  `tenant` (once the demo showroom exists); `-H "Host: nobody.blumodel.studio"` → a 404. The deploy
  (and so every update) prints the same checks under *Sites*.
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
- https://demo.blumodel.studio shows the demo showroom, every live company's address shows its
  showroom (Admin > Companies lists them), and a company's own domain, if any, loads with a padlock.
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
commit. The automatic update remembers the failed commit and doesn't retry it, but an update **by
hand** deploys it again. Fix it (or revert it) and publish a new release first (section 10,
*Publishing a version*).

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
4. checks the **prebuilt release** is there (`dist/` and `server/generated/`, committed to the
   `blumodel-studio` branch by `npm run release`): nothing is installed or built on the Wyse. Only in
   an emergency, `--build` runs `npm ci` and the build here instead (as `blumodel` on Linux; it needs
   about 2 GB of RAM + swap). Until here the site keeps running untouched;
5. the deploy: stops the server, **copies the database to `data/backups/<time>/` first**, puts the new
   app in place keeping the old one as `app.previous`, starts the server and checks
   `http://127.0.0.1:8790/api/health`;
6. if that check fails: `deploy-local.mjs --rollback`, the previous app back and checked again.
   It ends with `Updated: commit <sha> is running.`, or `ROLLED BACK: …` (exit 4) and the logs to read.

Only one update runs at a time (`logs/update.lock`); the automatic one below uses the same steps.

### Automatic updates

Publishing is all it takes: the Wyse picks a new release up by itself.

- **When.** Once a day at **04:00** local time (`AUTO_UPDATE_TIME`), the quietest hour. On Linux
  `blumodel-update.timer` (`OnCalendar=*-*-* 04:00:00`, `Persistent=true` so a run missed while the
  machine was off happens at boot, up to 10 minutes of random delay) starts `blumodel-update.service`,
  which runs `update.mjs --auto`. On Windows the task `BluModelStudioUpdate` runs daily at that time.
  Never more often: nothing else runs on a schedule.
- **Update now.** Admin > System > Updates > *Update now* (admins only, audited) applies a release at
  once: the server leaves `logs/update-now.request`, which `blumodel-update.path` acts on immediately
  (inotify, so it costs nothing while idle); on Windows `BluModelStudioUpdateNow` looks for it every two
  minutes and otherwise does nothing at all. The update deletes the file.
- **What a run does.** It fetches the branch and compares `app/DEPLOYED.txt` with
  `origin/blumodel-studio`. Equal: one `current` line, nothing else. A newer commit: `git merge
  --ff-only`, then the steps above (database backup, deploy, health check, rollback if unhealthy), run
  by the new copy of the script. It **never resets the checkout**: a force-pushed branch is refused
  with a log line. Only one run at a time (`logs/update.lock`; a lock left by a run that died is
  cleared after 2 hours), and never while a deploy is in progress.
- **When it fails.** The previous version keeps running (or is rolled back to), the commit is
  remembered in `logs/update-state.json` and **not retried** until a newer one is published (or Update
  now is pressed), and Admin > System shows a red *Rolled back* notice. Fix forward: publish a commit
  that fixes or reverts it.
- **Logs.** Every run is one JSON line in `logs/update.log` (time, from, to, outcome, duration, error;
  rotated at 1 MB, 3 kept): `sudo tail -n 20 /srv/blumodel-studio/logs/update.log`. On Linux also
  `journalctl -u blumodel-update` (one line per run, plus the deploy's output when it updates). The
  latest result is in `logs/update-status.json`, which Admin > System > Updates shows.
- **Change the time / turn it off.** Run the installer again with `--auto-update-time 05:30` or
  `--no-auto-update` (Windows: `-AutoUpdateTime 05:30`, `-NoAutoUpdate`), or directly
  `sudo node /srv/blumodel-studio/repo/blumodel-studio/scripts/register-tasks.mjs --only update --no-auto-update`
  (Windows, as administrator: `node scripts\register-tasks.mjs --at-startup --only update
  --auto-update-time 05:30`). The choice is recorded in `<home>/auto-update.conf`, which is not the
  settings file: the installer never reads `blumodel.env`. With it off, *Update now* is off too; update
  by hand with the command at the top of this section.

The site is down for a few seconds during step 5 (Cloudflare shows its 502 page); the tunnel keeps
running. Keep the system current too: `sudo apt update && sudo apt upgrade` now and then (Node.js and
cloudflared come from their own apt repositories, which `unattended-upgrades` leaves alone), then
`sudo systemctl restart blumodel-studio blumodel-tunnel` if either was upgraded.

### Publishing a version

The Wyse installs and updates from the **`blumodel-studio` branch** of `gabrieldocherty-ux/hubs` and
nothing else. Each commit there is a **prebuilt release**: development happens on other branches, and
a version reaches the Wyse only when you publish it, from your development checkout, with:

```
npm run release              # checks, builds, shows what goes live, asks, publishes
npm run release -- --qa      # also the full QA suite on the build first
npm run release -- --dry-run # everything but the push
npm run release -- --yes     # no question
```

`scripts/release.mjs`, in order: refuses when tracked files have uncommitted changes; makes a **clean
temporary worktree of HEAD** (with `node_modules` linked in) and runs `tsc --noEmit`, `npm test` and
the production build there (and with `--qa` the QA suite); builds the release tree with git plumbing
in a throwaway index, so your checkout and branch are never touched: HEAD's `blumodel-studio/`, plus
its `dist/` and `server/generated/` (gitignored on every work branch and committed **only** on the
release branch), `RELEASE.json` (the source commit), and `WYSE_SETUP.md` and `CLAUDE.md` at the top
(from `release/`; nothing else from the repo's top level); refuses when HEAD doesn't contain the live
release's source (it would drop published work); makes the release commit **on top of the branch's
tip**, prints what goes live (the commits since the last release, the build's size) and asks; then
`git push origin <release>:refs/heads/blumodel-studio`, never forced, so if someone published in
between git refuses and you run it again. The Wyse deploys it at 04:00, or at once with Update now.

The first release goes on top of the branch as it is. **Until the branch exists on GitHub, the install
commands in section 3 fail.** Move it only forward: a forced push would make the Wyse's update refuse
in turn (it never resets). To undo a version, revert the change on your branch and release again.
`--branch` (`-Branch` on Windows) installs from another branch instead, and the update then follows
that branch; a branch without a prebuilt release is refused unless `--build`.

## 11. Backups

Automatic, on the Wyse's own disk (OPERATIONS.md, *Backups and restore*): a daily copy of the database
in `data/backups/daily/` (14 kept), a mirror of the uploads in `data/backups/uploads-mirror/`, and the
deploy's copy before every deploy in `data/backups/<time>/` (the last 5, none older than 30 days).
Every copy ages out on a schedule (OPERATIONS.md, *How long each copy is kept*).

**A Wyse's eMMC can fail like any disk, and takes those with it.** So turn on the off-site backups.

### Off-site backups

Once a day the server writes an **encrypted** copy of the database and every upload
(`blumodel-offsite-<time>.tar.enc`, AES-256-GCM, the key made by scrypt from `BACKUP_PASSPHRASE`)
into `BACKUP_OFFSITE_DIR`, keeps the newest 30 (none older than 35 days), verifies each, and shows
the result on Admin > System. Nothing unencrypted is ever written there. The full story, the status
fields and the restore are in OPERATIONS.md, *Off-site backups*. On the Wyse:

1. **A place off the disk.** The simplest is a USB drive that stays plugged in (an exFAT or ext4
   stick or disk; better, two you swap weekly and keep one elsewhere):

   ```
   lsblk -f                                        # find it, say sdb1, and its UUID
   sudo mkdir -p /media/usb
   echo 'UUID=<its UUID> /media/usb auto nofail,x-systemd.device-timeout=10s 0 2' | sudo tee -a /etc/fstab
   sudo mount -a
   sudo install -d -o blumodel -g blumodel -m 700 /media/usb/blumodel-backups
   ```

   `nofail` keeps the Wyse booting without it; with the drive missing, the server just reports
   *the folder doesn't exist* until it is back.

   **Let the service write there.** The service is sandboxed (`ProtectSystem=strict`,
   `ProtectHome=yes`): it may write only `data/` and `logs/`. Add the folder once with a drop-in,
   which survives reinstalls of the unit:

   ```
   sudo systemctl edit blumodel-studio
   #   [Service]
   #   ReadWritePaths=/media/usb/blumodel-backups
   sudo systemctl restart blumodel-studio
   ```

   Without it Admin > System says *the server can't write to …* with this hint. A folder under
   `/home` stays unreachable (`ProtectHome=yes`); use `/media`, `/mnt` or `/srv`. A cloud folder works too: a Windows home uses its
   OneDrive / Google Drive / Dropbox folder directly; on Linux, any folder a sync client (rclone
   `mount`, the Dropbox client) keeps in step, writable by `blumodel`.
2. **The passphrase.** A long random one from your password manager; keep it there and on paper.
   Without it the copies can never be opened.
3. **The settings:** `sudo nano /srv/blumodel-studio/blumodel.env`, then
   `sudo systemctl restart blumodel-studio`:

   ```
   BACKUP_OFFSITE_DIR=/media/usb/blumodel-backups
   BACKUP_PASSPHRASE=<the passphrase>
   ```

4. **Check it** within the hour on Admin > System, or
   `sudo -u blumodel node /srv/blumodel-studio/app/server/scripts/restore-offsite.mjs --list /media/usb/blumodel-backups`.
5. **Restore** (the server stopped):

   ```
   sudo systemctl stop blumodel-studio
   sudo -u blumodel node /srv/blumodel-studio/app/server/scripts/restore-offsite.mjs /media/usb/blumodel-backups/<file>.tar.enc --uploads --home /srv/blumodel-studio
   sudo systemctl start blumodel-studio
   ```

   Onto a new machine: `import-data.mjs <file>.tar.enc --home <home>` (MOVING_DATA.md).

The settings file and the tunnel's credentials aren't in these copies (they can be recreated from
Stripe and Cloudflare); keep the settings' values in your password manager. An export bundle you
take by hand is encrypted the same way (MOVING_DATA.md).

## 12. Logs and status

Linux:

| What | Command |
| --- | --- |
| The server's own log (requests' errors, starts, payments, warnings) | `sudo tail -f /srv/blumodel-studio/logs/server.log` |
| Starts, stops and crashes of the server | `journalctl -u blumodel-studio -f` |
| The tunnel (`Registered tunnel connection` = connected) | `journalctl -u blumodel-tunnel -f` |
| Both at once, since the last boot | `journalctl -b -u blumodel-studio -u blumodel-tunnel` |
| Status | `systemctl status blumodel-studio blumodel-tunnel` |
| Automatic updates (one line per run) | `journalctl -u blumodel-update -n 20`, `sudo tail /srv/blumodel-studio/logs/update.log` |
| When the next update check is | `systemctl list-timers blumodel-update.timer` |
| Restart after a settings change | `sudo systemctl restart blumodel-studio` |
| Stop / start | `sudo systemctl stop blumodel-studio` / `sudo systemctl start blumodel-studio` |

`server.log` is mode 600, readable only by `blumodel` (it names accounts and addresses), so reading
it takes `sudo`; it rotates itself at 10 MB, 5 kept. `journalctl` needs `sudo` unless your user is in
the `adm` or `systemd-journal` group (Ubuntu's first user is in `adm`; Debian's isn't).

Windows: `logs\server.log`, `logs\console.log` (the supervisor, and anything printed before the log
opened), `logs\tunnel.log`, `logs\update.log`, in `%USERPROFILE%\Projects\BluModelStudio`; status with
`schtasks /Query /TN BluModelStudioServer /V /FO LIST` and http://127.0.0.1:8790/api/health.

### Turning the sites off and on

One switch takes **every** site offline at once (blumodel.studio, `www.`, the demo, every company's
showroom and their own domains) and puts it back, with no restart: the tunnel and the server keep
running. While it is OFF:

- every page answers a calm "We'll be right back" (HTTP 503, `Retry-After`), and the API answers
  503 `{ "code": "maintenance" }`;
- still answering: `/api/health` (200, with `"maintenance": true`, so an update's health check
  passes), `/api/config`, Stripe's webhooks (so billing stays right), and on the sales site the
  sign-in and the app at **https://blumodel.studio/admin**: a signed-in admin has the whole sales site,
  so Admin > System turns it back on from anywhere.

The state is `data/sites-switch.json` (on, since, by, via), so it survives a restart; every change is
in the admin audit log (*All websites turned off / on*, with where it came from). Three ways to flip it:

- **The server face**, a page served by the same server process on **http://127.0.0.1:8799**
  (`SERVER_FACE_PORT`; 0 turns it off), on the machine itself only: it refuses any peer that isn't
  loopback and any `Host` that isn't a loopback name, and is never routed by the tunnel. One big ON /
  OFF switch (a confirm before OFF), every site with a status dot (live, trial, lapsed, suspended: a
  showroom's own suspension shows here), uptime, the deployed commit, the last backup, the last
  automatic update and the server's memory, and **Update now** with its progress. Writes need the
  page's token, and **`SERVER_FACE_PIN`** in `blumodel.env` when set (five wrong tries lock it for five
  minutes). Windows: the **BluModel Server** shortcut on the desktop (the installer makes it).
  Linux: the *BluModel Server* launcher (`/usr/share/applications`; `--desktop-autostart` opens it at
  login, off by default to save RAM); headless, from your PC: `ssh -L 8799:127.0.0.1:8799 you@wyse`,
  then http://127.0.0.1:8799.
- **Admin > System > All websites** (admins only, audited, a confirm before OFF).
- **`blumodel sites status|on|off`** (`scripts/host/blumodel.mjs`: `<home>\blumodel.cmd` on Windows,
  `/usr/local/bin/blumodel` on Linux), for SSH and a Claude session: `--yes` skips the question,
  `--pin` (or `BLUMODEL_FACE_PIN`) gives the PIN.

## 13. Disk and memory

- **Disk.** The checkout with its prebuilt release takes about 20 MB under
  `/srv/blumodel-studio/repo` (plus git's history, which grows by about 5 MB a release; there is no
  `node_modules`, unless an emergency `--build` made one: 250-500 MB, and npm's cache in
  `/srv/blumodel-studio/.npm`, both safe to delete afterwards); each copy of the app
  (`app`, `app.previous`, `app.failed`) about 6 MB. What grows is the
  data: the database plus 14 daily copies of it, the uploads twice (they are mirrored) and 5 pre-deploy
  copies of the database. A 16 GB eMMC holds Ubuntu Server and a young site, but watch it; 32 GB or more
  (or an M.2 SATA drive, if your unit has the slot) is comfortable. Check with `df -h /` and
  `sudo du -sh /srv/blumodel-studio/data/*`. On a small disk, cap the journal: `SystemMaxUse=200M` in
  `/etc/systemd/journald.conf`, then `sudo systemctl restart systemd-journald`.
- **Memory.** Serving needs little, and nothing is built on the Wyse. Measured (Node 24, the seeded
  demo data): the server idles at **about 80 MB RSS**, stays under **90 MB** through a burst of 1,000
  requests across the sales site and the demo showroom, and under **about 150 MB** through the whole
  admin QA run (it settles back to about 75 MB). The systemd unit caps V8's heap at 384 MB
  (`--heap-mb`), throttles the service above `MemoryHigh=640M` and restarts it above
  `MemoryMax=896M`, so even a leak can't take a 4 GB machine. Nothing polls: the only timers are the
  server's own 10-minute housekeeping and hourly backup check, the daily 04:00 update check, and
  `blumodel-update.path`, which is an inotify watch (no process at all while idle). Desktop
  environments and other services are what to avoid on a 4 GB Wyse.
  The emergency `--build` (section 10) is the one heavy job: `scripts/host/build.mjs` gives it half the
  RAM (1-2 GB of heap) and refuses, with this fix, when RAM plus swap is under 2 GB. With 2 GB of RAM
  add swap first:

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
| blumodel.studio works but a showroom gives a bare 404 | the deploy's *Sites* warning; `grep hostname /srv/blumodel-studio/cloudflared.yml` | `cloudflared.yml` predates showrooms: `sudo node /srv/blumodel-studio/repo/blumodel-studio/scripts/tunnel/setup-tunnel.mjs --home /srv/blumodel-studio --validate`, then `sudo systemctl restart blumodel-tunnel` |
| A showroom's address doesn't resolve | Cloudflare → DNS | the wildcard `*` record is missing (ONBOARDING_A_COMPANY.md, *Once*) |
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
| `scripts/host/update.mjs` | the update (`npm run host:update`; `--dry-run`, `--force`, `--no-pull`, `--home`, `--build`), and the unattended `--auto` (`--trigger-only`) |
| `scripts/host/blumodel.mjs` | `blumodel sites status\|on\|off` (`--yes`, `--port`, `--pin`, `--json`): the sites switch from a shell |
| `server/face/face.mjs`, `server/ops/sitesSwitch.mjs` | the server face on 127.0.0.1:8799 and the switch it flips |
| `server/ops/winTools.mjs` | Windows: `blumodel.cmd`, `update-now.cmd` (the *Update BluModel* shortcut) and the shortcuts' icon, written by each deploy |
| `scripts/host/autoupdate.mjs` | what `--auto` decides and records (the lock, the failed commit, `logs/update.log`, `logs/update-status.json`) |
| `scripts/release.mjs` | `npm run release`: publish a prebuilt release to the branch (`--yes`, `--qa`, `--dry-run`, `--branch`, `--remote`) |
| `scripts/host/build.mjs` | the build with the memory guard (`npm run host:build`; `--out`, `--dry-run`) |
| `scripts/deploy-local.mjs` | deploy a build into the home (`--dist`, `--commit`), or `--rollback`; on Linux with sudo |
| `scripts/register-tasks.mjs` | Linux: install the systemd units (`--enable-tunnel` at the cutover, `--heap-mb`); Windows: the tasks (`--at-startup`); both: the update schedule (`--only update`, `--auto-update-time`, `--no-auto-update`); `--dry-run` |
| `scripts/tunnel/setup-tunnel.mjs` | write `cloudflared.yml` (the sales site, `www.`, `*.` showrooms and custom domains; and the Windows supervisor) and check it offline (`--validate`, `--credentials`, `--hostname`, `--no-custom-domains`) |
| `server/scripts/seed-demo-tenant.mjs` | make or refresh the demo showroom `demo.blumodel.studio` (`--db`) |
| `server/scripts/export-data.mjs`, `import-data.mjs` | the data bundle (MOVING_DATA.md) |
| `server/scripts/restore.mjs`, `make-admin.mjs` | restore a backup; make an admin (OPERATIONS.md) |

Making an admin on Linux (the account must exist; it usually comes with the data):

```
sudo -u blumodel env DB_PATH=/srv/blumodel-studio/data/blumodel.db node /srv/blumodel-studio/app/server/scripts/make-admin.mjs you@example.com
```
