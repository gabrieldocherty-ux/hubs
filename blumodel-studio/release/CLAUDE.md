# BluModel Studio on this machine (the Wyse)

This checkout is the **release branch** (`blumodel-studio`) of BluModel Studio, installed on the
small server that runs https://blumodel.studio. It is prebuilt: nothing is built here.

**Read [WYSE_SETUP.md](WYSE_SETUP.md) first and follow it.** It is written for you, a Claude Code
session running on this machine: the exact, ordered, repeatable steps to install, move the data,
switch the tunnel over, turn on the daily automatic update, verify, and roll back.

The rules that matter most (WYSE_SETUP.md, "Safety rules for this session", has all of them):

- Never open, read, print or ask for `blumodel.env` or the tunnel's credentials. Gabe pastes his
  secrets himself; you only check that the file exists and has the right permissions.
- Never delete or overwrite anything in `/srv/blumodel-studio/data/`.
- Never force-push, never `git reset --hard`, never edit files in this checkout: changes are made on
  a developer's machine and published with `npm run release`.
- Ask Gabe before the cutover (starting the tunnel here) and before anything that stops the site.

Full runbook: `blumodel-studio/docs/HOSTING.md`. Moving the data: `blumodel-studio/docs/MOVING_DATA.md`.
