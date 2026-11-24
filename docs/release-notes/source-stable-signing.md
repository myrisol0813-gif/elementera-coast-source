# Source Native stable signing

Starting with 0.2.26-source, the official GitHub APK is signed with a persistent Source-only certificate. Private Coast production signing remains separate. The official package is `com.elementeracoast.source`.

Certificate SHA-256: `3e021e11f05b619d603543929e07edd32a037323478a9abfdfe5b405ce6fca59`

The public certificate fingerprint is safe to distribute. The signing private key and passwords are not part of the repository. The publisher uses four repository Actions secrets, checks the certificate before signing and verifies the final APK and downloaded asset. Missing credentials or a mismatched certificate stop publishing. PR checks and local QA keep disposable test signing and do not access the release key.

Older visitor QA packages were signed with disposable certificates and cannot generally be upgraded in place to the stable series. Do not uninstall an older package with valuable local data until you have a verified migration/backup. The stable series supports in-place upgrades with the same package ID and signing certificate. No backend subscription or store fee is required for GitHub delivery.
