#!/usr/bin/env bash
set -euo pipefail

# Use a single unsigned release APK as input. Never sign or re-sign an
# already-signed debug APK; some phone installers reject that packaging.
unsigned_apk=${1:?Expected original unsigned APK}
signed_apk=${2:?Expected final signed APK path}
test -s "$unsigned_apk"
test "$unsigned_apk" != "$signed_apk"
case "$unsigned_apk" in *-unsigned.apk) ;; *) echo "Expected a release-unsigned.apk input" >&2; exit 1;; esac

tools_dir=$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export QA_SIGN_PASSWORD=$(openssl rand -hex 24)
echo "QA signature stage 1: generate single-use source-only certificate"
keytool -genkeypair -storetype PKCS12 -keystore "$work/qa.p12" -alias CERT -keyalg RSA -keysize 3072 -validity 365 -storepass "$QA_SIGN_PASSWORD" -keypass "$QA_SIGN_PASSWORD" -dname 'CN=Public Source QA, O=Elementera Coast Source' -noprompt

echo "QA signature stage 2: zipalign original unsigned Release APK"
"$tools_dir/zipalign" -f 4 "$unsigned_apk" "$work/aligned-unsigned.apk"
"$tools_dir/zipalign" -c 4 "$work/aligned-unsigned.apk"

echo "QA signature stage 3: sign exactly once with V1/V2/V3 and conventional CERT basename"
mkdir -p "$(dirname "$signed_apk")"
"$tools_dir/apksigner" sign --ks "$work/qa.p12" --ks-key-alias CERT --ks-pass env:QA_SIGN_PASSWORD --key-pass env:QA_SIGN_PASSWORD --min-sdk-version 23 --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --v4-signing-enabled false --v1-signer-name CERT --out "$signed_apk" "$work/aligned-unsigned.apk"

echo "QA signature stage 4: verify the exact final distributable APK"
"$tools_dir/apksigner" verify --verbose --min-sdk-version 23 --print-certs "$signed_apk" | tee "$work/verify.txt"
grep -F 'Verified using v1 scheme (JAR signing): true' "$work/verify.txt"
grep -F 'Verified using v2 scheme (APK Signature Scheme v2): true' "$work/verify.txt"
unzip -t "$signed_apk" >/dev/null
unzip -Z1 "$signed_apk" > "$work/files.txt"
grep -Fx 'META-INF/CERT.SF' "$work/files.txt"
grep -Fx 'META-INF/CERT.RSA' "$work/files.txt"
grep -Fx 'META-INF/MANIFEST.MF' "$work/files.txt"
echo "Source QA release is signed once and has verified conventional signature files."
