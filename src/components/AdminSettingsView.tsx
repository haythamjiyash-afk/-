import React, { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  DatabaseBackup,
  Download,
  Edit3,
  History,
  KeyRound,
  Layers,
  Plus,
  Save,
  Sliders,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import {
  ROLE_LABELS,
  type AdminUserItem,
  type AuditLogItem,
  type Criterion,
  type Department,
  type RatingThreshold,
  type SupervisorInfo,
  type UserRole,
} from '../types';

interface AdminSettingsViewProps {
  thresholds: RatingThreshold[];
  restaurantName: string;
  onThresholdsUpdated: (thresholds: RatingThreshold[], restaurantName: string) => void;
}

export const AdminSettingsView: React.FC<AdminSettingsViewProps> = ({
  thresholds,
  restaurantName,
  onThresholdsUpdated,
}) => {
  const [tab, setTab] = useState<'departments' | 'users' | 'thresholds' | 'backup' | 'audit'>(
    'departments'
  );
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Departments & Criteria state
  const [departments, setDepartments] = useState<Department[]>([]);
  const [supervisors, setSupervisors] = useState<SupervisorInfo[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptCode, setNewDeptCode] = useState('');
  const [newDeptSupId, setNewDeptSupId] = useState('');
  const [editingDept, setEditingDept] = useState<Department | null>(null);

  // New/Edit Criterion
  const [newCritName, setNewCritName] = useState('');
  const [newCritDesc, setNewCritDesc] = useState('');
  const [newCritReq, setNewCritReq] = useState(true);
  const [editingCrit, setEditingCrit] = useState<Criterion | null>(null);

  // Users state
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [showNewUserModal, setShowNewUserModal] = useState(false);
  const [uUsername, setUUsername] = useState('');
  const [uFullName, setUFullName] = useState('');
  const [uRole, setURole] = useState<UserRole>('supervisor');
  const [uPassword, setUPassword] = useState('');
  const [uPhone, setUPhone] = useState('');
  const [uCanEditApproved, setUCanEditApproved] = useState(false);
  const [uDeptIds, setUDeptIds] = useState<number[]>([]);
  const [editingUser, setEditingUser] = useState<AdminUserItem | null>(null);
  const [batchPassword, setBatchPassword] = useState('');
  const [showBatchModal, setShowBatchModal] = useState(false);

  // Thresholds state
  const [localThresholds, setLocalThresholds] = useState<RatingThreshold[]>(thresholds);
  const [localRestName, setLocalRestName] = useState(restaurantName);

  // Backup state
  const [backupStart, setBackupStart] = useState('');
  const [backupEnd, setBackupEnd] = useState('');
  const [restoring, setRestoring] = useState(false);

  // Audit logs
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);

  useEffect(() => {
    setLocalThresholds(thresholds);
    setLocalRestName(restaurantName);
  }, [thresholds, restaurantName]);

  const loadDepartmentsAndSups = async () => {
    try {
      const [dRes, sRes] = await Promise.all([
        apiRequest<{ departments: Department[] }>('/departments?includeInactive=1'),
        apiRequest<{ supervisors: SupervisorInfo[] }>('/supervisors'),
      ]);
      setDepartments(dRes.departments);
      setSupervisors(sRes.supervisors);
      if (!selectedDeptId && dRes.departments.length > 0) {
        setSelectedDeptId(dRes.departments[0]!.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل الأقسام');
    }
  };

  const loadCriteria = async (deptId: number) => {
    try {
      const res = await apiRequest<{ criteria: Criterion[] }>(
        `/departments/${deptId}/criteria?includeInactive=1`
      );
      setCriteria(res.criteria);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل المعايير');
    }
  };

  const loadUsers = async () => {
    try {
      const res = await apiRequest<{ users: AdminUserItem[] }>('/admin/users');
      setUsers(res.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل المستخدمين');
    }
  };

  const loadAuditLogs = async () => {
    try {
      const res = await apiRequest<{ logs: AuditLogItem[] }>('/admin/audit-logs');
      setAuditLogs(res.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل سجل التعديلات');
    }
  };

  useEffect(() => {
    loadDepartmentsAndSups();
  }, []);

  useEffect(() => {
    if (selectedDeptId) {
      loadCriteria(selectedDeptId);
    }
  }, [selectedDeptId]);

  useEffect(() => {
    if (tab === 'users') {
      loadUsers();
      loadDepartmentsAndSups();
    } else if (tab === 'audit') {
      loadAuditLogs();
    }
  }, [tab]);

  const notifySuccess = (msg: string) => {
    setError(null);
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  // Department CRUD
  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiRequest<{ id: number }>('/admin/departments', {
        method: 'POST',
        body: JSON.stringify({
          name: newDeptName,
          code: newDeptCode || undefined,
          supervisorId: newDeptSupId ? Number(newDeptSupId) : null,
        }),
      });
      setNewDeptName('');
      setNewDeptCode('');
      setNewDeptSupId('');
      await loadDepartmentsAndSups();
      setSelectedDeptId(res.id);
      notifySuccess('تمت إضافة القسم بنجاح');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء القسم');
    }
  };

  const handleSaveDeptEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDept) return;
    try {
      await apiRequest(`/admin/departments/${editingDept.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editingDept.name,
          code: editingDept.code,
          criteriaCount: editingDept.criteria_count,
          isActive: editingDept.is_active === 1,
          supervisorId: editingDept.supervisor_id,
        }),
      });
      setEditingDept(null);
      await loadDepartmentsAndSups();
      notifySuccess('تم تحديث بيانات القسم وتعيين المشرف');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث القسم');
    }
  };

  // Criteria CRUD & Reorder
  const handleAddCriterion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDeptId) return;
    try {
      await apiRequest(`/admin/departments/${selectedDeptId}/criteria`, {
        method: 'POST',
        body: JSON.stringify({
          name: newCritName,
          description: newCritDesc,
          isRequired: newCritReq,
        }),
      });
      setNewCritName('');
      setNewCritDesc('');
      setNewCritReq(true);
      await loadCriteria(selectedDeptId);
      notifySuccess('تمت إضافة المعيار بنجاح');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة المعيار');
    }
  };

  const handleSaveCriterionEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCrit || !selectedDeptId) return;
    try {
      await apiRequest(`/admin/criteria/${editingCrit.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editingCrit.name,
          description: editingCrit.description,
          isRequired: editingCrit.is_required === 1,
          isActive: editingCrit.is_active === 1,
        }),
      });
      setEditingCrit(null);
      await loadCriteria(selectedDeptId);
      notifySuccess('تم تحديث المعيار');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث المعيار');
    }
  };

  const handleDeleteCriterion = async (critId: number) => {
    if (!selectedDeptId) return;
    try {
      await apiRequest(`/admin/criteria/${critId}`, { method: 'DELETE' });
      await loadCriteria(selectedDeptId);
      notifySuccess('تم حذف/إيقاف المعيار مع الحفاظ على التقارير التاريخية');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حذف المعيار');
    }
  };

  const handleMoveCriterion = async (index: number, direction: -1 | 1) => {
    if (!selectedDeptId) return;
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= criteria.length) return;
    const copy = [...criteria];
    const [moved] = copy.splice(index, 1);
    if (!moved) return;
    copy.splice(targetIdx, 0, moved);
    setCriteria(copy);

    try {
      await apiRequest(`/admin/departments/${selectedDeptId}/criteria/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ orderedIds: copy.map((c) => c.id) }),
      });
      await loadCriteria(selectedDeptId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إعادة الترتيب');
    }
  };

  // Users CRUD
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: uUsername,
          fullName: uFullName,
          role: uRole,
          password: uPassword,
          phone: uPhone,
          canEditApproved: uCanEditApproved,
          departmentIds: uDeptIds,
        }),
      });
      setShowNewUserModal(false);
      setUUsername('');
      setUFullName('');
      setUPassword('');
      setUPhone('');
      setUDeptIds([]);
      await loadUsers();
      await loadDepartmentsAndSups();
      notifySuccess('تم إنشاء الحساب وتوزيع الصلاحيات بنجاح');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء الحساب');
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setError(null);
    try {
      await apiRequest(`/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: uFullName,
          role: uRole,
          isActive: editingUser.is_active === 1,
          canEditApproved: uCanEditApproved,
          password: uPassword || undefined,
          phone: uPhone,
          departmentIds: uRole === 'supervisor' ? uDeptIds : undefined,
        }),
      });
      setEditingUser(null);
      setUPassword('');
      await loadUsers();
      await loadDepartmentsAndSups();
      notifySuccess('تم تحديث بيانات الحساب والصلاحيات');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث الحساب');
    }
  };

  const handleBatchActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiRequest<{ activatedCount: number }>('/admin/users/activate-pending', {
        method: 'POST',
        body: JSON.stringify({ initialPassword: batchPassword }),
      });
      setShowBatchModal(false);
      setBatchPassword('');
      await loadUsers();
      notifySuccess(`تم تفعيل ${res.activatedCount} حسابات بنجاح`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تفعيل الحسابات');
    }
  };

  // Thresholds
  const handleSaveThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiRequest<{ thresholds: RatingThreshold[] }>('/admin/settings/thresholds', {
        method: 'PUT',
        body: JSON.stringify({
          thresholds: localThresholds,
          restaurantName: localRestName,
        }),
      });
      onThresholdsUpdated(res.thresholds, localRestName);
      notifySuccess('تم حفظ حدود تصنيفات الأداء وإعدادات النظام');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ الإعدادات');
    }
  };

  // Backup & Restore
  const handleDownloadBackup = async (withPeriod: boolean) => {
    setError(null);
    try {
      const qs =
        withPeriod && backupStart && backupEnd
          ? `?startDate=${encodeURIComponent(backupStart)}&endDate=${encodeURIComponent(backupEnd)}`
          : '';
      const payload = await apiRequest<Record<string, unknown>>(`/admin/backup${qs}`);
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `almadhaq_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notifySuccess('تم تنزيل النسخة الاحتياطية بنجاح');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء النسخة الاحتياطية');
    }
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoring(true);
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await apiRequest('/admin/restore', {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      await loadDepartmentsAndSups();
      await loadUsers();
      notifySuccess('تمت استعادة قاعدة البيانات من النسخة الاحتياطية بنجاح');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ملف النسخة الاحتياطية غير صالح أو فشل الاستعادة');
    } finally {
      setRestoring(false);
      e.target.value = '';
    }
  };

  const pendingUsersCount = users.filter((u) => u.has_password === 0).length;
  const selectedDept = departments.find((d) => d.id === selectedDeptId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">إدارة النظام والإعدادات</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          التحكم بالأقسام والمعايير، توزيع المشرفين، حسابات المستخدمين، حدود التصنيف، والنسخ الاحتياطي
        </p>
      </div>

      {/* Sub-Tabs */}
      <div className="flex flex-wrap gap-1.5 p-1 bg-slate-200/70 rounded-xl w-fit">
        {[
          { id: 'departments', label: 'الأقسام والمعايير', icon: Layers },
          { id: 'users', label: 'المستخدمون والمشرفون', icon: Users },
          { id: 'thresholds', label: 'تصنيفات الأداء', icon: Sliders },
          { id: 'backup', label: 'النسخ الاحتياطي', icon: DatabaseBackup },
          { id: 'audit', label: 'سجل التعديلات', icon: History },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id as typeof tab)}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors ${
                tab === item.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl p-4">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl p-4 font-semibold">
          {successMsg}
        </div>
      )}

      {/* TAB 1: DEPARTMENTS & CRITERIA */}
      {tab === 'departments' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Departments List & Add Form */}
          <div className="lg:col-span-5 space-y-4">
            <form
              onSubmit={handleCreateDept}
              className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
            >
              <h3 className="text-xs font-bold text-slate-900">إضافة قسم جديد</h3>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="اسم القسم الجديد *"
                  value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  required
                  className="col-span-2 px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  placeholder="الرمز (DEP-20)"
                  value={newDeptCode}
                  onChange={(e) => setNewDeptCode(e.target.value)}
                  dir="ltr"
                  className="px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex gap-2">
                <select
                  value={newDeptSupId}
                  onChange={(e) => setNewDeptSupId(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">-- تعيين مشرف للقسم (اختياري) --</option>
                  {supervisors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="px-3.5 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة</span>
                </button>
              </div>
            </form>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 text-xs font-bold text-slate-900">
                قائمة الأقسام ({departments.length})
              </div>
              <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
                {departments.map((d) => (
                  <div
                    key={d.id}
                    className={`p-3.5 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                      selectedDeptId === d.id ? 'bg-teal-50/80' : 'hover:bg-slate-50'
                    }`}
                    onClick={() => setSelectedDeptId(d.id)}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-400">{d.code}</span>
                        <span className="text-xs font-bold text-slate-900">{d.name}</span>
                        {d.is_active === 0 && (
                          <span className="text-[11px] font-semibold text-red-600">(موقوف)</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        المشرف: {d.supervisor_name || 'غير معين'} · المعايير النشطة:{' '}
                        {d.active_criteria_count ?? d.criteria_count}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingDept(d);
                      }}
                      className="p-1.5 text-slate-500 hover:text-teal-700 hover:bg-white rounded-lg border border-transparent hover:border-slate-200 cursor-pointer"
                      title="تعديل القسم"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Criteria Manager for Selected Department */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
            {!selectedDept ? (
              <p className="text-xs text-slate-500">اختر قسمًا لعرض وتعديل معايير التقييم الخاصة به.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      معايير قسم: {selectedDept.name}
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      تعديل المعايير أو حذفها لا يؤثر على التقارير التاريخية المحفوظة مسبقًا.
                    </p>
                  </div>
                  <span className="text-xs font-mono text-slate-500 tabular-nums">
                    العدد المستهدف: {selectedDept.criteria_count}
                  </span>
                </div>

                {/* Add Criterion Form */}
                <form
                  onSubmit={handleAddCriterion}
                  className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-2.5"
                >
                  <div className="text-xs font-bold text-slate-800">إضافة معيار تشغيلي جديد</div>
                  <input
                    type="text"
                    placeholder="اسم المعيار *"
                    value={newCritName}
                    onChange={(e) => setNewCritName(e.target.value)}
                    required
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                  <textarea
                    rows={2}
                    placeholder="وصف ما يتم تقييمه في هذا المعيار..."
                    value={newCritDesc}
                    onChange={(e) => setNewCritDesc(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newCritReq}
                        onChange={(e) => setNewCritReq(e.target.checked)}
                      />
                      <span>سؤال إلزامي</span>
                    </label>
                    <button
                      type="submit"
                      className="px-3.5 py-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>إضافة المعيار</span>
                    </button>
                  </div>
                </form>

                {/* Criteria List */}
                <div className="divide-y divide-slate-100">
                  {criteria.map((c, idx) => (
                    <div
                      key={c.id}
                      className={`py-3 flex items-start justify-between gap-3 ${
                        c.is_active === 0 ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="space-y-0.5 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-slate-400 tabular-nums">
                            {idx + 1}.
                          </span>
                          <span className="text-xs font-bold text-slate-900">{c.name}</span>
                          {c.is_required === 1 && (
                            <span className="text-[11px] text-red-600 font-semibold">(إلزامي)</span>
                          )}
                          {c.is_active === 0 && (
                            <span className="text-[11px] text-slate-500">(معطل)</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 pr-5">{c.description}</p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveCriterion(idx, -1)}
                          className="p-1 text-slate-500 hover:text-slate-900 disabled:opacity-30 cursor-pointer"
                          title="تحريك لأعلى"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === criteria.length - 1}
                          onClick={() => handleMoveCriterion(idx, 1)}
                          className="p-1 text-slate-500 hover:text-slate-900 disabled:opacity-30 cursor-pointer"
                          title="تحريك لأسفل"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCrit(c)}
                          className="p-1 text-slate-500 hover:text-teal-700 cursor-pointer"
                          title="تعديل المعيار"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCriterion(c.id)}
                          className="p-1 text-slate-500 hover:text-red-600 cursor-pointer"
                          title="حذف / تعطيل"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: USERS & SUPERVISORS */}
      {tab === 'users' && (
        <div className="space-y-4">
          {pendingUsersCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-amber-900">
                <strong>تنبيه تفعيل الحسابات:</strong> يوجد {pendingUsersCount} حسابات مسجلة
                (للمشرفين ومسؤول الإنتاج) بانتظار تعيين كلمة مرور لها ليتمكنوا من الدخول.
              </div>
              <button
                type="button"
                onClick={() => setShowBatchModal(true)}
                className="px-3.5 py-2 bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>تفعيل الحسابات المعلقة الآن</span>
              </button>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900">
                حسابات المستخدمين والمشرفين وتوزيع الأقسام
              </h3>
              <button
                type="button"
                onClick={() => {
                  setUUsername('');
                  setUFullName('');
                  setURole('supervisor');
                  setUPassword('');
                  setUPhone('');
                  setUCanEditApproved(false);
                  setUDeptIds([]);
                  setShowNewUserModal(true);
                }}
                className="px-3.5 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة مستخدم / مشرف جديد</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">الاسم الكامل</th>
                    <th className="py-3 px-4">اسم المستخدم</th>
                    <th className="py-3 px-4">الصلاحية</th>
                    <th className="py-3 px-4">الأقسام المسندة</th>
                    <th className="py-3 px-4">حالة الحساب</th>
                    <th className="py-3 px-4 text-left">تعديل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-bold text-slate-900 whitespace-nowrap">
                        {u.full_name}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">
                        {u.username}
                      </td>
                      <td className="py-3 px-4 font-semibold text-teal-800 whitespace-nowrap">
                        {ROLE_LABELS[u.role]}
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-md">
                        {u.role === 'supervisor' ? (
                          u.departments.length > 0 ? (
                            u.departments.map((d) => d.department_name).join(' · ')
                          ) : (
                            <span className="text-slate-400">لا توجد أقسام مسندة</span>
                          )
                        ) : (
                          <span className="text-slate-400">جميع الأقسام</span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {u.is_active === 0 ? (
                          <span className="text-red-600 font-semibold">موقوف</span>
                        ) : u.has_password === 0 ? (
                          <span className="text-amber-700 font-semibold">بانتظار كلمة المرور</span>
                        ) : (
                          <span className="text-emerald-700 font-semibold">نشط ومفعل</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-left">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingUser(u);
                            setUFullName(u.full_name);
                            setURole(u.role);
                            setUPassword('');
                            setUPhone(u.phone || '');
                            setUCanEditApproved(u.can_edit_approved === 1);
                            setUDeptIds(u.departments.map((d) => d.department_id));
                          }}
                          className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-700 font-semibold hover:bg-slate-50 cursor-pointer"
                        >
                          تعديل / كلمة المرور
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: RATING THRESHOLDS */}
      {tab === 'thresholds' && (
        <form
          onSubmit={handleSaveThresholds}
          className="bg-white border border-slate-200 rounded-xl p-5 max-w-2xl space-y-5"
        >
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
            إعدادات مسمى المنشأة وحدود التصنيف التشغيلي
          </h3>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              اسم المطعم / المنشأة في التقارير المطبوعة
            </label>
            <input
              type="text"
              value={localRestName}
              onChange={(e) => setLocalRestName(e.target.value)}
              className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>

          <div className="space-y-3">
            <div className="text-xs font-bold text-slate-700">
              حدود التصنيف (من 10 درجات)
            </div>
            {localThresholds.map((t, idx) => (
              <div
                key={t.id}
                className="grid grid-cols-12 gap-3 items-center bg-slate-50 border border-slate-200 rounded-lg p-3"
              >
                <div className="col-span-5">
                  <label className="block text-[11px] text-slate-500 mb-1">اسم التصنيف</label>
                  <input
                    type="text"
                    value={t.label}
                    onChange={(e) => {
                      const next = [...localThresholds];
                      next[idx] = { ...t, label: e.target.value };
                      setLocalThresholds(next);
                    }}
                    className="w-full px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded bg-white"
                  />
                </div>
                <div className="col-span-4">
                  <label className="block text-[11px] text-slate-500 mb-1">
                    الحد الأدنى (أكبر أو يساوي)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    value={t.minScore}
                    onChange={(e) => {
                      const next = [...localThresholds];
                      next[idx] = { ...t, minScore: Number(e.target.value) };
                      setLocalThresholds(next);
                    }}
                    dir="ltr"
                    className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded bg-white"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-[11px] text-slate-500 mb-1">اللون</label>
                  <input
                    type="color"
                    value={t.color}
                    onChange={(e) => {
                      const next = [...localThresholds];
                      next[idx] = { ...t, color: e.target.value };
                      setLocalThresholds(next);
                    }}
                    className="w-full h-8 border border-slate-300 rounded bg-white cursor-pointer"
                  />
                </div>
              </div>
            ))}
          </div>

          <button
            type="submit"
            className="px-4 py-2.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-lg flex items-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>حفظ الإعدادات</span>
          </button>
        </form>
      )}

      {/* TAB 4: BACKUP & RESTORE */}
      {tab === 'backup' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              إنشاء وتنزيل النسخ الاحتياطية والبيانات
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              تتضمن النسخة الكاملة جميع الجداول (المستخدمين، المشرفين، الأقسام، المعايير، التقارير، الدرجات التاريخية، الإجراءات التصحيحية، وسجل التعديلات).
            </p>
            <button
              type="button"
              onClick={() => handleDownloadBackup(false)}
              className="w-full py-2.5 px-4 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>تنزيل نسخة احتياطية كاملة (JSON)</span>
            </button>

            <div className="border-t border-slate-200 pt-4 space-y-3">
              <div className="text-xs font-bold text-slate-800">
                تنزيل بيانات فترة زمنية محددة
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={backupStart}
                  onChange={(e) => setBackupStart(e.target.value)}
                  className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                />
                <input
                  type="date"
                  value={backupEnd}
                  onChange={(e) => setBackupEnd(e.target.value)}
                  className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <button
                type="button"
                disabled={!backupStart || !backupEnd}
                onClick={() => handleDownloadBackup(true)}
                className="w-full py-2 px-4 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-40 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
              >
                تنزيل بيانات الفترة المحددة
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              استعادة البيانات من نسخة احتياطية كاملة
            </h3>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 leading-relaxed">
              تنبيه: استعادة النسخة الاحتياطية تستبدل كافة البيانات الحالية بمحتوى ملف النسخة الكاملة داخل عملية قاعدة بيانات آمنة.
            </div>
            <label className="w-full py-3 px-4 border-2 border-dashed border-slate-300 hover:border-teal-600 rounded-xl flex flex-col items-center justify-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer bg-slate-50">
              <Upload className="w-5 h-5 text-teal-700" />
              <span>{restoring ? 'جاري استعادة البيانات...' : 'اختر ملف النسخة الاحتياطية (.json)'}</span>
              <input
                type="file"
                accept="application/json,.json"
                onChange={handleRestoreFile}
                disabled={restoring}
                className="hidden"
              />
            </label>
          </div>
        </div>
      )}

      {/* TAB 5: AUDIT LOGS */}
      {tab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 text-sm font-bold text-slate-900">
            سجل التعديلات والعمليات الحساسة (آخر 250 عملية)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-4">التوقيت</th>
                  <th className="py-2.5 px-4">المستخدم</th>
                  <th className="py-2.5 px-4">نوع العملية</th>
                  <th className="py-2.5 px-4">التفاصيل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-4 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                      {log.created_at.slice(0, 19).replace('T', ' ')}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-bold text-slate-800 whitespace-nowrap">
                      {log.username}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-teal-700 whitespace-nowrap">
                      {log.action}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: Edit Department */}
      {editingDept && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">تعديل بيانات القسم</h3>
              <button
                type="button"
                onClick={() => setEditingDept(null)}
                className="text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveDeptEdit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">اسم القسم</label>
                <input
                  type="text"
                  value={editingDept.name}
                  onChange={(e) => setEditingDept({ ...editingDept, name: e.target.value })}
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">المشرف المسؤول</label>
                <select
                  value={editingDept.supervisor_id ?? ''}
                  onChange={(e) =>
                    setEditingDept({
                      ...editingDept,
                      supervisor_id: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">-- غير معين --</option>
                  {supervisors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  عدد المعايير المستهدف
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={editingDept.criteria_count}
                  onChange={(e) =>
                    setEditingDept({ ...editingDept, criteria_count: Number(e.target.value) })
                  }
                  className="w-28 px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingDept.is_active === 1}
                  onChange={(e) =>
                    setEditingDept({ ...editingDept, is_active: e.target.checked ? 1 : 0 })
                  }
                />
                <span>القسم نشط (إلغاء التفعيل يوقف القسم دون حذف تاريخه)</span>
              </label>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingDept(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-teal-700 rounded-lg cursor-pointer"
                >
                  حفظ التغييرات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Edit Criterion */}
      {editingCrit && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">تعديل المعيار</h3>
              <button
                type="button"
                onClick={() => setEditingCrit(null)}
                className="text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveCriterionEdit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">اسم المعيار</label>
                <input
                  type="text"
                  value={editingCrit.name}
                  onChange={(e) => setEditingCrit({ ...editingCrit, name: e.target.value })}
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">الوصف</label>
                <textarea
                  rows={3}
                  value={editingCrit.description}
                  onChange={(e) => setEditingCrit({ ...editingCrit, description: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingCrit.is_required === 1}
                  onChange={(e) =>
                    setEditingCrit({ ...editingCrit, is_required: e.target.checked ? 1 : 0 })
                  }
                />
                <span>سؤال إلزامي</span>
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingCrit.is_active === 1}
                  onChange={(e) =>
                    setEditingCrit({ ...editingCrit, is_active: e.target.checked ? 1 : 0 })
                  }
                />
                <span>المعيار نشط</span>
              </label>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingCrit(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-teal-700 rounded-lg cursor-pointer"
                >
                  حفظ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Create or Edit User */}
      {(showNewUserModal || editingUser) && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-4 my-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                {editingUser ? `تعديل حساب: ${editingUser.username}` : 'إضافة مستخدم / مشرف جديد'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowNewUserModal(false);
                  setEditingUser(null);
                }}
                className="text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={editingUser ? handleUpdateUser : handleCreateUser} className="space-y-3">
              {!editingUser && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    اسم المستخدم للدخول *
                  </label>
                  <input
                    type="text"
                    value={uUsername}
                    onChange={(e) => setUUsername(e.target.value)}
                    required
                    dir="ltr"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg text-left"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  الاسم الكامل *
                </label>
                <input
                  type="text"
                  value={uFullName}
                  onChange={(e) => setUFullName(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">الدور</label>
                  <select
                    value={uRole}
                    onChange={(e) => setURole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="supervisor">مشرف قسم</option>
                    <option value="production_manager">مسؤول الإنتاج</option>
                    <option value="admin">مدير النظام</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {editingUser ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور *'}
                  </label>
                  <input
                    type="password"
                    value={uPassword}
                    onChange={(e) => setUPassword(e.target.value)}
                    required={!editingUser}
                    dir="ltr"
                    placeholder={editingUser ? 'اتركه فارغًا للإبقاء' : '6 أحرف فأكثر'}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-left"
                  />
                </div>
              </div>

              {uRole === 'supervisor' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    الأقسام المسندة للمشرف
                  </label>
                  <div className="border border-slate-200 rounded-lg p-3 max-h-48 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50">
                    {departments.map((d) => {
                      const checked = uDeptIds.includes(d.id);
                      return (
                        <label key={d.id} className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setUDeptIds((prev) => [...prev, d.id]);
                              } else {
                                setUDeptIds((prev) => prev.filter((id) => id !== d.id));
                              }
                            }}
                          />
                          <span>{d.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={uCanEditApproved}
                  onChange={(e) => setUCanEditApproved(e.target.checked)}
                />
                <span>منح صلاحية تعديل التقارير المعتمدة (مع تسجيل التعديل)</span>
              </label>

              {editingUser && (
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingUser.is_active === 1}
                    onChange={(e) =>
                      setEditingUser({ ...editingUser, is_active: e.target.checked ? 1 : 0 })
                    }
                  />
                  <span>الحساب نشط</span>
                </label>
              )}

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewUserModal(false);
                    setEditingUser(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-teal-700 rounded-lg cursor-pointer"
                >
                  حفظ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Batch activate pending users */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">تفعيل الحسابات المعلقة</h3>
              <button
                type="button"
                onClick={() => setShowBatchModal(false)}
                className="text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              سيتم تعيين كلمة المرور المبدئية التالية لجميع الحسابات التي لم تُعيّن لها كلمة مرور بعد ({pendingUsersCount} حسابات)، ويمكن لكل مستخدم تغييرها لاحقًا.
            </p>
            <form onSubmit={handleBatchActivate} className="space-y-4">
              <input
                type="password"
                value={batchPassword}
                onChange={(e) => setBatchPassword(e.target.value)}
                required
                minLength={6}
                placeholder="أدخل كلمة المرور المبدئية (6 أحرف فأكثر)"
                dir="ltr"
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg text-left"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowBatchModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-amber-700 hover:bg-amber-800 rounded-lg cursor-pointer"
                >
                  تفعيل الحسابات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
