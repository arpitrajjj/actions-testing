// Android Emulator — LIVE low-latency stream bridge (binary frames + adb touch)
// * /stream : continuous raw screenshots -> WebSocket binary frames (fast, no re-encoding)
// * client taps/swipes -> POST /touch -> `adb shell input` (tap/swipe/drag)
// * /frame : single PNG (fallback for simple GET polling)
const express = require('express');
const http = require('http');
const { execFile } = require('child_process');
const { Server } = require('ws');
const path = require('path');

const PORT = process.env.PORT || 8090;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new Server({ server });

// ---- where we keep the latest frame ----
let frameBuf = Buffer.alloc(0);
let frameW = 540, frameH = 1170;
let snapBusy = false;

// Compact video-size frame (fast): cap the screenshot at a reasonable size.
// adb exec-out screencap -p is a full PNG; we keep the latest in memory.
function snap() {
  if (snapBusy) return;
  snapBusy = true;
  // encoding:'buffer' keeps stdout as a raw Buffer (PNG bytes untouched)
  execFile('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (err, stdout) => {
    snapBusy = false;
    if (err) { /* transient; try again soon */ return; }
    if (stdout && stdout.length > 1000) frameBuf = stdout;
  });
}
setInterval(snap, 120);          // ~8 fps — low latency, still smooth
setTimeout(snap, 2000);

// ---- geometry (used to scale tap coords) ----
function getSize() {
  return new Promise((resolve) => {
    execFile('adb', ['shell', 'wm', 'size'], (e, so) => {
      const m = (/Physical size: (\d+)x(\d+)/).exec(so || '');
      if (m) { frameW = +m[1]; frameH = +m[2]; }
      resolve();
    });
  });
}
getSize();
setInterval(getSize, 60000);

// ---- touch relay: normalized (0..1) -> adb input ----
function adb(cmd, args) {
  return new Promise((resolve) => execFile('adb', [cmd, ...args], { timeout: 3000 }, () => resolve()));
}

app.get('/frame', (req, res) => {
  if (frameBuf.length === 0) {
    // try one fresh snapshot synchronously
    return execFile('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (err, stdout) => {
      if (err) return res.status(404).send('no frame yet');
      res.set('Content-Type', 'image/png').set('Cache-Control', 'no-store');
      res.send(stdout);
    });
  }
  res.set('Content-Type', 'image/png').set('Cache-Control', 'no-store');
  res.send(frameBuf);
});

app.get('/size', (req, res) => res.json({ w: frameW, h: frameH }));

app.post('/touch', async (req, res) => {
  const { x, y, type } = req.body || {};
  if (typeof x !== 'number' || typeof y !== 'number') return res.status(400).json({ ok: false });
  const px = Math.round(x * frameW), py = Math.round(y * frameH);
  const t = type || 'tap';
  try {
    if (t === 'tap') await adb('shell', ['input', 'tap', String(px), String(py)]);
    else if (t === 'swipe') {
      const { x2 = x, y2 = y, ms = 200 } = req.body;
      await adb('shell', ['input', 'swipe', String(px), String(py), String(Math.round(x2 * frameW)), String(Math.round(y2 * frameH)), String(ms)]);
    }
    res.json({ ok: true, px, py });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.post('/key', async (req, res) => {
  const k = (req.body || {}).k;
  await adb('shell', ['input', 'keyevent', String(k)]);
  res.json({ ok: true });
});
app.post('/home', async (req, res) => {
  await adb('shell', ['input', 'keyevent', '3']);
  res.json({ ok: true });
});
app.post('/back', async (req, res) => {
  await adb('shell', ['input', 'keyevent', '4']);
  res.json({ ok: true });
});
app.post('/text', async (req, res) => {
  const t = (req.body || {}).t;
  if (typeof t === 'string' && t) await adb('shell', ['input', 'text', t]);
  res.json({ ok: true });
});

// ---- WebSocket: push raw frames at high rate ----
wss.on('connection', (ws) => {
  const timer = setInterval(() => {
    if (ws.readyState !== 1) return clearInterval(timer);
    if (frameBuf.length) ws.send(frameBuf);   // binary PNG frame
  }, 120);
  ws.on('close', () => clearInterval(timer));
});

server.listen(PORT, '0.0.0.0', () => console.log('android live bridge on 0.0.0.0:' + PORT));
