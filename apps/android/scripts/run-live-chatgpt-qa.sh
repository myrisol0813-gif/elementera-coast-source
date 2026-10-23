#!/usr/bin/env bash
set -euo pipefail

root="$(pwd)"
test -f "$root/apps/web/package.json"
test -f "$root/apps/android/app/build.gradle.kts"
test -f "$root/apps/android/scripts/sign-disposable-qa.sh"

cleanup() {
  set +e
  if [[ -n "${tunnel_pid:-}" ]]; then kill "$tunnel_pid" 2>/dev/null || true; fi
  if [[ -n "${pages_pid:-}" ]]; then kill "$pages_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT

# Random, one-run-only Coast login. Keep it out of Actions logs and summaries.
QA_PASSWORD="$(openssl rand -hex 8)"
SESSION_SECRET="$(openssl rand -hex 32)"
hash="$(printf '%s' "$QA_PASSWORD" | sha256sum | cut -d' ' -f1)"

cd "$root/apps/web"
npm install --no-audit --no-fund
npm install --no-save --no-audit --no-fund wrangler@4

umask 077
printf 'COAST_PASSWORD_HASH=%s\nCOAST_SESSION_SECRET=%s\n' "$hash" "$SESSION_SECRET" > .dev.vars
mkdir -p "$RUNNER_TEMP/live-chatgpt-source-db"

./node_modules/.bin/wrangler pages dev elementera-mcp/deploy-pages \
  --ip 127.0.0.1 --port 8788 \
  --d1 COAST_CHAT_DB=source-live-chatgpt \
  --persist-to "$RUNNER_TEMP/live-chatgpt-source-db" \
  --log-level warn > "$RUNNER_TEMP/live-chatgpt-pages.log" 2>&1 &
pages_pid=$!

for i in $(seq 1 90); do
  if curl -sf http://127.0.0.1:8788/login >/dev/null; then break; fi
  if ! kill -0 "$pages_pid" 2>/dev/null; then
    tail -n 45 "$RUNNER_TEMP/live-chatgpt-pages.log"
    exit 1
  fi
  sleep 2
done
curl -sf http://127.0.0.1:8788/login >/dev/null

curl -fL --retry 3 --max-time 150 \
  -o "$RUNNER_TEMP/cloudflared" \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x "$RUNNER_TEMP/cloudflared"

"$RUNNER_TEMP/cloudflared" tunnel --url http://127.0.0.1:8788 \
  --loglevel info > "$RUNNER_TEMP/live-chatgpt-tunnel.log" 2>&1 &
tunnel_pid=$!

url=''
for i in $(seq 1 90); do
  url="$(grep -Eo 'https://[a-zA-Z0-9-]+[.]trycloudflare[.]com' "$RUNNER_TEMP/live-chatgpt-tunnel.log" | head -n 1 || true)"
  if [[ -n "$url" ]]; then break; fi
  if ! kill -0 "$tunnel_pid" 2>/dev/null; then
    tail -n 60 "$RUNNER_TEMP/live-chatgpt-tunnel.log"
    exit 1
  fi
  sleep 2
done
test -n "$url"

# Confirm the real Coast login path before compiling the URL into the APK.
logged_in=0
for i in $(seq 1 35); do
  status="$(curl -sS -o /dev/null -c "$RUNNER_TEMP/live-chatgpt-cookie" \
    -w '%{http_code}' --max-time 15 \
    --data-urlencode "password=$QA_PASSWORD" "$url/login" || true)"
  if [[ "$status" == 302 ]]; then logged_in=1; break; fi
  sleep 3
done
test "$logged_in" = 1
rm -f "$RUNNER_TEMP/live-chatgpt-cookie"

cd "$root/apps/android"
version_name="$(sed -nE 's/^[[:space:]]*versionName = "([^"]+)".*/\1/p' app/build.gradle.kts | sed -n '1p')"
version_code="$(sed -nE 's/^[[:space:]]*versionCode = ([0-9]+).*/\1/p' app/build.gradle.kts | sed -n '1p')"
: "${version_name:?Missing versionName}"
: "${version_code:?Missing versionCode}"

gradle :app:testDebugUnitTest :app:assembleDebug --no-daemon --stacktrace \
  -PCOAST_API_BASE_URL="$url" \
  -PSOURCE_TOUR_ENABLED=false

apk="app/build/outputs/apk/debug/app-debug.apk"
test -s "$apk"
bash scripts/sign-disposable-qa.sh "$apk"

build_tools="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)"
badging="$("$build_tools/aapt" dump badging "$apk" | sed -n '1p')"
[[ "$badging" == *"name='com.elementeracoast.source'"* ]]
[[ "$badging" == *"versionCode='$version_code'"* ]]
[[ "$badging" == *"versionName='$version_name'"* ]]
"$build_tools/apksigner" verify --verbose "$apk" >/dev/null

mkdir -p live-chatgpt-release
apk_name="elementera-coast-source-${version_name%-source}-live-chatgpt.apk"
cp "$apk" "live-chatgpt-release/$apk_name"
(cd live-chatgpt-release && sha256sum "$apk_name" > SHA256SUMS.txt)
unzip -t "live-chatgpt-release/$apk_name" >/dev/null

tag="source-live-chatgpt-$GITHUB_RUN_ID"
notes="$RUNNER_TEMP/live-chatgpt-release-notes.md"
cat > "$notes" <<EOF
# Live ChatGPT Test

This is a disposable, owner-only test package for this workflow run.

- **Temporary Coast backend:** $url
- **Coast login password:** `$QA_PASSWORD`
- **Visitor gate:** OFF
- **Android package:** `com.elementeracoast.source`
- **Version:** `$version_name`
- **Backend lifetime:** about 30 minutes after this package is published

## Test

1. Install the APK below.
2. Open the app and enter the Coast login password above.
3. Open the model box.
4. Choose **ChatGPT plan**.
5. Tap **Continue with ChatGPT** and finish authorization in the browser.
6. Return to the app, refresh the account model list, select a model, and send a test reply.

The ChatGPT OAuth token stays on the Android device and is protected by Android Keystore. It is not sent through this temporary Coast backend.

This APK uses a disposable QA signing certificate. If Android reports a signature conflict with an older Source QA build, uninstall only `com.elementeracoast.source` and install this APK again.

When the workflow finishes, the Quick Tunnel and temporary backend stop. The APK will no longer have a live Coast backend after that.
EOF

release_url="$(gh release create "$tag" \
  "live-chatgpt-release/$apk_name" \
  "live-chatgpt-release/SHA256SUMS.txt" \
  --repo "$GITHUB_REPOSITORY" \
  --target "$GITHUB_SHA" \
  --draft \
  --title "Live ChatGPT Test · run $GITHUB_RUN_ID" \
  --notes-file "$notes")"

{
  echo '### Live ChatGPT Test is ready'
  echo
  echo "Open the private Draft Release while signed in to this repository:"
  echo
  echo "$release_url"
  echo
  echo 'The Draft Release contains the APK, temporary backend address, and random Coast login password.'
  echo 'Visitor mode is disabled for this build. The temporary backend stays alive while this job remains in its test window.'
} >> "$GITHUB_STEP_SUMMARY"

echo 'Live ChatGPT test package published as a Draft Release.'
echo 'Keeping the disposable backend and Quick Tunnel alive for about 30 minutes.'

for i in $(seq 1 60); do
  sleep 30
  kill -0 "$pages_pid"
  kill -0 "$tunnel_pid"
done

echo 'Live test window ended. Temporary backend and tunnel will now be removed.'
