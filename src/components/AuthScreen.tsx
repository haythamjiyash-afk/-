import React, { useEffect, useState } from 'react';
import { Lock, ShieldCheck, UserCheck } from 'lucide-react';
import { apiRequest, setAuthToken } from '../lib/api';
import type { SessionUser } from '../types';

interface AuthScreenProps {
  onAuthenticated: (user: SessionUser) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [needsInitialSetup, setNeedsInitialSetup] = useState(false);

  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('مدير النظام');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<{ needsInitialSetup: boolean }>('/auth/status')
      .then((res) => {
        if (!active) return;
        setNeedsInitialSetup(res.needsInitialSetup);
        if (res.needsInitialSetup) {
          setUsername('admin');
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'تعذر التحقق من حالة النظام');
      })
      .finally(() => {
        if (active) setCheckingStatus(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSetupAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError('كلمة المرور يجب أن تتكون من 6 أحرف على الأقل');
      return;
    }
    if (password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest<{ token: string; user: SessionUser }>('/auth/setup-admin', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), fullName: fullName.trim(), password }),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إتمام التفعيل');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('يرجى إدخال اسم المستخدم وكلمة المرور');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest<{ token: string; user: SessionUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تسجيل الدخول');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 sm:p-8">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
        <div className="border-b border-slate-100 pb-5 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-teal-700 text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-snug">
                مطاعم المذاق اليمني
              </h1>
              <p className="text-xs text-slate-500">
                نظام الرقابة والتقييم التشغيلي – صالة الإنتاج
              </p>
            </div>
          </div>
        </div>

        {checkingStatus ? (
          <div className="py-10 text-center text-sm text-slate-500">
            جاري التحقق من تهيئة النظام...
          </div>
        ) : needsInitialSetup ? (
          <form onSubmit={handleSetupAdmin} className="space-y-4">
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-3.5 text-xs text-teal-900 leading-relaxed">
              <p className="font-semibold mb-1">الإعداد الأولي لحساب مدير النظام</p>
              <p>
                يرجى تعيين كلمة مرور مدير النظام لبدء تشغيل المنصة وتفعيل حسابات المشرفين ومسؤول الإنتاج.
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                الاسم الكامل لمدير النظام
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                اسم المستخدم
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                dir="ltr"
                className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                كلمة المرور الجديدة (6 أحرف فأكثر)
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                dir="ltr"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                تأكيد كلمة المرور
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                dir="ltr"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <UserCheck className="w-4 h-4" />
              <span>{submitting ? 'جاري التفعيل...' : 'تفعيل حساب مدير النظام والدخول'}</span>
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">تسجيل الدخول</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                أدخل بيانات حسابك للوصول إلى لوحة الرقابة وتقييم الأقسام
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                اسم المستخدم
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
                dir="ltr"
                placeholder="admin / haytham_j"
                className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                كلمة المرور
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                dir="ltr"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              <span>{submitting ? 'جاري التحقق...' : 'دخول إلى النظام'}</span>
            </button>
          </form>
        )}
      </div>

      <p className="mt-6 text-xs text-slate-400">
        جميع الحقوق محفوظة · إدارة الجودة والتشغيل – مطاعم المذاق اليمني
      </p>
    </div>
  );
};
