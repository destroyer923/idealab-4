# Messaging, Notifications, and Reviews

## Repository Reality

This checkout uses React 19, Vite 7, TypeScript, Tailwind, and an Express/Mongoose
backend. Authentication, profiles, and listings use the server API; existing
collaboration, messaging, notifications, and reviews remain in browser storage.
`src/lib/db.ts` is **not** a security boundary and must not be described as one.

These changes repair the existing application rather than creating a disconnected
server or replacing its records. No production data, accounts, conversations,
reviews, listings, or submissions are seeded, reset, or deleted.

## Confirmed Root Causes

1. Before administrator functionality was removed, `App` invoked browser-side
   administrator provisioning on every mount and included an administrator
   credential hash in frontend code.
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

- Removed browser administrator bootstrap, sign-in, routes, and frontend
  credentials. Existing account records and roles remain untouched.
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
  storage failures do not leave messages, reviews, or alerts behind.
- Notifications have an independent total unread count, paginated history, an
  individual mark-read action, mark-all-read, destination navigation, and retryable
  read/action errors. Message alerts are coalesced per unread conversation. Actors
  do not receive notifications for their own actions. Legacy verification
  notifications remain stored but display a neutral archived notice.
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
- A 360px header overflow and React hook-order errors were fixed without
  redesigning the application.

## Update Mechanism

The application uses existing `BroadcastChannel` and storage events, plus one
5-second visibility-aware refresh fallback with cleanup. It also rechecks on tab
focus. This synchronizes **tabs sharing the same browser storage and origin**.
It is not a WebSocket service, a network poll, or cross-device real-time delivery.

## Verification Commands

```sh
npm run build
npx tsc --noEmit
npm --prefix server run build
npm --prefix server test
node scripts/run-community-checks.mjs
npx esbuild scripts/test-messaging.ts --bundle --platform=node --format=esm --packages=external --alias:@=./src --outfile=/tmp/messaging.mjs
node /tmp/messaging.mjs
```

Browser checks use temporary development tooling, not an application dependency:

```sh
npm install --no-save --package-lock=false @playwright/test
npx playwright install --with-deps chromium
node scripts/test-community-browser.mjs
```

The browser script needs the frontend, backend, and an isolated test MongoDB
running. It creates two ordinary accounts through the registration UI in a fresh
Chromium context. It tests member search, conversation creation,
two-way messaging, notification navigation, read receipts, simultaneous tab writes,
refresh persistence, actual collaboration completion, profile ratings/comments,
keyboard controls, injected storage failures/retry, and layouts at 360, 390, 768,
1024, and 1440px in all three languages. All fixture data is isolated from the
application's existing browser data.

The multilingual render suite is available. The broader translation audit is
maintained separately from this change. No lint command is configured in this
checkout.

## Remaining Deployment Blockers

- End-to-end behavior against MongoDB requires an isolated test database. This
  change did not connect to, migrate, reset, or alter any configured database.
- Messaging, collaboration, notifications, and reviews still use browser storage;
  that existing architecture was not changed by this task.

The server-side listing validation is exercised independently of browser checks;
create/edit/publication route integration tests against an isolated MongoDB remain
an environment-dependent follow-up.