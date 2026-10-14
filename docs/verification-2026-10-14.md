# UI backlog completion and verification — 14 October 2026

Completed the three work groups requested on 14 October: document search/review queue, safer upload interactions, and current verification documentation.

## Behavior

- The header searches document codes/titles across projects the authenticated user can access. Text is matched literally, including `%` and `_`; at most 20 results appear. Each result identifies its project and opens Manual Detail. Changing the query cancels/ignores old responses. Dismissing results restores keyboard focus to the input.
- Waiting for review counts IN_REVIEW revisions in projects where the user is ADMIN, OWNER, BA or REVIEWER. System Admin sees all. Membership is checked against the database each time. The dialog shows the oldest 20 items while the count includes every pending revision. It is available through mobile navigation, refreshes after mutations/focus, and refreshes once per minute while visible.
- Uploads and BA file replacements show actual byte progress. At 100% the interface separately says the server is saving the revision. Cancel upload stops the browser request and retains revision details/selected files.
- Cancellation checks history inside the form before enabling another upload. A failed check exposes a retry control. A matching new revision or a changed/deleted BA revision blocks resubmission and directs the user to inspect/reopen current history. The original expected_version is never silently advanced.
- Closing an edited form or pressing Escape requires discard confirmation. Changing file type warns before clearing selected files. Reload/closing the browser tab uses the browser's unsaved-change warning.

Cancellation cannot roll back a server request that has already arrived. Even after a history read finds no completed upload, the server may finish later. The form states this; existing revision uniqueness and content-version checks remain the final safeguards. There are no automatic mutation retries.

## Verification

| Check | Result |
| --- | --- |
| Full backend pytest | 182 passed; one existing Starlette/httpx deprecation warning |
| Full frontend Vitest | 87 passed across 13 files |
| TypeScript and production build | Passed; main JS 410.45 kB / 119.18 kB gzip; CSS 51.84 kB / 10.96 kB gzip |
| Independent source review | No Critical findings; cancellation reconciliation finding fixed and covered by slow/failing-history and committed-version tests; focus dismissal finding fixed |
| Headless Chromium | Real 4 MB PDF selection/upload, progress/processing, cancellation/history check, file retention, discard/type/Escape guards, search navigation and queue update passed |
| Responsive browser checks | 375, 768 and 1280 px; no document horizontal overflow |
| Browser runtime | No uncaught page errors or HTTP 5xx responses during the final run |
| React Doctor (changed lines) | No errors; six warnings for component complexity and explicit loading-state transitions |

Commands: `.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider` from backend, `npm test`, `npm run typecheck`, `npm run build`, and `npx react-doctor@latest . --scope lines --base 4449f3c --include-untracked --verbose --no-score --no-parallel --max-duration 120 --blocking none --no-color` from frontend. Python ran with UTF-8 environment variables.

Backend tests use SQLite and memory storage. Browser checks used a separate temporary SQLite database and memory objects with the real authentication, API handlers, PDF validation and multipart requests. No production users/projects/files were created, changed or deleted. Chromium selected a real local PDF through the file input. This replaces the earlier unverified-browser-upload status for this isolated test environment; it does not claim a browser upload against the deployed PostgreSQL/MinIO environment.

React Doctor's loading warnings refer to intentionally cancelling an old search and transitioning from transmission to cancellation reconciliation. Both paths have regression coverage. Complexity warnings are recorded rather than expanding this feature into a broader component refactor.

### PostgreSQL query review

Read-only `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` was run for the route's generated membership-capability, pending-count and oldest-20 SQL. Execution times were 0.604, 0.821 and 0.095 ms respectively (planning 6.042, 32.006 and 0.682 ms). Membership lookup used `idx_project_members_user_id`; the queue uses scalar columns and bounded output rather than loading revision file/review relationships.

The current dataset had no matching pending items for this query scope. These checks verify schema compatibility and the current execution plan, not large-volume response latency, production p95 or Redis cache hit rates. No index/migration was added.

### Browser evidence

[Final browser results](verification/2026-10-14/browser-result.json)

- [Desktop workspace](verification/2026-10-14/workspace-1280.png)
- [Tablet workspace](verification/2026-10-14/workspace-768.png)
- [Mobile workspace](verification/2026-10-14/workspace-375.png)
- [Global search](verification/2026-10-14/global-search.png)
- [Upload processing](verification/2026-10-14/upload-processing.png)
- [Cancelled upload with preserved files](verification/2026-10-14/upload-cancelled.png)

## Deployment and remaining scope

Rebuild/deploy backend and frontend together using the existing compose setup. This branch needs no additional migration; previously documented migrations through `011_ba_revision_updates.sql` remain prerequisites for older environments. The running containers were not redeployed by this GitHub update.

The broader original Phase E roadmap still includes a suggested next revision number, a reader-specific Open document action and explanations for hidden role actions. Those were outside the three work groups requested in this session. Production cache latency/hit-rate measurement and a deployed PostgreSQL/MinIO browser integration run remain separate validation work.

Reports dated 7–8 October are historical. Their earlier counts, authentication limitations, test-action-count mismatch and browser-validation status do not describe the current source tree; use this report for the checks performed in this change.
