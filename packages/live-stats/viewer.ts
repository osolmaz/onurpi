import type { BrailleSpinner } from "./spinners.ts";

/** The placeholder inside the page template that the frame data replaces. */
const DATA_PLACEHOLDER = "__SPINNER_DATA__";

/**
 * The spinner viewer as one self-contained page: every animation runs in place, the selected
 * spinner gets a large preview, and the frames can be copied as Pi indicator options.
 *
 * The page carries its own copy of the frame data and its own braille decoder, so it opens straight
 * from the file system with no server and no imports. Rebuild it with `npm run viewer` after a
 * change to the spinner set.
 */
const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Braille spinners</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #11111b;
        --panel: #1e1e2e;
        --line: #313244;
        --text: #cdd6f4;
        --muted: #a6adc8;
        --accent: #fab387;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        padding: 2rem 1.5rem 4rem;
        background: var(--bg);
        color: var(--text);
        font: 15px/1.6 ui-sans-serif, system-ui, sans-serif;
      }
      main {
        max-width: 1100px;
        margin: 0 auto;
      }
      h1 {
        margin: 0 0 0.5rem;
        font-size: 1.5rem;
      }
      h2 {
        margin: 2rem 0 0.75rem;
        font-size: 0.85rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      p {
        margin: 0 0 1rem;
        max-width: 62ch;
      }
      a,
      code {
        color: var(--accent);
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .controls {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem 1.5rem;
        align-items: center;
        padding: 0.75rem 1rem;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 10px;
      }
      .controls label {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        color: var(--muted);
      }
      .controls input[type="range"] {
        accent-color: var(--accent);
      }
      button {
        padding: 0.4rem 0.8rem;
        background: transparent;
        color: var(--text);
        border: 1px solid var(--line);
        border-radius: 8px;
        font: inherit;
        cursor: pointer;
      }
      button:hover {
        border-color: var(--accent);
        color: var(--accent);
      }
      .stage {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
        gap: 1.5rem;
        margin-top: 1rem;
        padding: 1.25rem;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 10px;
      }
      .preview {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        align-items: center;
        justify-content: center;
      }
      .glyph {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        line-height: 1;
        color: var(--accent);
        white-space: pre;
      }
      #big-glyph {
        font-size: 72px;
      }
      .working-line {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 15px;
        color: var(--accent);
        white-space: pre;
      }
      .working-line b {
        font-weight: 700;
      }
      .details {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        min-width: 0;
      }
      .details h3 {
        margin: 0;
        font-size: 1.1rem;
      }
      .details p {
        margin: 0;
      }
      .meta {
        color: var(--muted);
        font-size: 0.85rem;
        font-variant-numeric: tabular-nums;
      }
      .strip {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
      }
      .strip button {
        padding: 0.15rem 0.45rem;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .strip button[aria-pressed="true"] {
        border-color: var(--accent);
        color: var(--accent);
      }
      pre {
        margin: 0;
        padding: 0.75rem;
        background: var(--bg);
        border: 1px solid var(--line);
        border-radius: 8px;
        overflow-x: auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
        color: var(--accent);
      }
      [hidden] {
        display: none !important;
      }
      .gallery {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        gap: 0.75rem;
      }
      .card {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        padding: 0.75rem;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 10px;
        cursor: pointer;
        text-align: left;
      }
      .card[aria-current="true"] {
        border-color: var(--accent);
      }
      .card .name {
        font-weight: 600;
      }
      .card .card-glyph {
        font-size: 32px;
      }
      .card .note {
        color: var(--muted);
        font-size: 0.8rem;
      }
      footer {
        margin-top: 2.5rem;
        color: var(--muted);
        font-size: 0.85rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Braille spinners</h1>
      <p>
        <b id="count"></b> two-character spinners for the
        <code>@onurpi/live-stats</code> working line. Every frame is two code points from U+2800 to
        U+28FF, so a frame covers exactly two terminal columns and the line never changes width.
      </p>
      <p>
        Pi picks one spinner at random when a session starts and keeps it for that whole session, so
        a conversation always shows the same animation.
      </p>

      <div class="controls">
        <label
          ><input id="own" type="checkbox" checked /> use each spinner's own timing</label
        >
        <label
          >speed <input id="speed" type="range" min="40" max="200" step="10" value="90" /> <span
            id="speed-value"
            class="meta"
          ></span
        ></label>
        <label
          >size <input id="size" type="range" min="20" max="120" step="4" value="72" /></label
        >
        <label><input id="grids" type="checkbox" /> show the dot grid</label>
        <button id="pause" type="button">pause</button>
      </div>

      <section class="stage">
        <div class="preview">
          <div id="big-glyph" class="glyph" aria-hidden="true"></div>
          <div class="working-line"><b>Working</b> (12s &middot; ~438 out &middot; 21.7 tok/s)</div>
        </div>
        <div class="details">
          <h3 id="title"></h3>
          <p id="description"></p>
          <p class="meta" id="meta"></p>
          <div class="strip" id="strip"></div>
          <pre id="grid" hidden></pre>
          <div class="controls">
            <button id="copy-frames" type="button">copy frames</button>
            <button id="copy-json" type="button">copy JSON</button>
          </div>
          <textarea id="export" rows="3" readonly aria-label="Pi indicator options"></textarea>
        </div>
      </section>

      <h2>All spinners</h2>
      <section class="gallery" id="gallery"></section>

      <footer>
        The working line is shown in the theme's warning color. The label is bold and the statistics
        in parentheses keep the normal weight. In Pi, a lighter band of the same orange travels from
        right to left across the line every few seconds.
      </footer>
    </main>

    <script type="application/json" id="spinner-data">
      ${DATA_PLACEHOLDER}
    </script>
    <script>
      (function () {
        var SPINNERS = JSON.parse(document.getElementById("spinner-data").textContent);
        var DOTS = ["\u25cf", "\u00b7"];
        // The eight dots of a braille cell: the canvas row, the column inside the cell, and the bit.
        var DOT_BITS = [
          [0, 0, 1],
          [1, 0, 2],
          [2, 0, 4],
          [0, 1, 8],
          [1, 1, 16],
          [2, 1, 32],
          [3, 0, 64],
          [3, 1, 128],
        ];
        var state = { selected: 0, manualFrame: null };
        var painted = [];

        function el(id) {
          return document.getElementById(id);
        }

        /** Decodes one frame into a 4x4 dot grid, using the dot layout of the two braille cells. */
        function dotsOf(frame) {
          var grid = [
            [false, false, false, false],
            [false, false, false, false],
            [false, false, false, false],
            [false, false, false, false],
          ];
          Array.from(frame).forEach(function (glyph, cell) {
            var points = glyph.codePointAt(0) - 0x2800;
            DOT_BITS.forEach(function (dot) {
              if ((points & dot[2]) !== 0) grid[dot[0]][cell * 2 + dot[1]] = true;
            });
          });
          return grid;
        }

        function gridText(frame) {
          return dotsOf(frame)
            .map(function (line) {
              return line
                .map(function (filled) {
                  return DOTS[filled ? 0 : 1];
                })
                .join("");
            })
            .join("\\n");
        }

        function intervalOf(spinner) {
          return el("own").checked ? spinner.intervalMs : Number(el("speed").value);
        }

        function frameOf(spinner, now) {
          var frozen = state.manualFrame !== null && spinner === SPINNERS[state.selected];
          var step = frozen ? state.manualFrame : Math.floor(now / intervalOf(spinner));
          return spinner.frames[step % spinner.frames.length];
        }

        function renderGallery() {
          var gallery = el("gallery");
          SPINNERS.forEach(function (spinner, index) {
            var card = document.createElement("button");
            card.type = "button";
            card.className = "card";
            card.dataset.index = String(index);

            var glyph = document.createElement("span");
            glyph.className = "glyph card-glyph";
            glyph.dataset.glyph = String(index);

            var name = document.createElement("span");
            name.className = "name";
            name.textContent = spinner.name;

            var note = document.createElement("span");
            note.className = "note";
            note.textContent = spinner.frames.length + " frames, " + spinner.intervalMs + " ms";

            card.append(glyph, name, note);
            card.addEventListener("click", function () {
              select(index);
            });
            gallery.append(card);
          });
          el("count").textContent = String(SPINNERS.length);
        }

        function select(index) {
          state.selected = index;
          state.manualFrame = null;
          var spinner = SPINNERS[index];
          el("title").textContent = spinner.name;
          el("description").textContent = spinner.description;
          el("meta").textContent =
            spinner.id +
            " - " +
            spinner.frames.length +
            " frames at " +
            spinner.intervalMs +
            " ms per frame";
          el("export").value = JSON.stringify({
            frames: spinner.frames,
            intervalMs: spinner.intervalMs,
          });
          el("pause").textContent = "pause";
          el("big-glyph").dataset.glyph = String(index);
          renderStrip(spinner, -1);
          document.querySelectorAll(".card").forEach(function (card) {
            var current = card.dataset.index === String(index) ? "true" : "false";
            card.setAttribute("aria-current", current);
          });
        }

        function renderStrip(spinner, marked) {
          var strip = el("strip");
          strip.textContent = "";
          spinner.frames.forEach(function (frame, frameIndex) {
            var button = document.createElement("button");
            button.type = "button";
            button.textContent = frame;
            button.setAttribute("aria-pressed", frameIndex === marked ? "true" : "false");
            button.addEventListener("click", function () {
              state.manualFrame = frameIndex;
              el("pause").textContent = "play";
              renderStrip(spinner, frameIndex);
            });
            strip.append(button);
          });
        }

        function paint() {
          var now = performance.now();
          SPINNERS.forEach(function (spinner, index) {
            var frame = frameOf(spinner, now);
            if (painted[index] === frame) return;
            painted[index] = frame;
            document.querySelectorAll('[data-glyph="' + String(index) + '"]').forEach(function (node) {
              node.textContent = frame;
            });
          });
          var grid = el("grid");
          grid.hidden = !el("grids").checked;
          if (!grid.hidden) grid.textContent = gridText(frameOf(SPINNERS[state.selected], now));
        }

        function copy(text, button) {
          var label = button.textContent;
          var done = function () {
            button.textContent = "copied";
            window.setTimeout(function () {
              button.textContent = label;
            }, 900);
          };
          if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(done, function () {
              fallback(text, done);
            });
            return;
          }
          fallback(text, done);
        }

        function fallback(text, done) {
          var area = document.createElement("textarea");
          area.value = text;
          document.body.append(area);
          area.select();
          document.execCommand("copy");
          area.remove();
          done();
        }

        el("own").addEventListener("change", function () {
          el("speed").disabled = el("own").checked;
        });
        el("speed").disabled = true;
        el("speed").addEventListener("input", function () {
          el("speed-value").textContent = el("speed").value + " ms";
        });
        el("speed-value").textContent = el("speed").value + " ms";
        el("size").addEventListener("input", function () {
          var size = Number(el("size").value);
          el("big-glyph").style.fontSize = size + "px";
          document.querySelectorAll(".card-glyph").forEach(function (node) {
            node.style.fontSize = Math.round(size / 2.5) + "px";
          });
        });
        el("size").dispatchEvent(new Event("input"));
        el("grids").addEventListener("change", function () {
          el("grid").hidden = !el("grids").checked;
        });
        el("pause").addEventListener("click", function () {
          state.manualFrame = state.manualFrame === null ? 0 : null;
          el("pause").textContent = state.manualFrame === null ? "pause" : "play";
          renderStrip(SPINNERS[state.selected], state.manualFrame === null ? -1 : state.manualFrame);
        });
        el("copy-frames").addEventListener("click", function () {
          copy(JSON.stringify(SPINNERS[state.selected].frames), el("copy-frames"));
        });
        el("copy-json").addEventListener("click", function () {
          copy(el("export").value, el("copy-json"));
        });
        document.addEventListener("keydown", function (event) {
          if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
          var step = event.key === "ArrowRight" ? 1 : -1;
          select((state.selected + step + SPINNERS.length) % SPINNERS.length);
        });

        renderGallery();
        select(0);
        paint();
        // The tick keeps a steady 16 ms clock. Each spinner then picks its own frame from real time.
        window.setInterval(paint, 16);
      })();
    </script>
  </body>
</html>
`;

/** Fills the page template with the spinner data and keeps a closing tag inside it harmless. */
export function renderSpinnerViewerHtml(spinners: readonly BrailleSpinner[]): string {
  const data = JSON.stringify(spinners).replaceAll("</", "<\\/");
  return PAGE.replace(DATA_PLACEHOLDER, data);
}
