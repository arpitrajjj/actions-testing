// Android Emulator — LIVE viewer. Low-latency raw-frame stream + direct touch.
(() => {
  const img = document.getElementById('screen');
  const stage = document.getElementById('stage');
  const ripple = document.getElementById('ripple');
  const DOT = document.querySelector('#status .dot');
  const STAT = document.getElementById('stat');
  const LAT = document.getElementById('lat');

  // ---------- ultra low-latency frame stream (WS binary) ----------
  function connectStream() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(proto + '://' + location.host);
    ws.binaryType = 'arraybuffer';
    let t0 = 0;
    ws.onopen = () => { DOT.classList.add('on'); STAT.textContent = 'live'; };
    ws.onclose = () => { DOT.classList.remove('on'); STAT.textContent = 'reconnect'; setTimeout(connectStream, 1500); };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') return;
      const now = performance.now();
      if (t0) LAT.textContent = Math.round(now - t0) + 'ms';
      t0 = now;
      const blob = new Blob([ev.data], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); };
      img.src = url;
    };
  }

  // fallback polling if WS is broken
  let wsDeadAt = 0;
  setInterval(async () => {
    if (DOT.classList.contains('on')) { wsDeadAt = Date.now(); return; }
    if (Date.now() - wsDeadAt < 8000) return;
    const r = await fetch('/frame?t=' + Date.now());
    if (r.ok) { const b = await r.blob(); img.src = URL.createObjectURL(b); }
  }, 800);

  // ---------- touch -> adb ----------
  const $ripple = (x, y) => {
    ripple.style.left = x + 'px'; ripple.style.top = y + 'px';
    ripple.classList.add('show');
    clearTimeout(ripple._t);
    ripple._t = setTimeout(() => ripple.classList.remove('show'), 220);
  };

  function posting(body) {
    fetch('/touch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  }

  let down = null, moved = false, lastTap = 0;
  stage.addEventListener('pointerdown', (e) => {
    const p = pos(e);
    down = { x: p.x, y: p.y, t: Date.now() }; moved = false;
    stage.setPointerCapture(e.pointerId);
    $ripple(e.clientX, e.clientY);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!down) return;
    const p = pos(e);
    const dx = p.x - down.x, dy = p.y - down.y;
    if (dx * dx + dy * dy > 24 * 24 && !moved) moved = true;
    // live drag feedback
    $ripple(e.clientX, e.clientY);
  });
  stage.addEventListener('pointerup', (e) => {
    if (!down) return;
    const p = pos(e);
    const dur = Date.now() - down.t;
    if (!moved) {
      if (dur < 350) {
        // tap (double-tap detection not required)
        posting({ x: down.x, y: down.y, type: 'tap' });
      } else {
        posting({ x: down.x, y: down.y, type: 'swipe', x2: p.x, y2: p.y, ms: Math.min(600, dur) });
      }
    } else {
      posting({ x: down.x, y: down.y, type: 'swipe', x2: p.x, y2: p.y, ms: Math.min(600, dur) });
    }
    down = null;
  });
  stage.addEventListener('pointercancel', () => (down = null));

  function pos(e) {
    const r = img.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    };
  }

  // keys
  document.getElementById('b-home').onclick = () => fetch('/home', { method: 'POST' });
  document.getElementById('b-back').onclick = () => fetch('/back', { method: 'POST' });
  document.getElementById('b-recent').onclick = () => fetch('/key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k: 187 }) });
  document.getElementById('b-send').onclick = () => {
    const t = document.getElementById('txt').value;
    if (t) fetch('/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t }) });
  };

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace') fetch('/key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k: 67 }) });
  });

  connectStream();
})();
