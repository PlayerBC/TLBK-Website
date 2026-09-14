# Reproduce the eight mocked Edge tests

Requires **Node.js 24**. No npm packages, Deno installation, provider account, API key, or network access is required.

From the repository root:

```sh
node tests/edge/run.mjs
```

The runner starts Node's built-in test runner with TypeScript transformation enabled and loads the real Edge source. It supplies mocked Deno environment/serve APIs and intercepted fetch responses. All eight checks should pass:

1. Image contents/type/size rejection.
2. Required email event content, private access links, and HTML escaping.
3. Unlisted origin and unauthenticated catalog upload denial.
4. Guest proof authorization, private storage, and atomic commit sequence.
5. Cleanup after a proof-upload race fails.
6. Verified staff identity and five-minute signed proof URL.
7. Worker secret protection and invalidated-reminder skip.
8. Stable email idempotency key and acceptance recording after provider success.

These are mocked checks, not evidence that hosted Supabase, Storage, SMTP, DNS, Resend, or cron has been configured. No email is sent. Follow `docs/SETUP.md` and the owner acceptance checklist to verify actual receipt after setup. The TypeScript-transform experimental warning is expected on Node 24.
