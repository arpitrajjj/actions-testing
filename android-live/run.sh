#!/bin/bash
# Android emulator — LIVE interactive stream (raw frames + adb touch) on macOS Intel.
set -e
cd "$GITHUB_WORKSPACE/android-live"
export PORT="${PORT:-8090}"
SDK="$ANDROID_SDK_ROOT"
CMDTOOLS="$SDK/cmdline-tools/latest/bin"
ADB="$SDK/platform-tools/adb"
EMU="$SDK/emulator/emulator"
AVDMGR="$CMDTOOLS/avdmanager"
export PATH="$SDK/platform-tools:$SDK/emulator:$CMDTOOLS:$PATH"
IMAGE='system-images;android-30;default;x86_64'

echo "arch=$(uname -m) hv=$(sysctl -n kern.hv_support 2>/dev/null || echo 0)"
echo "SDK=$SDK"

# ---- 1) create AVD (small device → cheap screencap + low latency) ----
echo no | "$AVDMGR" create avd --force -n live -k "$IMAGE" -d "Nexus 4" || \
echo no | "$AVDMGR" create avd --force -n live -k "$IMAGE" -d pixel_2 || \
echo no | "$AVDMGR" create avd --force -n live -k "$IMAGE"

# ---- 2) boot headless with HVF acceleration ----
nohup "$EMU" -avd live \
  -no-window -no-audio -no-boot-anim -no-snapshot -no-metrics \
  -gpu swiftshader_indirect \
  -memory 2048 -cores 2 > emu.log 2>&1 &
EMUP=$!

echo "waiting for device…"
"$ADB" wait-for-device
echo "device visible; waiting for boot_completed…"
B=""
for i in $(seq 1 400); do    # up to ~20 min
  sleep 3
  B=$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  [ "$B" = "1" ] && break
  BANIM=$("$ADB" shell getprop init.svc.bootanim 2>/dev/null | tr -d '\r')
  [ "$BANIM" = "stopped" ] && { B=1; break; }
done
echo "boot_completed=$B"
[ "$B" = "1" ] || { echo "BOOT TIMED OUT"; tail -20 emu.log; exit 1; }

# give system services a moment; wait until the settings service answers
for i in $(seq 1 60); do
  SC=$("$ADB" shell service check settings 2>/dev/null | tr -d '\r')
  case "$SC" in *"found"*) echo "settings service up"; break;; esac
  sleep 2
done
"$ADB" shell input keyevent 224 >/dev/null 2>&1 || true   # WAKEUP
"$ADB" shell input keyevent 82  >/dev/null 2>&1 || true   # dismiss keyguard
# keep the display on permanently (headless emulator sleeps otherwise)
for x in 1 2 3 4 5 6 7 8; do
  "$ADB" shell svc power stayon true           >/dev/null 2>&1 && echo "stayon on" && break
  "$ADB" shell settings put system screen_off_timeout 2147483647 >/dev/null 2>&1 && echo "timeout maxed" && break
  sleep 2
done
"$ADB" shell wm size || true

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
  echo "## 📱 Android Emulator — Live & interactive (macOS Intel runner)"
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
