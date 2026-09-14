# Backend contract validation

This suite applies the actual SQL migrations to a fresh, in-memory PostgreSQL
engine (PGlite 0.5.8), including its real `pgcrypto` extension. It creates local
Supabase platform stubs for `auth`, Storage, and the API roles. It never connects
to a Supabase project or sends an email.

From this directory:

```sh
npm install
npm test
```

To check only that the migrations apply:

```sh
node run.mjs --migrations-only
```

To use dependencies installed outside the repository:

```sh
PGLITE_PACKAGE_ROOT=/absolute/path/to/dependency-directory node tests/backend/run.mjs
```

The dependency directory must contain `node_modules/@electric-sql/pglite`.
Every run begins with an empty database. Fixtures are local, clearly named test
products and accounts; the deployed migration remains empty and paused.

The suite has 29 checks. They exercise the public RPC with anonymous, customer, staff and owner roles;
service actions run with the separate service role. Direct SQL is used only to
seed verified users, inspect persisted invariants, and move deadlines without
waiting an hour. Fixed timestamp lead-time checks use the production helper.

Coverage includes Manila production dates and cutoff, shared pickup/delivery
capacity, no-reservation quotes, idempotent submissions and approvals, guest
privacy, timely/late/rejected proofs, expiry, paid amendment pricing and preserved
payment/progress, failed date-move rollback, counted product options, stock
restoration, promo limits/requalification/redemption, optimistic revisions and
role isolation. Outbox checks cover exclusive leases, sent-record guards, retry
backoff, stopping before the provider idempotency window, reminder deduplication,
and cancellation checks immediately before delivery preparation.

PGlite uses one database connection. These checks establish persisted invariants
and sequential retry behavior, but cannot prove concurrent transaction races.
Run the multi-session concurrency cases from `docs/ACCEPTANCE.md` against a
configured PostgreSQL/Supabase environment. Auth email delivery, actual inbox
receipt, image uploads, signed Storage URLs, and scheduled worker delivery also
need their documented integration checks after external services are configured.
