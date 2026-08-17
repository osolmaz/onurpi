---
name: pi-coding-agent
description: Use for any task involving the Pi coding agent, including browsing or installing Pi packages; creating, reviewing, testing, or debugging extensions; managing skills, prompts, themes, settings, sessions, models, providers, SDK integrations, TUI components, keybindings, or local Pi state; and answering questions about Pi behavior or APIs.
---

# Pi Coding Agent

Use the installed Pi documentation and examples as the authoritative reference.
Do not rely on remembered APIs when the current installation can be inspected.

## Required Companion Skill For Behavior Changes

Load and follow the `extending-pi` skill alongside this skill whenever a task
proposes, designs, implements, reviews, or debugs a change to Pi behavior. This
includes deciding between an extension and Pi core, and requests for an
"elegant," "long-term," "production-ready," "ideal," or "holy grail"
solution.

Do not produce an architecture proposal for changing Pi behavior until
`extending-pi` has been read. A request to change behavior does not authorize a
Pi source or internal change.

Treat the regular Pi model and its documented tools as part of the existing
architecture. Before adding a deterministic API or integration, check whether
the model can already observe the target and submit the result through a public
tool. In particular, Pi Workflows monitoring uses the regular Pi model and the
existing `workflow update` and `submit` actions. It does not require monitored
targets or providers to know about Pi.

## Locate the Installed Documentation

Resolve the package from the active `pi` executable instead of hardcoding a
Node version:

```bash
PI_ENTRY="$(readlink -f "$(command -v pi)")"
PI_ROOT="$(dirname "$(dirname "$PI_ENTRY")")"
test -f "$PI_ROOT/README.md"
test -d "$PI_ROOT/docs"
test -d "$PI_ROOT/examples"
printf '%s\n' "$PI_ROOT"
```

If `readlink -f` is unavailable, resolve the executable with the platform's
realpath tool or inspect `command -v pi` and its symlink target manually. Confirm
that the resulting directory is the `@earendil-works/pi-coding-agent` package
root before using it.

## Documentation Rules

- Read relevant Markdown files completely before answering or implementing.
- Follow links to related local documentation before coding. In particular,
  read `docs/tui.md` for TUI APIs used by an extension.
- Read the matching examples under `$PI_ROOT/examples` as well as the docs.
- Treat `$PI_ROOT/README.md`, `$PI_ROOT/docs`, and `$PI_ROOT/examples` as one
  version-matched source set.
- Prefer the installed version's behavior over online snippets or examples from
  another release.
- Use `rg` to locate a topic, then use the `read` tool to read each relevant
  file. Do not substitute partial `head`, `sed`, or `cat` output for complete
  documentation reads.

## Documentation Routing

Start with these files and follow their cross-references:

| Task | Read completely |
|---|---|
| Installation, first use, authentication | `docs/quickstart.md`, then `docs/providers.md` as needed |
| Daily CLI use and context files | `docs/usage.md` |
| Settings | `docs/settings.md` |
| Extensions and custom tools | `docs/extensions.md`, `examples/extensions/README.md`, and relevant examples |
| TUI components or custom rendering | `docs/extensions.md`, `docs/tui.md`, and relevant extension examples |
| Skills | `docs/skills.md` |
| Prompt templates | `docs/prompt-templates.md` |
| Themes | `docs/themes.md` |
| Keybindings | `docs/keybindings.md` |
| Packages and distribution | `docs/packages.md` |
| SDK embedding | `docs/sdk.md` and relevant examples |
| Custom providers | `docs/custom-provider.md`, `docs/models.md`, and provider examples |
| Models and model configuration | `docs/models.md`, `docs/providers.md` |
| Sessions and compaction | `docs/sessions.md`, `docs/session-format.md`, `docs/compaction.md` |
| RPC or JSON integration | `docs/rpc.md` or `docs/json.md` and relevant examples |
| Security and project trust | `docs/security.md` plus the resource-specific docs |
| Platform or terminal behavior | the matching `terminal-setup.md`, `tmux.md`, `windows.md`, or `termux.md` file |

Read `$PI_ROOT/README.md` when the task spans several areas or the correct route
is unclear.

## Browse Packages and Extensions

Pi packages can contain extensions, skills, prompt templates, and themes. The
public gallery is `https://pi.dev/packages`; npm packages intended for Pi use
the `pi-package` keyword.

For discovery, resolve bundled script paths against the directory containing
this `SKILL.md`:

```bash
pi list
python3 scripts/browse_pi_packages.py "SEARCH_TERMS" --pages 3
python3 scripts/browse_pi_packages.py "SEARCH_TERMS" --pages 3 --type extension --json
npm search --json --searchlimit=50 "pi-package SEARCH_TERMS"
```

The helper reads public gallery metadata without installing packages. Increase
`--pages` or continue from a later `--page` when needed rather than treating the
first page as exhaustive. Also inspect candidate detail pages directly.

For every serious candidate:

1. Inspect its gallery page, npm metadata, source repository, current release,
   license, maintenance activity, dependencies, and declared Pi resources.
2. Match the package's documented Pi compatibility to the installed
   `pi --version`.
3. Read the extension entry points and package scripts before installation.
4. Look specifically for process execution, shell hooks, filesystem access,
   network calls, credential access, telemetry, provider request interception,
   tool overrides, project-trust handlers, and lifecycle-started background
   resources.
5. Compare candidates by task fit and risk, not popularity alone.

Useful metadata commands:

```bash
pi --version
npm view PACKAGE --json
npm view PACKAGE dist.tarball repository scripts dependencies peerDependencies --json
```

Do not install a package merely to inspect it. Registry tarballs can be fetched
and unpacked into a temporary directory without executing package scripts:

```bash
url="$(npm view PACKAGE dist.tarball)"
tmp="$(mktemp -d)"
curl -fsSL "$url" -o "$tmp/package.tgz"
tar -xzf "$tmp/package.tgz" -C "$tmp"
```

Treat all third-party extensions as arbitrary code with the user's full system
permissions. Gallery inclusion, download counts, or a `pi-package` keyword are
not security endorsements.

## Install and Manage Packages

Only install, update, remove, or enable packages when the user asks for that
state change. Choose global versus project-local scope deliberately.

For small extensions with little adoption or operational history, default to
vendoring and auditing the source before installation. In the OnurPi repository,
put the reviewed copy under `packages/`, record the upstream URL, immutable
commit, retrieval date, license, and local changes, then install the local
package path. Strip unrelated code and dependencies. A mature package
with established maintainers, releases, and meaningful usage may be installed
from a pinned registry version or Git commit after the same source review. An
explicit user request for a direct remote install overrides this preference.

```bash
pi install npm:PACKAGE
pi install npm:PACKAGE@VERSION
pi install git:github.com/OWNER/REPO@REF
pi install npm:PACKAGE -l
pi list
pi config
pi update --extensions
pi remove npm:PACKAGE
```

Use an exact npm version or git tag/commit when reproducibility matters. Explain
that pinned sources do not advance during normal package updates. After a
resource change, use `/reload` when supported or start a new Pi session, then
verify the extension commands, tools, skills, prompts, or themes that should
have appeared.

## Preserve Pi Contracts by Default

When designing, planning, implementing, or reviewing a Pi extension, treat Pi's
state and contracts as immutable unless the user explicitly instructs you to
change them.

Do not propose, plan, or implement any of the following by default:

- Writes to session history, including custom entries, custom messages, labels,
  compaction metadata, tool-result persistence, or rewritten parent links.
- New or changed session fields, settings fields, schemas, migrations, sidecar
  state, or other persistent data models.
- Changes to Pi source, private APIs, internal classes, component prototypes, or
  undocumented runtime behavior.
- Hidden compatibility paths or inferred migrations that alter existing Pi
  data.

A request for a feature, reliability across reloads, or branch support is not
permission to persist data or change Pi internals. Reading Pi state is not
permission to write it.

Prefer documented public hooks, renderers, event payloads, and ephemeral
in-memory state. If an exact behavior cannot survive reloads or restarts without
persistence, explain that limitation and the available trade-offs. Ask for
explicit authorization before introducing storage or internal changes. Do not
quietly choose persistence as an implementation detail.

Every proposed implementation plan for Pi work must state whether it changes
session state, another persistent data model, or Pi internals. The default
answer must be no. If the public API is insufficient, stop at the limitation
instead of proposing an internal Pi change unless the user requested one.

## Create or Modify Pi Resources

- Put global extensions in `~/.pi/agent/extensions/` and project extensions in
  `.pi/extensions/`; use `pi -e ./extension.ts` for quick tests.
- Put global skills in `~/.pi/agent/skills/` and trusted project skills in
  `.pi/skills/` or `.agents/skills/` as documented.
- Use Pi packages when distributing multiple resources or runtime dependencies.
- Keep extension runtime dependencies in `dependencies`. Follow
  `docs/packages.md` for Pi peer dependencies and package manifests.
- Start background resources from session lifecycle hooks, not the extension
  factory, and close them idempotently during `session_shutdown`.
- Use `StringEnum` for string enums exposed to model tools, truncate large tool
  output, and use Pi's file-mutation queue for custom tools that modify files.
- Guard TUI-only behavior with the documented mode checks.
- When the user explicitly authorizes persistent extension state, preserve
  session branching semantics with Pi's documented mechanisms and confirm the
  data model before implementation.

Before considering work complete:

1. Validate the resource structure and manifest against the installed docs.
2. Run the repository's formatter, type checker, and tests.
3. Test extensions with `pi -e` or a temporary package path before permanent
   installation.
4. Exercise affected commands, tools, lifecycle hooks, and non-interactive
   modes where relevant.
5. Run `/reload` or restart Pi and verify discovery from the intended scope.

## Check Provider Usage

When the user asks for current Codex or provider usage, first check whether the
configured Pi packages include `@onurpi/pi-usage`. If it is available, use its
interactive `/usage` command instead of estimating usage or calling an
undocumented provider endpoint:

1. Start a temporary `pi --no-session` process with a TTY.
2. Enter `/usage` and wait for the current-provider report.
3. Read the primary and model-specific limits, reset times, credits, and plan.
4. Close the menu with Escape, then exit the temporary Pi process.

Report remaining percentages exactly as displayed. Do not convert a percentage
to token counts because subscription limits are not token quotas. Do not expose
credentials, raw provider payloads, or unrelated session state. If the package
is unavailable or the query fails, state that current account usage is not
visible instead of guessing.

## Local Pi State

Treat `~/.pi/agent/` as live user state. Inspect before changing it, back up
state before risky manual repairs, and prefer documented Pi commands over raw
edits. Never expose credentials, session contents, trust decisions, provider
payloads, or context-file contents in logs or reports.
