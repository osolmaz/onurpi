# Shared theme

This file defines defaults for newly authored presentation surfaces. It does
not recolor existing footage, product assets, textures, or physical materials.
Read the requested domain reference for its production and verification steps.

## Precedence

Apply these in order for visual choices:

1. Explicit user instructions.
2. Source-product visual fidelity.
3. The shared defaults in this file, including its medium-specific font choices.
4. Domain defaults where the shared theme leaves a choice open.

Keep evidence accurate and preserve originals. Check rights and report completion honestly. Style instructions do not waive them.

## Colors and surfaces

| Property | Dark | Light |
| --- | --- | --- |
| Background | `#000000` | `#F5F0E6` |
| Primary text | `#F5F5F5` | `#111111` |
| Secondary text | `#BDBDBD` | `#4A4A4A` |

Use dark mode by default. Its background is plain black. Light mode uses plain
beige. An existing product or embedding page supplies its own background when
source fidelity applies. Do not ask for a background choice when the defaults
already answer it.

Use neutral colors without an invented brand accent. Use plain presentation surfaces without gradients or shadows. Avoid glow.
Separate content with whitespace and alignment, adding functional borders when useful. Do not add a decorative header, footer, logo strip,
or ornamental progress bar.

Keep functional navigation, legal information, real progress indicators, legends,
form help, and required credits. Decorative restrictions must not remove facts
or controls that the user needs.

## Typography

| Medium | Default font |
| --- | --- |
| New web/UI work, including quick pages | Inter from Google Fonts |
| Videos and their title cards, posters, or related graphics | Yodel Grotesk |
| Other media without a specified font | Helvetica |

These are shared medium-specific defaults. Yodel Grotesk is not the global
font. A standalone figure uses Helvetica; a figure made for a film uses the
film's font. Product screenshots and faithful renderer ports retain source
fonts unless the user explicitly requests an adaptation.

Use an authorized source for font files and check embedding and redistribution
rights. Repository access alone does not grant those rights. Do not put private
font repository locations, credentials, or private font files in public skill
content. Record the source revision and file hashes in the task's provenance record.
Include the license and actual selected face. No fonts are bundled with this skill.

For web work, use Inter as the main font and a documented Helvetica, Arial,
Liberation Sans, sans-serif fallback stack. Choose hosted Google Fonts or
self-hosted licensed files according to the product's privacy and deployment
requirements. Test the loading and fallback states.

For static outputs, confirm the actual font before the full render. A Helvetica
fallback may use Arial or Liberation Sans if recorded. Do not silently replace
Inter or Yodel Grotesk in a final static output. If the required font is missing,
request an authorized source or approval for a substitute. Never claim a
fallback render used the requested font.

## Titles and copy

Use one visible title per section or card. Do not add an eyebrow or supertitle
above it, or a subtitle line directly below it. Use sentence case. Put additional
facts in ordinary body content where they are useful.

Preserve figure captions and axis labels as functional content. Keep table
column headers, form help, and accessibility subtitles in a video. Avoid redundant
section labels and repeated titles for the same content.

Write plain factual copy. Use full product names and give values with units. Remove slogans and
unsupported superlatives. Delete marketing filler. Apply the companion
writing skills before rendering. A demo's main evidence-backed claim can be a
sentence heading; ordinary sections should use short topic labels.

## Accessibility and spacing

Use spacing and alignment to establish hierarchy. Start with a spacing scale
of 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 units, adjusted to the medium. Web body text
should normally start at 16 CSS pixels with about 1.5 line height. Keep readable
line lengths and allow content to determine component height.

Meet WCAG AA contrast for web content: at least 4.5:1 for ordinary text and
3:1 for large text and required interface graphics. Check the actual foreground
and background pair, including hover and disabled states. Also check error and focus states. Do not
use color alone to distinguish meaning.

Interactive surfaces need visible keyboard focus and logical focus order. A
two-pixel outline with separation from the control is a starting point. Keep it
visible against both the control and its surroundings. Support text enlargement with responsive wrapping. Respect reduced motion. Check the target display size for
charts and films as well as the full-resolution output.

## Exceptions

Record exceptions in the task's existing design notes or README. State the
source or user requirement, affected element, replacement style, and checks.
No separate exception store or theme schema is needed.

Preserve the real product palette, including gradients within captured imagery.
Keep new surrounding presentation neutral. For charts, semantic colors and data
scales may depart from monochrome when needed; reinforce them with labels,
patterns, or shapes. A data-driven heatmap gradient is permitted. An unrelated
background gradient is decorative.

For 3D work, the subject determines material response and lighting. Preserve its textures.
Do not flatten them to satisfy the presentation palette. The surrounding viewer
controls follow the theme. Label an explicitly requested recolored product
visual as an adaptation rather than a faithful capture.
