import { Icon } from './Icon'

interface RevisionStepperProps {
  status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'REJECTED' | 'ARCHIVED' | string
}

const STEPS = [
  { key: 'DRAFT', label: 'Draft', actor: 'Contributor' },
  { key: 'IN_REVIEW', label: 'In Review', actor: 'Reviewer' },
  { key: 'APPROVED', label: 'Approved', actor: 'Owner' },
  { key: 'PUBLISHED', label: 'Published', actor: 'Live' },
]

export function RevisionStepper({ status }: RevisionStepperProps) {
  const isRejected = status === 'REJECTED'
  const isArchived = status === 'ARCHIVED'

  const activeIndex =
    status === 'DRAFT'
      ? 0
      : status === 'IN_REVIEW'
      ? 1
      : status === 'APPROVED'
      ? 2
      : status === 'PUBLISHED'
      ? 3
      : -1

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs" aria-label="Revision workflow progress">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Workflow Status
        </h3>
        {isRejected && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
            <Icon name="close" size={12} /> Changes Requested
          </span>
        )}
        {isArchived && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            Archived
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between">
        {STEPS.map((step, idx) => {
          const isPassed = !isRejected && activeIndex > idx
          const isCurrent = !isRejected && activeIndex === idx
          const isFuture = !isRejected && activeIndex < idx

          return (
            <div key={step.key} className="flex-1 flex items-center">
              <div className="flex flex-col items-center flex-1">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                    isCurrent
                      ? 'bg-blue-900 text-white ring-4 ring-blue-100'
                      : isPassed
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 text-slate-500 border border-slate-300'
                  }`}
                >
                  {isPassed ? <Icon name="check" size={14} /> : idx + 1}
                </div>
                <span
                  className={`mt-2 text-xs font-medium ${
                    isCurrent ? 'text-blue-950 font-semibold' : isPassed ? 'text-slate-900' : 'text-slate-400'
                  }`}
                >
                  {step.label}
                </span>
                <span className="text-[10px] text-slate-400 hidden sm:inline">
                  {step.actor}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={`h-0.5 w-full mx-2 -mt-6 transition-colors ${
                    isPassed ? 'bg-emerald-500' : 'bg-slate-200'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
