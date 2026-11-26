import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  CheckSquare,
  ClipboardCheck,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import { AdminSettingsView } from './components/AdminSettingsView';
import { AuthScreen } from './components/AuthScreen';
import { CorrectiveActionsView } from './components/CorrectiveActionsView';
import { DashboardView } from './components/DashboardView';
import { EvaluationView } from './components/EvaluationView';
import { ReportDetailModal } from './components/ReportDetailModal';
import { ReportsAnalyticsView } from './components/ReportsAnalyticsView';
import { apiRequest, setAuthToken } from './lib/api';
import {
  ROLE_LABELS,
  type RatingThreshold,
  type ReportListItem,
  type SessionUser,
} from './types';

type NavView = 'dashboard' | 'evaluate' | 'reports' | 'actions' | 'admin';

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [activeView, setActiveView] = useState<NavView>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [thresholds, setThresholds] = useState<RatingThreshold[]>([]);
  const [restaurantName, setRestaurantName] = useState('مطاعم المذاق اليمني – صالة الإنتاج');

  const [preselectedDeptId, setPreselectedDeptId] = useState<number | undefined>(undefined);
  const [openReportId, setOpenReportId] = useState<number | null>(null);
  const [prefillActionReport, setPrefillActionReport] = useState<ReportListItem | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Change password modal
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);
  const [pwdErr, setPwdErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    apiRequest<{ thresholds: RatingThreshold[]; restaurantName: string }>('/settings/thresholds')
      .then((res) => {
        setThresholds(res.thresholds);
        setRestaurantName(res.restaurantName);
      })
      .catch(() => {});
  }, [user]);

  const handleLogout = () => {
    setAuthToken(null);
    setUser(null);
    setActiveView('dashboard');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdErr(null);
    setPwdMsg(null);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: curPwd, newPassword: newPwd }),
      });
      setPwdMsg('تم تحديث كلمة المرور بنجاح');
      setCurPwd('');
      setNewPwd('');
    } catch (err) {
      setPwdErr(err instanceof Error ? err.message : 'تعذر تغيير كلمة المرور');
    }
  };

  if (!user) {
    return (
      <AuthScreen
        onAuthenticated={(loggedInUser) => {
          setUser(loggedInUser);
          setActiveView(loggedInUser.role === 'supervisor' ? 'evaluate' : 'dashboard');
        }}
      />
    );
  }

  const navItems: Array<{ id: NavView; label: string; icon: React.ComponentType<{ className?: string }>; hidden?: boolean }> = [
    { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
    { id: 'evaluate', label: 'تقييم الأقسام', icon: ClipboardCheck },
    { id: 'reports', label: 'التقارير والتحليلات', icon: BarChart3 },
    { id: 'actions', label: 'الإجراءات التصحيحية', icon: CheckSquare },
    {
      id: 'admin',
      label: 'إدارة النظام',
      icon: Settings,
      hidden: user.role !== 'admin',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar (Right side in RTL) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-slate-900 text-slate-100 border-l border-slate-800 no-print">
        <div className="px-5 py-5 border-b border-slate-800 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-600 text-white flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-white truncate">المذاق اليمني</div>
            <div className="text-[11px] text-slate-400 truncate">الرقابة والتقييم التشغيلي</div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems
            .filter((item) => !item.hidden)
            .map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setPreselectedDeptId(undefined);
                    setActiveView(item.id);
                  }}
                  className={`w-full px-3.5 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-3 transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-teal-700 text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-3">
          <div>
            <div className="text-xs font-bold text-white truncate">{user.full_name}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {ROLE_LABELS[user.role]} · <span className="font-mono">{user.username}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPwdModal(true)}
              className="flex-1 py-1.5 px-2 text-[11px] font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center justify-center gap-1 cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>كلمة المرور</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="py-1.5 px-2.5 text-[11px] font-semibold text-red-300 bg-slate-800 hover:bg-red-950/60 rounded-lg flex items-center justify-center gap-1 cursor-pointer"
              title="تسجيل الخروج"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>خروج</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-64 bg-slate-900 text-slate-100 flex flex-col h-full">
            <div className="px-4 py-4 border-b border-slate-800 flex items-center justify-between">
              <span className="text-sm font-bold text-white">المذاق اليمني</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {navItems
                .filter((item) => !item.hidden)
                .map((item) => {
                  const Icon = item.icon;
                  const isActive = activeView === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setPreselectedDeptId(undefined);
                        setActiveView(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full px-3.5 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-3 cursor-pointer ${
                        isActive ? 'bg-teal-700 text-white' : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
            </nav>
            <div className="p-4 border-t border-slate-800 space-y-2">
              <div className="text-xs font-bold text-white">{user.full_name}</div>
              <div className="text-[11px] text-slate-400">{ROLE_LABELS[user.role]}</div>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full py-2 text-xs font-semibold text-red-300 bg-slate-800 rounded-lg cursor-pointer"
              >
                تسجيل الخروج
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200 cursor-pointer"
              aria-label="فتح القائمة"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-sm font-bold text-slate-900 truncate">{restaurantName}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 text-xs text-slate-600">
            <span className="hidden sm:inline font-semibold text-slate-800">
              {user.full_name}
            </span>
            <span className="hidden sm:inline text-slate-300">·</span>
            <span className="hidden sm:inline">{ROLE_LABELS[user.role]}</span>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {activeView === 'dashboard' && (
            <DashboardView
              key={`dash-${refreshTick}`}
              currentUser={user}
              onNavigateToEvaluate={(deptId) => {
                setPreselectedDeptId(deptId);
                setActiveView('evaluate');
              }}
              onNavigateToActions={() => setActiveView('actions')}
            />
          )}

          {activeView === 'evaluate' && (
            <EvaluationView
              currentUser={user}
              initialDepartmentId={preselectedDeptId}
              thresholds={thresholds}
              onOpenReport={(id) => setOpenReportId(id)}
            />
          )}

          {activeView === 'reports' && (
            <ReportsAnalyticsView
              key={`rep-${refreshTick}`}
              currentUser={user}
              thresholds={thresholds}
              onOpenReport={(id) => setOpenReportId(id)}
            />
          )}

          {activeView === 'actions' && (
            <CorrectiveActionsView
              currentUser={user}
              prefillReport={prefillActionReport}
              onClearPrefill={() => setPrefillActionReport(null)}
            />
          )}

          {activeView === 'admin' && user.role === 'admin' && (
            <AdminSettingsView
              thresholds={thresholds}
              restaurantName={restaurantName}
              onThresholdsUpdated={(t, rName) => {
                setThresholds(t);
                setRestaurantName(rName);
              }}
            />
          )}
        </main>
      </div>

      {/* Report Detail Modal */}
      {openReportId !== null && (
        <ReportDetailModal
          reportId={openReportId}
          currentUser={user}
          onClose={() => setOpenReportId(null)}
          onUpdated={() => setRefreshTick((n) => n + 1)}
          onCreateActionFromReport={(report) => {
            setOpenReportId(null);
            setPrefillActionReport(report);
            setActiveView('actions');
          }}
        />
      )}

      {/* Change Password Modal */}
      {showPwdModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 no-print">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">تغيير كلمة المرور</h3>
              <button
                type="button"
                onClick={() => setShowPwdModal(false)}
                className="text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {pwdErr && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-2.5">
                {pwdErr}
              </div>
            )}
            {pwdMsg && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-lg p-2.5">
                {pwdMsg}
              </div>
            )}
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  كلمة المرور الحالية
                </label>
                <input
                  type="password"
                  value={curPwd}
                  onChange={(e) => setCurPwd(e.target.value)}
                  required
                  dir="ltr"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-left"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  كلمة المرور الجديدة (6 أحرف فأكثر)
                </label>
                <input
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  required
                  minLength={6}
                  dir="ltr"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg text-left"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPwdModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
                >
                  إغلاق
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-teal-700 rounded-lg cursor-pointer"
                >
                  تحديث
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
