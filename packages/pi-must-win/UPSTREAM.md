# Upstream provenance

The initial Git commit-attribution feature was adapted from `@shelken/pi-co-authored-by` 0.2.8.

| Field              | Value                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Repository         | https://github.com/shelken/pi-extensions                                                          |
| Upstream directory | `extensions/pi-co-authored-by`                                                                    |
| Commit             | `50b61b5e926b9fe516595c4c8c26b378598185bf`                                                        |
| Tag                | `@shelken/pi-co-authored-by@0.2.8`                                                                |
| npm package        | `@shelken/pi-co-authored-by@0.2.8`                                                                |
| npm SHA-1          | `911672f2fd338ef1001f2f2c37281d241269e042`                                                        |
| npm integrity      | `sha512-59fzsE6MkcWHm2KmoiNpCL3dRrj+FHSv7EmVBcocurC+V3TuO69hXDfuz9S8w5RJuDMX7BGhd6r8Y5vAwBDJ5w==` |
| Retrieved          | 2026-07-19                                                                                        |
| License            | MIT                                                                                               |

The review covered every file in the upstream package directory:

```text
AGENTS.md
CHANGELOG.md
LICENSE
README.md
index.ts
lib/commit.test.ts
lib/commit.ts
lib/index.test.ts
package.json
```

The package has no runtime dependencies. Its only package script runs Vitest. Runtime behavior is
limited to creating and deleting a temporary hook directory and prefixing Pi agent `bash` calls with
process-local Git configuration and trailer values. It does not access the network, credentials,
provider requests, trust decisions, or background services.

Local changes turn the source into the first feature of the `@onurpi/pi-must-win` umbrella
extension. Environment variables and temporary paths use the new package name. Trailer values are
normalized to one line, hook failures are fail-closed, tests use the OnurPi quality gate, and the
package documentation is written in English. The trailer format and session-scoped hook design
remain unchanged.
