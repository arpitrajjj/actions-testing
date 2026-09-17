#!/bin/bash
# Android emulator — LIVE interactive stream (raw frames + adb touch) on macOS.
set -e
cd "$GITHUB_WORKSPACE/android-live"
export PORT="${PORT:-8090}"
export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$PATH"

echo "arch=$(uname -m) hv=$(sysctl -n kern.hv_support 2>/dev/null || echo 0)"

# ---- 1) create AVD (image already installed by the workflow) ----
echo no | avdmanager create avd --force -n live -k 'system-images;android-35;google_apis;arm64-v8a' -d pixel_7 || \
echo no | avdmanager create avd --force -n live -k 'system-images;android-35;google_apis;arm64-v8a'

# ---- 2) boot headless, software rendering, software CPU (no nested virt) ----
nohup "$ANDROID_SDK_ROOT/emulator/emulator" -avd live \
  -no-window -no-audio -no-boot-anim -no-snapshot \
  -gpu swiftshader_indirect -accel off \
  -memory 2048 -cores 2 > emu.log 2>&1 &
EMUP=$!

echo "waiting for device…"
adb wait-for-device
B=""
for i in $(seq 1 240); do
  B=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  [ "$B" = "1" ] && break
  sleep 3
done
echo "boot_completed=$B"
[ "$B" = "1" ] || { echo "BOOT TIMED OUT"; tail -30 emu.log; exit 1; }

adb shell input keyevent 82 >/dev/null 2>&1 || true
adb shell settings put system screen_off_timeout 2147483647 || true
adb shell wm size

# ---- 3) stream server ----
npm install --no-audit --no-fund >/dev/null 2>&1 || true
node server.js > server.log 2>&1 &
SRV=$!
sleep 2
kill -0 $SRV 2>/dev/null || { echo "SERVER FAILED"; cat server.log; exit 1; }

# ---- 4) Cloudflare quick tunnel ----
ARCH=$(uname -m)
[ "$ARCH" = "arm64" ] && CFARCH=arm64 || CFARCH=amd64
curl -sL -o cf.tgz "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${CFARCH}.tgz"
tar xzf cf.tgz && chmod +x cloudflared
./cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate > cf.log 2>&1 &
CFP=$!

URL=""
for i in $(seq 1 120); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' cf.log | head -1 || true)
  [ -n "$URL" ] && break
  sleep 2
done
echo "=================================================="
echo "  📱 ANDROID EMULATOR IS LIVE: $URL"
echo "  (tap/swipe directly on the screen — low latency)"
echo "=================================================="
{
  echo "## 📱 Android Emulator — Live & interactive (macOS runner)"
  echo "**Open now:** $URL"
  echo ""
  echo "_Tap / swipe / drag directly on the screen — no buttons. adb input relays every touch. ~2 hours._"
} >> "$GITHUB_STEP_SUMMARY"

# ---- 5) push URL to repo ----
if [ -n "$URL" ]; then
  echo "$URL" > ../ANDROID_LIVE_URL.txt
  git config user.name 'github-actions[bot]'
  git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
  git add -f ../ANDROID_LIVE_URL.txt
  ( git commit -m "Android emulator live URL [skip ci]" && git push origin HEAD:main ) 2>/dev/null || true
fi

# ---- 6) keep alive ~2 hours ----
echo "Keeping the tunnel open for 2 hours…"
for t in $(seq 1 720); do sleep 10; done

kill $SRV $CFP $EMUP 2>/dev/null || true
