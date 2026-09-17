// iOS Simulator — live interactive bridge (runs INSIDE the GitHub Actions macOS job)
// * Serves the viewer page
// * Streams real screenshots of the booted iOS Simulator (polled frames)
// * Converts viewer taps -> real taps inside the Simulator (cliclick / AppleScript)
// * Launches stock apps, home, lock via xcrun + keystrokes
// * Relays WebRTC signaling so viewers can open camera/mic to each other
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');
const { Server } = require('ws');

const UDID = process.env.UDID || '';
const PORT = process.env.PORT || 8080;
const FRAME = '/tmp/ios-sim-frame.png';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- continuous screenshot loop -> /frame ----
function snap() {
  if (!UDID) return;
  execFile('xcrun', ['simctl', 'io', UDID, 'screenshot', FRAME], (err) => {
    if (err) { /* ignore transient failures */ }
  });
}
setInterval(snap, 1400);
setTimeout(snap, 4000);

function sendFrame(ws) {
  if (ws.readyState !== 1) return;
  fs.readFile(FRAME, (err, buf) => {
    if (!err && ws.readyState === 1) {
      ws.send(buf, { binary: true, fin: true });
    }
  });
}

// ---- taps: map normalized (0..1) to a real click in the Simulator window ----
function osa(script) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 4000 }, (e, stdout) => resolve(stdout ? stdout.trim() : ''));
  });
}
async function simWindow() {
  const out = await osa(
    'tell application "System Events" to tell process "Simulator" to ' +
    'get {position, size} of window 1'
  );
  // returns "x, y, w, h"
  const m = out.match(/(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
}
async function realTap(nx, ny) {
  const w = await simWindow();
  if (!w) {
    // fallback: assume simulator window fills a 1024x768 desktop region
    return tapAt(60 + nx * 880, 20 + ny * 720);
  }
  const px = Math.round(w.x + nx * w.w);
  const py = Math.round(w.y + ny * w.h);
  return tapAt(px, py);
}
function tapAt(px, py) {
  return new Promise((resolve) => {
    // bring Simulator front, then click
    exec('osascript -e \'tell application "Simulator" to activate\' && sleep 0.3 && ' +
         `cliclick c:${px},${py}`, { timeout: 5000 }, (err) => resolve(!err));
  });
}
function keystroke(keys) {
  // keys like 'h using {command down, shift down}'
  return osa(
    'tell application "Simulator" to activate' + String.fromCharCode(10) +
    'tell application "System Events" to keystroke ' + JSON.stringify(keys)
  );
}

// ---- API ----
app.get('/frame', (req, res) => {
  fs.readFile(FRAME, (err, buf) => {
    if (err) return res.status(404).send('no frame yet');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(buf);
  });
});
app.post('/tap', async (req, res) => {
  const { x, y } = req.body || {};
  if (typeof x !== 'number' || typeof y !== 'number') return res.status(400).json({ ok: false });
  await realTap(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
  snap();
  res.json({ ok: true });
});
const APPS = {
  safari: 'com.apple.mobilesafari',
  settings: 'com.apple.Preferences',
  photos: 'com.apple.mobileslideshow',
  music: 'com.apple.Music',
  maps: 'com.apple.Maps',
  weather: 'com.apple.weather',
  messages: 'com.apple.MobileSMS',
  phone: 'com.apple.mobilephone',
};
app.post('/app', async (req, res) => {
  const id = (req.body || {}).id;
  const bundle = APPS[id];
  if (!bundle) return res.status(404).json({ ok: false, msg: 'unknown app' });
  exec(`xcrun simctl launch ${UDID} ${bundle}`, () => {});
  res.json({ ok: true });
});
app.post('/home', async (req, res) => {
  // Cmd+Shift+H = Home in Simulator
  await keystroke('h using {command down, shift down}');
  snap();
  res.json({ ok: true });
});
app.post('/lock', async (req, res) => {
  await keystroke('l using {command down}'); // Cmd+L = Lock
  snap();
  res.json({ ok: true });
});

// ---- WebSocket: frames + WebRTC signaling relay ----
const server = http.createServer(app);
const wss = new Server({ server });
const peers = new Map();
let nid = 1;

wss.on('connection', (ws) => {
  const id = nid++;
  peers.set(id, ws);
  ws.send(JSON.stringify({ type: 'welcome', id }));

  const frameTimer = setInterval(() => sendFrame(ws), 1500);

  ws.on('message', (buf) => {
    let m;
    try { m = JSON.parse(buf.toString()); } catch { return; }
    if (m.type === 'signal' && m.to && peers.has(m.to)) {
      peers.get(m.to).send(JSON.stringify({ type: 'signal', from: id, data: m.data }));
    } else if (m.type === 'broadcast') {
      for (const [pid, p] of peers) if (pid !== id) p.send(JSON.stringify({ type: 'broadcast', from: id, data: m.data }));
    }
  });
  ws.on('close', () => { clearInterval(frameTimer); peers.delete(id); });
});

server.listen(PORT, '0.0.0.0', () => console.log('iOS live bridge on 0.0.0.0:' + PORT));
