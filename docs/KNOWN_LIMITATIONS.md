# Known limitations

- This repository is a source release, not a production service.
- The production signing chain, APK updater, production release publishing, production API origin, real credentials and private data are not included.
- The PWA is distributed as the copied Cloudflare Pages / static application tree. It does not have a separate production build script in this source repository.
- The PWA test suite can run through the repository test command; DOM-related tests require the declared test dependencies to be installed.
- GitHub Actions validates Android source with debug tests/builds; distribution uses a separate opt-in, stable-signed source-only GitHub prerelease workflow and GitHub Release assets, not Actions artifacts.
- The source prerelease, if explicitly enabled and signed, is not the official private production APK. Without release signing secrets, no APK release is generated.
- Preview APK password: `123456`.
- Legacy lowercase wire/database values may remain where changing them would alter stored-data or API compatibility. They are implementation compatibility keys, not public UI names.
