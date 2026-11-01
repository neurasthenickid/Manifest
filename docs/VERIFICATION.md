# Verification boundaries

Automated checks cover TypeScript, lint, manifest/version agreement, pinned fonts, runtime external imports, unit/integration fixtures, header checksums, interrupted download/retry and offline reinitialization. Synthetic identity/record fixtures exercise the Life Planner → Manifest rename while keeping technical IDs and source bytes unchanged.

Browser tests render the production PlannerWidget: calendar cards, workout/morning/evening statistics, conditional return actions, no journal DOM, independent selections, keyboard/scroll, 320–430px and larger layouts, themes and large text. Reports under ignored test-results are local evidence, not user data in public source.

Real GitHub verification on 2026-10-30: published 1.0.11 runtime assets matched SHA-256; the production header service downloaded all 472 objects of the published 2026.10.1 collection, checked sizes/hashes and passed cancellation, interrupted resume and offline reinitialization. Public installation/collection ZIP payloads were also compared. This was an isolated filesystem/HTTP host, not native Obsidian requestUrl or device testing.

For 1.0.12, publication verification must separately record the exact hosted CI commit, tag workflow, runtime attestations, anonymous runtime SHA-256 and full ZIP payload comparison. A prepared workflow is not a successful hosted run. The immutable local preparation candidate and its reports remain separate from publication evidence.

Current actual Obsidian Windows, pop-out windows, physical Samsung/Android/iPhone, OS keyboard, and live Yandex/OneCalendar/OneTask remain **NOT RUN**. isDesktopOnly:false and browser PASS do not certify those platforms. GitHub publication, the public directory card and availability in the app catalog are separate results. No installed vault is replaced by these scripts.
