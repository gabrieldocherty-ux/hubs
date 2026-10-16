# Moving the data to another machine

How to carry BluModel Studio's data (every account, kitchen, order and upload) from the PC that
serves https://blumodel.studio today to the Dell Wyse 5070, or between any two machines, Windows or
Linux either way. Installing the Wyse itself, the systemd units / scheduled tasks, updates and the
tunnel cutover are in [HOSTING.md](HOSTING.md); day-to-day running is in
[OPERATIONS.md](OPERATIONS.md). This page is only the data, the two secret files that go with it,
how to check the result, and how to go back.

**What moves, and how:**

| What | Where it lives (old PC) | How it moves |
| --- | --- | --- |
| The database | `%USERPROFILE%\Projects\BluModelStudio\data\blumodel.db` | the data bundle (`export-data` / `import-data`) |
| Uploads (models, photos, images) | `…\data\uploads\` | the data bundle |
| Private settings (Stripe keys etc.) | `…\blumodel.env` | **by hand**, or retyped (below) |
| Tunnel credentials | `%USERPROFILE%\.cloudflared\064671cd-a658-4240-8626-c697b9f148ac.json` | **by hand** (below) |
| Daily backups, logs | `…\data\backups\`, `…\logs\` | not needed: the new machine starts its own. Keep the old ones on the old PC (or copy `data\backups\` to a USB drive) |
| The code | | not moved: the new machine gets it from GitHub (HOSTING.md) |
| `cloudflared.yml`, supervisor scripts, systemd units | | not moved: the installer writes the new machine's own |

## The data bundle

`server/scripts/export-data.mjs` makes one file, `blumodel-data-<time>.tar`, holding:

```
blumodel-data-2026-10-16T04-20-54Z/manifest.json       what is inside: see "Reference" below
blumodel-data-2026-10-16T04-20-54Z/db/blumodel.db      a consistent copy of the database
blumodel-data-2026-10-16T04-20-54Z/uploads/ab/ab…ef.glb every upload, by its sha256
```

- It is a plain `.tar` (POSIX ustar). Nothing needs installing to open it: Windows 10 and 11 ship
  `tar.exe`, Linux ships `tar`. The scripts read and write it themselves; `tar -tf <bundle>` only
  lists it for you. `--folder` makes the same tree as a plain folder instead.
- The database copy is made with SQLite's `VACUUM INTO` from a read-only connection: **safe while
  the server runs**, and it is the database exactly as it was at that moment.
- `manifest.json` lists the size and sha256 of every file, the row count of every table, the
  schema (which migrations have run), when it was made, and the app's version and commit.
  `import-data` checks all of it before it changes anything.
- Nothing in a bundle names the machine it came from: every path inside is relative with `/`, and
  the database stores no file paths (uploads are found by sha256 under the uploads folder). A
  bundle made on Windows imports on Linux, and the other way round.
- **It holds every customer's data.** Treat it like the database: your own USB stick or your own
  machines only, never email, chat, a shared drive or git. `export-data` refuses to write inside a
  git checkout (the repo is public). Delete the copies once the new machine runs (keep one on a
  stick in a drawer if you like, as a backup).
- The settings file and the tunnel credentials are **not** in it, unless you ask
  (`--include-secrets`, below).

## This PC → the Wyse, step by step

Do it twice: once as a **rehearsal** while the old site keeps running (nothing on the old PC
changes; you get to check the Wyse with real data), then for real at the **cutover**, with the old
server stopped, so nothing written in between is lost.

### 0. Before you start

- The Wyse is installed and its server runs with an empty database, its tunnel **off**
  (HOSTING.md: the installer ends by printing what is left; this page is its step 3).
- On this PC, a checkout of the repo with this page in it. The scripts need nothing but Node (no
  `npm install`). The live home's own `app\` folder may be older than these scripts: run them from
  the checkout and point them at the home with `--home`.
- A USB stick formatted **exFAT** (FAT32 can't hold a file over 4 GB; Ubuntu 24.04 and Debian 12
  read exFAT with nothing extra), or SSH to the Wyse. Room for the bundle: about the size of
  `data\blumodel.db` plus `data\uploads\`, and the database's size once more while it is written
  (the copy is made beside the bundle, then removed).

### 1. Export (on this PC)

Rehearsal: just run it, the site keeps running. **Cutover:** stop the server and the tunnel first,
from the home folder: `stop-tunnel.cmd`, then `stop-server.cmd`.

In a terminal (cmd), in the repo's `blumodel-studio` folder, with the stick as `E:`:

```
node server\scripts\export-data.mjs --home %USERPROFILE%\Projects\BluModelStudio --out E:\
```

(PowerShell: `--home "$env:USERPROFILE\Projects\BluModelStudio"`.) It prints the file it wrote,
the row counts of the main tables, the number and size of the uploads, and *every file was read
back and matches its sha256*. Keep that output: you compare it with the import's.

Without `--out` the bundle goes to `<home>\data\backups\exports\`. `--folder` writes a folder
instead of a `.tar`.

### 2. Carry it

- **USB stick:** eject it properly (*Safely Remove*), plug it into the Wyse.
  - Wyse on Linux: `lsblk` shows it (say `sdb1`); `sudo mkdir -p /mnt/usb && sudo mount /dev/sdb1 /mnt/usb`.
    The bundle is then `/mnt/usb/blumodel-data-<time>.tar`.
  - Wyse on Windows: it appears as a drive, say `D:`.
- **Over the network (scp):** Windows 10/11 has an SSH client built in. To a Wyse on Linux (SSH
  server on, which the Ubuntu Server installer offers):

  ```
  scp E:\blumodel-data-<time>.tar you@wyse:~/
  ```

  The bundle is then `~/blumodel-data-<time>.tar` on the Wyse (`/home/you/…`).

### 3. Check it (on the Wyse)

Nothing changes in a check; run it as often as you like.

Linux:

```
sudo node /srv/blumodel-studio/app/server/scripts/import-data.mjs /mnt/usb/blumodel-data-<time>.tar --check
```

Windows (cmd):

```
node %USERPROFILE%\Projects\BluModelStudio\app\server\scripts\import-data.mjs D:\blumodel-data-<time>.tar --check
```

It must say *every file matches its sha256; the database passed PRAGMA integrity_check; the row
counts match the manifest*, then list every table. If it says a file doesn't match its checksum or
the tar *was copied only partly*, copy the bundle again.

### 4. Import (on the Wyse)

The server must be stopped (the import refuses while anything answers on the server's port, 8790
unless the home was installed with another, or, on Linux, while any process has the database open).

Linux:

```
sudo systemctl stop blumodel-studio
sudo node /srv/blumodel-studio/app/server/scripts/import-data.mjs /mnt/usb/blumodel-data-<time>.tar --home /srv/blumodel-studio
sudo systemctl start blumodel-studio
```

Run with `sudo`, the import gives everything it puts in place to `blumodel` (the account that owns
the home and runs the server), and makes the database `600` and its folders `700`.

Windows (cmd):

```
cd /d %USERPROFILE%\Projects\BluModelStudio
stop-server.cmd
node app\server\scripts\import-data.mjs D:\blumodel-data-<time>.tar --home %USERPROFILE%\Projects\BluModelStudio
start-server.cmd
```

What it does: checks everything again (as in step 3); puts the database at `data/blumodel.db` and
the uploads in `data/uploads/`; runs this app's migrations (a bundle from the older PC gets the
newer schema here, printed as *applied migrations: …*); prints every table's row count.

- The empty database the Wyse's server made at its first start doesn't count as data: it is set
  aside as `data/blumodel.db.before-import-<time>` and the import goes ahead.
- If the Wyse already has **real** data (the rehearsal's import, say), the import refuses and
  changes nothing. Add `--replace`: what is there is kept as `data/blumodel.db.before-import-<time>`
  (with its `-wal`/`-shm`) and `data/uploads.before-import-<time>/`, never deleted, and the bundle
  goes in its place. Delete those once you're happy.
- If anything fails after the swap (a migration, a full disk), the import puts back what was there
  and keeps what it imported as `*.failed-import-<time>`.
- If the bundle was made by a **newer** version of the app than the Wyse runs, it is refused:
  update the Wyse first (HOSTING.md, the update).

### 5. The settings file (by hand)

`blumodel.env` holds the live Stripe key and the other private settings. It is never in the bundle
unless you ask, never in git, and nothing prints it. Two ways to get it onto the Wyse:

**A. Retype it (recommended for the Stripe key).** On the Wyse, open the template the installer
made and fill it in from the dashboards, as in [LAUNCH.md](LAUNCH.md): a **new** Stripe restricted
key (then delete the old key in Stripe once the Wyse is live, so the copy on the old PC is worthless),
the same `STRIPE_WEBHOOK_SECRET` (the webhook endpoint `https://blumodel.studio/api/webhooks/stripe`
doesn't change), `PUBLIC_URL=https://blumodel.studio`, `TRUST_PROXY=1`, `DEMO_PAYMENTS=0`, the legal
and email settings.

- Linux: `sudo nano /srv/blumodel-studio/blumodel.env`, then `sudo systemctl restart blumodel-studio`.
- Windows (cmd): `notepad %USERPROFILE%\Projects\BluModelStudio\blumodel.env`, then in that folder `stop-server.cmd`, `start-server.cmd`.

**B. Copy the file on the USB stick.** On this PC, copy `%USERPROFILE%\Projects\BluModelStudio\blumodel.env`
to the stick by hand (Explorer or `copy`; don't open it in anything that syncs or previews). Then:

- Linux:

  ```
  sudo install -m 600 -o blumodel -g blumodel /mnt/usb/blumodel.env /srv/blumodel-studio/blumodel.env
  sudo systemctl restart blumodel-studio
  ```

- Windows: copy it to `%USERPROFILE%\Projects\BluModelStudio\blumodel.env`, then make it readable by
  your account only: `icacls "%USERPROFILE%\Projects\BluModelStudio\blumodel.env" /inheritance:r /grant:r "%USERNAME%:F"`,
  then `stop-server.cmd`, `start-server.cmd`.

Then **delete it from the stick** (and empty the stick's recycle bin; on flash, deleting doesn't
wipe, so keep the stick yourself or format it). A file written by Notepad on Windows (CRLF line
ends, a BOM) works unchanged on Linux.

Check it on the Wyse: the top of the new start in `logs/server.log` says `Stripe: LIVE mode` (or why
not), never a key. `npm run stripe:check -- --settings <file>` from the repo checks the Stripe side.

### 6. The tunnel credentials (by hand)

The tunnel `blumodel` keeps its name, its ID and its DNS: only its credentials file moves. Copy
`%USERPROFILE%\.cloudflared\064671cd-a658-4240-8626-c697b9f148ac.json` to the stick by hand. Not
`cert.pem` next to it: running the tunnel doesn't need it (it is for creating and routing tunnels;
leave it on the PC).

- Linux:

  ```
  sudo install -m 600 -o blumodel -g blumodel /mnt/usb/064671cd-a658-4240-8626-c697b9f148ac.json /srv/blumodel-studio/.cloudflared/
  ```

- Windows: copy it into `%USERPROFILE%\.cloudflared\` of the account that runs the tunnel.

Delete it from the stick afterwards.

**Only one machine may run the tunnel.** Cloudflare happily sends visitors to every machine that
runs it, so with both on, some visitors would sign in and pay on the old PC's database and some on
the Wyse's. At the cutover: stop the old PC's tunnel and server first (step 1), then start the
Wyse's tunnel (HOSTING.md, the cutover), then on the old PC disable its tasks so a reboot doesn't
bring them back: `schtasks /Change /TN BluModelTunnel /Disable` and
`schtasks /Change /TN BluModelStudioServer /Disable`.

### (Optional) Everything in one bundle

`--include-secrets` also puts the settings file and the tunnel credentials JSON in the bundle
(never `cert.pem`), and prints a loud warning: move that bundle only over a private channel and
delete it everywhere afterwards.

```
node server\scripts\export-data.mjs --home %USERPROFILE%\Projects\BluModelStudio --out E:\ --include-secrets
```

It finds the settings file in the home and the credentials in `%USERPROFILE%\.cloudflared\`
(or `<home>/.cloudflared/` on Linux); `--settings <file>` and `--tunnel-dir <folder>` name them.
The import still never installs them: it verifies them with everything else and tells you to take
them out by hand, e.g. `tar -xf blumodel-data-<time>.tar blumodel-data-<time>/secrets`, then place
them as in steps 5 and 6.

## Verify

After the import, before the cutover:

1. **The counts.** The import's table counts equal the export's (`users`, `projects`, `files`,
   `orders`…); only migrations may add a table or rows of their own, and it says which ran.
2. **The server.** Linux: `curl -s http://127.0.0.1:8790/api/health`; Windows: open that address.
   `{"ok":true,…,"db":"ok"}`.
3. **The site, on the Wyse itself**, before the tunnel. From your PC through SSH (port 8791 on the
   PC, because the PC's own server still has 8790): `ssh -L 8791:127.0.0.1:8790 you@wyse`, then open
   http://127.0.0.1:8791 on the PC. A Windows Wyse: its own browser at http://127.0.0.1:8790. Sign in
   as yourself, open a kitchen, check an uploaded photo or model shows, open Admin > Users.
4. **After the cutover:** https://blumodel.studio/api/health, sign in, open a kitchen. In Stripe,
   the webhook endpoint shows deliveries succeeding again (Stripe retries any it couldn't deliver
   during the few minutes of downtime, for up to 3 days, so no payment is lost).

`import-data.mjs <bundle> --check` re-verifies a bundle at any time, on either machine.

## Roll back

- **An import that failed** puts the previous data back by itself (it says so), keeping what it
  imported as `*.failed-import-<time>`.
- **An import you want to undo** (the server stopped first):

  Linux:

  ```
  sudo systemctl stop blumodel-studio
  cd /srv/blumodel-studio/data
  sudo mv blumodel.db blumodel.db.undone && sudo mv uploads uploads.undone
  sudo mv blumodel.db.before-import-<time> blumodel.db
  sudo mv uploads.before-import-<time> uploads
  sudo systemctl start blumodel-studio
  ```

  (and `blumodel.db.before-import-<time>-wal` / `-shm` to `blumodel.db-wal` / `-shm` if they exist).
  Windows: the same renames in `%USERPROFILE%\Projects\BluModelStudio\data` (`ren`, or Explorer),
  between `stop-server.cmd` and `start-server.cmd`.

- **The whole move.** The export only reads: the old PC still has all its data, untouched. To go
  back to it: stop the Wyse's tunnel (Linux `sudo systemctl disable --now blumodel-tunnel`; Windows
  `stop-tunnel.cmd` in its home, then `schtasks /Change /TN BluModelTunnel /Disable`), then on the
  old PC re-enable and start its tasks
  (`schtasks /Change /TN BluModelStudioServer /Enable`, the same for `BluModelTunnel`, then
  `start-server.cmd` and `start-tunnel.cmd`). Anything customers did on the Wyse since the cutover is
  only on the Wyse: carry it back the same way (export there, `import-data … --replace` here).
- **The code** (a new version that misbehaves): HOSTING.md, rolling back the app (`deploy-local --rollback` puts `app.previous` back).

## Backups on the new machine

The server keeps making its own daily copy (`data/backups/daily/`, 14 kept) and an uploads mirror,
on the same disk. `restore.mjs` puts one back on either OS (OPERATIONS.md, "Backups and restore"):

```
sudo -u blumodel node /srv/blumodel-studio/app/server/scripts/restore.mjs --home /srv/blumodel-studio --list
```

A data bundle is also the best off-machine backup: run the export now and then to a stick you keep
elsewhere (`--out /mnt/usb` on Linux; it is safe while the server runs). A Wyse's eMMC can fail like
any disk.

## Reference

`node server/scripts/export-data.mjs [options]`

| Option | |
| --- | --- |
| `--home <dir>` | the home whose `data/` to export (else `--db <file>` [`--uploads <dir>`], else `DB_PATH` / `UPLOAD_DIR`, else the home the script runs from) |
| `--out <folder or file.tar>` | where to write; default `<data>/backups/exports/`. Refused inside a git checkout or the uploads folder |
| `--folder` | a plain folder instead of a `.tar` |
| `--include-secrets` | also `blumodel.env` and the tunnel's `<id>.json` (`--settings <file>`, `--tunnel-dir <folder>`) |

`node server/scripts/import-data.mjs <bundle.tar or folder> [options]`

| Option | |
| --- | --- |
| `--check` | verify only, change nothing |
| `--home <dir>` | the home to import into (else `--db` / `--uploads`, `DB_PATH` / `UPLOAD_DIR`, the home the script runs from) |
| `--replace` | import over existing data, keeping it as `*.before-import-<time>` |
| `--port <n>` | the server's port, for the "is it stopped?" check (default: the port the home was installed with, read from its `run-server.cmd` or `blumodel-studio.service`, else 8790) |

The same from the repo: `npm run data:export -- …`, `npm run data:import -- …`, and
`npm run data:restore -- …` for `restore.mjs`. Exit codes: 0 done, 1 refused or failed (nothing
changed, or put back as it was), 2 wrong options.

`manifest.json`:

| Field | |
| --- | --- |
| `format`, `formatVersion` | `blumodel-data`, `1` |
| `createdAt` | when the database copy was made (UTC) |
| `app` | `name`, `version`, `commit` of the app that made it |
| `source` | the OS and Node version it was made on (no host name, user or path) |
| `schema` | `migrations` (count), `latest`, `ids`: the migrations the database had run |
| `tables` | row count per table, checked again on import |
| `uploads` | `files`, `bytes`, `referenced` (by the database), `missing` (referenced but already absent where it was made) |
| `secrets` | the secret files included (empty unless `--include-secrets`) |
| `files` | `path`, `size`, `sha256` of every file in the bundle |

On Linux, everything the scripts write is `600` (files) and `700` (folders). Run them with `sudo`
(they give what they put in the home to `blumodel`) or as `sudo -u blumodel`; a bundle in your own
home folder is readable only by `sudo`.
