import React, { useEffect, useState } from 'react';
import { Eye, FileSpreadsheet, Filter, Printer, Search, Users } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiRequest } from '../lib/api';
import { exportReportsListToExcel } from '../lib/exportExcel';
import {
  REPORT_STATUS_LABELS,
  REPORT_STATUS_STYLES,
  SHIFT_LABELS,
  type Department,
  type RatingThreshold,
  type ReportListItem,
  type SessionUser,
  type SupervisorInfo,
} from '../types';

interface ReportsAnalyticsViewProps {
  currentUser: SessionUser;
  thresholds: RatingThreshold[];
  onOpenReport: (reportId: number) => void;
}

interface AnalyticsResponse {
  period: { startDate: string; endDate: string };
  departmentPerformance: Array<{
    department_id: number;
    department_name: string;
    department_code: string;
    evaluations_count: number;
    avg_criteria: number;
    avg_discipline: number;
    avg_overall: number;
    avg_percentage: number;
  }>;
  dailyTimeline: Array<{
    date: string;
    reports_count: number;
    avg_overall: number;
    avg_discipline: number;
  }>;
  supervisorReport: Array<{
    supervisorId: number;
    supervisorName: string;
    assignedDepartmentsCount: number;
    reportsExecutedCount: number;
    coveredDepartmentsCount: number;
    activeDaysCount: number;
    departmentsAvgScore: number | null;
    departmentsAvgPercentage: number | null;
    lastReportDate: string | null;
  }>;
  recurringIssues: Array<{
    department_name: string;
    evaluation_date: string;
    report_number: string;
    notes_text: string;
    suggestions_text: string;
  }>;
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export const ReportsAnalyticsView: React.FC<ReportsAnalyticsViewProps> = ({
  currentUser,
  thresholds,
  onOpenReport,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const [activeTab, setActiveTab] = useState<'list' | 'daily' | 'weekly' | 'monthly' | 'supervisors'>('list');

  // Filter states
  const [startDate, setStartDate] = useState(`${today.slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(today);
  const [departmentId, setDepartmentId] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [shift, setShift] = useState('');
  const [status, setStatus] = useState('');
  const [ratingLabel, setRatingLabel] = useState('');
  const [search, setSearch] = useState('');

  // Reference lists
  const [departments, setDepartments] = useState<Department[]>([]);
  const [supervisors, setSupervisors] = useState<SupervisorInfo[]>([]);

  // Data
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ departments: Department[] }>('/departments')
      .then((res) => setDepartments(res.departments))
      .catch(() => {});
    apiRequest<{ supervisors: SupervisorInfo[] }>('/supervisors')
      .then((res) => setSupervisors(res.supervisors))
      .catch(() => {});
  }, []);

  // Auto-adjust date presets when switching period report tabs
  const switchTab = (tab: typeof activeTab) => {
    setActiveTab(tab);
    if (tab === 'daily') {
      setStartDate(today);
      setEndDate(today);
    } else if (tab === 'weekly') {
      setStartDate(getDateDaysAgo(6));
      setEndDate(today);
    } else if (tab === 'monthly') {
      setStartDate(`${today.slice(0, 7)}-01`);
      setEndDate(today);
    }
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (departmentId) params.set('departmentId', departmentId);
      if (supervisorId) params.set('supervisorId', supervisorId);
      if (shift) params.set('shift', shift);
      if (status) params.set('status', status);
      if (ratingLabel) params.set('ratingLabel', ratingLabel);
      if (search.trim()) params.set('search', search.trim());

      const [repRes, anaRes] = await Promise.all([
        apiRequest<{ reports: ReportListItem[] }>(`/reports?${params.toString()}`),
        apiRequest<AnalyticsResponse>(`/analytics/summary?${params.toString()}`),
      ]);
      setReports(repRes.reports);
      setAnalytics(anaRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل التقارير والتحليلات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeTab, startDate, endDate, departmentId, supervisorId, shift, status, ratingLabel]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div>
          <h2 className="text-lg font-bold text-slate-900">التقارير والتحليلات التشغيلية</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            بحث وتصفية متقدمة · تقارير يومية وأسبوعية وشهرية · مؤشرات متابعة المشرفين
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportReportsListToExcel(reports, `تقرير_${activeTab}`)}
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
            <span>طباعة / PDF</span>
          </button>
        </div>
      </div>

      {/* Report Mode Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-200/70 rounded-xl w-fit no-print">
        {[
          { id: 'list', label: 'سجل التقارير' },
          { id: 'daily', label: 'التقرير اليومي' },
          { id: 'weekly', label: 'التقرير الأسبوعي' },
          { id: 'monthly', label: 'التقرير الشهري' },
          { id: 'supervisors', label: 'تقرير أداء المشرفين' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => switchTab(t.id as typeof activeTab)}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === t.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters Panel */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 no-print">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <Filter className="w-3.5 h-3.5 text-teal-700" />
          <span>خيارات البحث والتصفية</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">من تاريخ</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">إلى تاريخ</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">القسم</label>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
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
          {currentUser.role !== 'supervisor' && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">المشرف</label>
              <select
                value={supervisorId}
                onChange={(e) => setSupervisorId(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="">جميع المشرفين</option>
                {supervisors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">الوردية</label>
            <select
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="">الكل</option>
              <option value="morning">صباحية</option>
              <option value="evening">مسائية</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">مستوى الأداء</label>
            <select
              value={ratingLabel}
              onChange={(e) => setRatingLabel(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="">جميع المستويات</option>
              {thresholds.map((t) => (
                <option key={t.id} value={t.label}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">حالة التقرير</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="">الكل</option>
              <option value="submitted">مرسل</option>
              <option value="under_review">قيد المراجعة</option>
              <option value="approved">معتمد</option>
              <option value="needs_corrective_action">يحتاج إلى إجراء تصحيحي</option>
              {currentUser.role !== 'production_manager' && <option value="draft">مسودة</option>}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">بحث نصي</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="رقم التقرير أو ملاحظة..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadData()}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
              <button
                type="button"
                onClick={loadData}
                className="px-3 py-1.5 bg-teal-700 text-white rounded-lg text-xs font-semibold hover:bg-teal-800 cursor-pointer shrink-0"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl p-4">
          {error}
        </div>
      )}

      {/* Print Header */}
      <div className="hidden print:block border-b-2 border-slate-800 pb-3 mb-4">
        <h1 className="text-lg font-bold">مطاعم المذاق اليمني – تقرير الأداء التشغيلي</h1>
        <p className="text-xs text-slate-600">
          الفترة من {startDate} إلى {endDate}
        </p>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
          جاري تحميل البيانات...
        </div>
      ) : activeTab === 'supervisors' && analytics ? (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900">
            <strong>ملاحظة منهجية:</strong> يُعرض عدد التقييمات المنفذة لكل مشرف كمؤشر متابعة
            مستقل للانتظام فقط، ولا يُعد وحده دليلًا على جودة الأداء التشغيلي للأقسام.
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
              <Users className="w-4 h-4 text-teal-700" />
              <h3 className="text-sm font-bold text-slate-900">
                تقرير أداء وانتظام المشرفين ({startDate} – {endDate})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">المشرف</th>
                    <th className="py-3 px-4 text-center">الأقسام المسندة</th>
                    <th className="py-3 px-4 text-center">الأقسام المقيّمة</th>
                    <th className="py-3 px-4 text-center">عدد التقييمات (مؤشر متابعة مستقل)</th>
                    <th className="py-3 px-4 text-center">أيام المتابعة النشطة</th>
                    <th className="py-3 px-4 text-center">متوسط نتائج الأقسام التابعة</th>
                    <th className="py-3 px-4">آخر تقييم</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {analytics.supervisorReport.map((sup) => (
                    <tr key={sup.supervisorId} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-bold text-slate-900">{sup.supervisorName}</td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums">
                        {sup.assignedDepartmentsCount}
                      </td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums">
                        {sup.coveredDepartmentsCount} / {sup.assignedDepartmentsCount}
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-semibold text-slate-700 tabular-nums">
                        {sup.reportsExecutedCount}
                      </td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums">
                        {sup.activeDaysCount}
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-teal-700 tabular-nums">
                        {sup.departmentsAvgScore !== null
                          ? `${sup.departmentsAvgScore.toFixed(2)} (${sup.departmentsAvgPercentage?.toFixed(1)}%)`
                          : '—'}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums">
                        {sup.lastReportDate || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (activeTab === 'daily' || activeTab === 'weekly' || activeTab === 'monthly') &&
        analytics ? (
        <div className="space-y-6">
          {/* Department comparison in period */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-4">
              {activeTab === 'daily'
                ? `ملخص الأداء اليومي (${startDate})`
                : activeTab === 'weekly'
                ? `تطور الأداء الأسبوعي (${startDate} إلى ${endDate})`
                : `مقارنة الأقسام الشهرية (${startDate} إلى ${endDate})`}
            </h3>
            {analytics.departmentPerformance.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                لا توجد تقييمات فعلية في الفترة المحددة.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-right border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-3">القسم</th>
                        <th className="py-2.5 px-3 text-center">التقييمات</th>
                        <th className="py-2.5 px-3 text-center">المعايير</th>
                        <th className="py-2.5 px-3 text-center">الانضباط</th>
                        <th className="py-2.5 px-3 text-center">العام</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {analytics.departmentPerformance.map((d) => (
                        <tr key={d.department_id}>
                          <td className="py-2.5 px-3 font-bold text-slate-900">
                            {d.department_name}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono tabular-nums">
                            {d.evaluations_count}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono tabular-nums">
                            {d.avg_criteria.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono tabular-nums">
                            {d.avg_discipline.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono font-bold text-teal-700 tabular-nums">
                            {d.avg_overall.toFixed(2)} ({d.avg_percentage.toFixed(0)}%)
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="h-72 border border-slate-200 rounded-lg p-3" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={analytics.departmentPerformance}
                      margin={{ top: 10, right: 12, left: 0, bottom: 32 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                      <XAxis
                        dataKey="department_name"
                        tick={{ fontSize: 10, fill: '#475569' }}
                        angle={-20}
                        textAnchor="end"
                        height={55}
                      />
                      <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: '#475569' }} />
                      <Tooltip />
                      <Bar dataKey="avg_overall" name="المتوسط العام" fill="#0F766E" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          {/* Recurring Notes & Recommendations */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-3">
              الملاحظات والتوصيات التطويرية المسجلة في الفترة
            </h3>
            {analytics.recurringIssues.length === 0 ? (
              <p className="text-xs text-slate-500">لا توجد ملاحظات مسجلة في هذه الفترة.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {analytics.recurringIssues.map((item, idx) => (
                  <div key={idx} className="py-3 text-xs space-y-1">
                    <div className="flex items-center gap-2 font-bold text-slate-900">
                      <span>{item.department_name}</span>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono text-teal-700">{item.report_number}</span>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono text-slate-500">{item.evaluation_date}</span>
                    </div>
                    {item.notes_text && (
                      <p className="text-slate-700">الملاحظة: {item.notes_text}</p>
                    )}
                    {item.suggestions_text && (
                      <p className="text-teal-800">المقترح: {item.suggestions_text}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Reports Searchable List */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">قائمة تقارير التقييم</h3>
            <span className="text-xs text-slate-500 tabular-nums">{reports.length} نتيجة</span>
          </div>

          {reports.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              لا توجد تقارير مطابقة لمعايير البحث المحددة.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">رقم التقرير</th>
                    <th className="py-3 px-4">التاريخ والوقت</th>
                    <th className="py-3 px-4">الوردية</th>
                    <th className="py-3 px-4">القسم</th>
                    <th className="py-3 px-4">المشرف</th>
                    <th className="py-3 px-4 text-center">متوسط المعايير</th>
                    <th className="py-3 px-4 text-center">الانضباط</th>
                    <th className="py-3 px-4 text-center">المتوسط العام</th>
                    <th className="py-3 px-4">التصنيف</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4 text-left no-print">تفاصيل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {reports.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono font-bold text-teal-700 tabular-nums whitespace-nowrap">
                        {r.report_number}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {r.evaluation_date} · {r.evaluation_time}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                        {SHIFT_LABELS[r.shift]}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                        {r.department_name}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                        {r.supervisor_name}
                      </td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums text-xs">
                        {r.criteria_average.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums text-xs">
                        {r.discipline_score.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold tabular-nums">
                        {r.overall_average.toFixed(2)} ({r.overall_percentage.toFixed(0)}%)
                      </td>
                      <td className="py-3 px-4 text-xs font-bold whitespace-nowrap" style={{ color: r.rating_color }}>
                        {r.rating_label}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-semibold border rounded ${
                            REPORT_STATUS_STYLES[r.status]
                          }`}
                        >
                          {REPORT_STATUS_LABELS[r.status]}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-left no-print">
                        <button
                          type="button"
                          onClick={() => onOpenReport(r.id)}
                          className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>عرض</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
