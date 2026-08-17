---
name: name-claim
description: Use when checking whether a project, product, organization, package, domain, or social handle name is free, taken, reserved, claimable, or missing across code hosts, package registries, domains, app stores, AI platforms, developer platforms, and social networks.
---

# Name Claim

Use this skill to check whether one or more candidate names are available across the public namespace surface a project usually needs.

## Principles

- Verify current status live; namespace availability changes quickly.
- Check exact candidates first, then common variants only when useful.
- Treat registry `404`, `not found`, empty search results, parked domains, redirects, bot defenses, and rate-limit pages as different signals.
- Prefer official APIs, registry endpoints, RDAP, DNS, and direct profile/package URLs over generic web search.
- Cross-check important claims with at least two signals when possible, especially for X/Twitter, domains, and package registries with anti-bot behavior.
- Report confidence separately from status. Say when a platform blocked verification or returned an ambiguous response.
- Do not attempt to create, reserve, purchase, or claim accounts/domains unless the user explicitly asks and the needed authentication/payment flow is available.

## Inputs

Identify:

- Primary candidate string.
- Candidate variants, such as hyphenated, underscored, scoped, suffixed, or TLD-specific forms.
- Desired surfaces. Default to the full checklist below unless the user asks for a narrow check.
- Whether the user needs a quick answer or a thorough claim plan.

Use neutral placeholders like `TARGET`, `HANDLE`, `ORG`, `PACKAGE`, and `DOMAIN` in notes, commands, and examples. Do not bake a real project name into the reusable procedure.

## Default Checklist

Check the exact primary candidate across:

- Code hosts: GitHub user/org, GitLab group/user, Codeberg user/org.
- Package registries: npm package, npm scope/org, PyPI project, crates.io crate, RubyGems gem, Packagist package, Go import or vanity namespace where relevant, Maven Central group/artifact where relevant.
- Container and artifact platforms: Docker Hub user/org, GitHub Container Registry namespace via GitHub ownership, npm organization if JavaScript tooling matters.
- AI and developer platforms: Hugging Face user/org, Replicate user/org, OpenRouter or model/provider handle if relevant, VS Code Marketplace publisher, JetBrains Marketplace vendor where relevant.
- Domains: `.com`, `.io`, `.ai`, `.dev`, `.org`, `.net`, `.co`, `.app`, `.xyz`, plus domain-specific TLDs that matter to the project.
- Socials: X/Twitter, Bluesky, Mastodon if an instance is specified or `mastodon.social` by default, Threads/Instagram, TikTok, YouTube handle, LinkedIn company page, Reddit user/subreddit, Discord server vanity URL if applicable.
- Product/community directories: Product Hunt topic/account, Discord invite vanity, Slack workspace URL if relevant.
- App stores: Apple App Store name/developer presence and Google Play package/developer presence when the project may become an app.

## Fast Command Patterns

Use parallel checks when possible. Substitute a shell-safe candidate value for `TARGET`.

### GitHub

Prefer unauthenticated API or `gh` when available:

```bash
curl -s -o /tmp/name-claim-gh-user.json -w 'github_user %{http_code}\n' https://api.github.com/users/TARGET
curl -s -o /tmp/name-claim-gh-org.json -w 'github_org %{http_code}\n' https://api.github.com/orgs/TARGET
```

Interpretation:

- `200`: taken or at least publicly resolvable.
- `404`: not publicly resolvable; likely available, but GitHub may reserve names internally.
- Auth-scope errors can appear on org checks. Confirm with public `/users/TARGET` too.

### npm and PyPI

```bash
curl -s -o /tmp/name-claim-npm.json -w 'npm_pkg %{http_code}\n' https://registry.npmjs.org/TARGET
curl -s -o /tmp/name-claim-pypi.json -w 'pypi_pkg %{http_code}\n' https://pypi.org/pypi/TARGET/json
```

Interpretation:

- `200`: package exists.
- `404`: exact package/project is not published.
- npm scopes and organizations are not fully proven by exact package checks; check web/account flows separately if needed.

### crates.io, RubyGems, Packagist

```bash
curl -s -A 'name-claim availability check' -o /tmp/name-claim-crates.json -w 'crates %{http_code}\n' https://crates.io/api/v1/crates/TARGET
curl -s -o /tmp/name-claim-rubygems.json -w 'rubygems %{http_code}\n' https://rubygems.org/api/v1/gems/TARGET.json
curl -s -o /tmp/name-claim-packagist.json -w 'packagist %{http_code}\n' https://repo.packagist.org/p2/VENDOR/PACKAGE.json
```

For Packagist, exact vendor/package availability is ecosystem-specific. Check the package shape the project would actually use.

### Hugging Face

```bash
curl -s -L -o /tmp/name-claim-hf-user.json -w 'hf_user %{http_code}\n' https://huggingface.co/api/users/TARGET/overview
curl -s -L -o /tmp/name-claim-hf-org.json -w 'hf_org %{http_code}\n' https://huggingface.co/api/organizations/TARGET/overview
```

Interpret case redirects as a taken-name signal. A `200` user and `404` org means the handle is taken as a user.

### Docker Hub

```bash
curl -s -o /tmp/name-claim-docker-user.json -w 'docker_user %{http_code}\n' https://hub.docker.com/v2/users/TARGET/
```

Docker Hub namespace checks can be incomplete for organizations. If the name matters, verify in the Docker Hub UI while logged in.

### Domains

Use RDAP plus DNS/HTTP checks:

```bash
curl -s -L -o /tmp/name-claim-rdap.json -w 'DOMAIN rdap %{http_code}\n' https://rdap.org/domain/DOMAIN
getent hosts DOMAIN
curl -LIs --max-time 8 https://DOMAIN | head -1
```

Interpretation:

- RDAP `200`: domain is registered.
- RDAP `404`: likely unregistered.
- DNS/HTTP resolving means the domain is probably registered even if RDAP lookup was inconclusive.
- Parked pages, registrar pages, and sale pages still mean taken for normal claim purposes.

### X/Twitter

Use multiple signals because X can return bot defenses and odd status codes:

```bash
curl -s -I -L --max-time 10 https://x.com/HANDLE -H 'User-Agent: Mozilla/5.0' | head -1
curl -s -L --max-time 10 https://api.fxtwitter.com/HANDLE -H 'User-Agent: Mozilla/5.0' | head -c 300
```

Interpretation:

- X profile HTTP `200`: active or resolvable account.
- X profile HTTP `404` plus FxTwitter `User not found`: likely available or unavailable due to internal reservation/suspension.
- A single `403` from X is not enough to decide; retry or use browser verification.
- Check obvious variants such as trailing underscore only if the clean handle is taken or the user asks.

### Bluesky

Check handle resolution:

```bash
curl -s -o /tmp/name-claim-bsky.json -w 'bsky %{http_code}\n' https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=HANDLE.bsky.social
```

A successful DID response means taken. A structured error usually means not resolvable.

### Mastodon

For a specified instance, check the account URL directly. If no instance is specified, use `mastodon.social` only as a default discovery surface:

```bash
curl -LIs --max-time 10 https://INSTANCE/@HANDLE | head -1
```

Mastodon handle availability is instance-specific. Do not generalize one instance result to the whole fediverse.

### Instagram, Threads, TikTok, YouTube, Reddit, LinkedIn

Prefer direct URLs and official-ish endpoints where available, but expect anti-bot behavior:

```bash
curl -LIs --max-time 10 https://www.instagram.com/HANDLE/ | head -1
curl -LIs --max-time 10 https://www.threads.net/@HANDLE | head -1
curl -LIs --max-time 10 https://www.tiktok.com/@HANDLE | head -1
curl -LIs --max-time 10 https://www.youtube.com/@HANDLE | head -1
curl -LIs --max-time 10 https://www.reddit.com/user/HANDLE/ | head -1
curl -LIs --max-time 10 https://www.reddit.com/r/HANDLE/ | head -1
curl -LIs --max-time 10 https://www.linkedin.com/company/HANDLE/ | head -1
```

For these surfaces, status codes alone are often weak. If the answer matters, open the page in a browser and look for the platform's own not-found/account page text.

### App Stores And Marketplaces

Use direct search or browser verification for:

- Apple App Store app names and developer names.
- Google Play app names, package names, and developer names.
- VS Code Marketplace publishers and extensions.
- JetBrains Marketplace vendors and plugins.
- Product Hunt accounts/topics.

Search results can be fuzzy. Distinguish exact namespace conflicts from merely similar names.

## Browser Verification

Use browser verification when:

- A platform blocks `curl` or always returns generic `200` pages.
- The user is about to spend money or announce a name.
- X/Twitter, Instagram, Threads, TikTok, LinkedIn, App Store, or Google Play status is important.
- A domain appears parked or for sale and the user needs practical acquisition guidance.

When using browser automation, load the direct profile, listing, search result, or claim page and inspect visible text, not just the network status.

## Reporting Format

Start with the practical answer:

- `Looks available`: no public claim found, but internal reservations may still exist.
- `Taken`: public account/package/domain exists.
- `Ambiguous`: platform blocked checks or signals conflict.
- `Already claimed by the user`: only when the user said they acquired it or the account clearly belongs to them.

Group results by urgency:

1. Grab now: high-value exact handles/packages/domains that appear available.
2. Already taken: names unavailable or held by others.
3. Needs manual/browser verification: anti-bot or ambiguous surfaces.
4. Optional variants: names worth checking only if the project needs broader protection.

Keep chat replies short. For longer audits, write a concise checklist with status per platform.

## What To Recommend Claiming First

Prioritize in this order unless the project has unusual needs:

1. GitHub org/user and canonical repo.
2. Primary domain, especially `.com`, `.io`, `.ai`, or `.dev` depending on project identity.
3. npm and PyPI exact packages, plus npm scope if JavaScript users matter.
4. X/Twitter and Bluesky handles.
5. Hugging Face org/user for AI projects.
6. Docker Hub and crates.io if the project ships CLI, containers, or Rust tooling.
7. Instagram/Threads/TikTok/YouTube/LinkedIn/Reddit if public marketing/community matters.
8. App store/developer namespaces if mobile apps are plausible.

## Safety And Ethics

- Do not squat names for unrelated projects.
- Do not impersonate existing projects or people.
- Do not bypass platform protections or automate signups.
- Do not store passwords, phone numbers, recovery codes, or payment details.
- If a user asks to reserve a namespace, guide them to official claim flows and ask before performing account creation or purchase steps.
