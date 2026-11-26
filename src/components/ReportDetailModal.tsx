import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardPlus,
  Download,
  Edit3,
  FileSpreadsheet,
  Paperclip,
  Printer,
  X,
} from 'lucide-react';
import { apiRequest, fetchProtectedBlobUrl } from '../lib/api';
import { exportSingleReportToExcel } from '../lib/exportExcel';
import {
  REPORT_STATUS_LABELS,
  REPORT_STATUS_STYLES,
  SHIFT_LABELS,
  type CorrectiveActionItem,
  type ReportListItem,
  type ReportNoteItem,
  type ReportScoreSnapshot,
  type SessionUser,
} from '../types';

interface ReportDetailModalProps {
  reportId: number;
  currentUser: SessionUser;
  onClose: () => void;
  onUpdated: () => void;
  onCreateActionFromReport?: (report: ReportListItem) => void;
}

interface ReportDetailResponse {
  report: ReportListItem;
  scores: ReportScoreSnapshot[];
  notes: ReportNoteItem[];
  correctiveActions: CorrectiveActionItem[];
}

const ProtectedAttachmentLink: React.FC<{ path: string; name: string }> = ({ path, name }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isImage = /\.(jpg|jpeg|png|webp)$/i.test(path);

  useEffect(() => {
    let mounted = true;
    let createdUrl: string | null = null;
    if (isImage) {
      setLoading(true);
      fetchProtectedBlobUrl(path)
        .then((url) => {
          createdUrl = url;
          if (mounted) setBlobUrl(url);
        })
        .catch(() => {})
        .finally(() => {
          if (mounted) setLoading(false);
        });
    }
    return () => {
      mounted = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [path, isImage]);

  const handleDownload = async () => {
    try {
      const url = blobUrl || (await fetchProtectedBlobUrl(path));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      if (!blobUrl) {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      // handled gracefully
    }
  };

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-700 truncate">
          <Paperclip className="w-4 h-4 text-slate-500 shrink-0" />
          <span className="truncate">{name}</span>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          className="px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-50 rounded border border-teal-200 flex items-center gap-1 shrink-0 cursor-pointer no-print"
        >
          <Download className="w-3.5 h-3.5" />
          <span>تنزيل</span>
        </button>
      </div>
      {isImage && !loading && blobUrl && (
        <img
          src={blobUrl}
          alt={name}
          referrerPolicy="no-referrer"
          className="mt-3 max-h-64 rounded-lg border border-slate-200 object-contain bg-white"
        />
      )}
    </div>
  );
};

export const ReportDetailModal: React.FC<ReportDetailModalProps> = ({
  reportId,
  currentUser,
  onClose,
  onUpdated,
  onCreateActionFromReport,
}) => {
  const [data, setData] = useState<ReportDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Review state
  const [reviewComment, setReviewComment] = useState('');
  const [reviewing, setReviewing] = useState(false);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editScores, setEditScores] = useState<Record<number, string>>({});
  const [editDiscipline, setEditDiscipline] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editSuggestions, setEditSuggestions] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const loadDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<ReportDetailResponse>(`/reports/${reportId}`);
      setData(res);
      setReviewComment(res.report.review_comment || '');
      const initialMap: Record<number, string> = {};
      res.scores.forEach((s) => {
        initialMap[s.snapshot_id] = s.score !== null ? String(s.score) : '';
      });
      setEditScores(initialMap);
      setEditDiscipline(String(res.report.discipline_score));
      setEditNotes(res.report.notes_text || '');
      setEditSuggestions(res.report.suggestions_text || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل تفاصيل التقرير');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
  }, [reportId]);

  const handleReview = async (status: 'under_review' | 'approved' | 'needs_corrective_action') => {
    setReviewing(true);
    setError(null);
    try {
      await apiRequest(`/reports/${reportId}/review`, {
        method: 'POST',
        body: JSON.stringify({ status, reviewComment }),
      });
      await loadDetail();
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث حالة المراجعة');
    } finally {
      setReviewing(false);
    }
  };

  const handleSaveEdit = async (submitNow: boolean) => {
    if (!data) return;
    setSavingEdit(true);
    setError(null);
    try {
      const scoresPayload = data.scores.map((s) => {
        const raw = editScores[s.snapshot_id];
        return {
          snapshotId: s.snapshot_id,
          score: raw !== undefined && raw.trim() !== '' ? Number(raw) : null,
        };
      });

      await apiRequest(`/reports/${reportId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          disciplineScore: Number(editDiscipline),
          notesText: editNotes,
          suggestionsText: editSuggestions,
          status: submitNow ? 'submitted' : data.report.status,
          scores: scoresPayload,
        }),
      });
      setIsEditing(false);
      await loadDetail();
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ التعديلات');
    } finally {
      setSavingEdit(false);
    }
  };

  const canReview =
    (currentUser.role === 'admin' || currentUser.role === 'production_manager') &&
    data?.report.status !== 'draft';

  const canEdit =
    data &&
    (currentUser.role === 'admin' ||
      (data.report.status === 'draft' && currentUser.role === 'supervisor') ||
      (currentUser.can_edit_approved === 1 && data.report.status === 'approved'));

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center p-2 sm:p-6 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl my-4 overflow-hidden">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 bg-slate-50 no-print">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-slate-900">
              تفاصيل تقرير التقييم التشغيلي
            </h2>
            {data && (
              <span className="font-mono text-sm font-semibold text-teal-700 tabular-nums">
                {data.report.report_number}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <>
                <button
                  type="button"
                  onClick={() => exportSingleReportToExcel(data.report, data.scores)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                  <span>تصدير Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-600" />
                  <span>طباعة / PDF</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200/60 cursor-pointer"
              aria-label="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5 sm:p-6 space-y-6">
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-500">جاري تحميل التقرير...</div>
          ) : error && !data ? (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4">
              {error}
            </div>
          ) : data ? (
            <>
              {/* Official Print Header */}
              <div className="hidden print:block border-b-2 border-slate-800 pb-4 mb-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h1 className="text-xl font-bold text-slate-900">مطاعم المذاق اليمني – صالة الإنتاج</h1>
                    <p className="text-sm text-slate-600">تقرير الرقابة والتقييم التشغيلي المعتمد</p>
                  </div>
                  <div className="text-left font-mono text-sm">
                    <div>رقم التقرير: {data.report.report_number}</div>
                    <div>التاريخ: {data.report.evaluation_date}</div>
                  </div>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3 no-print">
                  {error}
                </div>
              )}

              {/* Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-5 border-b border-slate-200">
                <div>
                  <div className="text-xs text-slate-500">القسم</div>
                  <div className="text-sm font-bold text-slate-900 mt-0.5">
                    {data.report.department_name}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">المشرف المسؤول</div>
                  <div className="text-sm font-semibold text-slate-900 mt-0.5">
                    {data.report.supervisor_name}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">التاريخ والوقت · الوردية</div>
                  <div className="text-sm font-medium text-slate-900 mt-0.5 tabular-nums">
                    {data.report.evaluation_date} · {data.report.evaluation_time} ·{' '}
                    {SHIFT_LABELS[data.report.shift]}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">حالة التقرير</div>
                  <div className="mt-1">
                    <span
                      className={`inline-block px-2.5 py-0.5 text-xs font-semibold border rounded ${
                        REPORT_STATUS_STYLES[data.report.status]
                      }`}
                    >
                      {REPORT_STATUS_LABELS[data.report.status]}
                    </span>
                  </div>
                </div>
              </div>

              {/* Calculated Score Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 border border-slate-200 rounded-lg p-4">
                <div>
                  <div className="text-xs text-slate-500">متوسط المعايير (÷ 9)</div>
                  <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">
                    {data.report.criteria_average.toFixed(2)}{' '}
                    <span className="text-xs font-normal text-slate-500">/ 10</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">الانضباط وتحمل المسؤولية</div>
                  <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">
                    {data.report.discipline_score.toFixed(2)}{' '}
                    <span className="text-xs font-normal text-slate-500">/ 10</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">متوسط الأداء العام</div>
                  <div className="text-xl font-bold text-teal-700 tabular-nums mt-0.5">
                    {data.report.overall_average.toFixed(2)}{' '}
                    <span className="text-xs font-normal text-slate-500">
                      ({data.report.overall_percentage.toFixed(1)}%)
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">التصنيف التشغيلي</div>
                  <div
                    className="text-base font-bold mt-1"
                    style={{ color: data.report.rating_color }}
                  >
                    {data.report.rating_label}
                  </div>
                </div>
              </div>

              {/* Edit Toggle */}
              {canEdit && !isEditing && (
                <div className="flex justify-end no-print">
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>تعديل التقرير</span>
                  </button>
                </div>
              )}

              {/* Criteria Table */}
              <div>
                <h3 className="text-sm font-bold text-slate-900 mb-3">
                  بنود المعايير التشغيلية المحفوظة (نسخة تاريخية وقت التقييم)
                </h3>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-right border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-3 w-10">#</th>
                        <th className="py-2.5 px-3">المعيار التشغيلي</th>
                        <th className="py-2.5 px-3 w-28 text-left">الدرجة (من 10)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {data.scores.map((s, idx) => (
                        <tr key={s.snapshot_id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-3 font-mono text-xs text-slate-500 tabular-nums align-top">
                            {idx + 1}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-slate-900 text-sm">{s.name}</div>
                            <div className="text-xs text-slate-500 mt-0.5">{s.description}</div>
                          </td>
                          <td className="py-2.5 px-3 text-left align-middle">
                            {isEditing ? (
                              <input
                                type="number"
                                min={0}
                                max={10}
                                step={0.5}
                                value={editScores[s.snapshot_id] ?? ''}
                                onChange={(e) =>
                                  setEditScores((prev) => ({
                                    ...prev,
                                    [s.snapshot_id]: e.target.value,
                                  }))
                                }
                                dir="ltr"
                                className="w-20 px-2 py-1 text-sm font-mono text-center border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-teal-600"
                              />
                            ) : (
                              <span className="font-mono font-bold text-slate-900 tabular-nums">
                                {s.score !== null ? s.score.toFixed(1) : '—'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Discipline edit if editing */}
              {isEditing && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      درجة الانضباط وتحمل المسؤولية (0 إلى 10)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step={0.5}
                      value={editDiscipline}
                      onChange={(e) => setEditDiscipline(e.target.value)}
                      dir="ltr"
                      className="w-32 px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                </div>
              )}

              {/* Notes & Suggestions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-lg p-4">
                  <div className="text-xs font-bold text-slate-700 mb-2">
                    الملاحظات والمشكلات المرصودة
                  </div>
                  {isEditing ? (
                    <textarea
                      rows={3}
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  ) : (
                    <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                      {data.report.notes_text || 'لا توجد ملاحظات مسجلة.'}
                    </p>
                  )}
                </div>

                <div className="border border-slate-200 rounded-lg p-4">
                  <div className="text-xs font-bold text-slate-700 mb-2">
                    المقترحات التطويرية
                  </div>
                  {isEditing ? (
                    <textarea
                      rows={3}
                      value={editSuggestions}
                      onChange={(e) => setEditSuggestions(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  ) : (
                    <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                      {data.report.suggestions_text || 'لا توجد مقترحات مسجلة.'}
                    </p>
                  )}
                </div>
              </div>

              {isEditing && (
                <div className="flex flex-wrap items-center justify-end gap-3 pt-2 no-print">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    إلغاء التعديل
                  </button>
                  <button
                    type="button"
                    disabled={savingEdit}
                    onClick={() => handleSaveEdit(false)}
                    className="px-4 py-2 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg cursor-pointer"
                  >
                    {savingEdit ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                  </button>
                  {data.report.status === 'draft' && (
                    <button
                      type="button"
                      disabled={savingEdit}
                      onClick={() => handleSaveEdit(true)}
                      className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
                    >
                      حفظ وإرسال التقرير نهائيًا
                    </button>
                  )}
                </div>
              )}

              {/* Attachments */}
              {data.notes.some((n) => n.attachment_path) && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-700">المرفقات والصور التوثيقية</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {data.notes
                      .filter((n) => n.attachment_path)
                      .map((n) => (
                        <ProtectedAttachmentLink
                          key={n.id}
                          path={n.attachment_path!}
                          name={n.attachment_name || 'مرفق'}
                        />
                      ))}
                  </div>
                </div>
              )}

              {/* Audit Trail Metadata */}
              <div className="text-xs text-slate-500 border-t border-slate-200 pt-4 flex flex-wrap gap-x-6 gap-y-1">
                <span>أنشئ بواسطة: {data.report.created_by_name}</span>
                <span>آخر تعديل بواسطة: {data.report.updated_by_name}</span>
                {data.report.reviewed_by_name && (
                  <span>
                    تمت المراجعة بواسطة: {data.report.reviewed_by_name} ({data.report.reviewed_at?.slice(0, 10)})
                  </span>
                )}
              </div>

              {/* Review Panel for Admin & Production Manager */}
              {canReview && !isEditing && (
                <div className="border-t border-slate-200 pt-5 space-y-3 no-print">
                  <h3 className="text-sm font-bold text-slate-900">
                    مراجعة واعتماد التقرير
                  </h3>
                  <textarea
                    rows={2}
                    placeholder="تعليق المراجع أو التوجيه التشغيلي (اختياري)..."
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={reviewing}
                        onClick={() => handleReview('approved')}
                        className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5 cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>اعتماد التقرير</span>
                      </button>
                      <button
                        type="button"
                        disabled={reviewing}
                        onClick={() => handleReview('under_review')}
                        className="px-3.5 py-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg cursor-pointer"
                      >
                        وضع قيد المراجعة
                      </button>
                      <button
                        type="button"
                        disabled={reviewing}
                        onClick={() => handleReview('needs_corrective_action')}
                        className="px-3.5 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg cursor-pointer"
                      >
                        يحتاج إلى إجراء تصحيحي
                      </button>
                    </div>

                    {onCreateActionFromReport && (
                      <button
                        type="button"
                        onClick={() => onCreateActionFromReport(data.report)}
                        className="px-3.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-200 hover:bg-teal-100 rounded-lg flex items-center gap-1.5 cursor-pointer"
                      >
                        <ClipboardPlus className="w-4 h-4" />
                        <span>إنشاء إجراء تصحيحي مرتبط</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Print Signature Footer */}
              <div className="hidden print:grid grid-cols-3 gap-6 pt-10 mt-8 border-t border-slate-300 text-xs text-slate-700">
                <div>توقيع مشرف القسم: __________________</div>
                <div>توقيع مسؤول الإنتاج: __________________</div>
                <div>اعتماد مدير النظام: __________________</div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
