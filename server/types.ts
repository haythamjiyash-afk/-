export type UserRole = 'admin' | 'production_manager' | 'supervisor';

export type ReportStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'needs_corrective_action';

export type ShiftType = 'morning' | 'evening';

export type CorrectiveActionStatus =
  | 'new'
  | 'in_progress'
  | 'completed'
  | 'not_resolved'
  | 'needs_followup';

export interface RatingThreshold {
  id: string;
  label: string;
  minScore: number;
  color: string;
}

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  supervisor_id: number | null;
  is_active: number;
}

export interface SeedCriterion {
  name: string;
  description: string;
  is_required: boolean;
}

export interface SeedDepartment {
  code: string;
  name: string;
  supervisorUsername: string;
  criteria: SeedCriterion[];
}

export interface SeedSupervisor {
  username: string;
  fullName: string;
  phone: string;
}
