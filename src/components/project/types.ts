export interface Listing {
  id: string
  title: string
  description: string
  roles_needed: string[] | string
  skills: string[] | string
  timezone: string
  created_by: string
  created_at: string
  deadline_at: string | null
}

export type TaskStatus = 'todo' | 'doing' | 'done'

export interface Task {
  id: string
  project_id: string
  title: string
  description: string | null
  status: TaskStatus
  assignee_id: string | null
  created_at: string

  start_at: string | null
  due_at: string | null
  completed_at: string | null
  penalty_percent: number
  excuse_reason: string | null
  excuse_status: 'none' | 'pending' | 'approved' | 'rejected'
  excuse_decided_by: string | null
  excuse_decided_at: string | null
}

export interface ProjectMember {
  user_id: string
  display_name: string
}

export interface ProjectMessage {
  id: string
  project_id: string
  author_id: string
  body: string
  created_at: string
  parent_message_id: string | null
  edited_at: string | null
  is_deleted_for_all: boolean
}

export interface Contribution {
  id: string
  project_id: string
  user_id: string
  task_id: string | null
  kind: string
  title: string
  description: string | null
  link: string | null
  hours: number | null
  verified_by: string | null
  verified_at: string | null
  created_at: string
}

export interface ProjectFile {
  id: string
  project_id: string
  uploaded_by: string
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  category: string
  description: string | null
  version_label: string | null
  task_id: string | null
  created_at: string
}

export interface ProjectEvent {
  id: string
  project_id: string
  created_by: string
  title: string
  description: string | null
  event_type: string
  starts_at: string
  ends_at: string | null
  created_at: string
}