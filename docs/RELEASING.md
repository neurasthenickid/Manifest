# Releasing Manifest

Only publish within explicit owner authorization. Use the sanitized public source, preserve remote history and prior release assets, and never force-push or overwrite an existing tag/release. The 1.0.12 publication is authorized separately from installing it in a working vault.

1. Fetch the target repository `neurasthenickid/Manifest`, compare main and existing tags, and preserve any remote changes. Verify licenses, clean source, source/build proof, content audit, unit and browser checks. Use ordinary GitHub authentication without extracting credentials.
2. Push the reviewed final commit to main and require its hosted CI to pass. CI uses the frozen lockfile, lint, typecheck, build, tests and production browser regressions. The exact numeric code tag must match manifest.version and point to this checked commit.
3. The tag workflow repeats checks, seals source/artifact hashes and creates a **draft only**. Inspect its assets before publication. The separate `attest-runtime` job signs the three checked runtime files; only this job receives OIDC/attestation permissions and it does not run project build scripts. Verify the hosted job and published provenance, not just local YAML.
4. Publish the reviewed code draft as an ordinary release, not a prerelease, and set latest. Preserve 1.0.11. Download the three runtime files anonymously and compare SHA-256 with the checked build; inspect the full ZIP and checksums. ZIP container metadata may differ between build hosts, but every packaged payload file must match its checked source.
5. Follow [the existing directory card procedure](OBSIDIAN_SUBMISSION.md). GitHub publication, directory-page publication and actual in-app catalog availability are independent checks. Do not claim device or provider testing from hosted/browser checks.

Code assets: `main.js`, `manifest.json`, `styles.css`, `SHA256SUMS.txt`, the full offline installation ZIP and `sizes-and-checksums.json`. Do not include vault data or passwords.

The static collection has its own immutable `headers-2026.10.1` release: manifest, 472 image objects, image license, checksums and collection ZIP. It is already published and real GitHub download/resume/offline verification passed on 2026-10-30. A code-only release must not republish this unchanged collection or make it the latest plugin release. Native Obsidian networking and physical-device checks remain separate.
