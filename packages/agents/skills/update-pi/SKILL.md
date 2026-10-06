---
disable-model-invocation: true
name: update-pi
description: Use when updating the Pi coding agent itself, its pinned versions in the OnurPi repository, or installed Pi packages, and when verifying that Pi still starts after an update. Covers version selection, workspace pin bumps, the global install, package updates, startup checks, repo checks, and the commit and push to OnurPi main.
---

# Update Pi

This procedure updates the installed Pi coding agent, the Pi version pins in the OnurPi
repository, and the installed Pi packages. It ends with proof that Pi starts and a push to
OnurPi `main`.

## Layout

- The OnurPi checkout lives at `~/repos/onurpi`. It pins Pi in the root `package.json` and in
  most `packages/*/package.json` files.
- The global `pi` binary is an npm global install under the vite-plus Node prefix. Confirm the
  prefix with `npm config get prefix`; expect `~/.vite-plus/js_runtime/node/<version>`.
- Installed Pi packages are listed by `pi list`. Local OnurPi packages load from the checkout by
  path and need no separate install step.

## Procedure

1. Pull the latest OnurPi changes. Run `git -C ~/repos/onurpi pull --ff-only` on `main` with a
   clean tree.
2. Pick the target version. Run `npm view @earendil-works/pi-coding-agent version` and check
   `@earendil-works/pi-ai` and `@earendil-works/pi-tui` as well. The three packages release in
   lockstep. Keep them on the same version.
3. Bump every exact pin of the three packages to the target version. Search with
   `grep -rn '"@earendil-works/pi-' --include=package.json packages` from the repository root.
   Change only exact pins such as `"1.0.0"`. Leave peerDependency ranges (`"*"`, `">="`) alone.
   One package may pin Pi in `dependencies` rather than `devDependencies`; bump it too, because
   the whole workspace tracks one Pi version.
4. Refresh the install. Run `npm install` in the repository root. Then run
   `npm install-scripts ls`. If a package with a native build lost its `build` output (for
   example `@homebridge/node-pty-prebuilt-multiarch`, which breaks `packages/restart` e2e
   tests), approve its script with `npm install-scripts approve <package>` and run
   `npm rebuild <package>`.
5. Update the installed Pi binary. Run `pi update --self`. If it cannot update, install the
   exact version directly: `npm install -g @earendil-works/pi-coding-agent@<version>`. On a
   global npm install, `pi update --self` may only recommend the pi.dev installer; the explicit
   npm command always works.
6. Update installed Pi packages. Run `pi update --extensions`. This updates unpinned packages
   only. Then compare `pi list` with `npm view <package> version` for each npm source. A source
   pinned to an exact version, such as `npm:pi-web-access@0.34.0`, needs an explicit
   `pi install npm:<package>@<new-version>`.
7. Verify that Pi starts. First check `pi --version` reports the target version. Then start the
   real TUI inside the OnurPi checkout so the root manifest loads every extension:

   ```sh
   cd ~/repos/onurpi && pi -a --no-session --no-context-files
   ```

   Press `ctrl+o` to show the loaded resources. Confirm the footer shows the new version, the
   full extension and skill lists load, and no errors appear. Exit with `ctrl+c` or `ctrl+d`.
8. Run the repository checks: `npm run check`, `npm run slophammer`, and `git diff --check`.
   ESLint can exceed the default 4 GB heap on this machine; rerun it with
   `NODE_OPTIONS=--max-old-space-size=8192 npm run lint`.
   Known failures on this machine that are not caused by a Pi bump: three ESLint errors in
   `scripts/sync-settings.ts` and its test, vitest failures that compare `/var/folders` paths
   against `/private/var/folders` canonical paths, and three slophammer findings for
   `packages/context-ceiling/.github/workflows`. Before you attribute any failure to the bump,
   stash your changes with `git stash`, rerun the failing check on pristine `main`, and compare.
   Reinstall your changes with `git stash pop` afterwards.
9. Commit and push. Use `chore(deps): adopt pi <version> across the workspace`. Per the
   repository rules, a version update that adopts a reviewed upstream release goes straight to
   `main`: commit and `git push origin main`. Do not open a pull request.
10. If instruction or skill sources changed in the same session, run `npm run sync` and
    `npm run agents:check` so the installed copies match, then restart or reload the agent.

## Notes

- Updating the global binary while a Pi session runs is safe: the running process keeps its
  loaded bundle. New sessions pick up the new version.
- The bump that moves the workspace pins can surface real API breaks in extensions. TypeScript
  errors about a missing `ExtensionAPI` member mean a package still resolves a stale nested
  copy of `pi-coding-agent`; a pin you missed usually causes it. Fix the pin, rerun
  `npm install`, and recheck.
- `@osolmaz/pi-workflows` is pinned separately from the Pi trio. Update it only when a release
  exists and the task asks for it.
