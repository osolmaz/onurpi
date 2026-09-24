# README cover

A README cover is the wide image at the top of a repository README. It names
the project in one plain line and shows a small picture of how it works. Apply
the [shared theme](THEME.md), and use the plain-writing and kill-ai-smell skills
for the words on it.

## Layout

Use a 960 by 320 canvas with a 12-unit corner radius. Use the light beige
background by default, since most READMEs are read on a white page. Keep at
least 64 units of margin on the left and right and about 52 units above and
below the tallest element.

Put the project name and the tagline on the left and the picture on the right.
Set the name in Yodel Grotesk Bold at about 64 units and the tagline in Yodel
Grotesk Regular at about 19 units, in the secondary text color, over at most two
lines. Leave clear space between the text block and the picture so the two read
as separate groups.

Keep the picture to one idea, such as an input becoming an output. A related
repository's cover should share the same layout and background, so the covers
read as a set.

## Windows and diagrams

When the picture shows software, draw it as a light macOS window. The body is
white, and the light gray title bar holds the window buttons and a centered
title. Put real content in it. Copy real keys from the project's
file format, and capture the product's actual screen (for example, a fresh
install's first screen) instead of inventing an interface. Then brand the copy
with the example project's name and version, and replace the stock welcome
line with one that says what makes the project different.

Give side-by-side windows the same width and height. Put the connecting arrow
in the middle of the gap between them. Each window gets equal padding of 12 to 16
units, and the longest code line must keep that padding on the right. Keep the title clear of the window buttons.

Code inside a window uses a monospace font such as Menlo, with syntax colors
from the GitHub light theme. Keys are `#0550ae` and strings are `#116329`,
table headers take `#8250df`, and punctuation stays gray at `#6e7781`. Terminal
text uses grays, with the product name in bold dark type.

## Text as outlines

Convert every letter to a path so the file needs no font and ships no font
file. The delivered SVG must contain no `<text>` element and no font
reference.

Shape each string with HarfBuzz (the `uharfbuzz` package) and draw each glyph at
the position it returns. Adding up glyph advance widths yourself drops the
font's kerning and ligatures, and the gaps show at pairs such as "y." and "To".
Check the result by measuring the same strings in a browser with the font
installed, for example with a canvas `measureText` call. The widths should
match to the pixel.

Record the font source revision and file hashes in the pull request or
provenance record. Check that the font's embedding flags allow outlining.

## Wording

Say what the project is in plain words. The tagline should name the category
and the job so that a reader who has never seen the project understands it.
Prefer everyday words to precise-sounding technical ones. The pi-factory cover
went through three versions. "Declarative Pi application bundle launcher" was
accurate but meant little to a new reader, and "A toolkit for creating Pi
distributions from one declarative manifest" still leaned on jargon. The
version that shipped was "A toolkit for creating Pi distributions in a more
structured way."

Match the words that sibling projects already use for the same idea, so one
term means one thing across the set. Keep the image's accessible label, the
README alt text, and the tagline in the same words.

## Checks

Render the final SVG to PNG and look at it at full size and at README width.
Parse it as XML and search it for `<text>` elements and font references, which
should find nothing. Compare the text widths with a browser rendering of the
same font. Then check the margins and padding, and make sure no text
touches an edge. After pushing, open the file on GitHub,
where it renders at about 880 units wide.
