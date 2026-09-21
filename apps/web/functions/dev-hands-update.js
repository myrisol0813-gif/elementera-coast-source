import { DEV_HANDS_RELEASE, EXPECTED_NATIVE_APPLICATION_ID, PWA_CACHE_VERSION } from './dev-hands-version.js';

export async function latestNativeUpdate() {
  return {
    pwa_cache_version: PWA_CACHE_VERSION,
    native: {
      version_code: 1,
      version_name: '0.1.0-source',
      application_id: EXPECTED_NATIVE_APPLICATION_ID,
      stable_signing: false,
      overwrite_installable: false,
      apk_sha256: null,
      apk_filename: null,
      update_time: null,
      update_notes: 'Source build: production APK updater, signing and release distribution are not included.',
      known_risk: null,
    },
    available: false,
    reason: 'Source build does not include the production APK updater or release-distribution chain.',
    release: DEV_HANDS_RELEASE,
  };
}
