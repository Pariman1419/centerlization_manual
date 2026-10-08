import type { Revision, RevisionReview } from '../types/manual'
import { RevisionFiles } from './RevisionFiles'
import { formatDate, formatDateTime, formatSize, StatusBadge } from './StatusBadge'

interface RevisionHistoryProps {
  revisions: Revision[]
  reviewsMap?: Record<number, RevisionReview[]>
  onSubmitReview?: (revision: Revision) => void
  onApprove?: (revision: Revision) => void
  onReject?: (revision: Revision) => void
  onPublish?: (revision: Revision) => void
  canDelete?: (revision: Revision) => boolean
  onDelete?: (revision: Revision) => void
  canManage?: (revision: Revision) => boolean
  onEdit?: (revision: Revision) => void
  onWithdraw?: (revision: Revision) => void
}

export function RevisionHistory({
  revisions,
  reviewsMap = {},
  onSubmitReview,
  onApprove,
  onReject,
  onPublish,
  canDelete,
  onDelete,
  canManage,
  onEdit,
  onWithdraw,
}: RevisionHistoryProps) {
  return (
    <section className="panel mt-6">
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <h2 className="text-lg font-semibold">Revision History</h2>
        <span className="text-sm text-slate-500">
          {revisions.length} {revisions.length === 1 ? 'revision' : 'revisions'}
        </span>
      </div>
      {revisions.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <p className="font-medium text-slate-700">No revisions yet</p>
          <p className="mt-2 text-sm text-slate-500">Upload the first revision (Word, PDF or other files) to get started.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-200">
          {revisions.map(revision => {
            const reviews = reviewsMap[revision.id] || []
            return (
              <article key={revision.id} className="px-6 py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-semibold text-slate-900">REV {revision.revision_no}</h3>
                      <StatusBadge status={revision.status} />
                    </div>
                    <p className="mt-2 text-sm text-slate-500">
                      {formatDate(revision.uploaded_at)} · Uploaded by {revision.uploaded_by}
                    </p>
                    {revision.submitted_by && (
                      <p className="mt-1 text-xs text-slate-500">
                        Submitted by {revision.submitted_by}
                        {revision.submitted_at ? ` · ${formatDate(revision.submitted_at)}` : ''}
                      </p>
                    )}
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                      {revision.revision_detail || 'No revision detail provided.'}
                    </p>
                    <p className="mt-3 break-all text-xs text-slate-500">
                      {revision.file_name} · {formatSize(revision.file_size)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {(revision.status === 'DRAFT' || revision.status === 'REJECTED') && onSubmitReview && (
                      <button
                        className="btn-secondary btn-small"
                        aria-label={`Submit REV ${revision.revision_no} for review`}
                        onClick={() => onSubmitReview(revision)}
                      >
                        Submit for Review
                      </button>
                    )}
                    {revision.status === 'IN_REVIEW' && (
                      <>
                        {onReject && (
                          <button
                            className="btn-secondary btn-small text-red-700 hover:text-red-800 hover:bg-red-50 hover:border-red-300"
                            aria-label={`Reject REV ${revision.revision_no}`}
                            onClick={() => onReject(revision)}
                          >
                            Reject
                          </button>
                        )}
                        {onApprove && (
                          <button
                            className="btn-success btn-small"
                            aria-label={`Approve REV ${revision.revision_no}`}
                            onClick={() => onApprove(revision)}
                          >
                            Approve
                          </button>
                        )}
                      </>
                    )}
                    {(revision.status === 'DRAFT' || revision.status === 'REJECTED') && onEdit && canManage?.(revision) && (
                      <button className="btn-secondary btn-small" aria-label={`Edit REV ${revision.revision_no}`} onClick={() => onEdit(revision)}>
                        Edit
                      </button>
                    )}
                    {revision.status === 'IN_REVIEW' && onWithdraw && canManage?.(revision) && (
                      <button className="btn-secondary btn-small" aria-label={`Withdraw REV ${revision.revision_no} from review`} onClick={() => onWithdraw(revision)}>
                        Withdraw
                      </button>
                    )}
                    {onDelete && canDelete?.(revision) && (
                      <button
                        className="btn-secondary btn-small text-red-700 hover:bg-red-50 hover:border-red-300"
                        aria-label={`Delete REV ${revision.revision_no}`}
                        onClick={() => onDelete(revision)}
                      >
                        Delete
                      </button>
                    )}
                    {revision.status === 'APPROVED' && onPublish && (
                      <button
                        className="btn-primary btn-small"
                        aria-label={`Publish REV ${revision.revision_no}`}
                        onClick={() => onPublish(revision)}
                      >
                        Publish
                      </button>
                    )}
                  </div>
                </div>

                {reviews.length > 0 && (
                  <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4" data-testid={`reviews-${revision.id}`}>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600">Review History</h4>
                    <div className="mt-3 divide-y divide-slate-200">
                      {reviews.map(review => (
                        <div key={review.id} className="py-2.5 first:pt-0 last:pb-0 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={review.decision} />
                            <span className="font-medium text-slate-700">
                              {review.reviewer_display_name || review.reviewer_username || `Reviewer #${review.reviewer_id}`}
                            </span>
                            <span className="text-xs text-slate-500">· {formatDateTime(review.created_at)}</span>
                          </div>
                          {review.comment && (
                            <p className="mt-1.5 text-sm text-slate-600 whitespace-pre-wrap">{review.comment}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4">
                  <RevisionFiles revision={revision} />
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
