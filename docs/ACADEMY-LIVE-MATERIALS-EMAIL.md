# Academy conversations, materials and email templates

Open conversations now retrieve new replies automatically, normally within three seconds plus network time. Both student and instructor views keep the current reply text, selected photos and typing position. Updates append messages rather than rebuilding the page. Reading older history stays in place, with a button to jump to the new reply. Background tabs pause polling; focus and reconnect resume it, with one request in flight and a retry backoff. Revoked access and sign-out stop the conversation view.

The class editor has a **Class materials** section after modules and student recipes. The owner can upload a file with a title and optional description, edit its label, and remove it. Enrolled students and the assigned instructor download files from the student class page. Files retain their original bytes and names. Supported formats: PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, ODT/ODS/ODP, CSV, TXT, ZIP, PNG, JPEG, WebP, HEIC and SVG; maximum 25 MiB each.

Materials use a separate private Storage bucket. A server-authorized reservation precedes upload; publishing checks the stored size and content type. Objects are immutable, and retrying a lost upload response compares the existing bytes. Downloads use the current authenticated session and recheck class access. Files are downloaded as attachments, never embedded as trusted content or served through public/signed URLs. Removal immediately revokes student access before storage cleanup. Class owners manage materials; instructors have download access for their assigned classes. Metadata and saved templates join the existing Academy metadata-only backups; file bytes still need the existing separate Storage backup.

The newsletter composer provides new-class, workshop, baking-camp and baking-tips starter templates. Class email provides reminder, materials-ready and schedule-update templates. Owners can save named templates for reuse and delete saved templates. Templates only fill the subject and message; replacing a current draft requires an explicit action. Saving or previewing a template does not send an email or change subscription preferences.

**Preview email** displays the sender, subject, branded HTML, desktop/mobile widths and plain-text version. The final recipient review uses the same preview. The preview and email worker share one renderer; draft text is escaped and the preview iframe is sandboxed. Marketing previews contain the business address and unsubscribe footer; class notifications retain their operational footer. Existing recipient eligibility, opt-in checks, suppression and idempotent queueing remain in place. Queueing with zero eligible recipients is disabled. Sample details in brackets should be replaced before sending.

## Validation

- Database checks cover owner-only writes, scoped downloads, private pending files, revocation, hidden classes, removal, filename/type/size restrictions, immutable objects, template persistence and no outbox changes from template operations.
- Browser integration exercises actual pages and migrated PostgreSQL functions with synthetic Auth and Storage transport. It covers student/instructor exchanges, drafts and photos during updates, slow/offline/hidden tabs, stale responses, upload retries, byte-identical downloads, mobile layouts, templates and escaped previews.
- Preview/worker parity and existing Academy authorization, recovery, browser, media and email regressions are checked separately.
- Browser engines: Chrome, Edge, Firefox and WebKit. These are local browser tests, not tests on physical phones or live customer accounts. No customer email was sent and no live student fixture was created.

The class-level **Products (one per line)** field is a descriptive list of bakes. It does not attach recipes or downloads; those have their own sections. This change does not alter that field.

Apply the new Supabase migration before deploying the website. Deploy the email worker with its shared `assets/ordering/academy-email-render.js` dependency. The frontend is released through the owner's normal pull-request merge.

Hosted backend verification: migration `20261002032212_academy_class_materials_and_email_templates` is applied and email-worker version 34 is active. Readback confirmed the private bucket, file limit, grants, RLS, API dispatch and metadata backup coverage. The worker's 13 deployed files match the reviewed deployment payload; unrelated hosted email renderers were preserved. Security advisory results are unchanged from before deployment. The worker was not invoked to send test mail.
