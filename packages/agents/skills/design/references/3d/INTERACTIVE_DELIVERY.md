# Interactive 3D delivery

A model for a game or interactive exhibit must work in its destination renderer. Validate a small
representative asset early, then preserve the approved visual result while the scene gains behavior
and scale.

## Export trial

Choose an asset containing the materials and moving parts that are hardest to export. Include curves
or modifiers when the model uses them. Export it through the proposed format and load it in a clean
destination scene. Check units and axes along with object transforms and normals. Verify that
textures load and materials look correct. Check which objects own each animation.

Compare a destination screenshot with a Blender render at a similar camera angle. Investigate
missing detail and material changes before repeating the export across the project. Material nodes,
lighting, and post-processing may need a destination implementation or a baked texture. Do not
assume that a successful export carries every Blender feature into the viewer.

Keep the destination engine chosen by the user. A polished offline film does not fulfill a request
for a playable scene. If a different engine is needed to meet the brief, explain the specific
limitation and obtain direction before changing the product.

## Interactive structure

Keep interactive parts individually addressable so users can select or move them without affecting
unrelated geometry. Use stable names or identifiers and verify that the export retains them. A
cutaway needs separate shells and interiors. Doors need useful pivots, and mechanisms need
consistent parent-child transforms.

For rooms and vehicles, inspect navigation at the intended player height and scale. Test actual
controls through the main routes. Check collision at openings and around equipment. Use accessible
camera positions to examine areas that the presentation camera does not show.

For tours and animation, review pacing as well as individual frames. Keep camera paths clear of
geometry and avoid abrupt changes of scale. Show the subject long enough for its function to be
clear. Make labels and control states agree with the visible model.

## Performance and appearance

Measure performance in the target viewer on the available hardware and report that context. Base
mesh and texture budgets on the intended scene and measured cost. Avoid reducing detail simply to
reach an arbitrary low polygon count.

Choose optimizations that address the measured cost, such as instancing or visibility control.
Reduce texture size or distant detail when those changes preserve the intended appearance. After
optimization, compare the same close-up views and repeat the main interactions. Keep fine detail
where users can approach it. If the requested quality and performance cannot both be met, present
the tradeoff instead of silently reducing the visual target.

## Final check

Reload the delivered build from a clean start. Verify that textures and other assets load without
editor-only paths. Test the normal user controls and inspect the resulting views. Structural
diagnostics can help explain a failure, but a test that sets state directly does not prove that the
user can reach that state.

Record screenshots from the delivered viewer and state which interactions were tested. Keep offline
Blender renders clearly labeled when including them beside live captures. Report remaining visual
differences between Blender and the final viewer, including any deliberately approximated effects.
