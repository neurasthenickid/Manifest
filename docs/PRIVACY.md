# Data and network

Manifest does not send telemetry or load ads. Records, task history, snapshots, settings and ordinary notes are vault-local. It neither scans outside the vault nor requires an account for local planning. Native secret storage is accessed only for the user-configured service; actual host behavior remains a separate acceptance test.

Optional header download requests a tag list from GitHub API and data from GitHub Releases/CDN for neurasthenickid/Manifest. No executable updates are downloaded. A full collection is optional and remains usable offline. Checksums protect image integrity, not a claim of GitHub availability before publication.

Optional CalDAV (events/tasks) and WebDAV (vault data sync) use the HTTPS endpoint and account entered by the user. Yandex defaults can be replaced. A copy or ZIP of a vault is independent until a synchronization service is explicitly set up. Local export is not a full vault backup. Do not share device secrets or private data with support.
