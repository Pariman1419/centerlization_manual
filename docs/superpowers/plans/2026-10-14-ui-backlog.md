# UI Backlog Completion Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. The user authorized implementation and GitHub publication on 2026-10-14.

**Goal:** Finish global document search, an actionable review queue, upload progress/cancellation and current verification documentation.

**Architecture:** Reuse authenticated manual search and add a bounded, role-scoped review queue. Keep search and queue in focused React components. Use XMLHttpRequest only for multipart uploads that need byte progress and AbortSignal; preserve the existing session, CSRF, mutation invalidation and error contracts.

**Tech Stack:** FastAPI, SQLAlchemy/PostgreSQL, React/TypeScript, Vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-10-08-ui-refinement-design.md`, section E, and the user's request to complete the three outstanding work groups.

## Global Constraints

- The UI stays English; user data may contain Thai.
- Authorization remains server-enforced and checked against current project membership.
- Search is literal by code/title. Results are bounded and deterministically ordered.
- IN_REVIEW revisions count only for system Admin or project ADMIN/OWNER/BA/REVIEWER.
- Cancellation stops client transmission/waiting; it cannot promise rollback after the server received a request. Preserve form values, refresh history before retrying, and never automatically retry a mutation.
- No schema migration, new dependencies, production data cleanup or deployment is needed for this change.

### Task 1: Search and review queue

**Files:** `backend/app/routers/manuals.py`, `backend/app/schemas/manual.py`, `backend/tests/test_navigation.py`; `frontend/src/api/manuals.ts`, `frontend/src/components/GlobalSearch.tsx`, `frontend/src/components/ReviewQueue.tsx`, `frontend/src/App.tsx`, `frontend/src/styles.css`, `frontend/src/test/workspace-navigation.test.tsx`.

**Interfaces:** `manualsApi.search(search, signal)` returns `Manual[]` (up to 20). `GET /api/manuals/review-queue` returns `{count, items}`; each item includes revision/manual/project IDs, codes/names, revision number and submitted time. `manual-data-changed` refreshes the queue after mutations.

- [ ] Write authorization tests: reviewer in project A and viewer in B sees only A's IN_REVIEW revisions; Admin sees both; removed memberships disappear immediately. Search returns literal matches only inside accessible projects and honors a bounded limit.
- [ ] Run `python -m pytest tests/test_navigation.py -q -p no:cacheprovider`; expect missing-route/limit failures.
- [ ] Add scalar-projection queue queries (count plus at most 20 rows), static route before `/{manual_id}`, and validated optional search limit. Use project-member subqueries instead of per-row permission reads.
- [ ] Write frontend tests for search, result navigation, stale request suppression, error retry and queue refresh; observe failure before creating components.
- [ ] Implement a submit-driven header search and review queue button/dialog for desktop/tablet/mobile. Empty queue stays hidden for users without eligible roles; reviewers get a zero state.
- [ ] Run targeted backend and frontend tests, then commit the feature.

### Task 2: Upload progress, cancel and unsaved changes

**Files:** `frontend/src/api/manuals.ts`, `frontend/src/components/UploadRevisionModal.tsx`, `frontend/src/pages/ManualDetailPage.tsx`, `frontend/src/test/upload-progress.test.tsx`, `frontend/src/test/upload-request.test.ts`, existing upload tests and shared test transport utility.

**Interfaces:** optional `UploadOptions = {signal?: AbortSignal; onProgress?: (percent: number | null) => void}` on `manualsApi.upload` and `replaceFiles`; a `onCancelled` modal callback refreshes parent revision history.

- [ ] Write transport tests proving multipart bytes, CSRF, successful JSON, HTTP/network errors, 401 session expiry, in-flight cache invalidation and abort behavior. Run them and observe failure with the current fetch-only transport.
- [ ] Implement the XHR transport with same-origin credentials and shared mutation lifecycle. Abort listeners are removed on settlement; no completion callback runs after cancellation.
- [ ] Write component tests for byte progress, processing at 100%, cancel preserving inputs, dirty close/escape confirmation and file-type change confirmation. Observe missing-behavior failures.
- [ ] Add an accessible progress bar, Cancel upload, cancellation warning/history refresh, a discard confirmation and beforeunload guard. Disable edits while uploading, retain files on errors/cancel, warn before changing type clears files.
- [ ] Run all upload/workflow/BA-update tests, then commit the feature.

### Task 3: Verify and document

**Files:** `README.md`, current verification report and historical report notes.

- [ ] Run backend pytest, frontend Vitest, TypeScript/build and React Doctor. Fix actual regressions with reproducing tests.
- [ ] Exercise the app in a browser against isolated test data: authenticated search, review queue, real file selection/upload, cancel/discard, keyboard navigation and 375/768/1280px layouts. Record exactly what was observed.
- [ ] Replace stale current-verification claims with a link to the dated report, preserve historical reports as history, and record remaining scope (e.g. unmeasured production cache latency).
- [ ] Request an independent whole-branch review; address important findings and rerun affected checks.
- [ ] Fast-forward the clean main checkout, push origin/main and confirm the remote SHA and clean status.

## Review Focus

Project-role isolation; bounded queries without ORM relationship fan-out; cancellation versus committed server writes; session/CSRF parity between fetch and XHR; queue freshness after mutations; keyboard focus and mobile layout; evidence-backed documentation.

## Execution Record

Ruling: Execute inline in a temporary linked worktree and integrate after validation; the user requested completion and push, so routine implementation choices and final publication are already authorized.

Ruling: Keep Fitness/Djuwara and completed Phase A-D work as implemented. Complete only the outstanding items named in the preceding status report.
