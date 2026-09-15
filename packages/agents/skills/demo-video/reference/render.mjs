// Render a deterministic canvas film to PNG previews, a poster, or an MP4.
//
// Usage: node render.mjs <preview|poster|video> [options]
//   --page film.html        page with a 1920x1080 <canvas id="film"> and window.renderFrame(t)
//   --out name              output stem (default: film) -> name.mp4, name-poster.png, name-previews/
//   --music bed.wav         audio bed for video mode (optional)
//   --fps 30 --duration 90  frame rate and length in seconds
//   --previews 1,6,12       times for preview frames (default: from window.FILM.previewTimes)
//   --poster 3              time for the poster frame (default: window.FILM.posterTime or 2)
//   --chrome /usr/bin/google-chrome
//
// Page contract:
//   window.ready        promise that resolves once fonts and assets are loaded and verified
//   window.renderFrame  async (t) => draws the frame for time t seconds and resolves
//   window.FILM         optional { duration, fps, previewTimes, posterTime }
//   window.fontEvidence optional array of loaded FontFace descriptors, written next to the output
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const args = process.argv.slice(2);
const mode = args.shift() || 'preview';
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const root = process.cwd();
const page = path.resolve(root, opt('page', 'film.html'));
const stem = opt('out', 'film');
const music = opt('music');
const chromeBin = opt('chrome', '/usr/bin/google-chrome');
const previewDir = path.join(root, `${stem}-previews`);
await mkdir(previewDir, {recursive: true});

const chrome = spawn(chromeBin, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--disable-background-networking', '--disable-component-update', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--disable-sync',
  '--allow-file-access-from-files', '--hide-scrollbars', '--remote-debugging-port=0',
  '--user-data-dir=' + path.join(root, '.chrome-' + mode), '--window-size=1920,1080', 'about:blank',
], {stdio: ['ignore', 'ignore', 'pipe']});

let diagnostic = '';
const endpoint = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Chrome startup timeout: ' + diagnostic)), 30000);
  chrome.stderr.on('data', (b) => {
    diagnostic += b.toString();
    const m = diagnostic.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if (m) { clearTimeout(timeout); resolve(m[1]); }
  });
  chrome.on('exit', (code) => reject(new Error('Chrome exited ' + code + ': ' + diagnostic)));
});

const ws = new WebSocket(endpoint);
await once(ws, 'open');
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const {resolve, reject} = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, {resolve, reject});
  ws.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
});
const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
const call = (method, params = {}) => send(method, params, sessionId);
async function evaluate(expression) {
  const r = await call('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function screenshot(file) {
  const {data} = await call('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
  await writeFile(file, Buffer.from(data, 'base64'));
  console.log(file);
}

let encoder;
try {
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', {width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false});
  await call('Page.navigate', {url: pathToFileURL(page).href});
  for (let n = 0; n < 100; n++) {
    if (await evaluate('!!window.ready')) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await evaluate('window.ready');
  const film = (await evaluate('JSON.stringify(window.FILM || {})')) ?? '{}';
  const settings = JSON.parse(film);
  const fps = Number(opt('fps', settings.fps ?? 30));
  const duration = Number(opt('duration', settings.duration ?? 90));
  const fonts = await evaluate('JSON.stringify(window.fontEvidence || null)');
  if (fonts && fonts !== 'null') await writeFile(path.join(root, `${stem}-font-load-check.json`), fonts + '\n');
  console.log(`Page ready. Mode: ${mode}. ${fps} fps, ${duration} s.`);

  if (mode === 'preview') {
    const times = (opt('previews') ? opt('previews').split(',').map(Number) : settings.previewTimes) ?? [1, 5, 10, 20, 30, 45, 60, 75, 85];
    for (const t of times) {
      await evaluate(`window.renderFrame(${t})`);
      await screenshot(path.join(previewDir, `frame-${String(t).padStart(3, '0')}.png`));
    }
  } else if (mode === 'poster') {
    await evaluate(`window.renderFrame(${Number(opt('poster', settings.posterTime ?? 2))})`);
    await screenshot(path.join(root, `${stem}-poster.png`));
  } else if (mode === 'video') {
    const output = path.join(root, `${stem}.mp4`);
    const ffArgs = ['-hide_banner', '-loglevel', 'warning', '-y',
      '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0'];
    if (music) ffArgs.push('-i', path.resolve(root, music), '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
    ffArgs.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level:v', '4.2',
      '-movflags', '+faststart', '-t', String(duration), output);
    encoder = spawn('ffmpeg', ffArgs, {stdio: ['pipe', 'ignore', 'pipe']});
    let err = '';
    encoder.stderr.on('data', (b) => (err += b.toString()));
    const ended = new Promise((resolve, reject) => encoder.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('FFmpeg ' + code + ': ' + err)))));
    ended.catch(() => {});
    encoder.stdin.on('error', () => {});
    const start = Date.now();
    const total = Math.round(duration * fps);
    for (let frame = 0; frame < total; frame++) {
      const b64 = await evaluate(`window.renderFrame(${frame / fps}).then(() => document.getElementById('film').toDataURL('image/jpeg', 0.96).split(',')[1])`);
      if (!encoder.stdin.write(Buffer.from(b64, 'base64'))) await once(encoder.stdin, 'drain');
      if (frame % (fps * 5) === 0) console.log(`frame ${frame}/${total}; ${((Date.now() - start) / 1000).toFixed(1)} s elapsed`);
    }
    encoder.stdin.end();
    await ended;
    console.log('Created', output);
    if (err) console.log(err);
  } else {
    throw new Error('Unknown mode ' + mode);
  }
} finally {
  try { await send('Browser.close'); } catch {}
  ws.close();
}
