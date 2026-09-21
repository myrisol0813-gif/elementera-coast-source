# Known limitations

- This repository is a source release, not a production service.
- The production signing chain, APK updater, production release publishing, production API origin, real credentials and private data are not included.
- The PWA is distributed as the copied Cloudflare Pages / static application tree. It does not have a separate production build script in this source repository.
- The PWA test suite can run through the repository test command; DOM-related tests require the declared test dependencies to be installed.
- The Android source debug APK is built through GitHub Actions and published as a Release asset for inspection and device testing.
- The published APK is a debug preview build, not an official production APK.
- Preview APK password: `123456`.
- Legacy lowercase wire/database values may remain where changing them would alter stored-data or API compatibility. They are implementation compatibility keys, not public UI names.
