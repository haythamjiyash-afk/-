import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Eye,
  FilePlus2,
  Paperclip,
  Save,
  Send,
} from 'lucide-react';
import { apiRequest, uploadAttachment } from '../lib/api';
import {
  REPORT_STATUS_LABELS,
  REPORT_STATUS_STYLES,
  SHIFT_LABELS,
  type Criterion,
  type Department,
  type RatingThreshold,
  type ReportListItem,
  type SessionUser,
  type ShiftType,
} from '../types';

interface EvaluationViewProps {
  currentUser: SessionUser;
  initialDepartmentId?: number;
  thresholds: RatingThreshold[];
  onOpenReport: (reportId: number) => void;
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function getNowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const EvaluationView: React.FC<EvaluationViewProps> = ({
  currentUser,
  initialDepartmentId,
  thresholds,
  onOpenReport,
}) => {
  const [subTab, setSubTab] = useState<'new' | 'history'>('new');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<number | ''>(initialDepartmentId || '');
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [loadingDepts, setLoadingDepts] = useState(true);
  const [loadingCriteria, setLoadingCriteria] = useState(false);

  // Form state
  const [evaluationDate, setEvaluationDate] = useState(getToday());
  const [evaluationTime, setEvaluationTime] = useState(getNowTime());
  const [shift, setShift] = useState<ShiftType>('morning');
  const [scores, setScores] = useState<Record<number, string>>({});
  const [disciplineScore, setDisciplineScore] = useState<string>('');
  const [notesText, setNotesText] = useState('');
  const [suggestionsText, setSuggestionsText] = useState('');
  const [attachment, setAttachment] = useState<{
    filename: string;
    originalName: string;
    url: string;
  } | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);

  // Submission & review preview state
  const [submissionToken, setSubmissionToken] = useState<string>(() => crypto.randomUUID());
  const [showReviewConfirm, setShowReviewConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedReport, setConfirmedReport] = useState<{
    id: number;
    reportNumber: string;
    overallAverage: number;
    overallPercentage: number;
    ratingLabel: string;
  } | null>(null);

  // History list
  const [myReports, setMyReports] = useState<ReportListItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadingDepts(true);
    apiRequest<{ departments: Department[] }>('/departments')
      .then((res) => {
        if (!active) return;
        setDepartments(res.departments);
        if (initialDepartmentId && res.departments.some((d) => d.id === initialDepartmentId)) {
          setSelectedDeptId(initialDepartmentId);
        } else if (res.departments.length === 1) {
          setSelectedDeptId(res.departments[0]!.id);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'تعذر تحميل الأقسام');
      })
      .finally(() => {
        if (active) setLoadingDepts(false);
      });
    return () => {
      active = false;
    };
  }, [initialDepartmentId]);

  useEffect(() => {
    if (!selectedDeptId) {
      setCriteria([]);
      return;
    }
    let active = true;
    setLoadingCriteria(true);
    setError(null);
    apiRequest<{ criteria: Criterion[] }>(`/departments/${selectedDeptId}/criteria`)
      .then((res) => {
        if (!active) return;
        setCriteria(res.criteria);
        setScores({});
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'تعذر تحميل معايير القسم');
      })
      .finally(() => {
        if (active) setLoadingCriteria(false);
      });
    return () => {
      active = false;
    };
  }, [selectedDeptId]);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await apiRequest<{ reports: ReportListItem[] }>('/reports');
      setMyReports(res.reports);
    } catch {
      // handled cleanly
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (subTab === 'history') {
      loadHistory();
    }
  }, [subTab]);

  // Live calculation preview
  const liveCalculations = useMemo(() => {
    if (criteria.length === 0) return null;
    const enteredValues = criteria.map((c) => {
      const raw = scores[c.id];
      if (raw === undefined || raw.trim() === '') return null;
      const num = Number(raw);
      return Number.isNaN(num) ? null : num;
    });

    const validNumeric = enteredValues.filter((v): v is number => v !== null);
    const allEntered = validNumeric.length === criteria.length;
    const sum = validNumeric.reduce((acc, v) => acc + v, 0);
    const divisor = criteria.length || 9;
    const criteriaAverage = Math.round((sum / divisor + Number.EPSILON) * 100) / 100;

    const discNum = disciplineScore.trim() === '' ? null : Number(disciplineScore);
    const hasDisc = discNum !== null && !Number.isNaN(discNum);
    const overallAverage = hasDisc
      ? Math.round(((criteriaAverage + discNum) / 2 + Number.EPSILON) * 100) / 100
      : null;
    const overallPercentage =
      overallAverage !== null ? Math.round((overallAverage * 10 + Number.EPSILON) * 100) / 100 : null;

    const sorted = [...thresholds].sort((a, b) => b.minScore - a.minScore);
    const matched =
      overallAverage !== null
        ? sorted.find((t) => overallAverage >= t.minScore) ?? sorted[sorted.length - 1]
        : null;

    return {
      enteredCount: validNumeric.length,
      totalCount: criteria.length,
      allEntered,
      criteriaAverage,
      overallAverage,
      overallPercentage,
      ratingLabel: matched?.label ?? '—',
      ratingColor: matched?.color ?? '#64748B',
    };
  }, [criteria, scores, disciplineScore, thresholds]);

  const handleScoreChange = (criterionId: number, raw: string) => {
    if (raw === '') {
      setScores((prev) => ({ ...prev, [criterionId]: '' }));
      return;
    }
    const num = Number(raw);
    if (Number.isNaN(num) || num < 0 || num > 10) {
      return; // Strictly block values outside 0..10
    }
    setScores((prev) => ({ ...prev, [criterionId]: raw }));
  };

  const handleDisciplineChange = (raw: string) => {
    if (raw === '') {
      setDisciplineScore('');
      return;
    }
    const num = Number(raw);
    if (Number.isNaN(num) || num < 0 || num > 10) {
      return;
    }
    setDisciplineScore(raw);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    setError(null);
    try {
      const uploaded = await uploadAttachment(file);
      setAttachment(uploaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل رفع المرفق');
    } finally {
      setUploadingFile(false);
    }
  };

  const validateBeforeSubmit = (): string | null => {
    if (!selectedDeptId) return 'يرجى اختيار القسم أولاً';
    if (criteria.length === 0) return 'لا توجد معايير نشطة لهذا القسم';
    for (const c of criteria) {
      const raw = scores[c.id];
      if (c.is_required === 1 && (raw === undefined || raw.trim() === '')) {
        return `يرجى إدخال درجة المعيار الإلزامي: ${c.name}`;
      }
      if (raw !== undefined && raw.trim() !== '') {
        const num = Number(raw);
        if (Number.isNaN(num) || num < 0 || num > 10) {
          return `درجة المعيار (${c.name}) يجب أن تكون بين 0 و 10`;
        }
      }
    }
    if (disciplineScore.trim() === '') {
      return 'يرجى إدخال درجة الانضباط وتحمل المسؤولية (من 0 إلى 10)';
    }
    const disc = Number(disciplineScore);
    if (Number.isNaN(disc) || disc < 0 || disc > 10) {
      return 'درجة الانضباط وتحمل المسؤولية يجب أن تكون بين 0 و 10';
    }
    return null;
  };

  const handleSaveReport = async (status: 'draft' | 'submitted') => {
    setError(null);
    if (status === 'submitted') {
      const validationMsg = validateBeforeSubmit();
      if (validationMsg) {
        setError(validationMsg);
        setShowReviewConfirm(false);
        return;
      }
    } else {
      if (!selectedDeptId) {
        setError('يرجى اختيار القسم أولاً');
        return;
      }
      if (disciplineScore.trim() !== '') {
        const d = Number(disciplineScore);
        if (Number.isNaN(d) || d < 0 || d > 10) {
          setError('درجة الانضباط يجب أن تكون بين 0 و 10');
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      const payloadScores = criteria.map((c) => {
        const raw = scores[c.id];
        return {
          criterionId: c.id,
          score: raw !== undefined && raw.trim() !== '' ? Number(raw) : null,
        };
      });

      const res = await apiRequest<{
        id: number;
        reportNumber: string;
        metrics: {
          overallAverage: number;
          overallPercentage: number;
          ratingLabel: string;
        };
      }>('/reports', {
        method: 'POST',
        body: JSON.stringify({
          departmentId: Number(selectedDeptId),
          evaluationDate,
          evaluationTime,
          shift,
          disciplineScore: disciplineScore.trim() !== '' ? Number(disciplineScore) : 0,
          notesText,
          suggestionsText,
          status,
          scores: payloadScores,
          attachmentPath: attachment?.url ?? null,
          attachmentName: attachment?.originalName ?? null,
          clientSubmissionToken: submissionToken,
        }),
      });

      setShowReviewConfirm(false);
      setConfirmedReport({
        id: res.id,
        reportNumber: res.reportNumber,
        overallAverage: res.metrics?.overallAverage ?? 0,
        overallPercentage: res.metrics?.overallPercentage ?? 0,
        ratingLabel: res.metrics?.ratingLabel ?? '',
      });

      // Reset form with a fresh idempotency token for the next evaluation
      setScores({});
      setDisciplineScore('');
      setNotesText('');
      setSuggestionsText('');
      setAttachment(null);
      setSubmissionToken(crypto.randomUUID());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ التقرير');
      setShowReviewConfirm(false);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedDept = departments.find((d) => d.id === Number(selectedDeptId));

  return (
    <div className="space-y-6">
      {/* Header & Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">تقييم الأقسام التشغيلية</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {currentUser.role === 'supervisor'
              ? 'الأقسام المعروضة هي الأقسام المسندة إلى حسابك فقط · التقييم مخصص لقسم واحد في كل عملية إرسال'
              : 'إجراء تقييم تشغيلي جديد أو مراجعة التقييمات السابقة للأقسام'}
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('new')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
              subTab === 'new'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FilePlus2 className="w-3.5 h-3.5" />
            <span>تقييم جديد</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('history')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
              subTab === 'history'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ClipboardList className="w-3.5 h-3.5" />
            <span>التقييمات السابقة والمسودات</span>
          </button>
        </div>
      </div>

      {subTab === 'new' ? (
        <>
          {/* Confirmation Card after Successful Submission */}
          {confirmedReport && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-bold text-emerald-950">
                    تم حفظ التقرير بنجاح · رقم التأكيد:{' '}
                    <span className="font-mono tabular-nums">{confirmedReport.reportNumber}</span>
                  </h3>
                  <p className="text-xs text-emerald-800 mt-1 tabular-nums">
                    متوسط الأداء العام: {confirmedReport.overallAverage.toFixed(2)} / 10 (
                    {confirmedReport.overallPercentage.toFixed(1)}%) · التصنيف:{' '}
                    {confirmedReport.ratingLabel}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenReport(confirmedReport.id)}
                  className="px-3.5 py-2 text-xs font-semibold text-emerald-900 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-100 cursor-pointer"
                >
                  عرض وطباعة التقرير
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmedReport(null)}
                  className="px-3 py-2 text-xs font-semibold text-emerald-800 hover:underline cursor-pointer"
                >
                  إخفاء
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loadingDepts ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
              جاري تحميل قائمة الأقسام...
            </div>
          ) : departments.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-600">
              لا توجد أقسام نشطة مسندة إلى حسابك حاليًا. يرجى التواصل مع مدير النظام.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              {/* Main Form (2 cols) */}
              <div className="lg:col-span-2 space-y-6">
                {/* Step 1: Department & Shift Metadata */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                  <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
                    بيانات القسم والوردية
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        اختر القسم المراد تقييمه
                      </label>
                      <select
                        value={selectedDeptId}
                        onChange={(e) => {
                          setSelectedDeptId(e.target.value ? Number(e.target.value) : '');
                          setConfirmedReport(null);
                        }}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                      >
                        <option value="">-- اختر القسم --</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.code}) {d.supervisor_name ? `- المشرف: ${d.supervisor_name}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        تاريخ التقييم
                      </label>
                      <input
                        type="date"
                        value={evaluationDate}
                        onChange={(e) => setEvaluationDate(e.target.value)}
                        className="w-full px-3.5 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        وقت التقييم
                      </label>
                      <input
                        type="time"
                        value={evaluationTime}
                        onChange={(e) => setEvaluationTime(e.target.value)}
                        className="w-full px-3.5 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        الوردية
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        {(['morning', 'evening'] as ShiftType[]).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setShift(s)}
                            className={`py-2.5 px-4 text-sm font-semibold rounded-lg border transition-colors cursor-pointer ${
                              shift === s
                                ? 'bg-teal-50 border-teal-600 text-teal-900'
                                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            الوردية {SHIFT_LABELS[s]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 2: Department Specialized Criteria */}
                {selectedDeptId && (
                  <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                      <h3 className="text-sm font-bold text-slate-900">
                        المعايير التشغيلية الخاصة بقسم: {selectedDept?.name}
                      </h3>
                      <span className="text-xs text-slate-500 tabular-nums">
                        الدرجة من 0 إلى 10 لكل معيار
                      </span>
                    </div>

                    {loadingCriteria ? (
                      <div className="py-8 text-center text-sm text-slate-500">
                        جاري تحميل معايير القسم...
                      </div>
                    ) : criteria.length === 0 ? (
                      <div className="py-8 text-center text-sm text-slate-500">
                        لم يتم تعريف معايير نشطة لهذا القسم بعد.
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {criteria.map((c, idx) => (
                          <div
                            key={c.id}
                            className="py-4 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                          >
                            <div className="space-y-1 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-slate-400 tabular-nums">
                                  {String(idx + 1).padStart(2, '0')}
                                </span>
                                <span className="text-sm font-bold text-slate-900">{c.name}</span>
                                {c.is_required === 1 && (
                                  <span className="text-[11px] font-semibold text-red-600">
                                    (إلزامي)
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-600 leading-relaxed pr-6">
                                {c.description}
                              </p>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 pr-6 sm:pr-0">
                              <input
                                type="number"
                                min={0}
                                max={10}
                                step={0.5}
                                placeholder="0 - 10"
                                value={scores[c.id] ?? ''}
                                onChange={(e) => handleScoreChange(c.id, e.target.value)}
                                dir="ltr"
                                className="w-24 px-3 py-2 text-sm font-mono font-bold text-center border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 tabular-nums"
                              />
                              <span className="text-xs text-slate-400 font-mono">/ 10</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Step 3: Discipline, Notes, Suggestions & Attachment */}
                {selectedDeptId && criteria.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
                    <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
                      الانضباط والملاحظات والمرفقات التوثيقية
                    </h3>

                    <div>
                      <label className="block text-xs font-bold text-slate-800 mb-1.5">
                        1. تقييم الانضباط وتحمل المسؤولية (من 0 إلى 10) *
                      </label>
                      <p className="text-xs text-slate-500 mb-2">
                        يشمل الالتزام بالحضور، النظافة الشخصية، تنفيذ التعليمات، والتعاون داخل القسم.
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={10}
                          step={0.5}
                          placeholder="0 - 10"
                          value={disciplineScore}
                          onChange={(e) => handleDisciplineChange(e.target.value)}
                          dir="ltr"
                          className="w-28 px-3 py-2 text-sm font-mono font-bold text-center border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
                        <span className="text-xs text-slate-400 font-mono">/ 10</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-800 mb-1.5">
                        2. الملاحظات والمشكلات المرصودة
                      </label>
                      <textarea
                        rows={3}
                        placeholder="سجل أي ملاحظات تشغيلية، أعطال، نقص خامات، أو مخالفات سلامة غذائية..."
                        value={notesText}
                        onChange={(e) => setNotesText(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-800 mb-1.5">
                        3. المقترحات التطويرية
                      </label>
                      <textarea
                        rows={2}
                        placeholder="اقتراحات عملية لتحسين سرعة التحضير أو الجودة أو تقليل الهدر..."
                        value={suggestionsText}
                        onChange={(e) => setSuggestionsText(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-800 mb-1.5">
                        4. إرفاق صورة أو مستند توثيقي (اختياري)
                      </label>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100 cursor-pointer flex items-center gap-2">
                          <Paperclip className="w-4 h-4 text-slate-500" />
                          <span>{uploadingFile ? 'جاري الرفع...' : 'اختيار ملف (صورة أو PDF)'}</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            onChange={handleFileChange}
                            disabled={uploadingFile}
                            className="hidden"
                          />
                        </label>
                        {attachment && (
                          <div className="flex items-center gap-2 text-xs text-teal-800 bg-teal-50 border border-teal-200 px-3 py-1.5 rounded-lg">
                            <span>{attachment.originalName}</span>
                            <button
                              type="button"
                              onClick={() => setAttachment(null)}
                              className="text-red-600 font-bold hover:underline cursor-pointer"
                            >
                              إزالة
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Sticky Summary & Submit Column */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5 lg:sticky lg:top-6">
                <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
                  ملخص الحساب التلقائي
                </h3>

                {!selectedDeptId || !liveCalculations ? (
                  <p className="text-xs text-slate-500">
                    اختر القسم وابدأ بإدخال الدرجات لعرض المتوسط والتصنيف الفوري.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600">المعايير المكتملة</span>
                      <span className="font-mono font-bold text-slate-900 tabular-nums">
                        {liveCalculations.enteredCount} / {liveCalculations.totalCount}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600">متوسط المعايير (÷ {criteria.length})</span>
                      <span className="font-mono font-bold text-slate-900 tabular-nums">
                        {liveCalculations.criteriaAverage.toFixed(2)} / 10
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600">الانضباط وتحمل المسؤولية</span>
                      <span className="font-mono font-bold text-slate-900 tabular-nums">
                        {disciplineScore.trim() !== '' ? `${Number(disciplineScore).toFixed(2)} / 10` : '—'}
                      </span>
                    </div>

                    <div className="border-t border-slate-200 pt-3">
                      <div className="text-xs text-slate-500">متوسط الأداء العام</div>
                      <div className="mt-1 flex items-baseline justify-between">
                        <span className="text-2xl font-bold text-teal-700 font-mono tabular-nums">
                          {liveCalculations.overallAverage !== null
                            ? liveCalculations.overallAverage.toFixed(2)
                            : '—'}
                        </span>
                        <span className="text-sm font-mono font-semibold text-slate-600 tabular-nums">
                          {liveCalculations.overallPercentage !== null
                            ? `${liveCalculations.overallPercentage.toFixed(1)}%`
                            : ''}
                        </span>
                      </div>
                      <div
                        className="mt-1.5 text-sm font-bold"
                        style={{ color: liveCalculations.ratingColor }}
                      >
                        التصنيف: {liveCalculations.ratingLabel}
                      </div>
                    </div>

                    <div className="pt-2 space-y-2.5">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => {
                          const msg = validateBeforeSubmit();
                          if (msg) {
                            setError(msg);
                          } else {
                            setError(null);
                            setShowReviewConfirm(true);
                          }
                        }}
                        className="w-full py-2.5 px-4 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Send className="w-4 h-4" />
                        <span>مراجعة وإرسال التقرير</span>
                      </button>

                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => handleSaveReport('draft')}
                        className="w-full py-2.5 px-4 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Save className="w-4 h-4" />
                        <span>حفظ كمسودة للمتابعة لاحقًا</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Review Before Submit Modal */}
          {showReviewConfirm && liveCalculations && selectedDept && (
            <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
              <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-6 space-y-4">
                <h3 className="text-base font-bold text-slate-900">
                  تأكيد مراجعة التقرير قبل الإرسال النهائي
                </h3>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">القسم:</span>
                    <span className="font-bold text-slate-900">{selectedDept.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">التاريخ والوردية:</span>
                    <span className="font-mono text-slate-900 tabular-nums">
                      {evaluationDate} · {evaluationTime} · {SHIFT_LABELS[shift]}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">متوسط المعايير:</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      {liveCalculations.criteriaAverage.toFixed(2)} / 10
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">درجة الانضباط:</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      {Number(disciplineScore).toFixed(2)} / 10
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2">
                    <span className="font-bold text-slate-700">متوسط الأداء العام:</span>
                    <span className="font-mono font-bold text-teal-700 tabular-nums">
                      {liveCalculations.overallAverage?.toFixed(2)} / 10 (
                      {liveCalculations.overallPercentage?.toFixed(1)}%) –{' '}
                      {liveCalculations.ratingLabel}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  بعد الإرسال، سيحصل التقرير على رقم متسلسل ويُحال إلى مسؤول الإنتاج ومدير النظام للمراجعة والاعتماد.
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowReviewConfirm(false)}
                    className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    العودة للتعديل
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleSaveReport('submitted')}
                    className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
                  >
                    {submitting ? 'جاري الإرسال...' : 'تأكيد وإرسال التقرير'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Supervisor / User Report History */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">سجل التقييمات والمسودات</h3>
            <span className="text-xs text-slate-500 tabular-nums">{myReports.length} تقرير</span>
          </div>

          {loadingHistory ? (
            <div className="p-8 text-center text-sm text-slate-500">جاري التحميل...</div>
          ) : myReports.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              لا توجد تقارير مسجلة حتى الآن.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">رقم التقرير</th>
                    <th className="py-3 px-4">التاريخ والوردية</th>
                    <th className="py-3 px-4">القسم</th>
                    <th className="py-3 px-4 text-center">المتوسط العام</th>
                    <th className="py-3 px-4">التصنيف</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4 text-left">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {myReports.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono font-bold text-teal-700 tabular-nums whitespace-nowrap">
                        {r.report_number}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {r.evaluation_date} · {SHIFT_LABELS[r.shift]}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                        {r.department_name}
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold tabular-nums">
                        {r.overall_average.toFixed(2)} ({r.overall_percentage.toFixed(0)}%)
                      </td>
                      <td className="py-3 px-4 text-xs font-bold" style={{ color: r.rating_color }}>
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
                      <td className="py-3 px-4 text-left">
                        <button
                          type="button"
                          onClick={() => onOpenReport(r.id)}
                          className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>فتح</span>
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
