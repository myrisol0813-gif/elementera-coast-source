#!/usr/bin/env bash
set -euo pipefail
umask 077
unsigned_apk=${1:?Expected original unsigned APK}
signed_apk=${2:?Expected final signed APK path}
test -s "$unsigned_apk"
test "$unsigned_apk" != "$signed_apk"
case "$unsigned_apk" in *-unsigned.apk) ;; *) echo "Expected unsigned Release APK" >&2; exit 1;; esac
: "${SOURCE_ANDROID_KEYSTORE_B64:?Missing Source release keystore}"
: "${SOURCE_ANDROID_KEYSTORE_PASSWORD:?Missing Source keystore password}"
: "${SOURCE_ANDROID_KEY_ALIAS:?Missing Source key alias}"
: "${SOURCE_ANDROID_KEY_PASSWORD:?Missing Source key password}"
expected="3e021e11f05b619d603543929e07edd32a037323478a9abfdfe5b405ce6fca59"
tools_dir=$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
printf '%s' "$SOURCE_ANDROID_KEYSTORE_B64" | base64 --decode > "$work/source.jks"
unset SOURCE_ANDROID_KEYSTORE_B64
keytool -exportcert -keystore "$work/source.jks" -storepass:env SOURCE_ANDROID_KEYSTORE_PASSWORD -alias "$SOURCE_ANDROID_KEY_ALIAS" -file "$work/source.der" >/dev/null
actual=$(sha256sum "$work/source.der" | cut -d' ' -f1)
[[ "$actual" == "$expected" ]] || { echo "Source release certificate mismatch; refusing to sign" >&2; exit 1; }
"$tools_dir/zipalign" -f 4 "$unsigned_apk" "$work/aligned-unsigned.apk"
"$tools_dir/zipalign" -c 4 "$work/aligned-unsigned.apk"
mkdir -p "$(dirname "$signed_apk")"
"$tools_dir/apksigner" sign --ks "$work/source.jks" --ks-key-alias "$SOURCE_ANDROID_KEY_ALIAS" --ks-pass env:SOURCE_ANDROID_KEYSTORE_PASSWORD --key-pass env:SOURCE_ANDROID_KEY_PASSWORD --min-sdk-version 23 --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --v4-signing-enabled false --v1-signer-name CERT --out "$signed_apk" "$work/aligned-unsigned.apk"
"$tools_dir/apksigner" verify --verbose --min-sdk-version 23 --print-certs "$signed_apk" > "$work/verify.txt"
grep -F 'Verified using v1 scheme (JAR signing): true' "$work/verify.txt"
grep -F 'Verified using v2 scheme (APK Signature Scheme v2): true' "$work/verify.txt"
grep -Fi "certificate SHA-256 digest: $expected" "$work/verify.txt"
unzip -t "$signed_apk" >/dev/null
unzip -Z1 "$signed_apk" > "$work/files.txt"
grep -Fx 'META-INF/CERT.SF' "$work/files.txt"
grep -Fx 'META-INF/CERT.RSA' "$work/files.txt"
echo "Pinned Source release certificate verified."
