# Public download landing page

This is an independent static site. It must not be deployed to the existing private app project, and it requires no database, secret, API key or backend functions.

For Cloudflare Pages, create a separate Pages project linked to the public repository `myrisol0813-gif/elementera-coast-source`, production branch `site/public-download`, framework preset None, no build command, output directory `public-home`. Verify the preview URL before associating `elementeracoast.com`. If the apex already serves an existing site, preserve it and integrate the download card there instead; do not replace DNS or alter app.elementeracoast.com.

The actual APK and checksums stay in GitHub Releases. Browser lookup follows the public latest stable Source Native release with exact asset names and URLs. If GitHub's API is unavailable, the pinned stable download remains available. No upload of the private app or data is involved.
