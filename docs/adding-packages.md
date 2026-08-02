# Adding packages to OnurPi

OnurPi loads every extension, skill, prompt, and theme through an independent package under
`packages/`. This keeps local development, the tracked settings file, and the Git-installed root
package on the same resource graph.

## Package choice

Create a local package when the code is maintained in OnurPi. Put the implementation, Pi manifest,
tests, and user README in that package.

Create a private wrapper package when OnurPi loads an extension maintained in another repository. A
wrapper keeps the upstream pin and integration code beside the Pi entry point that OnurPi actually
loads.

Use an exact npm version for a reviewed release or an immutable Git commit for unreleased source.
Follow [VENDORING.md](../VENDORING.md) when the dependency is small, unfamiliar, or better kept as
reviewed source files.

## Required files

A package that loads an extension needs:

```text
packages/<name>/
├── package.json
├── index.ts
├── index.test.ts
└── README.md
```

Add `UPSTREAM.md` for a wrapper or vendored package. Record the repository, exact version or commit,
license, reviewed behavior, and local integration code.

Set `private: true` unless the package has an explicit release plan. Adding a package to OnurPi does
not authorize publishing it to npm. Publish only packages that are useful independently, have stable
public contracts, and have separate release approval and automation.

## Dependency placement

Put an external extension dependency in the wrapper package that imports it:

```json
{
  "name": "@onurpi/example",
  "private": true,
  "dependencies": {
    "pi-example": "https://codeload.github.com/owner/pi-example/tar.gz/<commit>"
  },
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

The root package contains workspace tooling and the root Pi resource list. It must not own external
extension dependencies or load `./node_modules/...` entry points directly. Root `node_modules` paths
bypass the per-package settings generated for local development, which can leave an extension
present on disk but absent from Pi.

## Root registration

Register the package entry point in the root `package.json`:

```json
{
  "pi": {
    "extensions": ["./packages/example/index.ts"]
  }
}
```

Every root resource path must start with `./packages/<name>/`. The same package may provide more
than one resource type; settings synchronization deduplicates its package path.

## Settings synchronization

The live settings file may point at the main checkout or a worktree during development. Generate
canonical settings with the repository scripts:

```bash
npm run settings:reset
npm run settings:sync
```

`settings:reset` rewrites repo-owned live entries to `../../repos/onurpi/packages/<name>`.
`settings:sync` writes the normalized live settings to the tracked `settings.json`. Do not edit the
tracked file by hand.

After synchronization, run `pi list`. Every registered package must appear as its canonical local
path. Run `/reload` in an existing Pi session before checking commands, tools, providers, skills, or
themes.

## Checks

Before opening a pull request:

1. Install dependencies with `npm install` and review lockfile changes.
2. Run the package tests, including a test that imports the extension factory.
3. Run `npm run settings:reset` and `npm run settings:sync`.
4. Run `pi list` and exercise the restored resource in a fresh or reloaded Pi process.
5. Run `npm run check`, `npm run slophammer`, and `git diff --check`.
6. Push the branch, run Pi Reviewer against the base branch, and check CI.

The repository tests reject root `node_modules` resource paths and verify that every root resource
maps to an existing package and canonical settings entry.
