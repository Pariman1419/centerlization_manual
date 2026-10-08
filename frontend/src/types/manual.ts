export interface RevisionReview {
  id: number
  revision_id: number
  reviewer_id: number
  reviewer_username?: string | null
  reviewer_display_name?: string | null
  decision: 'APPROVED' | 'REJECTED'
  comment: string | null
  created_at: string
}

export interface RevisionUpdateEvent {
  id: number
  action: 'REVISION_UPDATED' | 'DEV_REVIEW_REQUESTED' | 'DEV_REVIEW_COMPLETED'
  actor_username: string | null
  created_at: string
  details: {
    content_version?: number
    revision_detail?: string | null
    previous_detail?: string | null
    previous_files?: { kind: string; file_name: string }[]
    files?: { kind: string; file_name: string }[]
    changes_requested?: boolean
    comment?: string
  } | null
}

export interface RevisionFile {
  id: number
  kind: 'WORD' | 'PDF' | 'OTHER'
  file_name: string
  file_size: number | null
  mime_type: string | null
  label?: string | null
}

export interface Revision {
  id: number
  manual_id: number
  revision_no: string
  revision_detail: string | null
  file_name: string
  file_size: number | null
  mime_type: string | null
  checksum: string | null
  status: string
  uploaded_by: string
  uploaded_at: string
  content_version?: number
  ba_updated_by?: string | null
  updated_at?: string | null
  dev_review_requested?: boolean
  dev_reviewed_by?: string | null
  dev_reviewed_at?: string | null
  dev_changes_requested?: boolean | null
  dev_review_comment?: string | null
  submitted_by?: string | null
  submitted_at?: string | null
  published_by: string | null
  published_at: string | null
  files?: RevisionFile[]
}

export interface Manual {
  id: number
  project_id: number
  project_code: string
  project_name: string
  manual_code: string
  title: string
  category: string | null
  description: string | null
  status: string
  current_revision_id: number | null
  current_revision: Revision | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface ManualInput {
  title: string
  category: string
  description: string
}
