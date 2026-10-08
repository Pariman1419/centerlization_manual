import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { errorMessage, manualsApi } from '../api/manuals'
import { projectsApi } from '../api/projects'
import { atLeast, type EffectiveRole } from '../lib/permissions'
import { Dialog } from '../components/Dialog'
import { ManualForm } from '../components/ManualForm'
import { RevisionFiles } from '../components/RevisionFiles'
import { RevisionHistory } from '../components/RevisionHistory'
import { formatDate, StatusBadge } from '../components/StatusBadge'
import { UploadRevisionModal } from '../components/UploadRevisionModal'
import { RevisionStepper } from '../components/RevisionStepper'
import { UserText } from '../components/UserText'
import type { Manual, Revision, RevisionReview } from '../types/manual'

export function ManualDetailPage({ currentUsername }: { currentUsername?: string } = {}) {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const manualId = Number(id)
  const [manual, setManual] = useState<Manual | null>(null)
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [reviewsMap, setReviewsMap] = useState<Record<number, RevisionReview[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState<string>(location.state?.message || '')
  const [uploading, setUploading] = useState(false)
  const [reload, setReload] = useState(0)
  const [role, setRole] = useState<EffectiveRole>(null)

  // Publish Dialog State
  const [selectedPublish, setSelectedPublish] = useState<Revision | null>(null)
  const [publishError, setPublishError] = useState('')
  const [publishing, setPublishing] = useState(false)

  // Submit Review Dialog State
  const [selectedSubmit, setSelectedSubmit] = useState<Revision | null>(null)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Approve Dialog State
  const [selectedApprove, setSelectedApprove] = useState<Revision | null>(null)
  const [approveComment, setApproveComment] = useState('')
  const [approveError, setApproveError] = useState('')
  const [approving, setApproving] = useState(false)

  // Reject Dialog State
  const [selectedReject, setSelectedReject] = useState<Revision | null>(null)
  const [rejectComment, setRejectComment] = useState('')
  const [rejectError, setRejectError] = useState('')
  const [rejecting, setRejecting] = useState(false)

  // Delete Revision Dialog State
  const [selectedDelete, setSelectedDelete] = useState<Revision | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Edit Manual / Edit Revision / Withdraw State
  const [editingManual, setEditingManual] = useState(false)
  const [editRevision, setEditRevision] = useState<Revision | null>(null)
  const [editDetail, setEditDetail] = useState('')
  const [editError, setEditError] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [selectedWithdraw, setSelectedWithdraw] = useState<Revision | null>(null)
  const [withdrawError, setWithdrawError] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)

  // Delete Manual Dialog State
  const [deletingManual, setDeletingManual] = useState(false)
  const [deleteManualError, setDeleteManualError] = useState('')
  const [deleteManualBusy, setDeleteManualBusy] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    if (!Number.isSafeInteger(manualId) || manualId <= 0) {
      setError('Manual not found')
      setLoading(false)
      return
    }

    Promise.all([manualsApi.get(manualId), manualsApi.revisions(manualId)])
      .then(([data, history]) => {
        if (!active) return
        setManual(data)
        setRevisions(history)
        projectsApi.get(data.project_id).then(project => {if (active) setRole(project.my_role)}).catch(() => {if (active) setRole(null)})
        Promise.all(
          history.map(rev =>
            manualsApi
              .reviews(rev.id)
              .then(revs => ({ id: rev.id, reviews: revs }))
              .catch(() => ({ id: rev.id, reviews: [] })),
          ),
        ).then(entries => {
          if (!active) return
          const map: Record<number, RevisionReview[]> = {}
          for (const entry of entries) {
            map[entry.id] = entry.reviews
          }
          setReviewsMap(map)
        })
      })
      .catch(err => {
        if (active) setError(errorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [manualId, reload])

  async function handleSaveRevision() {
    if (!editRevision || savingEdit) return
    setSavingEdit(true)
    setEditError('')
    try {
      await manualsApi.updateRevision(editRevision.id, editDetail.trim())
      setMessage(`REV ${editRevision.revision_no} updated.`)
      setEditRevision(null)
      setReload(v => v + 1)
    } catch (err) {
      setEditError(errorMessage(err))
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleWithdraw() {
    if (!selectedWithdraw || withdrawing) return
    setWithdrawing(true)
    setWithdrawError('')
    try {
      await manualsApi.withdraw(selectedWithdraw.id)
      setMessage(`REV ${selectedWithdraw.revision_no} withdrawn from review and returned to draft.`)
      setSelectedWithdraw(null)
      setReload(v => v + 1)
    } catch (err) {
      setWithdrawError(errorMessage(err))
    } finally {
      setWithdrawing(false)
    }
  }

  async function handleDeleteRevision() {
    if (!selectedDelete || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      await manualsApi.deleteRevision(selectedDelete.id)
      setMessage(`REV ${selectedDelete.revision_no} deleted.`)
      setSelectedDelete(null)
      setReload(v => v + 1)
    } catch (err) {
      setDeleteError(errorMessage(err))
    } finally {
      setDeleting(false)
    }
  }

  async function handleDeleteManual() {
    if (!manual || deleteManualBusy) return
    setDeleteManualBusy(true)
    setDeleteManualError('')
    try {
      await manualsApi.deleteManual(manual.id)
      navigate(`/projects/${manual.project_id}`, { state: { message: `Manual ${manual.manual_code} deleted.` } })
    } catch (err) {
      setDeleteManualError(errorMessage(err))
      setDeleteManualBusy(false)
    }
  }

  async function handlePublish() {
    if (!selectedPublish || publishing) return
    setPublishing(true)
    setPublishError('')
    try {
      const revision = await manualsApi.publish(selectedPublish.id)
      setSelectedPublish(null)
      setMessage(`REV ${revision.revision_no} published successfully.`)
      setReload(v => v + 1)
    } catch (err) {
      setPublishError(errorMessage(err))
    } finally {
      setPublishing(false)
    }
  }

  async function handleSubmitReview() {
    if (!selectedSubmit || submitting) return
    setSubmitting(true)
    setSubmitError('')
    try {
      const revision = await manualsApi.submitReview(selectedSubmit.id)
      setSelectedSubmit(null)
      setMessage(`REV ${revision.revision_no} submitted for review.`)
      setReload(v => v + 1)
    } catch (err) {
      setSubmitError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleApprove() {
    if (!selectedApprove || approving) return
    setApproving(true)
    setApproveError('')
    try {
      const revision = await manualsApi.approve(selectedApprove.id, approveComment.trim() || undefined)
      setSelectedApprove(null)
      setApproveComment('')
      setMessage(`REV ${revision.revision_no} approved.`)
      setReload(v => v + 1)
    } catch (err) {
      setApproveError(errorMessage(err))
    } finally {
      setApproving(false)
    }
  }

  async function handleReject() {
    if (!selectedReject || rejecting) return
    if (!rejectComment.trim()) {
      setRejectError('Comment is required when rejecting a revision.')
      return
    }
    setRejecting(true)
    setRejectError('')
    try {
      const revision = await manualsApi.reject(selectedReject.id, rejectComment.trim())
      setSelectedReject(null)
      setRejectComment('')
      setMessage(`REV ${revision.revision_no} rejected.`)
      setReload(v => v + 1)
    } catch (err) {
      setRejectError(errorMessage(err))
    } finally {
      setRejecting(false)
    }
  }

  const current = manual?.current_revision?.status === 'PUBLISHED' ? manual.current_revision : null

  return (
    <>
      <Link
        to={manual ? `/projects/${manual.project_id}` : '/projects'}
        className="mb-6 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-blue-800"
      >
        <span aria-hidden="true">←</span> {manual ? 'Back to Project' : 'Back to Projects'}
      </Link>
      {message && (
        <p role="status" className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </p>
      )}
      {error && (
        <div role="alert" className="error mb-5 flex items-center justify-between gap-4">
          <p>{error}</p>
          <button className="btn-secondary btn-small" onClick={() => setReload(v => v + 1)}>
            Retry
          </button>
        </div>
      )}
      {loading && <p className="py-10 text-center text-slate-500">Loading manual…</p>}
      {!loading && !error && manual && (
        <>
          <Link to={`/projects/${manual.project_id}`} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-blue-800 hover:underline">
            <span aria-hidden="true">←</span> Back to {manual.project_name}
          </Link>
          <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <Link to="/projects" className="hover:text-blue-800">
              Projects
            </Link>
            <span aria-hidden="true">/</span>
            <Link to={`/projects/${manual.project_id}`} className="hover:text-blue-800">
              {manual.project_name}
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{manual.title}</span>
          </nav>
          <div className="detail-heading panel mb-6 flex flex-wrap items-start justify-between gap-5 p-6">
            <div className="min-w-0">
              <UserText as="h1" className="break-words text-3xl font-semibold tracking-tight text-slate-900" text={manual.title}>{manual.title}</UserText>
              <p className="mt-2 text-sm font-medium text-slate-500">{manual.manual_code}</p>
              <p className="mt-3 text-sm text-slate-600">
                Project: {manual.project_name} <span className="ml-2 text-slate-500">{manual.project_code}</span>
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
                <span className="text-slate-600">
                  Category: <span className="text-slate-900">{manual.category || 'Uncategorized'}</span>
                </span>
                <StatusBadge status={manual.status} />
              </div>
              {manual.description && (
                <UserText as="p" className="mt-4 max-w-3xl whitespace-pre-wrap break-words text-sm leading-6 text-slate-600" text={manual.description}>
                  {manual.description}
                </UserText>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
            {atLeast(role, 'CONTRIBUTOR') && <button className="btn-secondary" onClick={() => { setMessage(''); setEditingManual(true) }}>
              Edit Manual
            </button>}
            {atLeast(role, 'OWNER') && <button
              className="btn-secondary text-red-700 hover:bg-red-50 hover:border-red-300"
              onClick={() => {
                setMessage('')
                setDeleteManualError('')
                setDeletingManual(true)
              }}
            >
              Delete Manual
            </button>}
            {atLeast(role, 'CONTRIBUTOR') && <button
              className="btn-primary"
              onClick={() => {
                setMessage('')
                setUploading(true)
              }}
            >
              <span aria-hidden="true">+</span> Upload New Revision
            </button>}
            </div>
          </div>
          <div className="mb-6">
            <RevisionStepper status={current ? 'PUBLISHED' : (revisions[0]?.status || 'DRAFT')} />
          </div>
          <section className="panel border-l-4 border-l-blue-800" data-testid="current-revision">
            <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
              <h2 className="text-lg font-semibold">Current Published Revision</h2>
            </div>
            <div className="px-6 py-5">
              {current ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-xl font-semibold">REV {current.revision_no}</h3>
                    <StatusBadge status={current.status} />
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    {formatDate(current.published_at || current.uploaded_at)}
                    {current.published_by && ` · Published by ${current.published_by}`}
                  </p>
                  <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                    {current.revision_detail || 'No revision detail provided.'}
                  </p>
                  <div className="mt-4">
                    <RevisionFiles revision={current} />
                  </div>
                </>
              ) : (
                <>
                  <p className="font-medium text-slate-700">No published revision</p>
                  <p className="mt-2 text-sm text-slate-500">
                    Upload a draft (Word, PDF or other files) and submit it for review. Once approved, publish it to make this manual available.
                  </p>
                </>
              )}
            </div>
          </section>

          <RevisionHistory
            revisions={revisions}
            reviewsMap={reviewsMap}
            onSubmitReview={!atLeast(role, 'CONTRIBUTOR') ? undefined : rev => {
              setSelectedSubmit(rev)
              setSubmitError('')
              setMessage('')
            }}
            onApprove={!atLeast(role, 'REVIEWER') ? undefined : rev => {
              setSelectedApprove(rev)
              setApproveComment('')
              setApproveError('')
              setMessage('')
            }}
            onReject={!atLeast(role, 'REVIEWER') ? undefined : rev => {
              setSelectedReject(rev)
              setRejectComment('')
              setRejectError('')
              setMessage('')
            }}
            canDelete={rev => atLeast(role, 'OWNER') || (atLeast(role, 'CONTRIBUTOR') && rev.uploaded_by === currentUsername)}
            canManage={rev => atLeast(role, 'OWNER') || (atLeast(role, 'CONTRIBUTOR') && (rev.uploaded_by === currentUsername || rev.submitted_by === currentUsername))}
            onEdit={!atLeast(role, 'CONTRIBUTOR') ? undefined : rev => {
              setEditRevision(rev)
              setEditDetail(rev.revision_detail ?? '')
              setEditError('')
              setMessage('')
            }}
            onWithdraw={!atLeast(role, 'CONTRIBUTOR') ? undefined : rev => {
              setSelectedWithdraw(rev)
              setWithdrawError('')
              setMessage('')
            }}
            onDelete={!atLeast(role, 'CONTRIBUTOR') ? undefined : rev => {
              setSelectedDelete(rev)
              setDeleteError('')
              setMessage('')
            }}
            onPublish={!atLeast(role, 'OWNER') ? undefined : rev => {
              setSelectedPublish(rev)
              setPublishError('')
              setMessage('')
            }}
          />

          {uploading && (
            <UploadRevisionModal
              manual={manual}
              onClose={() => setUploading(false)}
              onUploaded={revision => {
                setUploading(false)
                setMessage(`Revision ${revision.revision_no} uploaded successfully.`)
                setReload(v => v + 1)
              }}
            />
          )}

          {/* Submit for Review Dialog */}
          {selectedSubmit && (
            <Dialog
              title={`Submit REV ${selectedSubmit.revision_no} for Review?`}
              onClose={() => setSelectedSubmit(null)}
              busy={submitting}
            >
              <div className="space-y-3 px-6 py-5 text-sm leading-6 text-slate-600">
                <p>This revision will be submitted for reviewer approval.</p>
                {submitError && <p role="alert" className="error">{submitError}</p>}
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setSelectedSubmit(null)} disabled={submitting}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleSubmitReview} disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Submit for Review'}
                </button>
              </div>
            </Dialog>
          )}

          {/* Approve Dialog */}
          {selectedApprove && (
            <Dialog
              title={`Approve REV ${selectedApprove.revision_no}?`}
              onClose={() => setSelectedApprove(null)}
              busy={approving}
            >
              <div className="space-y-3 px-6 py-5 text-sm leading-6 text-slate-600">
                <p>Approve this revision to allow it to be published.</p>
                <fieldset disabled={approving} className="space-y-2">
                  <legend className="mb-2 text-xs font-medium text-slate-700">Review revision files</legend>
                  <RevisionFiles revision={selectedApprove} />
                </fieldset>
                <div>
                  <label htmlFor="approve-comment" className="block text-xs font-medium text-slate-700">
                    Approval Comments (Optional)
                  </label>
                  <textarea
                    id="approve-comment"
                    className="mt-1 block w-full rounded-md p-2 text-sm text-slate-900 shadow-xs"
                    rows={3}
                    placeholder="Notes or feedback for this approval..."
                    value={approveComment}
                    onChange={e => setApproveComment(e.target.value)}
                  />
                </div>
                {approveError && <p role="alert" className="error">{approveError}</p>}
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setSelectedApprove(null)} disabled={approving}>
                  Cancel
                </button>
                <button className="btn-success" onClick={handleApprove} disabled={approving}>
                  {approving ? 'Approving…' : 'Approve'}
                </button>
              </div>
            </Dialog>
          )}

          {/* Reject Dialog */}
          {selectedReject && (
            <Dialog
              title={`Reject REV ${selectedReject.revision_no}?`}
              onClose={() => setSelectedReject(null)}
              busy={rejecting}
            >
              <div className="space-y-3 px-6 py-5 text-sm leading-6 text-slate-600">
                <p>Reject this revision and return feedback to the submitter.</p>
                <div>
                  <label htmlFor="reject-comment" className="block text-xs font-medium text-slate-700">
                    Reason for Rejection <span className="text-red-700">*</span>
                  </label>
                  <textarea
                    id="reject-comment"
                    required
                    className="mt-1 block w-full rounded-md p-2 text-sm text-slate-900 shadow-xs"
                    rows={3}
                    placeholder="Provide specific reasons or changes needed..."
                    value={rejectComment}
                    onChange={e => {
                      setRejectComment(e.target.value)
                      if (rejectError) setRejectError('')
                    }}
                  />
                </div>
                {rejectError && <p role="alert" className="error">{rejectError}</p>}
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setSelectedReject(null)} disabled={rejecting}>
                  Cancel
                </button>
                <button className="btn-danger" onClick={handleReject} disabled={rejecting}>
                  {rejecting ? 'Rejecting…' : 'Reject'}
                </button>
              </div>
            </Dialog>
          )}

          {/* Edit Manual Dialog */}
          {editingManual && (
            <Dialog title="Edit Manual" onClose={() => setEditingManual(false)}>
              <ManualForm
                manual={manual}
                onCancel={() => setEditingManual(false)}
                onSaved={() => {
                  setEditingManual(false)
                  setMessage('Manual updated.')
                  setReload(v => v + 1)
                }}
              />
            </Dialog>
          )}

          {/* Edit Revision Dialog */}
          {editRevision && (
            <Dialog title={`Edit REV ${editRevision.revision_no}`} onClose={() => setEditRevision(null)} busy={savingEdit}>
              <div className="space-y-3 px-6 py-5 text-sm text-slate-600">
                <label className="field">Revision detail
                  <textarea rows={4} maxLength={20000} value={editDetail} onChange={event => setEditDetail(event.target.value)} />
                </label>
                <p className="text-xs text-slate-500">The files and revision number cannot be changed. Delete and re-upload to replace the files.</p>
                {editError && <p role="alert" className="error">{editError}</p>}
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setEditRevision(null)} disabled={savingEdit}>Cancel</button>
                <button className="btn-primary" onClick={handleSaveRevision} disabled={savingEdit}>{savingEdit ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </Dialog>
          )}

          {/* Withdraw Dialog */}
          {selectedWithdraw && (
            <Dialog title={`Withdraw REV ${selectedWithdraw.revision_no} from review?`} onClose={() => setSelectedWithdraw(null)} busy={withdrawing}>
              <div className="space-y-3 px-6 py-5 text-sm leading-6 text-slate-600">
                <p>The revision returns to Draft so it can be edited, deleted or submitted again.</p>
                {withdrawError && <p role="alert" className="error">{withdrawError}</p>}
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setSelectedWithdraw(null)} disabled={withdrawing}>Cancel</button>
                <button className="btn-primary" onClick={handleWithdraw} disabled={withdrawing}>{withdrawing ? 'Withdrawing…' : 'Withdraw'}</button>
              </div>
            </Dialog>
          )}

          {/* Delete Revision Dialog */}
          {selectedDelete && (
            <Dialog
              title={`Delete REV ${selectedDelete.revision_no}?`}
              onClose={() => setSelectedDelete(null)}
              busy={deleting}
            >
              <div className="space-y-3 px-6 py-5 text-sm leading-6 text-slate-600">
                <p>This permanently deletes the revision and all of its files. This cannot be undone.</p>
                {deleteError && <p role="alert" className="error">{deleteError}</p>}
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setSelectedDelete(null)} disabled={deleting}>
                  Cancel
                </button>
                <button className="btn-danger" onClick={handleDeleteRevision} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </Dialog>
          )}

          {/* Delete Manual Dialog */}
          {deletingManual && (
            <Dialog
              title={`Delete manual ${manual.manual_code}?`}
              onClose={() => setDeletingManual(false)}
              busy={deleteManualBusy}
            >
              <div className="space-y-3 px-6 py-5 text-sm leading-6 text-slate-600">
                <p>This permanently deletes the manual and all of its revisions (any status, including published) and files.</p>
                {deleteManualError && <p role="alert" className="error">{deleteManualError}</p>}
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setDeletingManual(false)} disabled={deleteManualBusy}>
                  Cancel
                </button>
                <button className="btn-danger" onClick={handleDeleteManual} disabled={deleteManualBusy}>
                  {deleteManualBusy ? 'Deleting…' : 'Delete Manual'}
                </button>
              </div>
            </Dialog>
          )}

          {/* Publish Dialog */}
          {selectedPublish && (
            <Dialog
              title={`Publish REV ${selectedPublish.revision_no}?`}
              onClose={() => setSelectedPublish(null)}
              busy={publishing}
            >
              <div className="space-y-3 px-6 py-5 text-sm leading-6 text-slate-600">
                <p>This revision will become the current manual.</p>
                <p>The previous published revision will be archived. Its file and revision history will remain available.</p>
                {publishError && <p role="alert" className="error">{publishError}</p>}
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setSelectedPublish(null)} disabled={publishing}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handlePublish} disabled={publishing}>
                  {publishing ? 'Publishing…' : 'Publish'}
                </button>
              </div>
            </Dialog>
          )}
        </>
      )}
    </>
  )
}
