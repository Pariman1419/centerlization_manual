from fastapi import HTTPException


def check_version(revision, expected):
    if expected is None or revision.content_version != expected:
        raise HTTPException(409, 'This revision has changed. Refresh and review the latest files before retrying.')


def require_dev_review_complete(revision):
    if revision.dev_review_requested and (
            revision.dev_reviewed_by is None or revision.dev_changes_requested is not False):
        raise HTTPException(409, 'Dev review is pending or requests changes. BA must resolve it before approval.')


def reset_dev_review(revision):
    revision.dev_review_requested = False
    revision.dev_reviewed_by = None
    revision.dev_reviewed_at = None
    revision.dev_changes_requested = None
    revision.dev_review_comment = None
