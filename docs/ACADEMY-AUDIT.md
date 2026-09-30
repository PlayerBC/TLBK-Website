# Academy security and reliability audit — 1 October 2026

The audit reproduced and fixed 19 issue groups. Database migration `20260930224436_academy_audit_security_and_reliability.sql` is already applied to the hosted project. The frontend fixes take effect after this branch is merged and deployed. No optional UX redesign is included.

## Required fixes

- **ACADEMY-TECH-01: Instructor access required unrelated ordering staff access.** Reference the existing Auth identity and search normal TLB accounts; keep owner-only instructor administration.
- **ACADEMY-TECH-02: Unsent private submission was readable by the instructor.** Require a submitted record for instructor/admin reading; preserve author access.
- **ACADEMY-TECH-03: Unsent question subject appeared in the instructor inbox.** Require a submitted message before another participant can access the thread.
- **ACADEMY-TECH-04: Forged media relationships could expose private attachment references.** Enforce a database check constraint for exact purpose-specific relationships.
- **ACADEMY-TECH-05: Late requests could restore private content after logout or overwrite navigation.** Reject stale responses; check session and dynamic-import continuations; discard stale image hydration and clear object URLs.
- **ACADEMY-TECH-06: Lost draft responses created duplicate submissions, questions or replies.** Add private, actor-scoped request keys, payload hashes and transaction locks; reauthorize replay requests and expire records after 30 days.
- **ACADEMY-TECH-07: Question upload retry became stuck after the first failure.** Validate and convert before draft creation; reuse the saved draft, completed reservations and original selected files.
- **ACADEMY-TECH-08: Admin photo retries duplicated saved records.** Remember successful saves per form and use stable server request keys for class/module/recipe/instructor/announcement/upcoming saves.
- **ACADEMY-TECH-09: Focus checks marked unseen replies as read.** Use a read-only thread_status action and mark only the last displayed message with read_thread.
- **ACADEMY-TECH-10: A pending message could still be sent after instructor deactivation.** Recheck active instructor during send, with parent/class locks.
- **ACADEMY-TECH-11: Module reorder accepted foreign, duplicate or incomplete lists.** Lock the class and validate exact count, uniqueness and ownership before updating order.
- **ACADEMY-TECH-12: Whitespace-only announcement and upcoming-class titles were accepted.** Validate a trimmed title length of 1–160 characters; lock existing rows before revision checks.
- **ACADEMY-TECH-13: Account search failed on pasted surrounding spaces.** Trim the account-search query.
- **ACADEMY-TECH-14: Academy Analytics could not open.** Use an unambiguous audit_row alias.
- **ACADEMY-TECH-15: Private-work notification opened the wrong admin section.** Route submission notifications to #submissions and message notifications to #inbox.
- **ACADEMY-TECH-16: Broadcast replay protection could be bypassed.** Require a broadcast key and reuse one reviewed-send key with a busy guard.
- **ACADEMY-TECH-17: Database details could appear in student errors.** Retain RPC codes, translate access/validation/network failures, and mask unexpected database internals.
- **ACADEMY-TECH-18: Recipe section changes lost keyboard focus.** Restore focus to the activated section control; name native dialogs with their heading.
- **ACADEMY-TECH-19: Gallery retry skipped a page and slower filters could replace newer results.** Commit page state after success and ignore obsolete filter responses.

## Validation

- 118 Academy database matrix checks and the original 19 database checks pass.
- 26 hosted role checks pass in a rolled-back transaction; verification found no retained synthetic users, classes, enrollments or test email jobs.
- 18 focused browser checks pass in each of Chrome and Edge, alongside 12 core Academy flows, 10 admin/upload/transport checks and 6 Auth/profile checks.
- All 18 business metadata tables restore locally with relationships intact, including an instructor without an ordering staff role. Media bytes are not part of that archive.
- 277 unit checks, 117 Edge checks, seven backend feature suites, static build, and the 12-check existing recipe browser suite pass.
- The monolithic backend run stops at a historical promo migration replay guard. Both remaining promo replay failures reproduce on unchanged main; separate backend files and the newsletter fixture family were exercised to continue coverage.

These counts overlap. Local Auth and email payload checks do not establish hosted sign-in or inbox delivery.

## Run the Academy suites

Use the repository's Node/PGlite/Playwright prerequisites. `PGLITE_PACKAGE_ROOT` can point to a package root containing PGlite, and `PLAYWRIGHT_PACKAGE_ROOT` can point to a node_modules directory containing Playwright. The new audit browser suites default to installed Chrome; set `PLAYWRIGHT_CHANNEL=msedge` for Edge. The recovery suite also needs JSZip resolvable by Node.

`npm run test:academy` runs the existing flows, Auth and archive checks.

`npm run test:academy:audit` runs the expanded database, browser and admin audit suites.

The browser harness exercises the real SQL/RPCs with synthetic Auth and storage transport. It does not send email or write cloud storage.

## Remaining issues

- **ACADEMY-RISK-01: Direct API image validation checks container structure, not a complete pixel decode.** A deliberately incomplete 1×1 VP8L payload passes validateWebP. Browser conversion rejects corrupt files, but an authenticated direct caller can bypass that conversion. The private bucket, size/dimension checks and authorization still apply. Next: Use a maintained decoder with explicit failure signaling and memory/CPU limits, then test corrupt bitstreams and supported phone formats. Two evaluated WASM wrappers returned bogus pixels for invalid data and were excluded.
- **ACADEMY-RISK-02: Hosted Google Drive Academy backup is disabled and has no successful run.** The production connection is disabled and last_success_at is null. The periodic worker job exists. Next: Connect the designated Drive account, enable the Academy destination, run a manual backup, verify its checksum and contents, and observe a scheduled run.
- **ACADEMY-RISK-03: Academy archives contain metadata, not the actual photos.** The archive declares files_included=false. All 18 metadata tables restore locally, including independent instructor identities and relationships; the image bytes are absent by design. Next: Provide and rehearse a separate private Storage object backup and restore process. Do not call the current metadata archive a full photo recovery solution.
- **ACADEMY-RISK-04: Two historical promo migration replay tests are incompatible with newer API definitions.** 13-promo-usage and 14-promo-deletion reproduce the same guarded source-mismatch failures with the audit migration excluded. Current promo behavior assertions preceding the replay pass. Next: Repair the historical upgrade test fixtures in an isolated test-maintenance change; retain the migrations’ production drift guards.
- **ACADEMY-RISK-05: Supabase leaked-password protection is disabled.** The hosted security advisor reports this Auth setting. No claim was made that Academy caused it. Next: Enable the Auth protection where the project plan supports it, then verify signup and password-reset behavior.

## Verification still needed

- **Hosted login, signup, reset and verification email delivery.** No authorized test inbox response or hosted test credentials were available. Required: An approved inbox and test account; complete new-tab, expired-link, used-link and password-reset journeys.
- **Instructor and student email receipt, branding, spam placement and reply notification latency.** No external test email was sent. Required: Approved instructor/student test addresses and access to their received messages.
- **Live Academy broadcast delivery and real unsubscribe links.** Consent, segmentation, idempotency and rendering were exercised locally; no live marketing recipient list was contacted. Required: An explicitly approved consenting test segment and provider delivery logs.
- **Google Drive OAuth, real writes, cron completion and cloud restore.** The production Academy connection is disabled. Required: Connected designated Drive account, enabled destination, a controlled manual run and scheduled observation.
- **Safari, iPhone Safari, iPad Safari and Firefox.** Only desktop Chrome and Edge were available. Required: Those browsers and physical iOS/iPadOS devices.
- **Physical phones/tablets, camera capture and mobile keyboard overlap.** Viewport emulation does not reproduce hardware or operating-system interactions. Required: Real small/large phones and tablets, portrait and landscape; use camera, multi-select, rotation and soft keyboard.
- **True concurrent PostgreSQL connections and sustained load.** The broad local matrix uses serialized PGlite requests; the hosted checks used one rolled-back SQL transaction. Required: A staging dataset and simultaneous independent authenticated connections.
- **Authenticated production performance at realistic scale and field Core Web Vitals.** Production has no Academy classes/enrollments; the specialist DevTools connector was unavailable. Required: Realistic staging volume, constrained network/CPU traces and field monitoring.
- **Full screen-reader and assistive-technology compatibility.** Keyboard, labels and focused visual checks are narrower than an assistive-technology audit. Required: NVDA/VoiceOver/TalkBack sessions through recipes, dialogs, uploads and messages.
- **Every existing TLB browser workflow and payment/email provider combination.** Core unit, Edge, backend and recipe-browser regressions were run; not all unrelated site browser suites or external providers. Required: The full site acceptance harness and approved provider test fixtures.

## Deployment notes

The applied migration is additive to the existing Academy API and keeps old non-broadcast requests compatible. It separates instructor identities from ordering staff, adds a private actor-scoped idempotency table and an hourly bounded cleanup, and reauthorizes cached responses. Its temporary request records are intentionally excluded from business archives. Do not replay the already-applied migration manually in production.

No email worker was redeployed as part of this audit. No marketing broadcast or Drive backup write was performed. Existing live email branding therefore still requires provider-side verification.

The separate local audit report includes the complete system checklist, machine-readable evidence, 19 optional UX proposals and 15 BEFORE/PROPOSED comparisons. All optional proposals are waiting for user approval.
