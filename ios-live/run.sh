#!/bin/bash
# Boots the real iOS Simulator inside GitHub Actions, serves a live interactive
# page (screen feed + controls + WebRTC camera/call), and exposes it through a
# Cloudflare quick tunnel. The public URL is printed to the job log + summary and
# pushed to this repo (IOS_LIVE_URL.txt). Job stays alive ~2 hours so you can use it.
set -e
cd "$GITHUB_WORKSPACE/ios-live"
export PORT="${PORT:-8080}"

# ---- 1) pick + boot a device (real Xcode iOS Simulator) ----
UDID=$(xcrun simctl list devices available | grep -m1 -E 'iPhone' | grep -oE '[0-9A-F-]{36}' | head -1)
[ -z "$UDID" ] && UDID=$(xcrun simctl list devices available | grep -m1 -oE '[0-9A-F-]{36}')
export UDID
echo "UDID=$UDID"
xcrun simctl boot "$UDID" 2>/dev/null || echo "(already booted)"
xcrun simctl bootstatus "$UDID" -b
open -a Simulator 2>/dev/null || true
# get a clean home screen first
sleep 5

# ---- 2) best-effort tap tool (background; harmless if it fails) ----
( brew install cliclick >/dev/null 2>&1 || true ) &

# ---- 3) interactive server (screen feed + controls + WebRTC signaling) ----
node server.js > server.log 2>&1 &
SRV=$!
sleep 2
if ! kill -0 $SRV 2>/dev/null; then echo "SERVER FAILED"; cat server.log; exit 1; fi

# ---- 4) Cloudflare quick tunnel (macOS artifacts are .tgz) ----
ARCH=$(uname -m)
[ "$ARCH" = "arm64" ] && CFARCH=arm64 || CFARCH=amd64
curl -sL -o cf.tgz "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${CFARCH}.tgz"
tar xzf cf.tgz
chmod +x cloudflared
./cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate > cf.log 2>&1 &
CFP=$!

# ---- 5) wait for the public URL ----
URL=""
for i in $(seq 1 120); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' cf.log | head -1 || true)
  [ -n "$URL" ] && break
  sleep 2
done

echo "=================================================="
echo "  📱 iOS SIMULATOR IS LIVE: $URL"
echo "=================================================="
{
  echo "## 📱 iOS Simulator — Live & interactive"
  echo "**Open now (works on phone or desktop):**"
  echo ""
  echo "🚀 $URL"
  echo ""
  echo "_Tap the screen to touch the simulator, use the app buttons, turn your camera on for WebRTC fun. The tunnel stays up ~2 hours._"
} >> "$GITHUB_STEP_SUMMARY"

# ---- 6) push the URL into the repo for easy later access ----
if [ -n "$URL" ]; then
  echo "$URL" > ../IOS_LIVE_URL.txt
  git config user.name 'github-actions[bot]'
  git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
  git add ../IOS_LIVE_URL.txt
  git commit -m "iOS simulator live URL [skip ci]" 2>/dev/null || true
  git pull --rebase origin main --no-edit >/dev/null 2>&1 || true
  git push origin HEAD:main 2>/dev/null || true
fi

# ---- 7) keep the job (and tunnel) alive so you can play ~2 hours ----
echo "Keeping the tunnel open for 2 hours…"
for t in $(seq 1 720); do
  sleep 10
done

kill $SRV $CFP 2>/dev/null || true
