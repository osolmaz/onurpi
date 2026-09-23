# Web and UI

Build the interface around the content and the user's task. Apply the
[shared theme](THEME.md), including Yodel Grotesk for new web work. Preserve an existing
product's components and typography when extending it.

## Structure

Use semantic HTML and native controls where suitable. Apply proper heading
levels. Associate labels with controls and provide useful alternative text. Give links meaningful names.
Use one page-level heading and one title for each titled section. Keep controls
and reading order consistent in the DOM and on screen.

Avoid a generic SaaS card grid. Use cards only when the content contains real
repeated units. A table, list, article, or ordinary form often expresses the task
more clearly. Do not invent branding, logos, or a palette to fill empty space.

## Responsive behavior

Use content-driven layout and flexible widths. Allow long names and translated
text to wrap. Do not fix component heights around one sample string. Keep images
within their containers and define deliberate behavior for wide tables.

Check narrow viewports down to 320 CSS pixels where the content permits reflow.
Also inspect medium and wide layouts. Test 200% text enlargement and zoom/reflow equivalent to
400% on a desktop viewport. Keep touch targets usable, normally at least 24 by
24 CSS pixels with adequate separation. Avoid hover-only information.

## Interaction

Test every normal path with a keyboard. Preserve logical focus order with a visible focus indicator. Provide escape
routes from dialogs. Restore focus after closing a
dialog. Make errors available as text and associate them with the affected field.
Use status announcements when an update otherwise cannot be perceived.

Use the `text-input-keybindings` skill for editors and input surfaces. Preserve
browser and platform conventions such as select-all. Do not intercept standard
shortcuts merely to imitate terminal behavior.

Respect reduced motion. Keep functional loading states and actual progress
feedback. Check readable copy and usable controls in empty and loading states. Repeat
those checks for error, success, and disabled states. Do not create persistence for a theme toggle unless the
product requires it.

## Verification

Run the project's normal checks and available accessibility checks. Open the
actual page in a browser and inspect screenshots at the target widths. Test keyboard operation and focus. Enlarge the text and check long content.
Exercise font loading and fallback. Check contrast, overflow, clipped controls, and layout shifts.

Repeat affected checks after the last visual change. Report the tested browsers and viewports. Name the interactions inspected. DOM assertions alone cannot prove
that the page is visually complete.
