---
name: design
description: >-
  Use when creating, revising, or visually reviewing web pages and interfaces,
  graphs and figures, video edits, demo or showcase videos, or 3D models and
  scenes. Covers visual hierarchy, typography, accessible presentation,
  source fidelity, rendering, and output inspection. Also use for local video
  transformations such as trimming or speed changes. Do not use for ordinary
  prose editing, backend work, software architecture, or data analysis without
  a visual deliverable.
---

# Design

Create the requested visual deliverable and inspect what the user will receive.
A successful script or export does not establish visual quality.

## Start

Identify the medium and intended audience. Establish the source material and delivery format.
Read [the shared theme](references/THEME.md), then the relevant domain reference.
Use the defaults without asking routine style questions. Ask when evidence,
rights, required tools, or conflicting instructions prevent correct work.

| Task | Read |
| --- | --- |
| Web page, interface, or visual layout | [Web and UI](references/WEB_UI.md) |
| Chart, plot, or figure | [Graphs and figures](references/GRAPHS_FIGURES.md) |
| Trim, speed change, or other existing-video edit | [Video editing](references/VIDEO_EDITING.md) |
| Demo, showcase, teaser, or results film | [Demo video](references/DEMO_VIDEO.md) |
| Model, materials, scene, cutaway, or interactive 3D asset | [3D work](references/THREE_D.md) |

Load more than one domain only when the deliverable needs it. A results film
with charts needs demo and graph guidance. A 3D viewer with controls needs 3D
and UI guidance. A speed change does not authorize restyling the footage.

## Precedence

For visual choices, explicit user instructions take precedence over source-product
visual fidelity. Apply shared defaults next. Use domain defaults for remaining choices.
Domain references add technical procedures and checks without silently changing
the shared theme. Preserve evidence accuracy and originals regardless of style. Check licensing
and report completion honestly.

The theme applies to newly authored presentation surfaces. Consult the theme reference for exceptions that protect product imagery and scene
materials. It also covers semantic data colors and functional controls.

## Companion skills

Use `plain-writing` and `kill-ai-smell` for reader-facing copy, including screen
text and captions. Load them from their discovered locations; do not duplicate
their full instructions here. Run the writing checker before final rendering.
Use `text-input-keybindings` for text input surfaces and preserve platform
conventions. Use `practical-significance` before a measured comparison determines
a spending or shipping decision. Follow `memory-safe-launch` for large renders.

## Resource paths

Resolve command paths from the directory containing this `SKILL.md`, called
`DESIGN_DIR` in examples. Markdown links resolve from the document containing
them. Run helpers with the task project as the working directory. Keep inputs and working files in that project with provenance and outputs,
outside the installed skill tree. Do not assume a particular harness installation path.

## Completion

Inspect the final output after the last relevant change. Check source fidelity and text fit. Verify accessibility and the domain's
delivery requirements. Preserve source
files and earlier delivered versions. State the actual tests and views checked.
If images, audio, or the destination viewer cannot be inspected, name the missing
check and report that part of validation as incomplete.
