---
name: 3d-modeling
description:
  Create and refine detailed 3D models and scenes, primarily in Blender. Use for modeling, cutaways,
  materials, cinematic rendering, or interactive 3D assets when visual quality matters. Requires
  rendered inspection and correction before visual completion.
---

# 3D modeling

This skill guides 3D modeling with visual review. Deliver the requested level of finish in an
editable scene, with images that show what was actually built.

Use image inspection throughout the work. Inspect the model after meaningful changes and identify
specific visible defects. Edit the affected parts before continuing. A successful script or export
does not establish visual quality.

## Brief and references

Establish the subject and intended style. Record the closest viewing distance and delivery format,
including whether the user needs stills, film, or interaction. Keep an interactive request
interactive throughout development.

Default to a finished asset unless the user requests a draft. Realistic work needs plausible
construction and material response. Stylized work needs deliberate shapes and consistent detail.
Treat low-poly as a requested style or a justified platform constraint. Do not infer it from the
words "game" or "browser."

Use the user's references first. For real objects, consult authoritative images and dimensions for
visible structure. State any invented or simplified parts. Use only permitted sources; a reference
search does not authorize inspecting unrelated local projects or importing existing models.

When art direction needs exploration, use an available image-generation tool for clearly labeled
concepts if permitted. Keep concept images separate from Blender renders. Generated concepts can
guide appearance but cannot establish factual dimensions or prove that geometry exists.

For a large scene, choose one representative close-up area that includes the hardest visible
requirements. Develop it to the intended finish before repeating that construction across the scene.
This sets a quality target for the rest of the work without dropping the user's requested scope.

## Blender access and editing

Inspect the running Blender version and scene contents before making changes. Check which tools are
available. Save a checkpoint and keep unrelated objects intact. For a new project, use a separate
file or scene without clearing the user's open work.

Prefer Blender MCP for live scene work when available. If the user requires MCP, verify that a
read-only call succeeds before modeling. If the required connection fails, report the failure and
request direction before using another execution method. Read the installed tool schemas to
determine valid tool calls.

Python through MCP is direct Blender editing. Use small, inspectable operations for mesh changes,
modifiers, material nodes, or object placement. Computer use can help with interactive inspection
and edits when available. Choose the method that supports the edit and its verification. Neither
mouse input nor code execution is evidence of a better result by itself.

Keep construction editable. Use meaningful object names and preserve boundaries needed for cutaways,
animation, or interaction. Scripts are useful for repeated geometry and reproducible edits, but
account for later interactive edits before rerunning them. Do not overwrite those edits with a stale
generation script.

## Modeling and refinement

Resolve the silhouette and major proportions before surface detail. Confirm the scale with a known
dimension when accuracy matters. Use a neutral solid view to inspect the structure. For interiors,
establish openings and usable space before placing equipment or furniture. Give walls the thickness
needed for the intended views.

Develop visible forms beyond their starting primitives. Model openings with actual depth and connect
pipes to their fittings. Match panel depth to the reference. Choose mesh edits, curves, booleans, or
modifiers according to the shape. Inspect the evaluated result for shading defects and unwanted
rounding. Adding more objects or polygons does not repair an incorrect shape.

Build repeated assemblies once and inspect their connections before duplication. Use instances where
they preserve editability and suit the target renderer. Match detail density to the viewing
distance. Check close-up parts in close-up images instead of approving them from a distant overview.

For visible people or creatures, establish anatomy and pose before clothing or surface detail. Check
the hands, joints, and contact with equipment. If the available method cannot meet the requested
character quality, report that limit and seek direction on alternatives. Do not present placeholder
figures as finished realistic characters.

Develop materials under readable lighting. Keep texture scale consistent with object dimensions.
Check roughness and surface detail at the intended camera distance, including the response of metal
to light. Add wear where construction and use justify it. Preserve clean surfaces where the
reference calls for them.

Use lighting and camera placement to explain the model. Check exposure before adding more lights.
Keep background objects from obscuring the main subject. Depth of field, bloom, darkness, and fast
camera motion must not be the only reason an unfinished part looks acceptable.

## Visual review

Read [quality-review.md](references/quality-review.md) before the first visual review. Use it to
choose views and assess the result against the brief.

After each meaningful construction or appearance change:

1. Capture a viewport image or render that exposes the affected area.
2. Open the image and compare it with the reference and intended use.
3. Record the largest visible defects with the affected part and view.
4. Correct those defects and capture the same view again.

Preserve camera and lighting settings during a comparison unless those settings are what needs
repair. Add diagnostic views when the existing views hide a problem. A camera move that conceals a
defect does not resolve it.

Use inexpensive previews during construction and final-quality renders for delivery. Continue
through self-review without requesting approval after every small edit. Honor explicit approval
gates and resource limits. If progress stops, change the modeling approach or report the remaining
limit. A fixed number of passes does not make an unfinished model complete.

For long tasks, retain a short project-local record of the current Blender file, reference sources
and reviewed views. Include unresolved defects and the next edit so the work can resume from the
saved state.

## Delivery

For games, browser scenes, or another destination renderer, read
[interactive-delivery.md](references/interactive-delivery.md) before choosing materials or an export
strategy. Test a representative export early enough to catch unsupported features before the full
scene depends on them.

Reopen the saved file or exported asset and verify the final state. Inspect every required view
after the last relevant change. If images cannot be opened, report visual validation as incomplete
even when structural checks pass.

Deliver the requested files with an editable source and representative renders when applicable.
State what was modeled and identify imported or generated assets. Name the viewer that was tested
and describe remaining simplifications. Identify rendered films and live interactive captures
correctly. A screenshot must show the delivered scene; a concept image or retouched image cannot
serve as completion evidence.

## Sources

OpenAI's
[Architectural visualization with Astra](https://developers.openai.com/blog/architectural-visualization-with-astra)
describes Blender Python modeling with render inspection and interactive export.
[Building games with Astra](https://developers.openai.com/blog/how-to-build-games-with-astra)
describes reference-driven visual development and browser testing. These are workflow examples. This
skill's acceptance checks are project guidance and do not establish a measured quality guarantee.
