# Releasing Manifest

Preparation does not authorize a push, publication or directory submission. Preserve existing repository files and remote history; never push the original private working tree. The replacement repository neurasthenickid/Manifest was accessible through standard Git on 2026-10-30 and returned no refs. Recheck its contents before writing; this does not authorize a push.

1. Confirm licenses, public file audit, source tests, browser checks and platform limits. Use standard GitHub authentication; do not put tokens in this project or chat.
2. Inspect/fetch the target repository, preserve its existing files, then review the clean source changes. Use the sanitized project only. If versions/tags already exist, choose a new version; never overwrite a tag or release.
3. After explicit owner permission, push reviewed source. The CI workflow verifies the frozen lockfile, lint, typecheck, tests, browser regression and runtime imports.
4. Push exact code tag (manifest.version, no v prefix) for a draft code release. Push the configured headers-* tag for a draft collection release. A tag workflow verifies the checked commit, validates source/artifact hashes and creates a new draft only. Existing releases cause failure; no clobber/delete/force behavior exists.
5. Review and publish the drafts only within the owner's authorized scope. The collection tag must become public for anonymous downloads to work. Verify real GitHub assets, hashes, retry and offline behavior after publishing. A local fixture is not that verification.
6. Follow OBSIDIAN_SUBMISSION.md. Submission is a separate owner action unless explicitly authorized.

Code release assets: main.js, manifest.json, styles.css, SHA256SUMS.txt. Collection release assets: headers-manifest.json, 472 h-<sha256>.webp objects, IMAGE_LICENSE.txt, SHA256SUMS.txt and header-collection-2026.10.1.zip. The collection tag is independent of code versions and never becomes the latest plugin release.
