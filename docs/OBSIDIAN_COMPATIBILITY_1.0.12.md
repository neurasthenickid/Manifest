# Manifest 1.0.12 — Obsidian compatibility candidate

Prepared locally on 2026-11-01 from the published 1.0.11 commit `c8859e2c5c58678324172c6297bc578b3bf5869d`. This candidate is not installed, pushed, released or resubmitted. Runtime data formats, IDs, history, CalDAV behavior, approved designs and the static image collection are preserved.

| Review item | Finding and decision | Evidence |
| --- | --- | --- |
| Daily Notes configuration path | Production callers already passed `vault.configDir`; the fallback `.obsidian` was unnecessary. The argument is now required. Unknown/empty paths fail before IO. | `compatibility.test.ts`: custom configuration directory, unrelated native options/core plugins, untouched foreign `.obsidian` sentinels, original backup and idempotent restart. All call sites typechecked. |
| DOM helpers | Replaced native HTML creation with public `createEl`/`createSpan`/`createSvg` helpers. Temporary nodes use the owning window's public `createFragment`, without transient insertion into the live note. Native SVG children retain their namespace and owning document. | Production renderers in a second real browser document; cross-realm free-notes action, calendar ghost, forms, controls and existing UI tests. |
| Timers, windows and gestures | Runtime no longer falls back to `globalThis` for Node. Test bootstrap explicitly injects its timer host. Each handle retains its scheduler, removes itself after firing/cancellation, and cancels on window pagehide; plugin unload cancels pending guards. Widget clocks, header clocks, range events and gesture handlers use the container's document/window. | Timer-host replacement/unload tests; real browser iframe with tracked window timers/listeners, continuous rating/one save/cancel, held kanban/drop/outside/blur/pagehide cleanup. |
| Deprecated activeLeaf | Current view is obtained through `getActiveViewOfType(View)`. `getLeaf` is not used to discover current focus. A temporary observer remembers intervening navigation during asynchronous reveal and is always removed. | Restored/deferred/duplicate/sidebar/mobile/race tests, including a newer note during creation and an intervening selection before reveal finishes. |
| Settings search 1.13+ | **Remaining limitation.** Public `getSettingDefinitions` is opt-in; non-empty definitions replace `display()`. The existing renderer has custom sections, async actions, dynamic lists and independent subscriptions. Correct granular search requires a substantial dual-renderer migration. No empty/stub definitions or duplicate controls were added merely to suppress a warning. Existing settings/UI/persistence remain unchanged; minAppVersion stays 1.11.4. | Official migration guide and public API declarations; normal typecheck plus checks against official 1.11.4 and 1.14.4 declarations. Actual settings search in Obsidian is NOT RUN and is not claimed supported. |
| CSS column-gap | The flagged declarations are gaps of CSS Grid containers, not CSS multicolumn. No grid redesign. | Existing geometry tests, 1.0.11 baseline comparison and responsive production UI. |
| clip-path | The 1px `.lp-sr-only` element uses `clip-path:inset(50%)` intentionally to keep its text available to accessibility APIs. It was not changed to `display:none`. | Production browser checks; actual screen-reader/phone acceptance NOT RUN. |
| display:contents | Retained on non-focusable period-group wrappers to preserve the approved 3×2 arrangement and Today placement. The buttons remain real focusable elements, and the labelled group remains exposed by the tested Chromium accessibility implementation. | Baseline geometry, role queries and >=44px controls. Safari/mobile Obsidian accessibility NOT RUN. |
| :has | Note/embedded-wrapper relational selectors were replaced with ref-counted classes on known ancestors. Mount/theme change/unmount adds/removes them without document polling. One small `:has(input:focus-visible)` remains to preserve the keyboard-only focus indication without an imperfect JS focus heuristic. | Multiple mounted production widgets share classes correctly; closing the final owner restores them. Baseline colors/geometry and browser tests. |
| !important | Removed redundant priorities where existing specificity/cascade suffices. Retained host-theme overrides and the mobile heading priority that overrides an earlier desktop `!important`. Green Today, separators and fonts are preserved. | Computed layout comparison against 1.0.11, including headings/calendar labels, plus inspected screenshots. |
| License recognition | GitHub main still contains the complete approved PolyForm Noncommercial 1.0.0 in root LICENSE; metadata/README/notices agree. GitHub's license endpoint reports `Other / NOASSERTION`, not a missing file. No formatting defect warranting a change was found. The selected code/image terms and authorship are unchanged. Catalog recognition/acceptance is not promised. | Public repository LICENSE API snapshot; retained license bytes, metadata and content audit. |
| File enumeration | Enumeration is not data transmission. The previous adapter called `getFiles()` for every prefix. It now walks only the requested subtree of the public live vault index, with no stale cache. Whole-vault enumeration remains possible only when explicitly requested with an empty prefix. | Subtree test rejects visiting unrelated branches and observes a rename; full storage/migration regressions. |
| Artifact provenance | Added a separate code-tag attestation job using pinned official `actions/attest@v4` and `download-artifact@v4`. Only that job receives OIDC/attestation/artifact-metadata write permissions. It executes no project build scripts; it signs the three checked runtime files from the preceding job. | Local workflow/configuration inspection only. GitHub execution and successful attestation creation are **NOT RUN** because push/publication are forbidden for this task. |
| Additional release assets | Full offline ZIP, separate collection ZIP and checksums are retained. The three mandatory runtime assets remain separate files. | Candidate package inventory and archive verification. |

## Remaining lint warnings

The settings-search warning remains deliberately visible. Four sentence-case suggestions concern the proper names **Daily Notes**, **Manifest**, **PNG/JPG/WebP**. Their established product spelling is retained. No lint rule was globally disabled or lowered in severity.

## Reproducible checks

`pnpm check` runs content/license/image audit, current Obsidian lint, typecheck, build and unit/integration tests. Node timer injection is confined to the test bootstrap. `pnpm test:ui` runs the existing four browser suites plus the multi-document/resource suite and baseline layout comparisons. Browser helper implementations are test adapters, not proof of running the actual Obsidian application.

Results and screenshots are saved in `test-results`; the separate candidate includes the final verification report. Browser iframe PASS is explicitly different from an actual Obsidian pop-out window, Samsung, iPhone, native WebView, real calendar provider or minimum-version host acceptance: these remain **NOT RUN**.

## Notes for Obsidian review

The code is intentionally licensed under PolyForm Noncommercial 1.0.0 (source-available), not MIT/MPL. The full license is in root LICENSE. Static illustrations separately use CC BY-NC 4.0. The repository's GitHub license classifier currently reports Other/NOASSERTION. Please review the explicit license terms; no license substitution is authorized.

## Primary references checked 2026-11-01

- https://docs.obsidian.md/plugins/guides/pop-out-windows
- https://docs.obsidian.md/plugins/guides/migrate-declarative-settings
- https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts
- https://github.com/actions/attest

This is a compatibility candidate with documented limitations, not a claim of catalog approval.
