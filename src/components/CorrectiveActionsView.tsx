import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckSquare,
  FileSpreadsheet,
  Plus,
  Printer,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { exportCorrectiveActionsToExcel } from '../lib/exportExcel';
import {
  ACTION_STATUS_LABELS,
  ACTION_STATUS_STYLES,
  type CorrectiveActionItem,
  type CorrectiveActionStatus,
  type Department,
  type ReportListItem,
  type SessionUser,
} from '../types';

interface CorrectiveActionsViewProps {
  currentUser: SessionUser;
  prefillReport?: ReportListItem | null;
  onClearPrefill?: () => void;
}

export const CorrectiveActionsView: React.FC<CorrectiveActionsViewProps> = ({
  currentUser,
  prefillReport,
  onClearPrefill,
}) => {
  const [actions, setActions] = useState<CorrectiveActionItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);

  // Create modal
  const [showCreate, setShowCreate] = useState(Boolean(prefillReport));
  const [departmentId, setDepartmentId] = useState(
    prefillReport ? String(prefillReport.department_id) : ''
  );
  const [reportId, setReportId] = useState<number | null>(prefillReport ? prefillReport.id : null);
  const [problemDescription, setProblemDescription] = useState(
    prefillReport?.notes_text || ''
  );
  const [rootCause, setRootCause] = useState('');
  const [requiredAction, setRequiredAction] = useState('');
  const [assignedTo, setAssignedTo] = useState(
    prefillReport?.supervisor_name || ''
  );
  const [recordedDate, setRecordedDate] = useState(new Date().toISOString().slice(0, 10));
  const [targetDate, setTargetDate] = useState(new Date().toISOString().slice(0, 10));
  const [creating, setCreating] = useState(false);

  // Edit / Followup modal
  const [editingAction, setEditingAction] = useState<CorrectiveActionItem | null>(null);
  const [editStatus, setEditStatus] = useState<CorrectiveActionStatus>('new');
  const [editFollowup, setEditFollowup] = useState('');
  const [editVerification, setEditVerification] = useState('');
  const [editTargetDate, setEditTargetDate] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const canManage = currentUser.role === 'admin' || currentUser.role === 'production_manager';

  useEffect(() => {
    if (prefillReport) {
      setShowCreate(true);
      setDepartmentId(String(prefillReport.department_id));
      setReportId(prefillReport.id);
      setProblemDescription(prefillReport.notes_text || '');
      setAssignedTo(prefillReport.supervisor_name || '');
    }
  }, [prefillReport]);

  useEffect(() => {
    apiRequest<{ departments: Department[] }>('/departments')
      .then((res) => setDepartments(res.departments))
      .catch(() => {});
  }, []);

  const loadActions = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (deptFilter) params.set('departmentId', deptFilter);
      if (overdueOnly) params.set('overdueOnly', '1');
      const res = await apiRequest<{ actions: CorrectiveActionItem[] }>(
        `/corrective-actions?${params.toString()}`
      );
      setActions(res.actions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل الإجراءات التصحيحية');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadActions();
  }, [statusFilter, deptFilter, overdueOnly]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      await apiRequest('/corrective-actions', {
        method: 'POST',
        body: JSON.stringify({
          reportId,
          departmentId: Number(departmentId),
          problemDescription,
          rootCause,
          requiredAction,
          assignedTo,
          recordedDate,
          targetDate,
          status: 'new',
        }),
      });
      setShowCreate(false);
      setProblemDescription('');
      setRootCause('');
      setRequiredAction('');
      setAssignedTo('');
      setReportId(null);
      if (onClearPrefill) onClearPrefill();
      await loadActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الإجراء التصحيحي');
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (item: CorrectiveActionItem) => {
    setEditingAction(item);
    setEditStatus(item.status);
    setEditFollowup(item.followup_notes || '');
    setEditVerification(item.verification_result || '');
    setEditTargetDate(item.target_date);
  };

  const handleUpdateAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAction) return;
    setSavingEdit(true);
    setError(null);
    try {
      await apiRequest(`/corrective-actions/${editingAction.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: editStatus,
          followupNotes: editFollowup,
          verificationResult: editVerification,
          targetDate: editTargetDate,
        }),
      });
      setEditingAction(null);
      await loadActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث الإجراء');
    } finally {
      setSavingEdit(false);
    }
  };

  const overdueCount = actions.filter((a) => a.is_overdue === 1).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div>
          <h2 className="text-lg font-bold text-slate-900">إدارة الملاحظات والإجراءات التصحيحية</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            توثيق المشكلات التشغيلية، تحديد الأسباب الجذرية، ومتابعة تنفيذ المعالجات والتحقق منها
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportCorrectiveActionsToExcel(actions)}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
            <span>تصدير Excel</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-4 h-4 text-slate-600" />
            <span>طباعة</span>
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>تسجيل إجراء تصحيحي</span>
            </button>
          )}
        </div>
      </div>

      {overdueCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between gap-3 text-xs text-red-900">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>يوجد {overdueCount} إجراء تصحيحي متجاوز للموعد المستهدف للإنجاز.</span>
          </div>
          <button
            type="button"
            onClick={() => setOverdueOnly((v) => !v)}
            className="px-3 py-1 bg-white border border-red-300 rounded-lg font-semibold text-red-700 hover:bg-red-100 cursor-pointer"
          >
            {overdueOnly ? 'عرض الكل' : 'تصفية المتأخرة فقط'}
          </button>
        </div>
      )}

      {/* Filter Row */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 no-print">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">القسم</label>
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value="">جميع الأقسام</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">حالة التنفيذ</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value="">جميع الحالات</option>
            <option value="new">جديد</option>
            <option value="in_progress">قيد التنفيذ</option>
            <option value="completed">مكتمل</option>
            <option value="not_resolved">لم تتم المعالجة</option>
            <option value="needs_followup">يحتاج إلى متابعة</option>
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer py-1.5">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
              className="rounded border-slate-300 text-teal-700"
            />
            <span>إظهار الإجراءات المتأخرة فقط</span>
          </label>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl p-4">
          {error}
        </div>
      )}

      {/* Actions Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">جاري تحميل السجل...</div>
        ) : actions.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            لا توجد إجراءات تصحيحية مسجلة مطابقة للبحث.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">#</th>
                  <th className="py-3 px-4">القسم</th>
                  <th className="py-3 px-4 min-w-[200px]">وصف المشكلة والسبب</th>
                  <th className="py-3 px-4 min-w-[180px]">الإجراء المطلوب</th>
                  <th className="py-3 px-4">المسؤول</th>
                  <th className="py-3 px-4">التسجيل / المستهدف</th>
                  <th className="py-3 px-4">الحالة</th>
                  <th className="py-3 px-4 text-left no-print">تحديث</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {actions.map((a) => (
                  <tr key={a.id} className={a.is_overdue ? 'bg-red-50/40' : 'hover:bg-slate-50/70'}>
                    <td className="py-3 px-4 font-mono font-bold text-slate-700 tabular-nums align-top">
                      #{a.id}
                      {a.report_number && (
                        <div className="text-[11px] text-teal-700 font-normal mt-0.5">
                          {a.report_number}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-900 align-top whitespace-nowrap">
                      {a.department_name}
                    </td>
                    <td className="py-3 px-4 align-top space-y-1">
                      <div className="font-semibold text-slate-900">{a.problem_description}</div>
                      {a.root_cause && (
                        <div className="text-slate-500">السبب: {a.root_cause}</div>
                      )}
                      {a.followup_notes && (
                        <div className="text-teal-800">المتابعة: {a.followup_notes}</div>
                      )}
                      {a.verification_result && (
                        <div className="text-emerald-800">التحقق: {a.verification_result}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-700 align-top">{a.required_action}</td>
                    <td className="py-3 px-4 font-semibold text-slate-800 align-top whitespace-nowrap">
                      {a.assigned_to}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums align-top whitespace-nowrap">
                      <div className="text-slate-500">تسجيل: {a.recorded_date}</div>
                      <div className={a.is_overdue ? 'text-red-700 font-bold' : 'text-slate-800'}>
                        مستهدف: {a.target_date}
                        {a.is_overdue ? ' (متأخر)' : ''}
                      </div>
                    </td>
                    <td className="py-3 px-4 align-top whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 font-semibold border rounded ${
                          ACTION_STATUS_STYLES[a.status]
                        }`}
                      >
                        {ACTION_STATUS_LABELS[a.status]}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-left align-top no-print">
                      <button
                        type="button"
                        onClick={() => openEditModal(a)}
                        className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-700 font-semibold hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <CheckSquare className="w-3.5 h-3.5" />
                        <span>متابعة</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Action Modal */}
      {showCreate && canManage && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">تسجيل إجراء تصحيحي جديد</h3>
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  if (onClearPrefill) onClearPrefill();
                }}
                className="text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    القسم المعني *
                  </label>
                  <select
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">-- اختر القسم --</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الشخص المسؤول عن التنفيذ *
                  </label>
                  <input
                    type="text"
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    required
                    placeholder="اسم المشرف أو مسؤول القسم"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  وصف المشكلة *
                </label>
                <textarea
                  rows={2}
                  value={problemDescription}
                  onChange={(e) => setProblemDescription(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  سبب المشكلة (تحليل السبب الجذري)
                </label>
                <textarea
                  rows={2}
                  value={rootCause}
                  onChange={(e) => setRootCause(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  الإجراء المطلوب *
                </label>
                <textarea
                  rows={2}
                  value={requiredAction}
                  onChange={(e) => setRequiredAction(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    تاريخ تسجيل الإجراء
                  </label>
                  <input
                    type="date"
                    value={recordedDate}
                    onChange={(e) => setRecordedDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الموعد المستهدف للإنجاز *
                  </label>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
                >
                  {creating ? 'جاري الحفظ...' : 'حفظ الإجراء التصحيحي'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Update / Verification Modal */}
      {editingAction && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                متابعة وتحديث الإجراء التصحيحي #{editingAction.id}
              </h3>
              <button
                type="button"
                onClick={() => setEditingAction(null)}
                className="text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-1">
              <div className="font-bold text-slate-900">{editingAction.department_name}</div>
              <div className="text-slate-700">{editingAction.problem_description}</div>
              <div className="text-teal-800">المطلوب: {editingAction.required_action}</div>
            </div>

            <form onSubmit={handleUpdateAction} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  حالة التنفيذ
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as CorrectiveActionStatus)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {canManage ? (
                    <>
                      <option value="new">جديد</option>
                      <option value="in_progress">قيد التنفيذ</option>
                      <option value="completed">مكتمل</option>
                      <option value="not_resolved">لم تتم المعالجة</option>
                      <option value="needs_followup">يحتاج إلى متابعة</option>
                    </>
                  ) : (
                    <>
                      <option value="in_progress">قيد التنفيذ</option>
                      <option value="needs_followup">يحتاج إلى متابعة</option>
                    </>
                  )}
                </select>
              </div>

              {canManage && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الموعد المستهدف للإنجاز
                  </label>
                  <input
                    type="date"
                    value={editTargetDate}
                    onChange={(e) => setEditTargetDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ملاحظات المتابعة
                </label>
                <textarea
                  rows={2}
                  value={editFollowup}
                  onChange={(e) => setEditFollowup(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              {canManage && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    نتيجة التحقق من المعالجة
                  </label>
                  <textarea
                    rows={2}
                    placeholder="سجل نتيجة الفحص الميداني بعد تنفيذ الإجراء..."
                    value={editVerification}
                    onChange={(e) => setEditVerification(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingAction(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
                >
                  {savingEdit ? 'جاري الحفظ...' : 'حفظ التحديث'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
