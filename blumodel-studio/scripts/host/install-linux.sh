#!/usr/bin/env bash
# Installs BluModel Studio on Ubuntu Server 24.04 LTS or Debian 12 (a Dell Wyse 5070, or any
# x86-64 machine), or brings an existing install up to date. Run it again at any time: every step
# checks first and only does what is missing. docs/HOSTING.md is the runbook.
#
#   sudo bash install-linux.sh [--dry-run] [--home /srv/blumodel-studio] [--branch blumodel-studio]
#                              [--repo https://github.com/gabrieldocherty-ux/hubs.git] [--port 8790]
#
# What it does, in order:
#   1. checks the machine: root, Ubuntu or Debian with systemd, the CPU, RAM + swap for the build
#   2. apt: ca-certificates curl gnupg git; Node.js 24 from NodeSource's apt repository (unless
#      node 24 or newer is there); cloudflared from Cloudflare's apt repository (unless it is there)
#   3. the 'blumodel' system account (no login shell, home = the BluModel home) and the home:
#      <home> (750), data/ and logs/ (750), .cloudflared/ (700), all owned by blumodel. The server's
#      log and database files are mode 600 (blumodel's only): an admin reads them with sudo
#   4. the code: a sparse, partial clone of just blumodel-studio/ on the branch into <home>/repo,
#      or a fast-forward of the one already there (both as blumodel)
#   5. npm ci and the build (scripts/host/build.mjs, which refuses with the fix when RAM + swap is
#      too small for it), as blumodel
#   6. the systemd units (scripts/register-tasks.mjs): blumodel-studio.service enabled,
#      blumodel-tunnel.service installed but NOT enabled (enabling it is the cutover)
#   7. the deploy (scripts/deploy-local.mjs): backs up an existing database first, puts the app in
#      <home>/app (keeping the old one as app.previous), writes the settings template only if there
#      is no blumodel.env, starts the server and checks http://127.0.0.1:<port>/api/health
#   8. cloudflared.yml (scripts/tunnel/setup-tunnel.mjs --validate, an offline check)
#   9. prints what is left for you: the settings, the tunnel's credentials, the data, the cutover,
#      the wildcard DNS record for the showrooms
# It never starts the tunnel, never opens blumodel.env or the tunnel's credentials, and never
# copies anything from another machine.
#
# --dry-run prints every command it would run (the lines starting with +) and runs none of them.
# The checks it makes to decide what to do (id, command -v, dpkg -s, /etc/os-release,
# /proc/meminfo, df, git status) only read.

set -euo pipefail
umask 022

HOME_DIR=/srv/blumodel-studio
BRANCH=blumodel-studio
REPO=https://github.com/gabrieldocherty-ux/hubs.git
# Empty: the port this home already uses (its blumodel-studio.service), else 8790.
PORT=
# Where register-tasks writes the server unit (BLUMODEL_SERVER_UNIT_FILE is for the tests).
UNIT_FILE="${BLUMODEL_SERVER_UNIT_FILE:-/etc/systemd/system/blumodel-studio.service}"
SVC_USER=blumodel
NODE_MAJOR=24
DRY_RUN=0
ARGS="$*"

usage() {
  echo "Usage: sudo bash install-linux.sh [--dry-run] [--home /srv/blumodel-studio] [--branch blumodel-studio] [--repo <git url>] [--port 8790]"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --home) HOME_DIR="${2:?--home needs a folder}"; shift ;;
    --branch) BRANCH="${2:?--branch needs a branch name}"; shift ;;
    --repo) REPO="${2:?--repo needs a git URL}"; shift ;;
    --port) PORT="${2:?--port needs a number}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
# Prints a command, then runs it (not in a dry run).
run() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
  if [ "$DRY_RUN" = 0 ]; then "$@"; fi
}
# Runs a command as the blumodel account in a folder, with its own HOME (git config, npm cache).
as_svc_in() {
  local dir="$1"
  shift
  run runuser -u "$SVC_USER" -- env -C "$dir" HOME="$HOME_DIR" PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$@"
}
# The same, quietly, for a question (its output is the answer). Never used in a dry run.
svc_q() {
  runuser -u "$SVC_USER" -- env HOME="$HOME_DIR" PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$@"
}
# Writes a small file (apt sources and pins).
write_file() {
  printf '+ write %s (mode %s): %s\n' "$1" "$2" "$3"
  if [ "$DRY_RUN" = 0 ]; then
    printf '%s\n' "$3" > "$1"
    chmod "$2" "$1"
  fi
}
# Downloads an apt signing key into a keyring (dearmored when it is ASCII-armoured).
fetch_key() {
  if [ "$3" = armored ]; then
    printf '+ curl -fsSL %s | gpg --dearmor --yes -o %s\n' "$1" "$2"
    if [ "$DRY_RUN" = 0 ]; then curl -fsSL "$1" | gpg --dearmor --yes -o "$2"; chmod 0644 "$2"; fi
  else
    run curl -fsSL "$1" -o "$2"
    if [ "$DRY_RUN" = 0 ]; then chmod 0644 "$2"; fi
  fi
}
node_major() {
  if command -v node >/dev/null 2>&1; then
    node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'
  else
    echo 0
  fi
}

# The same rules the systemd units check: an absolute path systemd needs no quoting for.
case "$HOME_DIR" in
  /*) ;;
  *) die "--home must be an absolute path (got $HOME_DIR)." ;;
esac
if ! [[ "$HOME_DIR" =~ ^/[A-Za-z0-9._/@+-]+$ ]] || [[ "$HOME_DIR" == *..* ]]; then
  die "--home may use letters, digits and . _ - / @ + only (got $HOME_DIR)."
fi
HOME_DIR="${HOME_DIR%/}"
PORT_FROM=""
if [ -z "$PORT" ]; then
  # A home installed with --port keeps it when the install runs again without one: its unit says
  # which (only the unit whose database is this home's).
  if [ -r "$UNIT_FILE" ] && grep -qxF "Environment=DB_PATH=$HOME_DIR/data/blumodel.db" "$UNIT_FILE"; then
    PORT="$(sed -n 's/^Environment=PORT=\([0-9]\{1,5\}\)$/\1/p' "$UNIT_FILE" | head -n 1)"
    if [ -n "$PORT" ]; then PORT_FROM="this home's, from $UNIT_FILE"; fi
  fi
  PORT="${PORT:-8790}"
fi
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] || die "--port must be a number (got $PORT)."
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || die "Not a branch name: $BRANCH"
REPO_DIR="$HOME_DIR/repo"
APP_SRC="$REPO_DIR/blumodel-studio"

if [ "$DRY_RUN" = 1 ]; then
  echo "DRY RUN: every command is printed (+) and none is run."
fi

# -- 1. the machine ----------------------------------------------------------
say "Checking this machine"
if [ "$(id -u)" != 0 ]; then
  if [ "$DRY_RUN" = 1 ]; then note "(running as $(id -un); a real run needs sudo)"; else die "Run it with sudo: sudo bash $0 $ARGS"; fi
fi
OS_ID=unknown
OS_VER=unknown
if [ -r /etc/os-release ]; then
  OS_ID="$(. /etc/os-release && printf '%s' "${ID:-unknown}")"
  OS_VER="$(. /etc/os-release && printf '%s' "${VERSION_ID:-unknown}")"
fi
case "$OS_ID:$OS_VER" in
  ubuntu:24.04|debian:12) note "OS: $OS_ID $OS_VER" ;;
  ubuntu:*|debian:*) note "OS: $OS_ID $OS_VER (written for Ubuntu 24.04 and Debian 12; carrying on)" ;;
  *)
    if [ "$DRY_RUN" = 1 ]; then note "OS: $OS_ID $OS_VER (not Ubuntu or Debian; a real run stops here)"
    else die "This is for Ubuntu Server 24.04 LTS or Debian 12 (found $OS_ID $OS_VER). docs/HOSTING.md lists what it does, to do by hand elsewhere."; fi
    ;;
esac
if ! command -v systemctl >/dev/null 2>&1; then
  if [ "$DRY_RUN" = 1 ]; then note "systemd: not found (a real run stops here)"; else die "systemd is needed (systemctl not found)."; fi
fi
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) note "CPU: $ARCH" ;;
  aarch64|arm64) note "CPU: $ARCH (Node.js and cloudflared have arm64 packages; carrying on)" ;;
  *) if [ "$DRY_RUN" = 1 ]; then note "CPU: $ARCH (unsupported)"; else die "Unsupported CPU: $ARCH (x86-64 or arm64)."; fi ;;
esac
if [ -r /proc/meminfo ]; then
  MEM_KB="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
  SWAP_KB="$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)"
  TOTAL_MB=$(( (${MEM_KB:-0} + ${SWAP_KB:-0}) / 1024 ))
  note "RAM + swap: ${TOTAL_MB} MB"
  if [ "$TOTAL_MB" -lt 2048 ]; then
    echo "    The build needs about 2048 MB of RAM + swap. Add a 2 GB swap file, then run this again:"
    echo "      sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"
    echo "      echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
    [ "$DRY_RUN" = 1 ] || exit 1
  fi
fi
FREE_MB="$(df -Pm / 2>/dev/null | awk 'NR == 2 {print $4}')"
if [ -n "$FREE_MB" ]; then
  note "Free disk on /: ${FREE_MB} MB"
  if [ "$FREE_MB" -lt 2048 ]; then note "WARNING: under 2 GB free. The code and its dependencies take about 500 MB, and the database, uploads and their backups grow from there."; fi
fi

# -- 2. packages -------------------------------------------------------------
say "Packages"
NEED=()
for p in ca-certificates curl gnupg git; do
  dpkg -s "$p" >/dev/null 2>&1 || NEED+=("$p")
done
APT_UPDATED=0
apt_update() {
  if [ "$APT_UPDATED" = 0 ]; then run apt-get update; APT_UPDATED=1; fi
}
if [ "${#NEED[@]}" -gt 0 ]; then
  apt_update
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y "${NEED[@]}"
else
  note "ca-certificates, curl, gnupg, git: installed"
fi

if [ "$(node_major)" -ge "$NODE_MAJOR" ]; then
  note "Node.js $(node --version): ok"
else
  note "Installing Node.js $NODE_MAJOR from NodeSource's apt repository (found: $(node --version 2>/dev/null || echo none))"
  run install -d -m 0755 /etc/apt/keyrings
  fetch_key https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key /etc/apt/keyrings/nodesource.gpg armored
  write_file /etc/apt/sources.list.d/nodesource.list 0644 "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main"
  # Prefer NodeSource's nodejs over the distribution's older one.
  write_file /etc/apt/preferences.d/nodejs 0644 "Package: nodejs
Pin: origin deb.nodesource.com
Pin-Priority: 600"
  APT_UPDATED=0
  apt_update
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  if [ "$DRY_RUN" = 0 ] && [ "$(node_major)" -lt "$NODE_MAJOR" ]; then die "Node.js $NODE_MAJOR did not install (node --version: $(node --version 2>&1 || true))."; fi
fi

if command -v cloudflared >/dev/null 2>&1; then
  note "cloudflared: $(cloudflared --version 2>/dev/null | head -n 1)"
else
  note "Installing cloudflared from Cloudflare's apt repository"
  run install -d -m 0755 /usr/share/keyrings
  fetch_key https://pkg.cloudflare.com/cloudflare-main.gpg /usr/share/keyrings/cloudflare-main.gpg binary
  write_file /etc/apt/sources.list.d/cloudflared.list 0644 "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main"
  APT_UPDATED=0
  apt_update
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y cloudflared
fi

# -- 3. the account and the home ---------------------------------------------
say "The $SVC_USER account and the home ($HOME_DIR)"
if id -u "$SVC_USER" >/dev/null 2>&1; then
  note "account $SVC_USER: exists"
else
  run useradd --system --user-group --home-dir "$HOME_DIR" --no-create-home --shell /usr/sbin/nologin --comment "BluModel Studio" "$SVC_USER"
fi
run install -d -m 0750 -o "$SVC_USER" -g "$SVC_USER" "$HOME_DIR" "$HOME_DIR/data" "$HOME_DIR/logs"
run install -d -m 0700 -o "$SVC_USER" -g "$SVC_USER" "$HOME_DIR/.cloudflared"

# -- 4. the code -------------------------------------------------------------
say "The code: $REPO, branch $BRANCH, only blumodel-studio/"
if [ -d "$REPO_DIR/.git" ]; then
  if [ "$DRY_RUN" = 0 ]; then
    CHANGES="$(svc_q git -C "$REPO_DIR" status --porcelain --untracked-files=no)"
    [ -z "$CHANGES" ] || die "The checkout in $REPO_DIR has local changes (git -C $REPO_DIR status). Undo them, then run this again."
  fi
  as_svc_in "$REPO_DIR" git sparse-checkout set blumodel-studio
  as_svc_in "$REPO_DIR" git fetch origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
  if [ "$DRY_RUN" = 1 ] || svc_q git -C "$REPO_DIR" show-ref --verify --quiet "refs/heads/$BRANCH"; then
    as_svc_in "$REPO_DIR" git checkout "$BRANCH"
  else
    as_svc_in "$REPO_DIR" git checkout --track -b "$BRANCH" "origin/$BRANCH"
  fi
  as_svc_in "$REPO_DIR" git merge --ff-only "origin/$BRANCH"
else
  as_svc_in "$HOME_DIR" git clone --filter=blob:none --sparse --branch "$BRANCH" --single-branch "$REPO" "$REPO_DIR"
  as_svc_in "$REPO_DIR" git sparse-checkout set blumodel-studio
fi
if [ "$DRY_RUN" = 1 ]; then COMMIT="<commit>"; else COMMIT="$(svc_q git -C "$REPO_DIR" rev-parse --short HEAD)"; fi
note "commit $COMMIT"

# -- 5. dependencies and the build -------------------------------------------
say "Dependencies (npm ci) and the build"
as_svc_in "$APP_SRC" npm ci --no-audit --no-fund
as_svc_in "$APP_SRC" node scripts/host/build.mjs --out dist

# -- 6. the systemd units ----------------------------------------------------
say "The systemd units"
NODE_BIN="$(command -v node || echo /usr/bin/node)"
CF_BIN="$(command -v cloudflared || echo /usr/bin/cloudflared)"
run node "$APP_SRC/scripts/register-tasks.mjs" --home "$HOME_DIR" --user "$SVC_USER" --port "$PORT" --node "$NODE_BIN" --cloudflared "$CF_BIN"

# -- 7. the deploy -----------------------------------------------------------
say "The deploy (backs up an existing database first, starts the server, checks its health)"
if ! run env BLUMODEL_HOME="$HOME_DIR" BLUMODEL_PORT="$PORT" node "$APP_SRC/scripts/deploy-local.mjs" --dist "$APP_SRC/dist" --commit "$COMMIT"; then
  die "The deploy did not finish healthy. Look at: journalctl -u blumodel-studio -n 50, and $HOME_DIR/logs/server.log. If an older app was there: sudo node $APP_SRC/scripts/deploy-local.mjs --rollback"
fi

# -- 8. the tunnel's config --------------------------------------------------
say "The tunnel's config (written, checked offline; the tunnel is NOT started)"
if ! run node "$APP_SRC/scripts/tunnel/setup-tunnel.mjs" --home "$HOME_DIR" --port "$PORT" --validate; then
  note "WARNING: the tunnel config did not validate; see the lines above (docs/HOSTING.md, \"Move the tunnel\")."
fi

# -- 9. what is left ---------------------------------------------------------
TUNNEL_ID="064671cd-a658-4240-8626-c697b9f148ac"
say "Installed. What is left (docs/HOSTING.md has each step):"
cat <<EOF
  The site runs on this machine at http://127.0.0.1:$PORT (curl -s http://127.0.0.1:$PORT/api/health).
  It is NOT public yet: the tunnel is off until the cutover.

  1. Settings: sudo nano $HOME_DIR/blumodel.env   (paste a NEW Stripe key here, nowhere else),
     then: sudo systemctl restart blumodel-studio
  2. The tunnel's credentials: copy $TUNNEL_ID.json yourself into $HOME_DIR/.cloudflared/, then
       sudo chown $SVC_USER:$SVC_USER $HOME_DIR/.cloudflared/$TUNNEL_ID.json
       sudo chmod 600 $HOME_DIR/.cloudflared/$TUNNEL_ID.json
  3. The data from the old machine: docs/MOVING_DATA.md
  4. The cutover (stop the old machine's server and tunnel FIRST, then):
       sudo systemctl enable --now blumodel-tunnel
  5. Showrooms (once, in Cloudflare): the wildcard DNS record *.blumodel.studio for the tunnel, and
     the demo showroom: sudo -u $SVC_USER node $HOME_DIR/app/server/scripts/seed-demo-tenant.mjs
     (docs/ONBOARDING_A_COMPANY.md, "Once: Cloudflare")
  Updates later: sudo bash $APP_SRC/scripts/host/update-linux.sh
  Logs: sudo tail -f $HOME_DIR/logs/server.log   sudo journalctl -u blumodel-studio -u blumodel-tunnel -f
EOF
if [ "$DRY_RUN" = 1 ]; then echo; echo "Dry run: nothing was installed, written, started or changed."; fi
