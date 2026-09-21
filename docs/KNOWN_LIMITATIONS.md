# Known limitations

- The current execution environment does not contain Wrangler, Gradle or an Android SDK.
- The PWA JavaScript suite can run tests that do not require `happy-dom`; DOM tests require installing the repository's declared test dependency.
- Native XML has been parsed and source contracts have been statically checked here, but an Android APK cannot be assembled in this container.
- The root source CI is prepared to run web tests and build an unsigned/debug Android artifact once the candidate tree is pushed to a GitHub branch.
- No tag or release should be created until the PWA and Android builds have been checked on a real device.
- Legacy lowercase wire/database values used by the copied application are retained where changing them would alter stored-data or API compatibility. They are implementation compatibility keys, not public UI names.
