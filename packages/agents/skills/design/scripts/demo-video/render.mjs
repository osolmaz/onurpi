// Deterministic canvas frames to new PNG previews, a poster, or an MP4.
// Run from the task project with Node 22+, Chrome/Chromium, and FFmpeg.
// Fonts, evidence extraction, text-fit assertions, and music preparation belong
// to the film page and workflow. This helper never establishes their correctness.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HELP = `Usage: node render.mjs <preview|poster|video> [options]
  --page film.html      page with canvas#film, window.ready and renderFrame(t)
  --out film           new output stem; existing outputs are never replaced
  --music bed.wav      prepared licensed audio bed (video only)
  --fps 30             positive integer frame rate
  --duration 90        positive duration in seconds
  --previews 1,6,12     preview times, each within the film
  --poster 2           poster time within the film
  --chrome PATH        installed Chrome/Chromium executable
Page metadata: window.FILM = { duration, fps, previewTimes, posterTime }.
Optional window.fontEvidence records actual loaded faces per render mode.
`;
const OPTIONS = new Set(["page", "out", "music", "fps", "duration", "previews", "poster", "chrome"]);

export function parseOptions(argv) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  const [mode = "preview", ...args] = argv;
  if (!["preview", "poster", "video"].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  const options = { mode };
  for (let i = 0; i < args.length; i += 2) readOption(args, i, options);
  return options;
}

function readOption(args, index, options) {
  const key = args[index].replace(/^--/, "");
  if (!args[index].startsWith("--") || !OPTIONS.has(key)) throw new Error(`Unknown option: ${args[index]}`);
  if (Object.hasOwn(options, key)) throw new Error(`Duplicate option: --${key}`);
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value: --${key}`);
  options[key] = value;
}

function positive(value, name, integer = false) {
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "") {
    throw new Error(`Invalid ${name}`);
  }
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0 || (integer && !Number.isSafeInteger(result))) {
    throw new Error(`Invalid ${name}`);
  }
  return result;
}

function frameTime(value, duration) {
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "") {
    throw new Error("Invalid frame time");
  }
  const time = Number(value);
  if (!Number.isFinite(time) || time < 0 || time >= duration) throw new Error("Frame time outside film");
  return time;
}

function setting(options, film, key, fallback) {
  return options[key] ?? film[key] ?? fallback;
}

function previewSettings(options, film, duration) {
  const defaults = [0, 1, 5, 10, 20, 30, 45, 60, 75, 85].filter((t) => t < duration);
  const times = options.previews?.split(",") ?? film.previewTimes ?? defaults;
  if (!Array.isArray(times) || times.length === 0) throw new Error("Preview times must be a nonempty array");
  const result = times.map((t) => frameTime(t, duration));
  if (new Set(result).size !== result.length) throw new Error("Duplicate preview times");
  return result;
}

export function resolveSettings(options, film = {}) {
  if (!film || typeof film !== "object" || Array.isArray(film)) throw new Error("Invalid window.FILM");
  const fps = positive(setting(options, film, "fps", 30), "fps", true);
  const duration = positive(setting(options, film, "duration", 90), "duration");
  const total = Math.round(fps * duration);
  if (!Number.isSafeInteger(total) || total < 1) throw new Error("Invalid frame count");
  const previewTimes = previewSettings(options, film, duration);
  const posterTime = frameTime(setting({ posterTime: options.poster }, film, "posterTime", Math.min(2, duration / 2)), duration);
  return { fps, duration, total, previewTimes, posterTime };
}

export function encoderArgs(settings, output, music) {
  const args = ["-hide_banner", "-loglevel", "warning", "-n", "-f", "image2pipe",
    "-vcodec", "mjpeg", "-framerate", String(settings.fps), "-i", "pipe:0"];
  if (music) args.push("-i", path.resolve(music), "-map", "0:v:0", "-map", "1:a:0",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2");
  args.push("-vf", "scale=in_range=full:out_range=tv,format=yuv420p", "-color_range", "tv",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-profile:v", "high", "-movflags", "+faststart", "-t", String(settings.duration), output);
  return args;
}

async function assertNew(file) {
  try {
    await access(file);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Refusing to replace ${file}`);
}

function launchBrowser(executable, profile) {
  const child = spawn(executable, [
    "--headless=new", "--disable-gpu", "--disable-background-networking",
    "--disable-component-update", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-sync", "--hide-scrollbars",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "--window-size=1920,1080", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = new Promise((resolve, reject) => {
    let diagnostic = "";
    const timer = setTimeout(() => reject(new Error(`Chrome startup timeout: ${diagnostic}`)), 30000);
    const fail = (error) => { clearTimeout(timer); reject(error); };
    child.once("error", fail);
    child.once("exit", (code) => fail(new Error(`Chrome exited ${code}: ${diagnostic}`)));
    child.stderr.on("data", (data) => {
      diagnostic = (diagnostic + data.toString()).slice(-16000);
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(diagnostic);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  return { child, endpoint };
}

async function connect(endpoint) {
  const ws = new WebSocket(endpoint);
  let seq = 0;
  const pending = new Map();
  const rejectPending = () => {
    for (const entry of pending.values()) entry.reject(new Error("Chrome connection closed"));
    pending.clear();
  };
  ws.addEventListener("close", rejectPending);
  ws.addEventListener("error", rejectPending);
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });
  const timeout = AbortSignal.timeout(30000);
  try { await once(ws, "open", { signal: timeout }); }
  catch (error) { ws.close(); throw error; }
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Chrome request timeout: ${method}`));
    }, 30000);
    const finish = (callback) => (value) => { clearTimeout(timer); callback(value); };
    pending.set(id, { resolve: finish(resolve), reject: finish(reject) });
    try { ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
    catch (error) { pending.get(id).reject(error); pending.delete(id); }
  });
  return { send, close: () => { rejectPending(); ws.close(); } };
}

async function openPage(connection, page) {
  const { targetId } = await connection.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await connection.send("Target.attachToTarget", { targetId, flatten: true });
  const call = (method, params = {}) => connection.send(method, params, sessionId);
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const navigation = await call("Page.navigate", { url: pathToFileURL(page).href });
  if (navigation.errorText) throw new Error(navigation.errorText);
  for (let n = 0; n < 100; n++) {
    if (await evaluate("typeof window.renderFrame === 'function' && !!window.ready")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await evaluate(`(async () => {
    if (!window.ready || typeof window.ready.then !== 'function') throw Error('Missing window.ready promise');
    await window.ready;
    if (typeof window.renderFrame !== 'function') throw Error('Missing window.renderFrame');
    const canvas = document.getElementById('film');
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width !== 1920 || canvas.height !== 1080)
      throw Error('Expected a 1920x1080 canvas#film');
  })()`);
  return { call, evaluate };
}

async function renderPng(page, time, file) {
  await page.evaluate(`Promise.resolve(window.renderFrame(${time}))`);
  const { data } = await page.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(file, Buffer.from(data, "base64"), { flag: "wx" });
  console.log(file);
}

async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close").catch(() => { /* The original process error is reported by its caller. */ });
  const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
  try { child.kill("SIGTERM"); await closed; }
  finally { clearTimeout(timer); }
}

async function renderVideo(page, settings, output, music, children) {
  const child = spawn("ffmpeg", encoderArgs(settings, output, music), { stdio: ["pipe", "ignore", "pipe"] });
  children.push(child);
  let diagnostic = "";
  child.stderr.on("data", (data) => { diagnostic = (diagnostic + data.toString()).slice(-16000); });
  const ended = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg ${code}: ${diagnostic}`)));
  });
  // A premature encoder exit must interrupt frame rendering or backpressure waits.
  const premature = ended.then(() => { throw new Error("FFmpeg exited before all frames were sent"); });
  premature.catch(() => { /* The active race or ended promise reports the failure. */ });
  child.stdin.on("error", () => { /* Encoder close and backpressure waits report failure. */ });
  const start = Date.now();
  for (let frame = 0; frame < settings.total; frame++) {
    const expression = `Promise.resolve(window.renderFrame(${frame / settings.fps})).then(() =>
      document.getElementById('film').toDataURL('image/jpeg', 0.96).split(',')[1])`;
    const data = await Promise.race([page.evaluate(expression), premature]);
    if (!child.stdin.write(Buffer.from(data, "base64"))) {
      await Promise.race([once(child.stdin, "drain"), premature]);
    }
    if (frame % (settings.fps * 5) === 0) console.log(`frame ${frame}/${settings.total}; ${(Date.now() - start) / 1000}s elapsed`);
  }
  child.stdin.end();
  await ended;
  console.log(`Created ${output}`);
}

async function renderMode(page, options, settings, stem, children) {
  if (options.mode === "preview") {
    const directory = `${stem}-previews`;
    await mkdir(directory); // EEXIST refuses an older preview set.
    for (const time of settings.previewTimes) await renderPng(page, time, path.join(directory, `frame-${time}.png`));
  } else if (options.mode === "poster") {
    await renderPng(page, settings.posterTime, `${stem}-poster.png`);
  } else {
    await renderVideo(page, settings, `${stem}.mp4`, options.music, children);
  }
}

async function prepare(options) {
  // Reject invalid explicit settings before launching a browser.
  if (options.fps !== undefined) positive(options.fps, "fps", true);
  if (options.duration !== undefined) positive(options.duration, "duration");
  const pagePath = path.resolve(options.page ?? "film.html");
  await access(pagePath);
  if (options.music) await access(options.music);
  const stem = path.resolve(options.out ?? "film");
  const suffix = { preview: "-previews", poster: "-poster.png", video: ".mp4" }[options.mode];
  await assertNew(stem + suffix);
  const fontPath = `${stem}-${options.mode}-font-load-check.json`;
  await assertNew(fontPath);
  await mkdir(path.dirname(stem), { recursive: true });
  return { pagePath, stem, fontPath };
}

export async function main(argv) {
  const options = parseOptions(argv);
  if (options.help) { console.log(HELP); return; }
  const { pagePath, stem, fontPath } = await prepare(options);
  const profile = await mkdtemp(path.join(tmpdir(), "design-render-"));
  const children = [];
  let connection;
  const interrupt = () => { for (const child of children) child.kill("SIGTERM"); };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const browser = launchBrowser(options.chrome ?? "google-chrome", profile);
    children.push(browser.child);
    connection = await connect(await browser.endpoint);
    const page = await openPage(connection, pagePath);
    const settings = resolveSettings(options, await page.evaluate("window.FILM ?? {}"));
    const fonts = await page.evaluate("window.fontEvidence ?? null");
    if (fonts !== null) await writeFile(fontPath, JSON.stringify(fonts, null, 2) + "\n", { flag: "wx" });
    console.log(`Page ready. ${settings.fps} fps, ${settings.duration}s.`);
    await renderMode(page, options, settings, stem, children);
    console.log(`DONE ${options.mode} ${stem}`);
  } finally {
    connection?.close();
    await Promise.all(children.map(stopChild));
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await rm(profile, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
