# Extension vendoring

Small Pi extensions with little adoption or operational history should be vendored into this
workspace before installation. This is the default for extensions that are practical to audit in
full. Mature packages with established maintainers and meaningful usage can still be installed from
a pinned registry version or Git commit after review.

Every vendored extension needs a provenance record. Record the upstream repository, immutable commit
or release, retrieval date, and license. Name the package contents and scripts that were reviewed.
Explain local changes to upstream behavior.

Review the source for process execution, shell hooks, filesystem and network access, credential
access, telemetry, provider interception, tool overrides, trust handlers, and background resources.
Remove code and dependencies that are unrelated to the requested capability. Keep an unlicensed
source private and obtain permission before publishing it.

Install the reviewed local package path. For an update, compare upstream against the recorded commit
and repeat the review. Run the package quality checks before updating the provenance record. Remote
package updates must never replace vendored code automatically.
