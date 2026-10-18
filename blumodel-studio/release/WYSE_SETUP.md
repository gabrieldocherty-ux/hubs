# Setting up the Wyse (for a Claude Code session on this machine, and for Gabe)

**Run this** (on the Wyse, Ubuntu Server 24.04 or Debian 12, as the admin user; it prints every
command and changes nothing):

```
curl -fsSLO https://raw.githubusercontent.com/gabrieldocherty-ux/hubs/blumodel-studio/blumodel-studio/scripts/host/install-linux.sh && sudo bash install-linux.sh --dry-run
```

Then work through the steps below **in order**. Every step is safe to run again: each one checks
first and only does what is missing. Stop at the first thing that doesn't match what a step says
to expect, and tell Gabe what you saw. The full runbook behind this page is
`blumodel-studio/docs/HOSTING.md` (section numbers below refer to it).

This machine runs the whole of https://blumodel.studio: the sales site, `www.`, the demo showroom
`demo.blumodel.studio` and every company's showroom, from one Node server on `127.0.0.1:8790`, made
public by a Cloudflare tunnel. Releases are **prebuilt** on a developer's machine (`npm run release`)
and published to the `blumodel-studio` branch; nothing is ever built here.

## Safety rules for this session

- **Secrets: never open, read, print, `cat`, `grep`, copy or ask for** `/srv/blumodel-studio/blumodel.env`
  or the tunnel's credentials (`/srv/blumodel-studio/.cloudflared/*.json`). Never ask Gabe to paste a
  key, token or password into the chat. You may check that a file exists and its permissions
  (`ls -l`), nothing more. Gabe edits `blumodel.env` himself (step 4).
- **Never delete, move or overwrite anything in `/srv/blumodel-studio/data/`** (the database, uploads,
  backups). The import in step 5 is the only thing that writes there, and it backs up first.
- **Git: never force-push, never `git reset --hard`, never `git checkout -- .` without asking, never
  edit or commit files in `/srv/blumodel-studio/repo/`.** Changes are made on Gabe's PC and published
  with `npm run release`; this machine only fast-forwards.
- **Ask Gabe before the cutover** (step 6: anything that starts the tunnel here or stops the PC's),
  before a reboot, and before anything that stops the site (`systemctl stop`, an import, a rollback).
- One tunnel only: never start or enable `blumodel-tunnel` while the PC's tunnel may be running
  (the split-brain rule, step 6).

## 1. Prerequisites (check; change nothing)

```
cat /etc/os-release | head -3          # Ubuntu 24.04 or Debian 12
uname -m                                # x86_64
free -m                                 # 4 GB or more of RAM is plenty (nothing is built here)
df -h /                                 # at least 2 GB free; 16 GB+ disk
systemctl --version | head -1           # systemd is there
timedatectl | grep -i 'synchronized'    # yes: Stripe's webhook check needs a correct clock
ping -c 1 github.com                    # the network works
```

Expect all of those to hold. The BIOS settings (power on after a power cut, no sleep) are HOSTING.md
section 2; ask Gabe whether they are done, you can't check them from here.

## 2. Install (or repair) from GitHub

```
sudo bash install-linux.sh --dry-run    # read the plan (you ran this above)
sudo bash install-linux.sh
```

It installs git, Node.js 24 and cloudflared from their apt repositories, creates the `blumodel`
account and `/srv/blumodel-studio`, clones the branch into `/srv/blumodel-studio/repo`, installs the
systemd units (the server enabled, the tunnel **not**), deploys the prebuilt release, starts the
server and checks `http://127.0.0.1:8790/api/health`, and turns on the daily automatic update
(step 7). Options: `--auto-update-time HH:MM`, `--no-auto-update`, `--heap-mb 384`, `--port 8790`.
Expect it to end with `Installed. What is left`. Running it again later only repairs or updates.

## 3. Check the install

```
curl -s http://127.0.0.1:8790/api/health          # {"ok":true,...,"db":"ok"}
systemctl is-enabled blumodel-studio              # enabled
systemctl is-enabled blumodel-tunnel              # disabled  (until the cutover)
systemctl list-timers blumodel-update.timer       # the next run at 04:00
ls -l /srv/blumodel-studio/blumodel.env           # -rw------- blumodel blumodel (do NOT open it)
```

## 4. Gabe's secrets (Gabe does this; you never see them)

Tell Gabe, word for word:

> Please open the settings file yourself and paste the values in:
> `sudo nano /srv/blumodel-studio/blumodel.env`
> (a NEW Stripe key, the webhook secret and the rest; docs/LAUNCH.md says where each comes from),
> save, then run `sudo systemctl restart blumodel-studio`. Don't paste any of it here.

When he says it's done, check only that the server came back:
`curl -s http://127.0.0.1:8790/api/health` and `ls -l /srv/blumodel-studio/blumodel.env` (still
`-rw-------`, owner `blumodel`). If it is not, `sudo chown blumodel:blumodel` and `sudo chmod 600` it,
without reading it.

The tunnel's credentials file is also Gabe's to copy (HOSTING.md section 6, MOVING_DATA.md step 6):
into `/srv/blumodel-studio/.cloudflared/`, then
`sudo chown blumodel:blumodel /srv/blumodel-studio/.cloudflared/*.json` and `sudo chmod 600` on it.

## 5. Move the data from the Windows PC

Follow `blumodel-studio/docs/MOVING_DATA.md`. In short: Gabe exports a bundle on the PC
(`export-data.mjs`) to a USB stick; on the Wyse, mount it (`lsblk`, then
`sudo mkdir -p /mnt/usb && sudo mount /dev/sdX1 /mnt/usb`) and:

```
sudo node /srv/blumodel-studio/app/server/scripts/import-data.mjs /mnt/usb/blumodel-data-<time>.tar --check
```

`--check` must pass. A **rehearsal** import (before the cutover) is fine at any time; the real one
happens inside the cutover (step 6), with the PC's server stopped. Ask Gabe before running the import
itself (it stops the server for a moment):

```
sudo systemctl stop blumodel-studio
sudo node /srv/blumodel-studio/app/server/scripts/import-data.mjs /mnt/usb/blumodel-data-<time>.tar --home /srv/blumodel-studio
sudo systemctl start blumodel-studio
```

(`--replace` when a rehearsal already left data here.)

## 6. The tunnel: the cutover (ask Gabe first)

**The split-brain rule: only one machine may run the tunnel.** With both connected, Cloudflare sends
some visitors to each database. So the PC's tunnel and server stop **first** (Gabe does that on the
PC: HOSTING.md section 7), its final data bundle is exported, imported here (step 5), and only then:

```
curl -s http://127.0.0.1:8790/api/health                  # ok first
sudo systemctl enable --now blumodel-tunnel
journalctl -u blumodel-tunnel -n 30 --no-pager            # "Registered tunnel connection"
```

Going back to the PC is the reverse: `sudo systemctl disable --now blumodel-tunnel` here **first**.

## 7. The daily automatic update

The install turned it on. Check:

```
systemctl is-enabled blumodel-update.timer blumodel-update.path   # enabled, enabled
systemctl list-timers blumodel-update.timer                       # next: 04:00 (+ up to 10 min)
cat /srv/blumodel-studio/auto-update.conf                         # AUTO_UPDATE=on, AUTO_UPDATE_TIME=04:00
```

Once a day at 04:00 it fetches the branch; when there is a newer release it deploys it (database
backed up first) and rolls back by itself if the new version doesn't come up healthy, then doesn't
retry that release until a newer one is published. Admin > System > **Update now** applies a release
at once. Its log: `journalctl -u blumodel-update` and `/srv/blumodel-studio/logs/update.log`.
Another time: `sudo bash install-linux.sh --auto-update-time 05:30`. Off:
`sudo bash install-linux.sh --no-auto-update`. HOSTING.md, "Automatic updates".

## 8. Verify

```
curl -s http://127.0.0.1:8790/api/health
curl -s -H "Host: blumodel.studio" http://127.0.0.1:8790/api/config | head -c 300        # "site":"sales"
curl -s -H "Host: demo.blumodel.studio" http://127.0.0.1:8790/api/config | head -c 300   # "site":"showroom"
systemctl status blumodel-studio --no-pager | head -5                                    # active (running)
systemctl show blumodel-studio -p MemoryCurrent                                          # ~100-150 MB
tail -n 5 /srv/blumodel-studio/logs/update.log
```

After the cutover, also from outside: https://blumodel.studio/api/health answers `{"ok":true,...}`.
The reboot test (ask Gabe first): `sudo reboot`; a minute later the health check answers again
without anyone logging in. HOSTING.md section 8 has the full list.

## 9. Roll back

- **A bad update**: the automatic update rolls back by itself. By hand:
  `sudo node /srv/blumodel-studio/repo/blumodel-studio/scripts/deploy-local.mjs --rollback`
  (the previous app back, restarted, checked; the database is untouched).
- **The cutover** (back to the PC): `sudo systemctl disable --now blumodel-tunnel` here first, then
  Gabe starts the PC's server and tunnel (HOSTING.md section 9). Data entered here since the cutover
  has to be carried back with a bundle.
- **The database**: `sudo -u blumodel node /srv/blumodel-studio/app/server/scripts/restore.mjs --list`,
  and only with Gabe's go-ahead `--latest` (HOSTING.md section 9).
