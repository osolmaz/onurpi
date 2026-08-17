---
name: add-license
description: Use when adding or standardizing project license files and README license sections. Defaults to MIT unless the user or repository explicitly asks for another license, creates/updates a root LICENSE from the bundled template, and appends a bottom-of-README Markdown link such as [MIT](LICENSE).
---

# Add License

Use this skill when adding a license to a repository or normalizing how the
license is presented.

Default to MIT unless the user explicitly asks for another license or the
repository already has clear license requirements.

## Workflow

1. Inspect the repo root for existing `LICENSE`, `LICENSE.md`, `COPYING`,
   `README.md`, package metadata, and contribution guidance.
2. If there is no license file and MIT is appropriate, create root `LICENSE`
   from `references/mit-license-template.txt`.
3. Fill the MIT template with the current year and the project owner or author.
   Prefer explicit package metadata, existing copyright notices, README author
   text, or the GitHub owner/user when available. If ownership is unclear, ask.
4. Update package metadata when the ecosystem has a standard license field
   and the file already uses that metadata format. For Rust, set
   `license = "MIT"` in `Cargo.toml`.
5. Add or normalize a `## License` section at the very bottom of `README.md`.
   The section should be the final content in the file.

## README Convention

At the bottom of the README, use exactly this shape for MIT:

```md
## License

[MIT](LICENSE)
```

Rules:

- Put the section after every other README section.
- Use a Markdown link to the local license file, not plain text.
- Link to `LICENSE` when the root file is named `LICENSE`.
- Do not add prose unless the user asks for it.
- If a README already has a license section elsewhere, move or rewrite it so
  the normalized section is at the bottom.

## MIT Template

When adding MIT, read and use
`references/mit-license-template.txt`. Do not write a shortened license.
