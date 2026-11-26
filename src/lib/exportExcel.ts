import * as XLSX from 'xlsx';
import {
  ACTION_STATUS_LABELS,
  REPORT_STATUS_LABELS,
  SHIFT_LABELS,
  type CorrectiveActionItem,
  type DepartmentDashboardRow,
  type ReportListItem,
  type ReportScoreSnapshot,
} from '../types';

function saveWorkbook(wb: XLSX.WorkBook, filename: string): void {
  XLSX.writeFile(wb, filename);
}

export function exportReportsListToExcel(reports: ReportListItem[], filenamePrefix = 'تقارير_الأداء'): void {
  const rows = reports.map((r) => ({
    'رقم التقرير': r.report_number,
    'تاريخ التقييم': r.evaluation_date,
    'الوقت': r.evaluation_time,
    'الوردية': SHIFT_LABELS[r.shift] || r.shift,
    'القسم': r.department_name,
    'المشرف': r.supervisor_name,
    'متوسط المعايير (10)': r.criteria_average,
    'درجة الانضباط (10)': r.discipline_score,
    'المتوسط العام (10)': r.overall_average,
    'النسبة المئوية (%)': r.overall_percentage,
    'التصنيف': r.rating_label,
    'الحالة': REPORT_STATUS_LABELS[r.status] || r.status,
    'الملاحظات': r.notes_text || '-',
    'المقترحات التطويرية': r.suggestions_text || '-',
    'أنشئ بواسطة': r.created_by_name,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'التقارير');
  saveWorkbook(wb, `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportSingleReportToExcel(
  report: ReportListItem,
  scores: ReportScoreSnapshot[]
): void {
  const summaryRows = [
    { 'البيان': 'رقم التقرير', 'القيمة': report.report_number },
    { 'البيان': 'القسم', 'القيمة': report.department_name },
    { 'البيان': 'المشرف', 'القيمة': report.supervisor_name },
    { 'البيان': 'تاريخ التقييم', 'القيمة': report.evaluation_date },
    { 'البيان': 'الوقت', 'القيمة': report.evaluation_time },
    { 'البيان': 'الوردية', 'القيمة': SHIFT_LABELS[report.shift] },
    { 'البيان': 'الحالة', 'القيمة': REPORT_STATUS_LABELS[report.status] },
    { 'البيان': 'متوسط المعايير التشغيلية (من 10)', 'القيمة': report.criteria_average },
    { 'البيان': 'درجة الانضباط وتحمل المسؤولية (من 10)', 'القيمة': report.discipline_score },
    { 'البيان': 'متوسط الأداء العام (من 10)', 'القيمة': report.overall_average },
    { 'البيان': 'النسبة المئوية (%)', 'القيمة': `${report.overall_percentage}%` },
    { 'البيان': 'التصنيف', 'القيمة': report.rating_label },
    { 'البيان': 'الملاحظات والمشكلات', 'القيمة': report.notes_text || '-' },
    { 'البيان': 'المقترحات التطويرية', 'القيمة': report.suggestions_text || '-' },
  ];

  const criteriaRows = scores.map((s, idx) => ({
    'م': idx + 1,
    'المعيار': s.name,
    'الوصف': s.description,
    'إلزامي': s.is_required ? 'نعم' : 'لا',
    'الدرجة (من 10)': s.score ?? '-',
  }));

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'ملخص التقرير');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(criteriaRows), 'درجات المعايير');
  saveWorkbook(wb, `تقرير_${report.report_number}.xlsx`);
}

export function exportDashboardSummaryToExcel(rows: DepartmentDashboardRow[]): void {
  const data = rows.map((d) => ({
    'رمز القسم': d.departmentCode,
    'اسم القسم': d.departmentName,
    'المشرف المسؤول': d.supervisorName,
    'عدد التقييمات': d.evaluationsCount,
    'متوسط الأداء (من 10)': d.averageScore ?? '-',
    'النسبة المئوية (%)': d.averagePercentage ?? '-',
    'مستوى الأداء': d.ratingLabel,
    'آخر تاريخ تقييم': d.lastEvaluationDate ?? '-',
    'أبرز الملاحظات': d.latestNote || '-',
    'الإجراءات المفتوحة': d.openActionsCount,
    'الإجراءات المتأخرة': d.overdueActionsCount,
  }));
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'أداء الأقسام');
  saveWorkbook(wb, `ملخص_أداء_الأقسام_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportCorrectiveActionsToExcel(actions: CorrectiveActionItem[]): void {
  const data = actions.map((a) => ({
    'رقم الإجراء': a.id,
    'القسم المعني': a.department_name,
    'رقم التقرير المرجعي': a.report_number || '-',
    'وصف المشكلة': a.problem_description,
    'سبب المشكلة': a.root_cause || '-',
    'الإجراء المطلوب': a.required_action,
    'الشخص المسؤول': a.assigned_to,
    'تاريخ التسجيل': a.recorded_date,
    'الموعد المستهدف': a.target_date,
    'الحالة': ACTION_STATUS_LABELS[a.status] || a.status,
    'متأخر': a.is_overdue ? 'نعم' : 'لا',
    'ملاحظات المتابعة': a.followup_notes || '-',
    'نتيجة التحقق': a.verification_result || '-',
  }));
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'الإجراءات التصحيحية');
  saveWorkbook(wb, `الإجراءات_التصحيحية_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
