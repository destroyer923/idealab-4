# Messaging, Notifications, and Reviews

## Repository Reality

This checkout is React 19, Vite 7, TypeScript, and Tailwind. It has no Next.js
server, Drizzle models, PostgreSQL connection, migration directory, server session
middleware, or notification transport. `src/lib/db.ts` stores records in the
browser. It is **not** a security boundary and must not be described as one.

These changes repair the existing application rather than creating a disconnected
server or replacing its records. No production data, accounts, conversations,
reviews, listings, or submissions are seeded, reset, or deleted.

## Confirmed Root Causes

1. `App` invoked browser-side administrator provisioning on every mount. That
   function silently switched the active account to the admin, including after a
   refresh. It also imported an administrator credential hash into frontend code.
2. The notification bell calculated unread counts from a list limited to 30
   entries. Read failures were displayed as an empty inbox and mutation failures
   were not handled.
3. A message retry looked up its id globally and returned the matching message
   without checking sender, conversation, or text. This could return an unrelated
   private message and falsely acknowledge the send.
4. The inbox hid conversations without messages and filtered only display names.
   New-recipient search had no proper retry action and briefly displayed stale
   results during debounce.
5. Read receipts were written merely when a chat was mounted, not when it was
   focused and scrolled to the visible latest message. Scrolling also stopped
   updating correctly after the 50-message display window filled up.
6. Public profiles displayed reviews but provided no eligible review form. Review
   counts and averages were calculated independently without checking completed
   exchange eligibility or duplicate historical records.
7. `transact` persisted partially changed state even when an operation threw. This
   could leave side effects behind after a reported failure.

## Repairs

- Removed browser administrator bootstrap and the frontend credential artifact.
  Existing account records and roles remain untouched. The old provisioning
  command now fails with a setup-required error rather than creating browser
  credentials or signing anyone in. A role-grant helper was removed from runtime
  source; tests configure isolated role fixtures explicitly.
- Account changes remount the private application shell, clearing conversations,
  composers, search results, and other account-scoped component state.
- Active-account and participant checks apply to message history, sending, read
  receipts, notification reads, review submission, and suspension-sensitive calls.
- Member search supports names and usernames, partial/case-insensitive Unicode
  matching, whitespace normalization, and a leading `@`. It excludes self, blocked,
  suspended, and missing accounts, and returns public profile fields only.
- Conversation creation reuses the existing participant/context combination.
  Message and review mutations use Web Locks where available to serialize writes
  between same-origin tabs. The UI awaits the committed result, keeps failed input,
  and retries with the same idempotency key. Retry keys cannot cross conversations
  or senders.
- Successful operations and their notifications commit together. Validation and
  storage failures do not leave messages, reviews, or alerts behind. OTP failure
  attempt counters explicitly commit before an error is returned; there is no
  global commit-on-error exception anymore.
- Notifications have an independent total unread count, paginated history, an
  individual mark-read action, mark-all-read, destination navigation, and retryable
  read/action errors. Message alerts are coalesced per unread conversation. Actors
  do not receive notifications for their own actions. A single verification
  approval never claims that all publication requirements have passed.
- Shared review eligibility requires distinct participants, actual completion,
  fulfilled and confirmed commitments, and no prior review for that participant
  pair/exchange. Public profiles, review lists, and rating summaries use the same
  eligible review query. Ineligible legacy records are retained but not counted.
- Public profiles now offer a completed-exchange selector and the same review form
  used in collaborations. Ratings and written comments are saved together. Reviews
  have completed-exchange labels; private collaboration links are only offered to
  participants. Reporting does not remove negative feedback or alter ratings.
- Star controls support arrow keys, Home/End, roving keyboard focus, and accurate
  fractional display of averages. Added/repaired UI text uses English, Hindi, and
  Marathi dictionaries. Member-written text is never translated.
- A 360px header overflow and hook-order errors triggered by live verification
  status changes were fixed without redesigning the application.

## Update Mechanism

The application uses existing `BroadcastChannel` and storage events, plus one
5-second visibility-aware refresh fallback with cleanup. It also rechecks on tab
focus. This synchronizes **tabs sharing the same browser storage and origin**.
It is not a WebSocket service, a network poll, or cross-device real-time delivery.

## Verification Commands

```sh
npx tsc --noEmit
node scripts/run-community-checks.mjs
npx esbuild scripts/test-messaging.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/messaging.mjs
node /tmp/messaging.mjs
npx esbuild scripts/test-verification.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/verification.mjs
node /tmp/verification.mjs
npx esbuild scripts/test-admin.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/admin.mjs
node --test /tmp/admin.mjs
npm run build
```

Browser checks use temporary development tooling, not an application dependency:

```sh
npm install --no-save --package-lock=false @playwright/test
npx playwright install --with-deps chromium
node scripts/test-community-browser.mjs
```

The browser script creates two ordinary accounts through the real registration UI
in a fresh Chromium context. It tests member search, conversation creation,
two-way messaging, notification navigation, read receipts, simultaneous tab writes,
refresh persistence, actual collaboration completion, profile ratings/comments,
keyboard controls, injected storage failures/retry, and layouts at 360, 390, 768,
1024, and 1440px in all three languages. All fixture data is isolated from the
application's existing browser data.

The existing multilingual render suite also runs. The broader translation audit
already failed on 538 findings before these changes, mainly earlier admin and
verification translations. No new findings are accepted; the unrelated dictionary
backlog is reported separately rather than hidden or declared complete. No lint
command is configured in this checkout.

## Remaining Deployment Blockers

- PostgreSQL persistence, Drizzle constraints/indexes, server-side authentication,
  CSRF controls, server rate limits, and server-side authorization cannot be tested
  or completed against a server that is absent from this checkout. Client role
  checks do not protect browser storage from a malicious browser user.
- Separate browsers/devices do not share these records. They need the real backend
  and authenticated API to communicate. Do not deploy this local store as a
  multi-user production database.
- Secure administrator provisioning must happen on that server using deployment
  secrets. No replacement password or administrator was invented here. Treat any
  credentials previously embedded in frontend assets as exposed and rotate them
  on the real server before deployment.
- The existing local verification demonstration is not proof of phone/email or
  identity ownership. Genuine OTP/identity providers and authorized verification
  outcomes remain unverified externally. Publication service guards are preserved;
  these client-side guards are not a substitute for server enforcement.

To finish the requested PostgreSQL acceptance tests, supply the actual backend
source/schema, database connection, trusted session implementation, and configured
verification providers. The same participant, eligibility, idempotency, atomicity,
and notification rules must be enforced there before production deployment.