#!/usr/bin/env bash
set -euo pipefail
root=$(pwd)
test -f "$root/apps/web/package.json"
test -f "$root/apps/android/scripts/sign-disposable-qa.sh"
QA_PASSWORD=123456
cd "$root/apps/web"
npm install --no-audit --no-fund
npm install --no-save --no-audit --no-fund wrangler@4
hash=$(printf '%s' "$QA_PASSWORD" | sha256sum | cut -d' ' -f1)
umask 077
printf 'COAST_PASSWORD_HASH=%s\nCOAST_SESSION_SECRET=%s\nCOAST_PREVIEW_PASSWORD_HINT=%s\n' "$hash" "$(openssl rand -hex 32)" "$QA_PASSWORD" > .dev.vars
mkdir -p "$RUNNER_TEMP/qa-source-db"
./node_modules/.bin/wrangler pages dev elementera-mcp/deploy-pages --ip 127.0.0.1 --port 8788 --d1 COAST_CHAT_DB=source-testing --persist-to "$RUNNER_TEMP/qa-source-db" --log-level warn > "$RUNNER_TEMP/qa-pages.log" 2>&1 &
pages_pid=$!
for i in $(seq 1 90); do
  if curl -sf http://127.0.0.1:8788/login >/dev/null; then break; fi
  if ! kill -0 "$pages_pid" 2>/dev/null; then tail -n 30 "$RUNNER_TEMP/qa-pages.log"; exit 1; fi
  sleep 2
done
curl -sf http://127.0.0.1:8788/login >/dev/null
curl -fL --retry 3 --max-time 150 -o "$RUNNER_TEMP/cloudflared" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x "$RUNNER_TEMP/cloudflared"
"$RUNNER_TEMP/cloudflared" tunnel --url http://127.0.0.1:8788 --loglevel info > "$RUNNER_TEMP/qa-tunnel.log" 2>&1 &
tunnel_pid=$!
url=''
for i in $(seq 1 90); do
  url=$(grep -Eo 'https://[a-zA-Z0-9-]+[.]trycloudflare[.]com' "$RUNNER_TEMP/qa-tunnel.log" | head -n 1 || true)
  if [[ -n "$url" ]]; then break; fi
  if ! kill -0 "$tunnel_pid" 2>/dev/null; then tail -n 40 "$RUNNER_TEMP/qa-tunnel.log"; exit 1; fi
  sleep 2
done
test -n "$url"
logged_in=0
for i in $(seq 1 35); do
  status=$(curl -sS -o /dev/null -c "$RUNNER_TEMP/qa-cookie" -w '%{http_code}' --max-time 15 --data-urlencode "password=$QA_PASSWORD" "$url/login" || true)
  if [[ "$status" == 302 ]]; then logged_in=1; break; fi
  sleep 3
done
test "$logged_in" = 1
for endpoint in /api/calendar/entries /api/library/books; do
  status=$(curl -sS -o /dev/null -b "$RUNNER_TEMP/qa-cookie" -w '%{http_code}' --max-time 15 "$url$endpoint")
  test "$status" = 200
done
echo 'Isolated test login and D1 APIs confirmed.'
cd "$root/apps/android"
gradle :app:testDebugUnitTest :app:assembleDebug --no-daemon -PCOAST_API_BASE_URL="$url" -PSOURCE_PREVIEW_PASSWORD_HINT="$QA_PASSWORD"
apk=app/build/outputs/apk/debug/app-debug.apk
test -s "$apk"
bash scripts/sign-disposable-qa.sh "$apk"
bt=$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)
package=$("$bt/aapt" dump badging "$apk" | head -n 1)
[[ "$package" == *"name='com.elementeracoast.source'"* ]]
[[ "$package" == *"versionCode='3'"* ]]
[[ "$package" == *"versionName='0.2.2-source'"* ]]
mkdir -p source-qa
cp "$apk" source-qa/elementera-coast-source-v0.2.2-signed-qa.apk
(cd source-qa && sha256sum elementera-coast-source-v0.2.2-signed-qa.apk > SHA256SUMS.txt)
unzip -t source-qa/elementera-coast-source-v0.2.2-signed-qa.apk >/dev/null
(cd source-qa && zip -0 -q elementera-coast-source-v0.2.2-signed-qa.zip elementera-coast-source-v0.2.2-signed-qa.apk)
unzip -t source-qa/elementera-coast-source-v0.2.2-signed-qa.zip >/dev/null
unzip -p source-qa/elementera-coast-source-v0.2.2-signed-qa.zip elementera-coast-source-v0.2.2-signed-qa.apk | sha256sum | cut -d' ' -f1 > "$RUNNER_TEMP/source-extracted-sha"
cut -d' ' -f1 source-qa/SHA256SUMS.txt | diff - "$RUNNER_TEMP/source-extracted-sha"
echo 'Original APK and ZIP-contained APK match byte-for-byte; both ZIP structures passed CRC testing.'
tag="source-v1v2-$GITHUB_RUN_ID"
gh release create "$tag" source-qa/*.apk source-qa/*.zip source-qa/SHA256SUMS.txt --repo "$GITHUB_REPOSITORY" --target "$GITHUB_SHA" --prerelease --title 'Source 0.2.2 signed temporary QA' --notes "Temporary isolated source PWA $url, password 123456. APK uses this tunnel. Data removed after runner exits. Disposable QA signing certificate."
gh api --method POST "repos/$GITHUB_REPOSITORY/statuses/$GITHUB_SHA" -f state=success -f context=source-v1v2-live -f description='Live 30min QA, password 123456' -f target_url="$url" >/dev/null
{
  echo '### Verified temporary source APK and PWA'
  echo "PWA: $url"
  echo "Password: $QA_PASSWORD"
  echo "APK: https://github.com/$GITHUB_REPOSITORY/releases/download/$tag/elementera-coast-source-v0.2.2-signed-qa.apk"
  echo "ZIP-wrapped APK: https://github.com/$GITHUB_REPOSITORY/releases/download/$tag/elementera-coast-source-v0.2.2-signed-qa.zip"
  echo "SHA256: $(cut -d' ' -f1 source-qa/SHA256SUMS.txt)"
} >> "$GITHUB_STEP_SUMMARY"
echo 'Verified temporary APK published; keeping tunnel alive for 30 minutes.'
for i in $(seq 1 60); do
  sleep 30
  kill -0 "$pages_pid"
  kill -0 "$tunnel_pid"
done
