# Naming and upload validation

This change keeps the existing API payloads and database schema. Errors continue
to use `{"detail":"message"}` and forms preserve their values on failure.

## Project and manual codes

- Codes are trimmed, 1–100 characters, and case-sensitive. They must start with
  an ASCII letter or digit; remaining characters may also include `_` and `-`.
  Project create/update and explicit manual codes use the same validator.
- Project names, manual titles, and original filenames may repeat. Database
  unique constraints protect project codes, global manual codes, and revision
  numbers within a manual, including concurrent requests.
- Project create and code changes check `<code>/` in MinIO. Both a folder marker
  and any object below that prefix produce 409. Similar prefixes such as
  `PRJ-1-OTHER/` do not block `PRJ-1/`.
- An unavailable MinIO folder check returns 503 without saving the project.
  Metadata-only edits do not perform this check.
- A project code cannot change while the project has manuals. Manual creation
  and project editing lock the same project row, so the count check and code
  selection are serialized on PostgreSQL. Names and descriptions remain editable.
- Prefix inspection is a precheck, not a reservation against external MinIO
  writers. It does not relocate or delete existing objects. Old stored keys
  continue to be used for preview and download.

## Revision uploads

- Numeric revision numbers normalize to the same value (`1`, `01`, `001` → `01`).
  The duplicate check runs again after locking the manual, before uploading.
  The database constraint remains the final guard.
- File contents, extensions, empty files, executable attachments, and individual
  sizes continue to use the existing validation.
- Combined file payload size cannot exceed `MAX_UPLOAD_MB`. Multipart request
  limits retain the extra 1 MB allowance for form fields and boundaries.
- The frontend checks the combined size while selecting attachments and describes
  its 50 MB ceiling as a combined limit. Deployments configured below 50 MB are
  additionally enforced by the backend, whose error states the configured limit.
- Existing upload cleanup and uncertain-commit recovery remain in place; clients
  must inspect revision history before retrying an unconfirmed upload.

## Verification

Regression checks cover existing prefixes and folder markers, unavailable storage,
code changes before/after manual creation, invalid codes, conflicts discovered
after locking, combined upload limits, and retention of form values and old files.
Backend business tests use SQLite and in-memory storage. PostgreSQL row-lock
behavior and a live MinIO deployment require separate integration verification.

Verification on 2026-10-08: 48 targeted backend tests and 44 frontend tests pass;
the frontend production build passes. The full backend suite reports 133 passed
and one existing failure, `test_all_reserved_actions_are_defined`, which expects
17 audit actions while the unchanged action registry contains 18. Starlette also
reports an existing deprecation warning about the test client's use of httpx.

## Optimization and cache

- The frontend shares concurrent default GET requests for project/manual metadata
  using a bounded map (up to 128 in-flight requests). Entries are removed on both
  success and failure. Custom request options, authentication, users, membership,
  and signed file URLs bypass the cache. No completed response is retained.
- Mutations clear the map before starting and when finishing, including errors.
  Session-token changes clear it as well. An old response cannot remove a newer
  request's entry, and an old-session 401 cannot log out the new session.
- React memoizes filtered project/manual lists until their data or filters change.
- Manual numbering now selects the largest numeric suffix inside the database,
  returning one value instead of loading all matching codes into Python. Digit
  length and then digit text preserve numeric order without integer overflow.
  Prefix matching escapes SQL wildcards such as `_`.
- Number selection still requires database work over matching rows; this reduces
  transfer and Python memory to one value, not a guaranteed O(log N) database query.
  List endpoints still return all matching records; cache does not replace pagination.
- MinIO existence checks, uniqueness checks, and authorization remain uncached.
  This avoids stale answers across other users, processes, and external storage writes.
