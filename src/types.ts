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

export interface AssignedDepartmentSummary {
  id: number;
  name: string;
  code: string;
  is_active: number;
}

export interface SessionUser {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  is_active: number;
  can_edit_approved: number;
  supervisor_id: number | null;
  assignedDepartments: AssignedDepartmentSummary[];
}

export interface Department {
  id: number;
  code: string;
  name: string;
  criteria_count: number;
  is_active: number;
  supervisor_id: number | null;
  supervisor_name: string | null;
  active_criteria_count?: number;
}

export interface Criterion {
  id: number;
  department_id: number;
  name: string;
  description: string;
  sort_order: number;
  is_required: number;
  is_active: number;
}

export interface SupervisorInfo {
  id: number;
  user_id: number | null;
  name: string;
  phone: string;
  is_active: number;
  username: string | null;
}

export interface ReportListItem {
  id: number;
  report_number: string;
  evaluation_date: string;
  evaluation_time: string;
  shift: ShiftType;
  department_id: number;
  department_name: string;
  department_code: string;
  supervisor_id: number;
  supervisor_name: string;
  created_by_user_id: number;
  created_by_name: string;
  updated_by_name: string;
  reviewed_by_name: string | null;
  criteria_average: number;
  discipline_score: number;
  overall_average: number;
  overall_percentage: number;
  rating_label: string;
  rating_color: string;
  notes_text: string;
  suggestions_text: string;
  status: ReportStatus;
  reviewed_at: string | null;
  review_comment: string;
  created_at: string;
  updated_at: string;
}

export interface ReportScoreSnapshot {
  snapshot_id: number;
  original_criterion_id: number | null;
  name: string;
  description: string;
  sort_order: number;
  is_required: number;
  score: number | null;
}

export interface ReportNoteItem {
  id: number;
  report_id: number;
  department_id: number;
  note_type: 'observation' | 'issue' | 'suggestion';
  content: string;
  attachment_path: string | null;
  attachment_name: string | null;
  created_by_name: string;
  created_at: string;
}

export interface CorrectiveActionItem {
  id: number;
  report_id: number | null;
  report_number: string | null;
  department_id: number;
  department_name: string;
  problem_description: string;
  root_cause: string;
  required_action: string;
  assigned_to: string;
  recorded_date: string;
  target_date: string;
  status: CorrectiveActionStatus;
  followup_notes: string;
  verification_result: string;
  created_by_name: string;
  is_overdue: number;
  created_at: string;
  updated_at: string;
}

export interface DashboardData {
  kpis: {
    totalDepartments: number;
    submittedReportsCount: number;
    approvedReportsCount: number;
    productionHallAverage: number | null;
    productionHallPercentage: number | null;
    productionHallRatingLabel: string;
    productionHallRatingColor: string;
    dailyReportsCount: number;
    weeklyReportsCount: number;
    monthlyReportsCount: number;
    overdueActionsCount: number;
    departmentsNeedingImprovementCount: number;
  };
  departmentsNeedingImprovement: DepartmentDashboardRow[];
  topDepartments: DepartmentDashboardRow[];
  departmentSummaryTable: DepartmentDashboardRow[];
  trendSeries: Array<{
    date: string;
    averageScore: number;
    reportsCount: number;
  }>;
  overdueActions: Array<{
    id: number;
    department_id: number;
    department_name: string;
    problem_description: string;
    assigned_to: string;
    target_date: string;
    status: CorrectiveActionStatus;
  }>;
}

export interface DepartmentDashboardRow {
  departmentId: number;
  departmentCode: string;
  departmentName: string;
  isActive: boolean;
  supervisorId: number | null;
  supervisorName: string;
  evaluationsCount: number;
  averageScore: number | null;
  averagePercentage: number | null;
  ratingLabel: string;
  ratingColor: string;
  lastEvaluationDate: string | null;
  latestNote: string;
  openActionsCount: number;
  overdueActionsCount: number;
}

export interface AdminUserItem {
  id: number;
  username: string;
  full_name: string;
  role: UserRole;
  is_active: number;
  can_edit_approved: number;
  has_password: number;
  supervisor_id: number | null;
  phone: string | null;
  created_at: string;
  departments: Array<{
    supervisor_id: number;
    department_id: number;
    department_name: string;
  }>;
}

export interface AuditLogItem {
  id: number;
  user_id: number | null;
  username: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
  created_at: string;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'مدير النظام',
  production_manager: 'مسؤول الإنتاج',
  supervisor: 'مشرف قسم',
};

export const SHIFT_LABELS: Record<ShiftType, string> = {
  morning: 'صباحية',
  evening: 'مسائية',
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  draft: 'مسودة',
  submitted: 'مرسل',
  under_review: 'قيد المراجعة',
  approved: 'معتمد',
  needs_corrective_action: 'يحتاج إلى إجراء تصحيحي',
};

export const REPORT_STATUS_STYLES: Record<ReportStatus, string> = {
  draft: 'text-slate-600 bg-slate-100 border-slate-200',
  submitted: 'text-sky-700 bg-sky-50 border-sky-200',
  under_review: 'text-amber-700 bg-amber-50 border-amber-200',
  approved: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  needs_corrective_action: 'text-red-700 bg-red-50 border-red-200',
};

export const ACTION_STATUS_LABELS: Record<CorrectiveActionStatus, string> = {
  new: 'جديد',
  in_progress: 'قيد التنفيذ',
  completed: 'مكتمل',
  not_resolved: 'لم تتم المعالجة',
  needs_followup: 'يحتاج إلى متابعة',
};

export const ACTION_STATUS_STYLES: Record<CorrectiveActionStatus, string> = {
  new: 'text-sky-700 bg-sky-50 border-sky-200',
  in_progress: 'text-amber-700 bg-amber-50 border-amber-200',
  completed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  not_resolved: 'text-red-700 bg-red-50 border-red-200',
  needs_followup: 'text-purple-700 bg-purple-50 border-purple-200',
};
