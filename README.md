# Manifest

Plan your days, tasks, habits, routines and workouts inside Obsidian. Daily, weekly, monthly, quarterly and yearly notes share stable records, configurable life areas and readable Markdown free notes.

Manifest was previously called Life Planner. Its technical ID remains `life-planner`, so existing records, folders, settings and history keep their identities. Author: [neurasthenick1d](https://github.com/neurasthenickid).

## Features

- Shared tasks and events, calendar views, mobile Kanban, configurable life areas and historical statistics.
- Versioned habits, morning/evening routines, workout programs and confirmed snapshots.
- Calendar-based workout/routine statistics with independent date selection and collapsed item details. No separate journal panels.
- Static illustrated headers selected for the note's season and current local time, with saved manual choices and mobile framing. Headers are optional; animations are not included.
- Vault-local data and Markdown notes. Calendar/task CalDAV and vault WebDAV connections are optional and off until configured.

## Install and update

Plugin releases are distributed through [GitHub Releases](https://github.com/neurasthenickid/Manifest/releases). Each code release includes separate `main.js`, `manifest.json` and `styles.css`, with an exact numeric tag matching the manifest version. The existing [Obsidian directory page](https://community.obsidian.md/plugins/life-planner) is a separate publication surface: its displayed version and automated review must be checked independently of GitHub.

For manual installation, download those three files from [Releases](https://github.com/neurasthenickid/Manifest/releases), place them in `<vault-config>/plugins/life-planner/`, and enable **Manifest**. The config folder is usually `.obsidian`, but may be customized. For Android transfer, copy the same vault including its config folder; there is one plugin runtime for Windows and Android. Back up data before updating; do not replace `data.json` or the `Planner` folder with someone else's example files.

When Manifest is available in your app's Community plugins catalog, install/update there. A public website page or an Add to Obsidian link alone does not prove that Browse can install the current release; directory propagation and the app's catalog must be checked separately. Manifest has no custom code updater.

## Illustrated headers

In Manifest settings → Appearance, use **Скачать все шапки**. This fetches optional static WebP data from this repository's `headers-*` releases. The collection contains 473 logical paths backed by 472 distinct images. Progress, cancellation, checksum validation and retry are supported. Installed images work offline. A collection update does not change plugin code.

The credit beside the button remains: «Иллюстрации созданы с помощью ChatGPT по авторским описаниям и отобраны для проекта». These are illustrations, not documentary photographs. Image permissions are separate: see [IMAGE_LICENSE](IMAGE_LICENSE). The [2026.10.1 collection](https://github.com/neurasthenickid/Manifest/releases/tag/headers-2026.10.1) is published. On 2026-10-30 the production download service fetched all 472 public GitHub image objects and passed checksum, interruption/resume and offline-restart checks in an isolated filesystem host. This verifies real GitHub downloads, not native Obsidian networking or a physical phone.

## Privacy and network

No telemetry or advertising. Planner data stays in the vault unless you explicitly configure synchronization. Header downloads contact `api.github.com` and `github.com` (including GitHub's release asset CDN). Optional CalDAV/WebDAV contacts the HTTPS server you choose; Yandex is a configurable default, not a mandatory account. Device secrets use Obsidian's secret storage when available; passwords are not source-code configuration. Export writes a local copy to `Planner/Exports`, not a full-vault backup. A copied vault does not automatically synchronize two devices. Details: [Privacy](docs/PRIVACY.md).

## Platforms and limits

One runtime, `isDesktopOnly: false`, no Node/Electron imports. Declared minimum Obsidian: **1.11.4**. Its mobile-compatible API usage is checked statically and with a browser host adapter; actual operation on that minimum version is not certified. For this release: Windows Obsidian, physical Samsung/other Android/iPhone and real Yandex/OneCalendar/OneTask round-trips are **NOT RUN**. Browser touch/rotation simulations are not device acceptance. Statistics support multiple stored workout sessions per date; the unchanged daily form does not add a second-session creation button.

## Development

Node 24 and pnpm 11.25.0. Run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm collection`, then `pnpm run pack`. Tests use synthetic fixtures. For browser regression install Chromium with `pnpm exec playwright install chromium`, run `pnpm test:ui`; it builds and starts its own temporary test servers. `MANIFEST_BROWSER_CHANNEL=msedge` can select an installed Edge locally. See [Releasing](docs/RELEASING.md), [Verification](docs/VERIFICATION.md) and [Catalog submission](docs/OBSIDIAN_SUBMISSION.md).

## License and support

Original code and documentation are licensed under PolyForm Noncommercial 1.0.0, as approved by the owner. Third-party MPL-2.0/MIT/ISC/OFL components retain their own grants, independent of restrictions on original Manifest code or images. See [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md) and [Licensing](docs/LICENSING.md). Source availability must not be described as OSI open source if the chosen license restricts commercial use.

Report reproducible problems at [Issues](https://github.com/neurasthenickid/Manifest/issues), with app/platform/version and steps. Do not attach passwords, tokens or a private vault.
