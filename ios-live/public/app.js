// iOS Simulator — viewer controller
// * live screen frames over WebSocket (/frame) with <img> refresh
// * taps -> POST /tap (real clicks in the simulator)
// * app buttons -> POST /app
// * WebRTC camera/call between viewers (signaling via the same WS)
(() => {
  const $ = s => document.querySelector(s);
  const img = $('#screen');
  const noframe = $('#noframe');
  const DOT = document.querySelector('#status .dot');
  let ws = null, myId = null;
  const peerConns = new Map();

  const APPS = [
    ['safari','Safari','🧭'], ['settings','Settings','⚙️'], ['photos','Photos','🖼️'],
    ['music','Music','🎵'], ['maps','Maps','🗺️'], ['weather','Weather','🌤️'],
    ['messages','Messages','💬'], ['phone','Phone','📞'],
  ];
  $('#appgrid').innerHTML = APPS.map(([id,n,e]) =>
    `<button class="appbtn" data-app="${id}"><span class="e">${e}</span>${n}</button>`).join('');
  document.querySelectorAll('.appbtn').forEach(b => b.onclick = () => {
    fetch('/app', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: b.dataset.app }) });
    flash('Launching ' + b.textContent.trim());
  });

  $('#btn-home').onclick = () => fetch('/home', {method:'POST'});
  $('#btn-lock').onclick = () => fetch('/lock', {method:'POST'});
  $('#btn-wake').onclick = () => fetch('/tap', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({x:0.5,y:0.5})});

  let lastFrame = 0;
  async function refreshFrame(){
    try {
      const r = await fetch('/frame?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        const blob = await r.blob();
        img.src = URL.createObjectURL(blob);
        noframe.style.display = 'none';
        lastFrame = Date.now();
      }
    } catch {}
  }

  // ---- tap -> normalized coords -> POST /tap ----
  let peakT;
  function peakAt(x,y){
    const p = $('#peak');
    p.style.left = x + 'px'; p.style.top = y + 'px';
    p.style.opacity = '1';
    clearTimeout(peakT); peakT = setTimeout(()=> p.style.opacity = '0', 500);
  }
  img.addEventListener('click', (e) => {
    const r = img.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    peakAt(e.clientX - r.left, e.clientY - r.top);
    fetch('/tap', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ x, y }) });
  });

  // ---- WebRTC ----
  const RTC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  let localStream = null;
  $('#btn-cam').onclick = async () => {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      $('#localvideo').srcObject = localStream;
      $('#localvideo').style.display = 'block';
      $('#rtc-hint').textContent = 'Camera live — new viewers will see you over WebRTC.';
      for (const [id] of peerConns) offerTo(id);
      if (ws) ws.send(JSON.stringify({ type:'broadcast', data: { t:'cam-on' } }));
    } catch(e) {
      $('#rtc-hint').textContent = 'Camera/mic denied or unavailable in this browser.';
    }
  };
  $('#btn-call').onclick = async () => {
    try {
      if (!localStream) localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      for (const [id] of peerConns) offerTo(id);
      $('#rtc-hint').textContent = 'Call started — joined to all connected viewers.';
    } catch(e) { $('#rtc-hint').textContent = 'Mic/camera denied — cannot start call.'; }
  };

  function makePC(id) {
    const pc = new RTC({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    peerConns.set(id, pc);
    pc.onicecandidate = (ev) => { if (ev.candidate) sendSig(id, { c: ev.candidate }); };
    pc.ontrack = (ev) => {
      let v = document.getElementById('rv-' + id);
      if (!v) {
        v = document.createElement('video');
        v.id = 'rv-' + id; v.autoplay = v.playsinline = true;
        $('#callvideos').appendChild(v);
      }
      v.srcObject = ev.streams[0];
    };
    if (localStream) for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
    return pc;
  }
  async function offerTo(id) {
    const pc = peerConns.get(id) || makePC(id);
    const o = await pc.createOffer();
    await pc.setLocalDescription(o);
    sendSig(id, { d: o });
  }
  async function onSig(from, data) {
    let pc = peerConns.get(from) || makePC(from);
    if (data.d) {
      if (data.d.type === 'offer') {
        await pc.setRemoteDescription(data.d);
        const a = await pc.createAnswer();
        await pc.setLocalDescription(a);
        sendSig(from, { d: a });
      } else if (data.d.type === 'answer') {
        await pc.setRemoteDescription(data.d);
      }
    } else if (data.c) {
      try { await pc.addIceCandidate(data.c); } catch {}
    }
  }
  function sendSig(to, data) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type:'signal', to, data })); }

  // ---- WebSocket: frames + signaling ----
  function connect(){
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { DOT.classList.add('on'); $('#status').textContent = 'connected to simulator '; $('#status').appendChild(DOT); };
    ws.onclose = () => { DOT.classList.remove('on'); setTimeout(connect, 2500); };
    ws.onerror = () => { try{ws.close();}catch{} };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return; // binary frames handled below
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'welcome') {
        myId = m.id;
      } else if (m.type === 'signal') {
        onSig(m.from, m.data);
      } else if (m.type === 'broadcast') {
        if (m.data && m.data.t === 'cam-on') { /* another viewer turned their camera on */ }
      }
    };
  }
  // Note: the server sends binary frames too; refreshFrame() in parallel keeps it
  // simple and reliable across browsers.

  connect();
  setInterval(refreshFrame, 1500);
  refreshFrame();

  function flash(msg){
    const el = $('#info');
    el.textContent = msg;
    setTimeout(()=> el.textContent = 'Tap = real click in the Simulator · Apps launch real iOS apps · Home = ⌘⇧H.', 2500);
  }
})();
