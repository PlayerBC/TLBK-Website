# Approved Academy UX implementation

All 19 proposals were approved on 1 October 2026, with the existing branding and colors preserved. The implementation is based on main 7d8a0dd33348e39d38cc23863dec4c886fe13642.

## Release order

The new database migration is tested locally but has **not been applied to production**. Automatic approval review requires explicit approval for this persistent database/API change. Apply `supabase/migrations/20261001025348_academy_approved_ux_reads.sql` and verify hosted permissions **before merging/deploying the frontend**. The new frontend uses the new `navigation` and `gallery_post` actions. The migration is compatible with the existing frontend. No live email tests were sent for this change.

## Approved changes

| ID | Result |
| --- | --- |
| ACADEMY-UX-01 | Short greeting, visible new replies, compact classes and permission-checked recipe shortcuts. |
| ACADEMY-UX-02 | Clear login/signup choices, three benefits and an explanation of access before enrollment. |
| ACADEMY-UX-03 | Shorter course imagery, instructor names, Open class and direct unread-reply links. |
| ACADEMY-UX-04 | Modules and recipes lead the class page; named instructor help and sharing follow them. |
| ACADEMY-UX-05 | Continuous recipe with ingredients and method together; all teaching fields and section jumps retained. |
| ACADEMY-UX-06 | Gallery filter chips, Clear all, account-scoped page/scroll state and nearby-image loading. |
| ACADEMY-UX-07 | Back to gallery, browser Back, class context and previous/next photos with a count. |
| ACADEMY-UX-08 | Photo previews, individual removal, library/camera choices, count and upload progress; audience defaults preserved. |
| ACADEMY-UX-09 | Named instructor and class context, recipe question prefill and optional attachment previews. |
| ACADEMY-UX-10 | Explicit Show new reply notice, latest/reply jumps and a composer that retains drafts and selected photos. |
| ACADEMY-UX-11 | Distinct schedule block, products to make and the existing inquiry destination. |
| ACADEMY-UX-12 | Compact mobile header and four visible destinations with a keyboard-accessible More menu. |
| ACADEMY-UX-13 | Focused tablet layout with side-by-side ingredients/method in landscape and a collapsible ingredient panel. |
| ACADEMY-UX-14 | Instructor inbox landing, teaching navigation, actual Needs reply / All / Resolved and class filters. |
| ACADEMY-UX-15 | Grouped owner navigation and persistent assignment count, class, instructor and success feedback. |
| ACADEMY-UX-16 | Unread-first announcements, a clear unread indicator and a subdued read state. |
| ACADEMY-UX-17 | Independent explicit consent saves, Saved/Unsaved feedback and disabled unchanged Save buttons. |
| ACADEMY-UX-18 | Visible route progress, stable navigation, lightweight navigation data and deferred private image requests. |
| ACADEMY-UX-19 | Larger secondary controls, visible focus and field-associated errors with existing keyboard behavior preserved. |

## Architecture and privacy

The existing authenticated RPC remains the only browser entry point. Internal read projections remain non-public and reuse current enrollment/thread permissions. Direct gallery routes return only submitted, approved gallery posts, even for owners. Needs reply derives from the latest submitted sender and resolution status, rather than unread state. Conversation read markers advance only to rendered messages. Class recipe shortcuts are permission checked. Existing replay/idempotency guards remain intact. No direct table grants, new consent defaults, offline recipe storage or persistent photo caches were introduced.

Gallery state is account-scoped, expires after 15 minutes, restores at most ten pages and re-fetches content. Logout/navigation clear preview/media resources. Upload retries retain the original File and saved draft/reservation identity.

## Verification

All 15 regression suites passed: 283 unit checks; 118 Edge Function checks; 16 new UX database checks; 118 Academy audit database checks; 19 original Academy database checks; archive recovery; 12 core browser workflows; 20 new UX checks each in Chrome and Edge; 18 existing audit checks each in Chrome and Edge; 6 auth checks; 13 admin checks; shared newsletter browser regression; static build (24 pages). Counts overlap. The final touch-target CSS was subsequently checked through the focused browser suite and refreshed captures.

Fifteen actual before/after browser states were reviewed with no horizontal overflow or unlabeled fields in the recorded states. Physical-device camera/iPad Safari and full screen-reader validation remain open. This is not a conformance certificate.

Controlled performance comparison: 52 synthetic gallery posts, 390×844 viewport, 4× CPU slowdown, three fresh contexts per version. Initial image downloads fell from 24 to 6 (75% fewer); route feedback appeared in 6–18.4 ms during a deliberately held 400 ms class response, and the navigation node remained stable. Transport uses real migrated local RPCs with mocked Auth/media, so these are not production latency measurements.

Brand comparison: the shared ordering stylesheet (including fonts/palette) and Academy logo are unchanged after normalizing Git's Windows line endings for text. All eight checked computed palette variables, the Inter body font and logo URL match the baseline. New Academy rules use the existing brand variables.

Run `npm run test:academy:ux` for the focused DB/browser suite. Set `PLAYWRIGHT_CHANNEL=msedge` for Edge. The existing PGlite and Playwright dependency setup is shared with the Academy test harness.
