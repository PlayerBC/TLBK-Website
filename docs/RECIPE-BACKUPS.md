# Recipe and costing recovery

## Current release status

On 3 October 2026 the owner approved **Final recipes only**: drafts, R&D and
unrelated previous recipe versions must not enter new backups. The Final-only
change is verified locally and awaits the coordinated audit release. It requires
`20261002171359_recipe_final_only_backups.sql`, the updated `recipe-backup` worker
and the updated archive checker/UI. New archives use schema 5. Older schema 1–4
archives remain readable and retain their original coverage.

The published `production_version_id` selects the Final, even if the current
working version is a newer draft. Recovery records use that Final's name,
category, document and exact saved cost snapshot. Current catalog prices are
included separately. A pinned Final component is included when a Final recipe
needs that exact formula; unrelated earlier versions are excluded. Comparison-only
variation bases outside this scope are omitted, along with the archived document's
optional `base` metadata. Ingredients, methods, yield and saved costing are unchanged.

The deployment evidence below describes earlier archive formats and does not
prove that the new Final-only scope is live.

The owner approved deployment on 30 September 2026. The recipe/access migrations
and `recipe-backup` Edge Function v2 are deployed, and automatic backups are enabled.
A real daily archive completed at 05:43 UTC; the unattended scheduler made a
matching monthly copy at 05:45 UTC. Both are 10,553 bytes with SHA-256
`58c2059c9850c91102b163f02e9aa18595e948d5da19c5942f31987de33eabb8`.
The downloaded daily copy restored into an isolated database with checksum and
relationship checks passing. It contains 16 initial configuration/actor records
and no recipes/files. After the supplier workbook import, a manual archive completed
at 06:52 UTC: 440,695 bytes, 1,022 records and zero files. Its SHA-256 is
`7b5d126c48a917461c9e34c28a4002571057eedcb4d7d163af0e7e40d7c6daad`.
That archive was downloaded and restored into an isolated database, including all
332 resources, 333 supplier links and 340 price records. Full nested values and
relationships matched. Recovery comparison normalizes typed database timestamps
so UTC/Manila representations of the same instant do not cause false failures.
Schema 2 also backs up recipe invitations; schema 1 archives remain readable.
Hosted photo-volume capacity remains unverified.

The owner-selected [Drive folder](https://drive.google.com/drive/folders/1rRxDTqAVqliCdx0OTRJK0XuLC4iHQyeg)
has Daily, Monthly and Manual subfolders and 44 private ZIP slots.
Three contain verified snapshots; the other 41 remain unused placeholders.
Placeholders are not recovery points. The connected
Drive account owns the files and the existing Google service account has writer
access. This permits unattended updates without relying on a service account's
unavailable personal Drive storage quota. No public/domain sharing was added.

## Contents and layout

Each completed snapshot is a self-contained ZIP:

```
Daily / Monthly / Manual/
  TLBK-<kind>-<UTC timestamp>.zip
    README.txt
    manifest.json
    Database Exports/<table>.json
    Recipes/<name>-<recipe ID>-v<version>.html
    Files/<file ID>/<original filename>
```

The authoritative JSON retains original IDs and relationships for:

- Recipe settings, categories, published Final recipes and the exact pinned Final
  component versions needed by them.
- Ingredient, supplier and packaging resources, supplier-item links and each
  supplier's latest purchase quote.
- Yield, quantities, methods, baking stages, notes, allergens and variations.
- Recipe/packaging/component cost snapshots and optional labor/other costs.
- Pinned component links and ingredient references.
- Uploaded-file metadata, visibility links and the actual bytes of every file
  used by included Final recipes, their pinned components or catalog items.
- Actor IDs and email addresses needed to reconcile attribution during recovery.

The database snapshot is captured by a single INSERT/SELECT statement and then
paged from staging. A concurrent edit cannot make different tables come from
different snapshots. File paths cannot be overwritten; each upload gets a new ID.

Readable HTML is included for Final recipes and their required pinned components. It is secondary to
the complete JSON records. SHA-256 checksums identify each archive entry and map
each file back to its database ID and private Storage path.

Excluded: passwords, Auth sessions, service/API keys, worker tokens, unrelated shop
orders/customer data, drafts/R&D, unrelated earlier recipe versions, equipment
catalog records, R&D/production/activity logs, draft recovery records, staff access
and schedules, personal library state, unfinished/unused uploads and external
files that were never uploaded into the recipe system. Existing order backups
remain a separate system. Older verified archives retain their previous content.

## Schedule and retention

- Scheduled checks run every five minutes using `pg_cron` and a dedicated Vault
  token. Daily snapshots become due at **02:00 Asia/Manila**.
- Keep **30 daily**, **12 monthly** and **2 manual** independent copies. A monthly copy
  comes from a verified daily archive and must match its checksum and byte count.
- **Back up now** requests a manual copy. The user can close the browser after
  the job starts. Status is polled while the page remains open.
- Rotate the oldest slot of the appropriate kind. A failed write invalidates only
  its target slot; other verified recovery points remain available.
- Every copy includes its own linked files. Approximate fully populated storage is
  44 times the current archive size, subject to historical photo/version growth.
- A live deletion does not remove existing historical snapshots. Records remain
  available until normal retention rotates the copies containing them.

Jobs use an exclusive ten-minute lease. Failed manual jobs retain their retry
request. A later scheduled check marks an expired job interrupted before retrying.
Drive requests retry partial acknowledgments and interrupted resumable uploads.
Status reports last attempt, last verified success, due time, errors, counts and
recovery points. Coverage is labeled **Final recipes**, **Latest working copy** or
**Full history** per archive. Monthly copies inherit their verified daily source's
coverage. In-flight pre-migration jobs remain labeled latest working copies. Three
consecutive failures receive a prominent warning. There is
no separate email/SMS alert in this release.

Success requires Google's returned file ID, byte count and SHA-256 to match the
complete uploaded archive. Local downloads are recorded separately and never
advance the successful Drive backup timestamp. A checksum mismatch is a failure.

## Security

Only the owner can connect, trigger, inspect or download backups through the app.
Chef and Kitchen permissions cannot access them. Worker RPCs require service-role
credentials and a valid lease; scheduled requests use a dedicated Vault token.
Credentials are runtime secrets and are not present in the static website, ZIPs,
logs or committed configuration. API errors shown to users omit provider secrets.

Before writing, the worker checks that each target is a private editable ZIP and
rejects public or domain-wide permissions. Resumable upload URLs are restricted to
the expected Google API origin/path. All supplied archive paths are validated.

## Deployment checklist — requires explicit production approval

1. Review the Final-only migration and this release's test report. Take the normal
   Supabase database backup before applying schema changes.
2. On the existing deployed recipe system, apply
   `20261002171359_recipe_final_only_backups.sql` after the essential-backup
   migrations. A fresh recovery environment needs the full matching migration
   sequence. This change preserves worker authorization, RLS, leases, verified
   Drive completion, scheduling and existing recovery points.
3. Deploy `supabase/functions/recipe-backup/index.ts` with its shared modules and
   local archive/hash dependencies. Gateway JWT verification must be disabled for
   the dedicated cron token; the handler enforces owner JWT or worker-token auth.
   Configure normal allowed origins and retain existing service-account secrets.
4. Using a verified owner session, connect the provisioned slot IDs in the private
   deployment record. Do not commit live access tokens or private deployment files.
   `connect` verifies all slots before enabling the connection. Provisioning alone
   does not enable backups. For this deployment, the authorized database operator
   configured the service connection after checking all 44 files through Drive;
   the worker independently checked each actual upload target through Google.
5. Verify real owner/chef/kitchen access against the deployed API. Run a small manual
   backup, download it from Drive, verify its manifest, and rehearse restoration.
6. Verify an unattended scheduled run, monthly rotation, failure/retry status and
   actual representative photo-volume capacity before declaring the backup active.
   Check the daily job the next day. Record provider timestamps/file metadata as
   evidence; local mocks are not evidence of a successful live upload.
7. Release the website navigation after the database/API checks. Keep the new page
   inaccessible to ungranted users. Do not import private recipes into Git.

## Runtime and capacity limits

ZIP memory is bounded by one file, a page of database rows, upload chunks and the
archive directory, rather than loading the entire backup into memory. Files have
a 25 MB limit; ZIP32 limits are below 4 GiB and fewer than 65,535 entries. Browser
download/verification still needs memory for the resulting ZIP.

Supabase currently documents a **2-second CPU limit**, 256 MB memory, and a
150-second free / 400-second paid wall-clock limit. See the official
[Edge Function limits](https://supabase.com/docs/guides/functions/limits).
The backup uses native and vendored WASM hashes to reduce CPU cost. A local Node
100 MiB synthetic archive test, including per-file verification, used about
1.0 second CPU and 54 MiB peak RSS. This is **not a hosted capacity guarantee**;
database JSON processing, network latency and hosted CPU speed also matter.

The current worker runs an archive within one invocation. Very large photo/version
libraries can exceed hosted limits even below ZIP32's limit. Representative hosted
capacity testing remains a release requirement. If it does not fit, move this
worker to a longer-running scheduled service or implement persisted continuation
between invocations before enabling automatic backup at that scale. Do not treat
the 4 GiB ZIP format limit as the supported hosted archive size. Existing verified
archives are preserved if the worker times out.

Reproduce the local benchmark with:

```
node scripts/benchmark-recipe-backup.mjs 100
```

## Restore rehearsal

Use a trusted checkout containing the same schema/backup format. The new Final-only
manifest is format version 1, schema version 5; schemas 1–4 are also accepted.
Install PGlite in an isolated test
environment; `PGLITE_PACKAGE_ROOT` can point to its node_modules directory.

```
node scripts/restore-recipe-backup.mjs ARCHIVE.zip RESTORE-REPORT.json
```

This command only creates an isolated in-memory database. It accepts no production
connection URL and cannot overwrite live recipes. It:

1. Rejects unsafe archive paths, invalid manifests, missing records and changed bytes.
2. Restores actor placeholders, categories, resources/prices and saved formulas in
   relationship order, then dependent links, logs, runs, files and settings.
3. Compares complete nested JSON values and table counts, not just recipe names.
4. Verifies actual file bytes against manifest hashes and their metadata links.
5. Resets the audit identity sequence so a subsequent edit can append a new event.

The test suite also creates a new audit entry after recovery. It verifies the
restored ingredient price snapshot still has its old price even after the source
price was changed, and that the recipe still has its earlier saved quantities.

## Actual disaster recovery

Use a fresh Supabase project or isolated staging database first. Never rehearse by
overwriting production. The local test bootstrap and its placeholder Auth users
are **not** a production Auth restore script.

1. Preserve the selected Drive archive; validate checksums with the app or script.
2. Apply the matching recipe schema to the fresh environment. Reconcile actor IDs
   with real Auth users. Recreate authorized accounts separately where necessary;
   passwords and sessions are intentionally excluded. Review access grants before
   enabling logins.
3. Import the authoritative JSON with deferred recipe/version pointer constraints
   and the dependency order in `restore-recipe-backup.mjs`. Do not invent new recipe,
   version, resource or file IDs. Reset restored identity sequences afterward.
4. Upload each `Files/` object through the Storage API to the **private**
   `recipe-files` bucket at its manifest `source_path`. Do not just insert a
   `storage.objects` row: real file bytes must be uploaded. Recheck byte sizes and
   hashes. Reconcile file ownership against the restored account mapping.
5. Compare full data, pinned component versions, yields, historical prices,
   packaging and photo access; compare logs/history only if the chosen older
   archive includes them. Test kitchen isolation,
   saving a new version, import, printing and a fresh independent backup.
6. Only after owner review switch application credentials/traffic. Reconfigure the
   external backup connection and runtime secrets separately; they are not in ZIPs.

Actual hosted disaster recovery and live Storage re-upload have not been performed
in this release. The automated rehearsal verifies database reconstruction and
file bytes in isolation, not Supabase's hosted Auth or Storage infrastructure.
