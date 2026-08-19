# Pi Workflows

This private OnurPi package loads an exact reviewed Pi Workflows release. It provides the
`/workflow` command, the model-visible `workflow` tool, workflow run integration, typed nested
workflows, and the built-in `autoplan`, `autodoc`, `autoimplement`, and `monitor` workflows. It also
exposes all upstream Pi Workflows skills from the same pinned package.

OnurPi loads this wrapper from the local checkout. It is not published to npm.

## Update the pinned package

After installing a reviewed Pi Workflows release that provides Herdr synchronization, run:

```bash
npm run workflows:sync
```

The command asks the installed Pi Workflows CLI to find and verify its own bundled Herdr plugin.
OnurPi does not store the plugin path or copy its manifest. Herdr is optional, so the command
reports an unavailable Herdr installation without failing the rest of the package update. A broken
installed Herdr or an invalid plugin registration remains an error.

Run `/reload` in an existing Pi process, or restart it, after changing the package or global
settings. Herdr synchronization does not reload process-local Pi resources.
