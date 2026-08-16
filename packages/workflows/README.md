# Pi Workflows

This private OnurPi package loads a pinned Pi Workflows release. It provides the `/workflow`
command, the model-visible `workflow` control tool, workflow run integration, and the built-in
`monitor` workflow. It also exposes the upstream `pi-workflows` and `monitor` skills so the agent
can operate and author workflows without a separate skill installation. You can ask the agent to
monitor or check something at a regular interval. The agent can start and manage the monitor without
requiring you to write workflow JSON. Workflows can also show optional progress, elapsed time,
rates, and ETAs for one or more tracks.

OnurPi loads this wrapper from the local checkout. It is not published to npm.

Run `/reload` after changing the package or global settings.
