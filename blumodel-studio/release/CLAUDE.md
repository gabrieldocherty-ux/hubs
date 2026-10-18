# BluModel Studio on this machine (the Wyse)

This checkout is the **release branch** (`blumodel-studio`) of BluModel Studio, on the small server
that runs https://blumodel.studio: a Dell Wyse 5070 on Windows 11 Pro. Releases are prebuilt:
nothing is built here.

**Read [WYSE_SETUP.md](WYSE_SETUP.md) first and follow it.** It is written for you, a Claude Code
session running on this machine: the exact, ordered, repeatable steps to install, move the data,
switch the tunnel over, turn on the daily automatic update, verify, roll back, and finish. It marks
which steps you run (unelevated) and which Gabe runs in an administrator PowerShell.

The rules that matter most (WYSE_SETUP.md, "Safety rules for this session", has all of them):

- Never open, read, print or ask for `blumodel.env`, the tunnel's credentials, the deploy key or any
  passphrase. Gabe types his secrets himself; you only check that files exist.
- Never delete or overwrite anything in the home's `data\` folder.
- Never force-push, never `git reset --hard`, never edit files in the checkout: changes are made on
  Gabe's PC and published with `npm run release`.
- Never register or change scheduled tasks yourself; ask Gabe before the cutover (starting the
  tunnel here) and before anything that stops the site.

Full runbook: `blumodel-studio/docs/HOSTING.md`. Moving the data: `blumodel-studio/docs/MOVING_DATA.md`.
