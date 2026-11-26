import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  FileSpreadsheet,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiRequest } from '../lib/api';
import { exportDashboardSummaryToExcel } from '../lib/exportExcel';
import { ACTION_STATUS_LABELS, type DashboardData, type SessionUser } from '../types';

interface DashboardViewProps {
  currentUser: SessionUser;
  onNavigateToEvaluate: (departmentId?: number) => void;
  onNavigateToActions: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  currentUser,
  onNavigateToEvaluate,
  onNavigateToActions,
}) => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiRequest<DashboardData>('/dashboard')
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات لوحة التحكم');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-80 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-5 text-sm">
        {error || 'حدث خطأ أثناء تحميل البيانات'}
      </div>
    );
  }

  const { kpis } = data;
  const evaluatedForChart = data.departmentSummaryTable.filter(
    (d) => d.averageScore !== null && d.evaluationsCount > 0
  );

  return (
    <div className="space-y-6">
      {/* Top Action Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">نظرة عامة على الأداء التشغيلي</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {currentUser.role === 'supervisor'
              ? 'ملخص الأقسام المسندة إليك والتقييمات الفعلية المسجلة'
              : 'مؤشرات صالة الإنتاج في مطاعم المذاق اليمني (محسوبة من التقارير المرسلة والمعتمدة فقط)'}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => exportDashboardSummaryToExcel(data.departmentSummaryTable)}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
            <span>تصدير الملخص Excel</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigateToEvaluate()}
            className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>بدء تقييم قسم</span>
          </button>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-semibold text-slate-500">متوسط أداء صالة الإنتاج</div>
          {kpis.productionHallAverage !== null ? (
            <>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900 tabular-nums">
                  {kpis.productionHallAverage.toFixed(2)}
                </span>
                <span className="text-xs text-slate-500 tabular-nums">
                  / 10 ({kpis.productionHallPercentage?.toFixed(1)}%)
                </span>
              </div>
              <div
                className="mt-1.5 text-xs font-bold"
                style={{ color: kpis.productionHallRatingColor }}
              >
                {kpis.productionHallRatingLabel}
              </div>
            </>
          ) : (
            <div className="mt-3 text-xs text-slate-500">
              لا توجد تقييمات مرسلة بعد
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-semibold text-slate-500">إجمالي الأقسام · التقارير المرسلة</div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-2xl font-bold text-slate-900 tabular-nums">
              {kpis.totalDepartments}
            </span>
            <span className="text-xs text-slate-400">قسم نشط</span>
          </div>
          <div className="mt-1.5 text-xs text-slate-600 tabular-nums">
            {kpis.submittedReportsCount} تقرير مرسل · {kpis.approvedReportsCount} معتمد
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-semibold text-slate-500">وتيرة التقارير (يومي · أسبوعي · شهري)</div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center border border-slate-100 rounded-lg p-2 bg-slate-50">
            <div>
              <div className="text-lg font-bold text-slate-900 tabular-nums">
                {kpis.dailyReportsCount}
              </div>
              <div className="text-[11px] text-slate-500">اليوم</div>
            </div>
            <div>
              <div className="text-lg font-bold text-slate-900 tabular-nums">
                {kpis.weeklyReportsCount}
              </div>
              <div className="text-[11px] text-slate-500">أسبوعي</div>
            </div>
            <div>
              <div className="text-lg font-bold text-slate-900 tabular-nums">
                {kpis.monthlyReportsCount}
              </div>
              <div className="text-[11px] text-slate-500">شهري</div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-semibold text-slate-500">تنبيهات التحسين والإجراءات المتأخرة</div>
          <div className="mt-2 flex items-baseline gap-3">
            <span
              className={`text-2xl font-bold tabular-nums ${
                kpis.overdueActionsCount > 0 ? 'text-red-600' : 'text-slate-900'
              }`}
            >
              {kpis.overdueActionsCount}
            </span>
            <span className="text-xs text-slate-500">إجراء متأخر</span>
          </div>
          <div className="mt-1.5 text-xs text-slate-600 tabular-nums">
            {kpis.departmentsNeedingImprovementCount} أقسام تحتاج إلى تحسين
          </div>
        </div>
      </div>

      {/* Overdue Corrective Actions Banner */}
      {data.overdueActions.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 text-red-800">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold">
                إجراءات تصحيحية متأخرة عن الموعد المستهدف ({data.overdueActions.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={onNavigateToActions}
              className="text-xs font-semibold text-red-800 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>متابعة الإجراءات التصحيحية</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="divide-y divide-red-200/70">
            {data.overdueActions.slice(0, 4).map((a) => (
              <div
                key={a.id}
                className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-red-900"
              >
                <div>
                  <span className="font-bold">{a.department_name}</span>
                  <span className="mx-1.5">·</span>
                  <span>{a.problem_description}</span>
                </div>
                <div className="font-mono tabular-nums text-red-700">
                  المسؤول: {a.assigned_to} · الموعد: {a.target_date} · {ACTION_STATUS_LABELS[a.status]}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top & Needs Improvement Highlight Row */}
      {(data.topDepartments.length > 0 || data.departmentsNeedingImprovement.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900">الأقسام الأعلى أداءً</h3>
            </div>
            {data.topDepartments.length === 0 ? (
              <p className="text-xs text-slate-500">لا توجد بيانات تقييم كافية بعد.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.topDepartments.map((d) => (
                  <div key={d.departmentId} className="py-2.5 flex items-center justify-between text-sm">
                    <div>
                      <span className="font-semibold text-slate-900">{d.departmentName}</span>
                      <span className="text-xs text-slate-500 mr-2">({d.supervisorName})</span>
                    </div>
                    <div className="font-mono font-bold tabular-nums text-emerald-700">
                      {d.averageScore?.toFixed(2)} / 10
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <h3 className="text-sm font-bold text-slate-900">الأقسام التي تحتاج إلى تحسين</h3>
            </div>
            {data.departmentsNeedingImprovement.length === 0 ? (
              <p className="text-xs text-slate-500">
                لا توجد أقسام دون الحد التشغيلي المعتمد حاليًا.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.departmentsNeedingImprovement.map((d) => (
                  <div key={d.departmentId} className="py-2.5 flex items-center justify-between text-sm">
                    <div>
                      <span className="font-semibold text-slate-900">{d.departmentName}</span>
                      <span className="text-xs text-slate-500 mr-2">({d.supervisorName})</span>
                    </div>
                    <div className="font-mono font-bold tabular-nums text-red-600">
                      {d.averageScore?.toFixed(2)} / 10
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-900">مقارنة متوسط أداء الأقسام</h3>
            <span className="text-xs text-slate-500">الدرجة من 10</span>
          </div>
          {evaluatedForChart.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg p-6">
              <TrendingUp className="w-6 h-6 text-slate-400 mb-2" />
              <p>سيظهر الرسم البياني لمقارنة الأقسام فور إرسال أول تقييم فعلي.</p>
            </div>
          ) : (
            <div className="h-72 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={evaluatedForChart} margin={{ top: 8, right: 12, left: 0, bottom: 32 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis
                    dataKey="departmentName"
                    tick={{ fontSize: 11, fill: '#475569' }}
                    angle={-20}
                    textAnchor="end"
                    height={55}
                  />
                  <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: '#475569' }} />
                  <Tooltip
                    formatter={(value: unknown) => [`${Number(value).toFixed(2)} / 10`, 'متوسط الأداء']}
                  />
                  <Bar dataKey="averageScore" fill="#0F766E" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-900">تطور الأداء العام عبر الزمن</h3>
            <span className="text-xs text-slate-500">آخر 30 يومًا نشطًا</span>
          </div>
          {data.trendSeries.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg p-6">
              <TrendingUp className="w-6 h-6 text-slate-400 mb-2" />
              <p>سيظهر منحنى تطور الأداء اليومي عند توفر تقييمات مسجلة.</p>
            </div>
          ) : (
            <div className="h-72 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.trendSeries} margin={{ top: 8, right: 16, left: 0, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: '#475569' }} />
                  <Tooltip
                    formatter={(value: unknown) => [`${Number(value).toFixed(2)} / 10`, 'المتوسط العام']}
                  />
                  <Line
                    type="monotone"
                    dataKey="averageScore"
                    stroke="#0F766E"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#0F766E' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Main 8-Column Departments Performance Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900">
            الجدول الرئيسي لمراقبة أداء الأقسام
          </h3>
          <span className="text-xs text-slate-500 tabular-nums">
            إجمالي الصفوف: {data.departmentSummaryTable.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4 whitespace-nowrap">اسم القسم</th>
                <th className="py-3 px-4 whitespace-nowrap">المشرف المسؤول</th>
                <th className="py-3 px-4 whitespace-nowrap text-center">عدد التقييمات</th>
                <th className="py-3 px-4 whitespace-nowrap text-center">متوسط الأداء</th>
                <th className="py-3 px-4 whitespace-nowrap">مستوى الأداء</th>
                <th className="py-3 px-4 whitespace-nowrap">آخر تاريخ تقييم</th>
                <th className="py-3 px-4 min-w-[200px]">أبرز الملاحظات</th>
                <th className="py-3 px-4 whitespace-nowrap">حالة الإجراءات التصحيحية</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {data.departmentSummaryTable.map((row) => (
                <tr key={row.departmentId} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onNavigateToEvaluate(row.departmentId)}
                      className="hover:text-teal-700 hover:underline cursor-pointer text-right"
                    >
                      {row.departmentName}
                    </button>
                    {!row.isActive && (
                      <span className="mr-2 text-[11px] text-slate-400">(موقوف)</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                    {row.supervisorName}
                  </td>
                  <td className="py-3 px-4 text-center font-mono tabular-nums text-slate-800">
                    {row.evaluationsCount}
                  </td>
                  <td className="py-3 px-4 text-center font-mono tabular-nums font-bold text-slate-900">
                    {row.averageScore !== null ? (
                      <span>
                        {row.averageScore.toFixed(2)}{' '}
                        <span className="text-xs font-normal text-slate-500">
                          ({row.averagePercentage?.toFixed(0)}%)
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400 font-normal">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span
                      className="text-xs font-bold"
                      style={{ color: row.ratingColor }}
                    >
                      {row.ratingLabel}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                    {row.lastEvaluationDate || '—'}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-600 max-w-xs truncate">
                    {row.latestNote || '—'}
                  </td>
                  <td className="py-3 px-4 text-xs whitespace-nowrap">
                    {row.overdueActionsCount > 0 ? (
                      <span className="font-semibold text-red-700">
                        {row.overdueActionsCount} متأخر · {row.openActionsCount} مفتوح
                      </span>
                    ) : row.openActionsCount > 0 ? (
                      <span className="font-semibold text-amber-700">
                        {row.openActionsCount} إجراء قيد المتابعة
                      </span>
                    ) : (
                      <span className="text-slate-500">لا توجد إجراءات مفتوحة</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
