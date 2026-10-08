# BA Update/Edit and Dev review

Implemented workflow agreed on 2026-10-08. This is a code change; deployment requires migration 011 first.

## Workflow

- Dev creates/selects a manual, uploads the first revision as DRAFT, then submits it to BA (IN_REVIEW).
- BA chooses Approve, Reject or Update/Edit.
- Reject requires a reason. Dev reads that reason, corrects the document, uploads a new revision number and submits the new draft. A REJECTED file cannot be resubmitted unchanged.
- Update/Edit lets project BA / Reviewer / Owner / Admin edit the detail and replace files while keeping the revision ID and number. It returns the revision to DRAFT.
- BA may approve that updated draft directly, or request Dev review first.
- Dev / Contributor previews/downloads the BA update and reports either Request Changes (feedback required) or No Further Changes.
- Requested changes require another BA update. No further changes allows BA to approve directly.
- APPROVED then goes through Publish. The previous current publication is archived.

## Files and history

The update replaces the selected file type: PDF replaces PDF, Word replaces Word, and Other replaces the whole Other attachment set. Unselected types are retained. The UI states this before saving. The original uploader remains unchanged; BA updater and timestamp are recorded separately.

Replacement uses new UUID object keys. A successful database commit switches references, then removes superseded storage objects. Validation, storage or confirmed database failures keep the original files. An unconfirmed commit retains objects for reconciliation. Update history records actor, time, content version, prior/current filenames and details; it is metadata history, not a backup download of superseded files.

Published and archived revisions cannot be replaced. Upload a new revision instead.

## Review safety and permissions

- File/detail updates increment content_version. Update, Dev request and Dev feedback require expected_version. Approving a BA-updated revision also checks expected_version.
- A BA update clears current Dev feedback and submit/publication metadata, so old approval does not authorize new files. Historical approval/rejection records remain visible.
- Pending Dev review or requested changes blocks both approval and submission as a bypass.
- Dev feedback does not grant approval or publication permissions.
- BA-controlled drafts cannot be edited through the old Contributor detail-edit API.
- Mutation handlers refresh the revision after acquiring its lock. Replacement, publication and deletion acquire the manual lock before the revision lock.
- Project authorization and existing session/CSRF checks apply to all endpoints.

## New endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /api/revisions/{id}/update-files | Multipart detail/replacement files and expected_version; BA+ |
| POST | /api/revisions/{id}/request-dev-review | expected_version; BA+ |
| POST | /api/revisions/{id}/dev-review | expected_version, changes_requested, comment; Dev/Contributor |
| GET | /api/revisions/{id}/updates | Scoped metadata history, latest 100 events |

The existing approve JSON accepts expected_version; the frontend sends it. Initial Dev drafts still require Submit for Review.

## Deployment

Apply the additive, idempotent migration explicitly before starting the updated backend. It adds columns to manual_revisions and does not replace existing files or records.

From backend in PowerShell:

```powershell
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONPATH = '.'
..\.venv\Scripts\python.exe scripts/migrate.py 011_ba_revision_updates.sql
```

Build the frontend and deploy both backend and frontend together. No migration runs at startup.
