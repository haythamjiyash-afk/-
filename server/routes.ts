import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import express from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import {
  createAuthMiddleware,
  hashPassword,
  requireRole,
  signSessionToken,
  verifyPassword,
  type AuthenticatedRequest,
} from './auth.ts';
import { calculateReportMetrics } from './calculations.ts';
import { getRatingThresholds, getUploadsDir, writeAuditLog } from './db.ts';
import type { RatingThreshold, ReportStatus, ShiftType, UserRole } from './types.ts';

function sanitizeExt(originalName: string, mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
  };
  if (map[mimeType]) {
    return map[mimeType];
  }
  const ext = path.extname(originalName).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.pdf'].includes(ext) ? ext : '.bin';
}

function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function getCurrentTimeString(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function createApiRouter(db: Database.Database): express.Router {
  const router = express.Router();
  const requireAuth = createAuthMiddleware(db);

  const uploadsDir = getUploadsDir();
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${crypto.randomUUID()}${sanitizeExt(
        file.originalname,
        file.mimetype
      )}`;
      cb(null, unique);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
      if (!allowed.includes(file.mimetype)) {
        cb(new Error('نوع الملف غير مدعوم. المسموح: JPG, PNG, WEBP, PDF'));
        return;
      }
      cb(null, true);
    },
  });

  // Health check
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Auth status (check if initial admin setup is needed)
  router.get('/auth/status', (_req: Request, res: Response) => {
    const adminWithPassword = db
      .prepare(
        `SELECT id FROM users WHERE role = 'admin' AND password_hash IS NOT NULL AND is_active = 1 LIMIT 1`
      )
      .get();
    const hasEnvPasscode = Boolean(
      process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0
    );
    res.json({
      needsInitialSetup: !adminWithPassword && !hasEnvPasscode,
      hasEnvAdminPasscode: hasEnvPasscode,
    });
  });

  // One-time initial admin setup
  router.post('/auth/setup-admin', (req: Request, res: Response) => {
    const hasEnvPasscode = Boolean(
      process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0
    );
    if (hasEnvPasscode) {
      res.status(403).json({ error: 'تم إعداد رمز دخول المدير عبر متغيرات البيئة' });
      return;
    }

    const body = req.body as { username?: unknown; fullName?: unknown; password?: unknown };
    const username = typeof body.username === 'string' ? body.username.trim() : 'admin';
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : 'مدير النظام';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!username || username.length < 3) {
      res.status(400).json({ error: 'اسم المستخدم يجب أن لا يقل عن 3 أحرف' });
      return;
    }
    if (!password || password.length < 6) {
      res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 6 أحرف' });
      return;
    }

    try {
      const result = db.transaction(() => {
        const existingClaimed = db
          .prepare(
            `SELECT id FROM users WHERE role = 'admin' AND password_hash IS NOT NULL LIMIT 1`
          )
          .get();
        if (existingClaimed) {
          return { conflict: true as const };
        }

        const now = new Date().toISOString();
        const hash = hashPassword(password);
        const placeholderAdmin = db
          .prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`)
          .get() as { id: number } | undefined;

        let adminId: number;
        if (placeholderAdmin) {
          db.prepare(
            `UPDATE users SET username = ?, full_name = ?, password_hash = ?, is_active = 1, can_edit_approved = 1, updated_at = ?
             WHERE id = ?`
          ).run(username, fullName || 'مدير النظام', hash, now, placeholderAdmin.id);
          adminId = placeholderAdmin.id;
        } else {
          const insert = db
            .prepare(
              `INSERT INTO users (username, full_name, role, password_hash, is_active, can_edit_approved, created_at, updated_at)
               VALUES (?, ?, 'admin', ?, 1, 1, ?, ?)`
            )
            .run(username, fullName || 'مدير النظام', hash, now, now);
          adminId = Number(insert.lastInsertRowid);
        }

        writeAuditLog(db, {
          userId: adminId,
          username,
          action: 'ADMIN_INITIAL_SETUP',
          entityType: 'user',
          entityId: adminId,
          details: 'تفعيل حساب مدير النظام لأول مرة',
        });

        const user = db
          .prepare(
            `SELECT id, username, full_name, role, is_active, can_edit_approved FROM users WHERE id = ?`
          )
          .get(adminId) as {
          id: number;
          username: string;
          full_name: string;
          role: UserRole;
          is_active: number;
          can_edit_approved: number;
        };

        return { conflict: false as const, user };
      })();

      if (result.conflict) {
        res.status(403).json({ error: 'تم إعداد حساب مدير النظام مسبقًا' });
        return;
      }

      const token = signSessionToken(result.user.id, result.user.role);
      res.json({
        token,
        user: {
          ...result.user,
          supervisor_id: null,
          assignedDepartments: [],
        },
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'تعذر إتمام إعداد المدير',
      });
    }
  });

  // Login
  router.post('/auth/login', (req: Request, res: Response) => {
    const body = req.body as { username?: unknown; password?: unknown };
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!username || !password) {
      res.status(400).json({ error: 'يرجى إدخال اسم المستخدم وكلمة المرور' });
      return;
    }

    const userRow = db
      .prepare(
        `SELECT u.id, u.username, u.full_name, u.role, u.password_hash, u.is_active, u.can_edit_approved, s.id AS supervisor_id
         FROM users u
         LEFT JOIN supervisors s ON s.user_id = u.id
         WHERE u.username = ?`
      )
      .get(username) as
      | {
          id: number;
          username: string;
          full_name: string;
          role: UserRole;
          password_hash: string | null;
          is_active: number;
          can_edit_approved: number;
          supervisor_id: number | null;
        }
      | undefined;

    if (!userRow) {
      res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
      return;
    }

    if (userRow.is_active !== 1) {
      res.status(403).json({ error: 'هذا الحساب موقوف حاليًا. راجع مدير النظام' });
      return;
    }

    // Check env override for admin passcode if set
    let isValid = false;
    if (
      userRow.role === 'admin' &&
      process.env.ADMIN_PASSCODE &&
      process.env.ADMIN_PASSCODE.trim().length > 0
    ) {
      const a = Buffer.from(password);
      const b = Buffer.from(process.env.ADMIN_PASSCODE.trim());
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        isValid = true;
      }
    }

    if (!isValid) {
      if (!userRow.password_hash) {
        res.status(403).json({
          error: 'الحساب بانتظار تعيين كلمة مرور من قبل مدير النظام',
        });
        return;
      }
      isValid = verifyPassword(password, userRow.password_hash);
    }

    if (!isValid) {
      res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
      return;
    }

    const assignedDepartments =
      userRow.role === 'supervisor' && userRow.supervisor_id
        ? db
            .prepare(
              `SELECT d.id, d.name, d.code, d.is_active
               FROM departments d
               JOIN supervisor_departments sd ON sd.department_id = d.id
               WHERE sd.supervisor_id = ?
               ORDER BY d.id ASC`
            )
            .all(userRow.supervisor_id)
        : [];

    const token = signSessionToken(userRow.id, userRow.role);
    res.json({
      token,
      user: {
        id: userRow.id,
        username: userRow.username,
        full_name: userRow.full_name,
        role: userRow.role,
        is_active: userRow.is_active,
        can_edit_approved: userRow.can_edit_approved,
        supervisor_id: userRow.supervisor_id,
        assignedDepartments,
      },
    });
  });

  // Current user profile
  router.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const auth = req.authUser!;
    const userExtra = db
      .prepare(`SELECT can_edit_approved FROM users WHERE id = ?`)
      .get(auth.id) as { can_edit_approved: number } | undefined;
    const assignedDepartments =
      auth.role === 'supervisor' && auth.supervisor_id
        ? db
            .prepare(
              `SELECT d.id, d.name, d.code, d.is_active
               FROM departments d
               JOIN supervisor_departments sd ON sd.department_id = d.id
               WHERE sd.supervisor_id = ?
               ORDER BY d.id ASC`
            )
            .all(auth.supervisor_id)
        : [];

    res.json({
      user: {
        ...auth,
        can_edit_approved: userExtra?.can_edit_approved ?? 0,
        assignedDepartments,
      },
    });
  });

  // Change own password
  router.post('/auth/change-password', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const auth = req.authUser!;
    const body = req.body as { currentPassword?: unknown; newPassword?: unknown };
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (newPassword.length < 6) {
      res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن لا تقل عن 6 أحرف' });
      return;
    }

    const row = db
      .prepare(`SELECT password_hash FROM users WHERE id = ?`)
      .get(auth.id) as { password_hash: string | null } | undefined;

    if (!row || !verifyPassword(currentPassword, row.password_hash)) {
      res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(
      hashPassword(newPassword),
      now,
      auth.id
    );

    writeAuditLog(db, {
      userId: auth.id,
      username: auth.username,
      action: 'CHANGE_PASSWORD',
      entityType: 'user',
      entityId: auth.id,
      details: 'قام المستخدم بتغيير كلمة المرور الخاصة به',
    });

    res.json({ ok: true });
  });

  // Settings: thresholds (readable by all authenticated users)
  router.get('/settings/thresholds', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
    const thresholds = getRatingThresholds(db);
    const restaurantSetting = db
      .prepare(`SELECT value FROM system_settings WHERE key = 'restaurant_name'`)
      .get() as { value: string } | undefined;
    res.json({
      thresholds,
      restaurantName: restaurantSetting?.value ?? 'مطاعم المذاق اليمني – صالة الإنتاج',
    });
  });

  // Dashboard summary
  router.get('/dashboard', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const auth = req.authUser!;
    const today = getTodayDateString();
    const weekAgoDate = new Date();
    weekAgoDate.setDate(weekAgoDate.getDate() - 6);
    const weekStart = weekAgoDate.toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;

    // Determine visible departments based on role
    const departments =
      auth.role === 'supervisor'
        ? db
            .prepare(
              `SELECT d.id, d.code, d.name, d.criteria_count, d.is_active,
                      s.id AS supervisor_id, s.name AS supervisor_name
               FROM departments d
               JOIN supervisor_departments sd ON sd.department_id = d.id
               JOIN supervisors s ON s.id = sd.supervisor_id
               WHERE sd.supervisor_id = ?
               ORDER BY d.id ASC`
            )
            .all(auth.supervisor_id ?? -1)
        : db
            .prepare(
              `SELECT d.id, d.code, d.name, d.criteria_count, d.is_active,
                      s.id AS supervisor_id, s.name AS supervisor_name
               FROM departments d
               LEFT JOIN supervisor_departments sd ON sd.department_id = d.id
               LEFT JOIN supervisors s ON s.id = sd.supervisor_id
               ORDER BY d.id ASC`
            )
            .all();

    const deptRows = departments as Array<{
      id: number;
      code: string;
      name: string;
      criteria_count: number;
      is_active: number;
      supervisor_id: number | null;
      supervisor_name: string | null;
    }>;

    const deptIds = deptRows.map((d) => d.id);
    const thresholds = getRatingThresholds(db);
    const sortedThresholds = [...thresholds].sort((a, b) => b.minScore - a.minScore);
    const improvementThreshold =
      sortedThresholds.find((t) => t.id === 'acceptable')?.minScore ?? 6;

    const classify = (avg: number | null) => {
      if (avg === null) {
        return { label: 'لا توجد تقييمات', color: '#64748B' };
      }
      const match =
        sortedThresholds.find((t) => avg >= t.minScore) ??
        sortedThresholds[sortedThresholds.length - 1];
      return {
        label: match?.label ?? 'يحتاج إلى تحسين',
        color: match?.color ?? '#DC2626',
      };
    };

    // Query non-draft reports visible to user
    const reportScopeSql =
      auth.role === 'supervisor'
        ? `WHERE r.status != 'draft' AND r.department_id IN (${
            deptIds.length > 0 ? deptIds.map(() => '?').join(',') : '-1'
          })`
        : `WHERE r.status != 'draft'`;
    const scopeParams = auth.role === 'supervisor' && deptIds.length > 0 ? deptIds : [];

    const kpiCounts = db
      .prepare(
        `SELECT
           COUNT(*) AS total_submitted,
           SUM(CASE WHEN r.status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
           AVG(r.overall_average) AS hall_avg,
           SUM(CASE WHEN r.evaluation_date = ? THEN 1 ELSE 0 END) AS daily_count,
           SUM(CASE WHEN r.evaluation_date >= ? AND r.evaluation_date <= ? THEN 1 ELSE 0 END) AS weekly_count,
           SUM(CASE WHEN r.evaluation_date >= ? AND r.evaluation_date <= ? THEN 1 ELSE 0 END) AS monthly_count
         FROM reports r
         ${reportScopeSql}`
      )
      .get(today, weekStart, today, monthStart, today, ...scopeParams) as {
      total_submitted: number;
      approved_count: number | null;
      hall_avg: number | null;
      daily_count: number | null;
      weekly_count: number | null;
      monthly_count: number | null;
    };

    // Per-department aggregation
    const departmentSummaryTable = deptRows.map((dept) => {
      const stats = db
        .prepare(
          `SELECT
             COUNT(*) AS evaluations_count,
             AVG(overall_average) AS avg_score,
             MAX(evaluation_date) AS last_eval_date
           FROM reports
           WHERE department_id = ? AND status != 'draft'`
        )
        .get(dept.id) as {
        evaluations_count: number;
        avg_score: number | null;
        last_eval_date: string | null;
      };

      const latestNoteRow = db
        .prepare(
          `SELECT notes_text
           FROM reports
           WHERE department_id = ? AND status != 'draft' AND TRIM(notes_text) != ''
           ORDER BY evaluation_date DESC, id DESC
           LIMIT 1`
        )
        .get(dept.id) as { notes_text: string } | undefined;

      const actionsStats = db
        .prepare(
          `SELECT
             SUM(CASE WHEN status != 'completed' THEN 1 ELSE 0 END) AS open_count,
             SUM(CASE WHEN status != 'completed' AND target_date < ? THEN 1 ELSE 0 END) AS overdue_count
           FROM corrective_actions
           WHERE department_id = ?`
        )
        .get(today, dept.id) as {
        open_count: number | null;
        overdue_count: number | null;
      };

      const avg =
        stats.avg_score !== null ? Math.round(stats.avg_score * 100) / 100 : null;
      const rating = classify(avg);

      return {
        departmentId: dept.id,
        departmentCode: dept.code,
        departmentName: dept.name,
        isActive: dept.is_active === 1,
        supervisorId: dept.supervisor_id,
        supervisorName: dept.supervisor_name ?? 'غير معين',
        evaluationsCount: stats.evaluations_count,
        averageScore: avg,
        averagePercentage: avg !== null ? Math.round(avg * 10 * 100) / 100 : null,
        ratingLabel: rating.label,
        ratingColor: rating.color,
        lastEvaluationDate: stats.last_eval_date,
        latestNote: latestNoteRow?.notes_text ?? '',
        openActionsCount: actionsStats.open_count ?? 0,
        overdueActionsCount: actionsStats.overdue_count ?? 0,
      };
    });

    const evaluatedDepts = departmentSummaryTable.filter(
      (d) => d.averageScore !== null && d.evaluationsCount > 0
    );
    const departmentsNeedingImprovement = evaluatedDepts.filter(
      (d) => (d.averageScore ?? 0) < improvementThreshold
    );
    const topDepartments = [...evaluatedDepts]
      .sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0))
      .slice(0, 5);

    // Trend series by date (actual evaluations only)
    const trendRows = db
      .prepare(
        `SELECT
           r.evaluation_date AS date,
           ROUND(AVG(r.overall_average), 2) AS averageScore,
           COUNT(*) AS reportsCount
         FROM reports r
         ${reportScopeSql}
         GROUP BY r.evaluation_date
         ORDER BY r.evaluation_date ASC
         LIMIT 30`
      )
      .all(...scopeParams);

    // Overdue corrective actions list
    const actionScopeSql =
      auth.role === 'supervisor'
        ? `WHERE ca.status != 'completed' AND ca.target_date < ? AND ca.department_id IN (${
            deptIds.length > 0 ? deptIds.map(() => '?').join(',') : '-1'
          })`
        : `WHERE ca.status != 'completed' AND ca.target_date < ?`;
    const actionParams =
      auth.role === 'supervisor' && deptIds.length > 0 ? [today, ...deptIds] : [today];

    const overdueActions = db
      .prepare(
        `SELECT ca.id, ca.department_id, d.name AS department_name, ca.problem_description,
                ca.assigned_to, ca.target_date, ca.status
         FROM corrective_actions ca
         JOIN departments d ON d.id = ca.department_id
         ${actionScopeSql}
         ORDER BY ca.target_date ASC`
      )
      .all(...actionParams);

    const hallAverage =
      kpiCounts.hall_avg !== null ? Math.round(kpiCounts.hall_avg * 100) / 100 : null;
    const hallRating = classify(hallAverage);

    res.json({
      kpis: {
        totalDepartments: deptRows.filter((d) => d.is_active === 1).length,
        submittedReportsCount: kpiCounts.total_submitted ?? 0,
        approvedReportsCount: kpiCounts.approved_count ?? 0,
        productionHallAverage: hallAverage,
        productionHallPercentage:
          hallAverage !== null ? Math.round(hallAverage * 10 * 100) / 100 : null,
        productionHallRatingLabel: hallRating.label,
        productionHallRatingColor: hallRating.color,
        dailyReportsCount: kpiCounts.daily_count ?? 0,
        weeklyReportsCount: kpiCounts.weekly_count ?? 0,
        monthlyReportsCount: kpiCounts.monthly_count ?? 0,
        overdueActionsCount: overdueActions.length,
        departmentsNeedingImprovementCount: departmentsNeedingImprovement.length,
      },
      departmentsNeedingImprovement,
      topDepartments,
      departmentSummaryTable,
      trendSeries: trendRows,
      overdueActions,
    });
  });

  // Departments visible to user
  router.get('/departments', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const auth = req.authUser!;
    const includeInactive = req.query.includeInactive === '1' && auth.role === 'admin';

    const rows =
      auth.role === 'supervisor'
        ? db
            .prepare(
              `SELECT d.id, d.code, d.name, d.criteria_count, d.is_active,
                      s.id AS supervisor_id, s.name AS supervisor_name,
                      (SELECT COUNT(*) FROM evaluation_criteria ec WHERE ec.department_id = d.id AND ec.is_active = 1) AS active_criteria_count
               FROM departments d
               JOIN supervisor_departments sd ON sd.department_id = d.id
               JOIN supervisors s ON s.id = sd.supervisor_id
               WHERE sd.supervisor_id = ? AND d.is_active = 1
               ORDER BY d.id ASC`
            )
            .all(auth.supervisor_id ?? -1)
        : db
            .prepare(
              `SELECT d.id, d.code, d.name, d.criteria_count, d.is_active,
                      s.id AS supervisor_id, s.name AS supervisor_name,
                      (SELECT COUNT(*) FROM evaluation_criteria ec WHERE ec.department_id = d.id AND ec.is_active = 1) AS active_criteria_count
               FROM departments d
               LEFT JOIN supervisor_departments sd ON sd.department_id = d.id
               LEFT JOIN supervisors s ON s.id = sd.supervisor_id
               ${includeInactive ? '' : 'WHERE d.is_active = 1'}
               ORDER BY d.id ASC`
            )
            .all();

    res.json({ departments: rows });
  });

  // Supervisors list (for filters and admin)
  router.get('/supervisors', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
    const rows = db
      .prepare(
        `SELECT s.id, s.user_id, s.name, s.phone, s.is_active, u.username
         FROM supervisors s
         LEFT JOIN users u ON u.id = s.user_id
         ORDER BY s.id ASC`
      )
      .all();
    res.json({ supervisors: rows });
  });

  // Criteria for a department
  router.get(
    '/departments/:id/criteria',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.authUser!;
      const deptId = Number(req.params.id);
      if (!Number.isInteger(deptId) || deptId <= 0) {
        res.status(400).json({ error: 'معرف القسم غير صالح' });
        return;
      }

      if (auth.role === 'supervisor') {
        const owns = db
          .prepare(
            `SELECT 1 FROM supervisor_departments WHERE supervisor_id = ? AND department_id = ?`
          )
          .get(auth.supervisor_id ?? -1, deptId);
        if (!owns) {
          res.status(403).json({ error: 'غير مصرح لك بالوصول إلى معايير هذا القسم' });
          return;
        }
      }

      const includeInactive = req.query.includeInactive === '1' && auth.role === 'admin';
      const criteria = db
        .prepare(
          `SELECT id, department_id, name, description, sort_order, is_required, is_active
           FROM evaluation_criteria
           WHERE department_id = ? ${includeInactive ? '' : 'AND is_active = 1'}
           ORDER BY sort_order ASC, id ASC`
        )
        .all(deptId);

      res.json({ criteria });
    }
  );

  // Admin: Create department
  router.post(
    '/admin/departments',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.authUser!;
      const body = req.body as {
        name?: unknown;
        code?: unknown;
        supervisorId?: unknown;
        criteriaCount?: unknown;
      };
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const code =
        typeof body.code === 'string' && body.code.trim()
          ? body.code.trim().toUpperCase()
          : `DEP-${Date.now().toString().slice(-4)}`;
      const supervisorId =
        typeof body.supervisorId === 'number' && body.supervisorId > 0
          ? body.supervisorId
          : null;
      const criteriaCount =
        typeof body.criteriaCount === 'number' && body.criteriaCount >= 1 && body.criteriaCount <= 20
          ? Math.round(body.criteriaCount)
          : 9;

      if (!name) {
        res.status(400).json({ error: 'اسم القسم مطلوب' });
        return;
      }

      try {
        const deptId = db.transaction(() => {
          const now = new Date().toISOString();
          const insert = db
            .prepare(
              `INSERT INTO departments (code, name, criteria_count, is_active, created_at, updated_at)
               VALUES (?, ?, ?, 1, ?, ?)`
            )
            .run(code, name, criteriaCount, now, now);
          const id = Number(insert.lastInsertRowid);

          if (supervisorId) {
            db.prepare(
              `INSERT INTO supervisor_departments (supervisor_id, department_id, assigned_at)
               VALUES (?, ?, ?)`
            ).run(supervisorId, id, now);
          }

          writeAuditLog(db, {
            userId: auth.id,
            username: auth.username,
            action: 'CREATE_DEPARTMENT',
            entityType: 'department',
            entityId: id,
            details: `إضافة قسم جديد: ${name} (${code})`,
          });

          return id;
        })();

        res.status(201).json({ id: deptId });
      } catch (err) {
        res.status(400).json({
          error:
            err instanceof Error && err.message.includes('UNIQUE')
              ? 'اسم القسم أو رمزه مستخدم مسبقًا'
              : 'تعذر إنشاء القسم',
        });
      }
    }
  );

  // Admin: Update department (name, active status, supervisor, criteria_count)
  router.patch(
    '/admin/departments/:id',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.authUser!;
      const deptId = Number(req.params.id);
      const body = req.body as {
        name?: unknown;
        code?: unknown;
        isActive?: unknown;
        supervisorId?: unknown;
        criteriaCount?: unknown;
      };

      const existing = db
        .prepare(`SELECT id, name, code, criteria_count, is_active FROM departments WHERE id = ?`)
        .get(deptId) as
        | { id: number; name: string; code: string; criteria_count: number; is_active: number }
        | undefined;

      if (!existing) {
        res.status(404).json({ error: 'القسم غير موجود' });
        return;
      }

      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing.name;
      const code = typeof body.code === 'string' && body.code.trim() ? body.code.trim() : existing.code;
      const isActive =
        typeof body.isActive === 'boolean' ? (body.isActive ? 1 : 0) : existing.is_active;
      const criteriaCount =
        typeof body.criteriaCount === 'number' && body.criteriaCount >= 1 && body.criteriaCount <= 20
          ? Math.round(body.criteriaCount)
          : existing.criteria_count;

      try {
        db.transaction(() => {
          const now = new Date().toISOString();
          db.prepare(
            `UPDATE departments SET name = ?, code = ?, criteria_count = ?, is_active = ?, updated_at = ?
             WHERE id = ?`
          ).run(name, code, criteriaCount, isActive, now, deptId);

          if (body.supervisorId !== undefined) {
            db.prepare(`DELETE FROM supervisor_departments WHERE department_id = ?`).run(deptId);
            if (typeof body.supervisorId === 'number' && body.supervisorId > 0) {
              db.prepare(
                `INSERT INTO supervisor_departments (supervisor_id, department_id, assigned_at)
                 VALUES (?, ?, ?)`
              ).run(body.supervisorId, deptId, now);
            }
          }

          writeAuditLog(db, {
            userId: auth.id,
            username: auth.username,
            action: 'UPDATE_DEPARTMENT',
            entityType: 'department',
            entityId: deptId,
            details: `تحديث بيانات القسم: ${name} (الحالة: ${isActive ? 'نشط' : 'موقوف'})`,
          });
        })();

        res.json({ ok: true });
      } catch {
        res.status(400).json({ error: 'تعذر تحديث القسم، تأكد من عدم تكرار الاسم أو الرمز' });
      }
    }
  );

  // Admin: Add criterion to department
  router.post(
    '/admin/departments/:id/criteria',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.authUser!;
      const deptId = Number(req.params.id);
      const body = req.body as {
        name?: unknown;
        description?: unknown;
        isRequired?: unknown;
      };
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const isRequired = typeof body.isRequired === 'boolean' ? (body.isRequired ? 1 : 0) : 1;

      if (!name) {
        res.status(400).json({ error: 'اسم المعيار مطلوب' });
        return;
      }

      const maxOrderRow = db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM evaluation_criteria WHERE department_id = ?`
        )
        .get(deptId) as { max_order: number };
      const now = new Date().toISOString();

      const info = db
        .prepare(
          `INSERT INTO evaluation_criteria (department_id, name, description, sort_order, is_required, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(deptId, name, description, maxOrderRow.max_order + 1, isRequired, now, now);

      writeAuditLog(db, {
        userId: auth.id,
        username: auth.username,
        action: 'CREATE_CRITERION',
        entityType: 'criterion',
        entityId: Number(info.lastInsertRowid),
        details: `إضافة معيار (${name}) للقسم #${deptId}`,
      });

      res.status(201).json({ id: Number(info.lastInsertRowid) });
    }
  );

  // Admin: Update criterion
  router.patch(
    '/admin/criteria/:id',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.authUser!;
      const criterionId = Number(req.params.id);
      const body = req.body as {
        name?: unknown;
        description?: unknown;
        isRequired?: unknown;
        isActive?: unknown;
      };

      const existing = db
        .prepare(
          `SELECT id, name, description, is_required, is_active FROM evaluation_criteria WHERE id = ?`
        )
        .get(criterionId) as
        | { id: number; name: string; description: string; is_required: number; is_active: number }
        | undefined;
      if (!existing) {
        res.status(404).json({ error: 'المعيار غير موجود' });
        return;
      }

      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing.name;
      const description =
        typeof body.description === 'string' ? body.description.trim() : existing.description;
      const isRequired =
        typeof body.isRequired === 'boolean' ? (body.isRequired ? 1 : 0) : existing.is_required;
      const isActive =
        typeof body.isActive === 'boolean' ? (body.isActive ? 1 : 0) : existing.is_active;

      db.prepare(
        `UPDATE evaluation_criteria
         SET name = ?, description = ?, is_required = ?, is_active = ?, updated_at = ?
         WHERE id = ?`
      ).run(name, description, isRequired, isActive, new Date().toISOString(), criterionId);

      writeAuditLog(db, {
        userId: auth.id,
        username: auth.username,
        action: 'UPDATE_CRITERION',
        entityType: 'criterion',
        entityId: criterionId,
        details: `تحديث المعيار: ${name}`,
      });

      res.json({ ok: true });
    }
  );

  // Admin: Delete (or deactivate if referenced in history) criterion
  router.delete(
    '/admin/criteria/:id',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.authUser!;
      const criterionId = Number(req.params.id);

      const usedInHistory = db
        .prepare(`SELECT 1 FROM criteria_snapshots WHERE original_criterion_id = ? LIMIT 1`)
        .get(criterionId);

      if (usedInHistory) {
        db.prepare(`UPDATE evaluation_criteria SET is_active = 0, updated_at = ? WHERE id = ?`).run(
          new Date().toISOString(),
          criterionId
        );
      } else {
        db.prepare(`DELETE FROM evaluation_criteria WHERE id = ?`).run(criterionId);
      }

      writeAuditLog(db, {
        userId: auth.id,
        username: auth.username,
        action: 'DELETE_CRITERION',
        entityType: 'criterion',
        entityId: criterionId,
        details: usedInHistory
          ? `تعطيل المعيار #${criterionId} مع الاحتفاظ بالسجلات التاريخية`
          : `حذف المعيار #${criterionId}`,
      });

      res.json({ ok: true });
    }
  );

  // Admin: Reorder criteria
  router.put(
    '/admin/departments/:id/criteria/reorder',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.authUser!;
      const deptId = Number(req.params.id);
      const body = req.body as { orderedIds?: unknown };
      if (!Array.isArray(body.orderedIds)) {
        res.status(400).json({ error: 'قائمة الترتيب غير صالحة' });
        return;
      }
      const orderedIds = body.orderedIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);

      db.transaction(() => {
        const now = new Date().toISOString();
        orderedIds.forEach((id, index) => {
          db.prepare(
            `UPDATE evaluation_criteria SET sort_order = ?, updated_at = ? WHERE id = ? AND department_id = ?`
          ).run(index + 1, now, id, deptId);
        });

        writeAuditLog(db, {
          userId: auth.id,
          username: auth.username,
          action: 'REORDER_CRITERIA',
          entityType: 'department',
          entityId: deptId,
          details: `إعادة ترتيب معايير القسم #${deptId}`,
        });
      })();

      res.json({ ok: true });
    }
  );

  // Attachments Upload
  router.post(
    '/attachments',
    requireAuth,
    upload.single('file'),
    (req: AuthenticatedRequest, res: Response) => {
      if (!req.file) {
        res.status(400).json({ error: 'لم يتم إرفاق أي ملف' });
        return;
      }
      res.status(201).json({
        filename: req.file.filename,
        originalName: req.file.originalname,
        url: `/api/attachments/${encodeURIComponent(req.file.filename)}`,
      });
    }
  );

  // Secure attachment serving with path confinement
  router.get('/attachments/:filename', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const rawName = String(req.params.filename || '');
    const safeBase = path.basename(rawName);
    const resolvedPath = path.resolve(uploadsDir, safeBase);
    if (!resolvedPath.startsWith(uploadsDir + path.sep) || !fs.existsSync(resolvedPath)) {
      res.status(404).json({ error: 'الملف غير موجود' });
      return;
    }
    res.sendFile(resolvedPath);
  });

  // List reports with comprehensive filtering
  router.get('/reports', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const auth = req.authUser!;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (auth.role === 'supervisor') {
      conditions.push(
        `r.department_id IN (SELECT department_id FROM supervisor_departments WHERE supervisor_id = ?)`
      );
      params.push(auth.supervisor_id ?? -1);
    }

    const { date, startDate, endDate, departmentId, supervisorId, shift, status, ratingLabel, search } =
      req.query;

    if (typeof date === 'string' && date.trim()) {
      conditions.push(`r.evaluation_date = ?`);
      params.push(date.trim());
    }
    if (typeof startDate === 'string' && startDate.trim()) {
      conditions.push(`r.evaluation_date >= ?`);
      params.push(startDate.trim());
    }
    if (typeof endDate === 'string' && endDate.trim()) {
      conditions.push(`r.evaluation_date <= ?`);
      params.push(endDate.trim());
    }
    if (typeof departmentId === 'string' && departmentId.trim()) {
      conditions.push(`r.department_id = ?`);
      params.push(Number(departmentId));
    }
    if (typeof supervisorId === 'string' && supervisorId.trim()) {
      conditions.push(`r.supervisor_id = ?`);
      params.push(Number(supervisorId));
    }
    if (typeof shift === 'string' && (shift === 'morning' || shift === 'evening')) {
      conditions.push(`r.shift = ?`);
      params.push(shift);
    }
    if (typeof status === 'string' && status.trim()) {
      conditions.push(`r.status = ?`);
      params.push(status.trim());
    } else if (auth.role === 'production_manager') {
      conditions.push(`r.status != 'draft'`);
    }
    if (typeof ratingLabel === 'string' && ratingLabel.trim()) {
      conditions.push(`r.rating_label = ?`);
      params.push(ratingLabel.trim());
    }
    if (typeof search === 'string' && search.trim()) {
      const q = `%${search.trim()}%`;
      conditions.push(
        `(r.report_number LIKE ? OR d.name LIKE ? OR s.name LIKE ? OR r.notes_text LIKE ?)`
      );
      params.push(q, q, q, q);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const reports = db
      .prepare(
        `SELECT r.*, d.name AS department_name, d.code AS department_code,
                s.name AS supervisor_name,
                cu.full_name AS created_by_name,
                uu.full_name AS updated_by_name,
                ru.full_name AS reviewed_by_name
         FROM reports r
         JOIN departments d ON d.id = r.department_id
         JOIN supervisors s ON s.id = r.supervisor_id
         JOIN users cu ON cu.id = r.created_by_user_id
         JOIN users uu ON uu.id = r.updated_by_user_id
         LEFT JOIN users ru ON ru.id = r.reviewed_by_user_id
         ${whereClause}
         ORDER BY r.evaluation_date DESC, r.id DESC
         LIMIT 500`
      )
      .all(...params);

    res.json({ reports });
  });

  // Get single report detail with historical snapshot criteria & scores
  router.get('/reports/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const auth = req.authUser!;
    const reportId = Number(req.params.id);

    const report = db
      .prepare(
        `SELECT r.*, d.name AS department_name, d.code AS department_code,
                s.name AS supervisor_name,
                cu.full_name AS created_by_name,
                uu.full_name AS updated_by_name,
                ru.full_name AS reviewed_by_name
         FROM reports r
         JOIN departments d ON d.id = r.department_id
         JOIN supervisors s ON s.id = r.supervisor_id
         JOIN users cu ON cu.id = r.created_by_user_id
         JOIN users uu ON uu.id = r.updated_by_user_id
         LEFT JOIN users ru ON ru.id = r.reviewed_by_user_id
         WHERE r.id = ?`
      )
      .get(reportId) as { id: number; department_id: number; status: string } | undefined;

    if (!report) {
      res.status(404).json({ error: 'التقرير غير موجود' });
      return;
    }

    if (auth.role === 'supervisor') {
      const owns = db
        .prepare(
          `SELECT 1 FROM supervisor_departments WHERE supervisor_id = ? AND department_id = ?`
        )
        .get(auth.supervisor_id ?? -1, report.department_id);
      if (!owns) {
        res.status(403).json({ error: 'غير مصرح لك بالاطلاع على هذا التقرير' });
        return;
      }
    } else if (auth.role === 'production_manager' && report.status === 'draft') {
      res.status(403).json({ error: 'لا يمكن لمسؤول الإنتاج الاطلاع على المسودات غير المرسلة' });
      return;
    }

    const scores = db
      .prepare(
        `SELECT cs.id AS snapshot_id, cs.original_criterion_id, cs.name, cs.description,
                cs.sort_order, cs.is_required, rs.score
         FROM criteria_snapshots cs
         JOIN report_scores rs ON rs.snapshot_criterion_id = cs.id
         WHERE cs.report_id = ?
         ORDER BY cs.sort_order ASC`
      )
      .all(reportId);

    const notes = db
      .prepare(
        `SELECT rn.*, u.full_name AS created_by_name
         FROM report_notes rn
         JOIN users u ON u.id = rn.created_by_user_id
         WHERE rn.report_id = ?
         ORDER BY rn.id ASC`
      )
      .all(reportId);

    const correctiveActions = db
      .prepare(
        `SELECT ca.*, d.name AS department_name
         FROM corrective_actions ca
         JOIN departments d ON d.id = ca.department_id
         WHERE ca.report_id = ?
         ORDER BY ca.id DESC`
      )
      .all(reportId);

    res.json({ report, scores, notes, correctiveActions });
  });

  // Create new report (draft or submitted)
  router.post('/reports', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const auth = req.authUser!;
    const body = req.body as {
      departmentId?: unknown;
      evaluationDate?: unknown;
      evaluationTime?: unknown;
      shift?: unknown;
      disciplineScore?: unknown;
      notesText?: unknown;
      suggestionsText?: unknown;
      status?: unknown;
      scores?: Array<{ criterionId: number; score: number | null }>;
      attachmentPath?: unknown;
      attachmentName?: unknown;
      clientSubmissionToken?: unknown;
    };

    const departmentId = Number(body.departmentId);
    const shift: ShiftType = body.shift === 'evening' ? 'evening' : 'morning';
    const targetStatus: ReportStatus = body.status === 'draft' ? 'draft' : 'submitted';
    const evaluationDate =
      typeof body.evaluationDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.evaluationDate)
        ? body.evaluationDate
        : getTodayDateString();
    const evaluationTime =
      typeof body.evaluationTime === 'string' && /^\d{2}:\d{2}$/.test(body.evaluationTime)
        ? body.evaluationTime
        : getCurrentTimeString();
    const disciplineScore = Number(body.disciplineScore);
    const notesText = typeof body.notesText === 'string' ? body.notesText.trim() : '';
    const suggestionsText =
      typeof body.suggestionsText === 'string' ? body.suggestionsText.trim() : '';
    const attachmentPath =
      typeof body.attachmentPath === 'string' && body.attachmentPath.trim()
        ? body.attachmentPath.trim()
        : null;
    const attachmentName =
      typeof body.attachmentName === 'string' && body.attachmentName.trim()
        ? body.attachmentName.trim()
        : null;
    const clientSubmissionToken =
      typeof body.clientSubmissionToken === 'string' && body.clientSubmissionToken.trim()
        ? body.clientSubmissionToken.trim()
        : null;

    if (!Number.isInteger(departmentId) || departmentId <= 0) {
      res.status(400).json({ error: 'يرجى اختيار القسم' });
      return;
    }

    const deptRow = db
      .prepare(
        `SELECT d.id, d.name, d.is_active, sd.supervisor_id
         FROM departments d
         LEFT JOIN supervisor_departments sd ON sd.department_id = d.id
         WHERE d.id = ?`
      )
      .get(departmentId) as
      | { id: number; name: string; is_active: number; supervisor_id: number | null }
      | undefined;

    if (!deptRow || deptRow.is_active !== 1) {
      res.status(404).json({ error: 'القسم غير موجود أو موقوف' });
      return;
    }

    if (auth.role === 'supervisor') {
      if (!auth.supervisor_id || deptRow.supervisor_id !== auth.supervisor_id) {
        res.status(403).json({ error: 'غير مصرح لك بتقييم هذا القسم' });
        return;
      }
    }

    // Determine supervisor_id for report
    const effectiveSupervisorId = auth.supervisor_id ?? deptRow.supervisor_id;
    if (!effectiveSupervisorId) {
      res.status(400).json({ error: 'لا يوجد مشرف معين لهذا القسم. يرجى تعيين مشرف من الإعدادات' });
      return;
    }

    // Check duplicate submission token
    if (clientSubmissionToken) {
      const dup = db
        .prepare(`SELECT id, report_number FROM reports WHERE client_submission_token = ?`)
        .get(clientSubmissionToken) as { id: number; report_number: string } | undefined;
      if (dup) {
        res.status(200).json({
          id: dup.id,
          reportNumber: dup.report_number,
          deduplicated: true,
        });
        return;
      }
    }

    if (Number.isNaN(disciplineScore) || disciplineScore < 0 || disciplineScore > 10) {
      res.status(400).json({ error: 'درجة الانضباط وتحمل المسؤولية يجب أن تكون بين 0 و 10' });
      return;
    }

    const activeCriteria = db
      .prepare(
        `SELECT id, name, description, sort_order, is_required
         FROM evaluation_criteria
         WHERE department_id = ? AND is_active = 1
         ORDER BY sort_order ASC, id ASC`
      )
      .all(departmentId) as Array<{
      id: number;
      name: string;
      description: string;
      sort_order: number;
      is_required: number;
    }>;

    if (activeCriteria.length === 0) {
      res.status(400).json({ error: 'لا توجد معايير نشطة لهذا القسم' });
      return;
    }

    const scoreMap = new Map<number, number | null>();
    if (Array.isArray(body.scores)) {
      for (const item of body.scores) {
        if (item && typeof item.criterionId === 'number') {
          if (item.score === null || item.score === undefined) {
            scoreMap.set(item.criterionId, null);
          } else {
            const num = Number(item.score);
            if (Number.isNaN(num) || num < 0 || num > 10) {
              res.status(400).json({ error: 'جميع الدرجات يجب أن تكون بين 0 و 10' });
              return;
            }
            scoreMap.set(item.criterionId, num);
          }
        }
      }
    }

    // Validate required criteria if submitting
    if (targetStatus === 'submitted') {
      for (const criterion of activeCriteria) {
        const val = scoreMap.get(criterion.id);
        if (criterion.is_required === 1 && (val === undefined || val === null)) {
          res.status(400).json({
            error: `يرجى إدخال درجة المعيار الإلزامي: ${criterion.name}`,
          });
          return;
        }
      }
    }

    const numericScores = activeCriteria.map((c) => {
      const v = scoreMap.get(c.id);
      return typeof v === 'number' ? v : 0;
    });
    const thresholds = getRatingThresholds(db);
    const metrics = calculateReportMetrics(numericScores, disciplineScore, thresholds);

    try {
      const created = db.transaction(() => {
        const now = new Date().toISOString();
        const counter = db
          .prepare(`UPDATE report_counters SET last_seq = last_seq + 1 WHERE id = 1 RETURNING last_seq`)
          .get() as { last_seq: number };
        const reportNumber = `RPT-${String(counter.last_seq).padStart(4, '0')}`;

        const insertReport = db
          .prepare(
            `INSERT INTO reports (
               report_number, evaluation_date, evaluation_time, shift,
               department_id, supervisor_id, created_by_user_id, updated_by_user_id,
               criteria_average, discipline_score, overall_average, overall_percentage,
               rating_label, rating_color, notes_text, suggestions_text,
               status, client_submission_token, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            reportNumber,
            evaluationDate,
            evaluationTime,
            shift,
            departmentId,
            effectiveSupervisorId,
            auth.id,
            auth.id,
            metrics.criteriaAverage,
            disciplineScore,
            metrics.overallAverage,
            metrics.overallPercentage,
            metrics.ratingLabel,
            metrics.ratingColor,
            notesText,
            suggestionsText,
            targetStatus,
            clientSubmissionToken,
            now,
            now
          );

        const reportId = Number(insertReport.lastInsertRowid);

        for (const criterion of activeCriteria) {
          const snap = db
            .prepare(
              `INSERT INTO criteria_snapshots (report_id, original_criterion_id, name, description, sort_order, is_required)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(
              reportId,
              criterion.id,
              criterion.name,
              criterion.description,
              criterion.sort_order,
              criterion.is_required
            );
          const snapId = Number(snap.lastInsertRowid);
          const scoreVal = scoreMap.get(criterion.id) ?? null;
          db.prepare(
            `INSERT INTO report_scores (report_id, snapshot_criterion_id, score)
             VALUES (?, ?, ?)`
          ).run(reportId, snapId, scoreVal);
        }

        if (notesText || attachmentPath) {
          db.prepare(
            `INSERT INTO report_notes (report_id, department_id, note_type, content, attachment_path, attachment_name, created_by_user_id, created_at)
             VALUES (?, ?, 'observation', ?, ?, ?, ?, ?)`
          ).run(
            reportId,
            departmentId,
            notesText || 'مرفق توثيقي',
            attachmentPath,
            attachmentName,
            auth.id,
            now
          );
        }

        if (suggestionsText) {
          db.prepare(
            `INSERT INTO report_notes (report_id, department_id, note_type, content, attachment_path, attachment_name, created_by_user_id, created_at)
             VALUES (?, ?, 'suggestion', ?, NULL, NULL, ?, ?)`
          ).run(reportId, departmentId, suggestionsText, auth.id, now);
        }

        writeAuditLog(db, {
          userId: auth.id,
          username: auth.username,
          action: targetStatus === 'draft' ? 'CREATE_DRAFT_REPORT' : 'SUBMIT_REPORT',
          entityType: 'report',
          entityId: reportId,
          details: `إنشاء التقرير ${reportNumber} لقسم ${deptRow.name} (${
            targetStatus === 'draft' ? 'مسودة' : 'مرسل'
          })`,
        });

        return { id: reportId, reportNumber, metrics };
      })();

      res.status(201).json(created);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'تعذر حفظ التقرير',
      });
    }
  });

  // Update report (draft -> submitted, or edit permitted report)
  router.patch('/reports/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const auth = req.authUser!;
    const reportId = Number(req.params.id);

    const existing = db
      .prepare(`SELECT * FROM reports WHERE id = ?`)
      .get(reportId) as
      | {
          id: number;
          report_number: string;
          department_id: number;
          supervisor_id: number;
          created_by_user_id: number;
          status: ReportStatus;
          evaluation_date: string;
          evaluation_time: string;
          shift: ShiftType;
          discipline_score: number;
          notes_text: string;
          suggestions_text: string;
        }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'التقرير غير موجود' });
      return;
    }

    const userPerms = db
      .prepare(`SELECT can_edit_approved FROM users WHERE id = ?`)
      .get(auth.id) as { can_edit_approved: number } | undefined;
    const canEditApproved = auth.role === 'admin' || userPerms?.can_edit_approved === 1;

    if (auth.role === 'supervisor') {
      const owns = db
        .prepare(
          `SELECT 1 FROM supervisor_departments WHERE supervisor_id = ? AND department_id = ?`
        )
        .get(auth.supervisor_id ?? -1, existing.department_id);
      if (!owns) {
        res.status(403).json({ error: 'غير مصرح لك بتعديل هذا التقرير' });
        return;
      }
      if (existing.status === 'approved' && !canEditApproved) {
        res.status(403).json({
          error: 'لا يمكن للمشرف تعديل تقرير معتمد إلا بصلاحية مخصصة من مدير النظام',
        });
        return;
      }
      if (existing.status !== 'draft' && !canEditApproved) {
        res.status(403).json({
          error: 'تم إرسال التقرير للمراجعة ولا يمكن تعديله من حساب المشرف',
        });
        return;
      }
    } else if (existing.status === 'approved' && !canEditApproved) {
      res.status(403).json({ error: 'تعديل التقرير المعتمد يتطلب صلاحية خاصة' });
      return;
    }

    const body = req.body as {
      evaluationDate?: unknown;
      evaluationTime?: unknown;
      shift?: unknown;
      disciplineScore?: unknown;
      notesText?: unknown;
      suggestionsText?: unknown;
      status?: unknown;
      scores?: Array<{ snapshotId: number; score: number | null }>;
    };

    const evaluationDate =
      typeof body.evaluationDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.evaluationDate)
        ? body.evaluationDate
        : existing.evaluation_date;
    const evaluationTime =
      typeof body.evaluationTime === 'string' && /^\d{2}:\d{2}$/.test(body.evaluationTime)
        ? body.evaluationTime
        : existing.evaluation_time;
    const shift: ShiftType =
      body.shift === 'evening' || body.shift === 'morning' ? body.shift : existing.shift;
    const disciplineScore =
      body.disciplineScore !== undefined ? Number(body.disciplineScore) : existing.discipline_score;
    const notesText =
      typeof body.notesText === 'string' ? body.notesText.trim() : existing.notes_text;
    const suggestionsText =
      typeof body.suggestionsText === 'string'
        ? body.suggestionsText.trim()
        : existing.suggestions_text;

    const targetStatus: ReportStatus =
      body.status === 'draft' || body.status === 'submitted'
        ? body.status
        : existing.status;

    if (Number.isNaN(disciplineScore) || disciplineScore < 0 || disciplineScore > 10) {
      res.status(400).json({ error: 'درجة الانضباط يجب أن تكون بين 0 و 10' });
      return;
    }

    const snapshots = db
      .prepare(
        `SELECT cs.id AS snapshot_id, cs.name, cs.is_required, rs.score AS current_score
         FROM criteria_snapshots cs
         JOIN report_scores rs ON rs.snapshot_criterion_id = cs.id
         WHERE cs.report_id = ?
         ORDER BY cs.sort_order ASC`
      )
      .all(reportId) as Array<{
      snapshot_id: number;
      name: string;
      is_required: number;
      current_score: number | null;
    }>;

    const scoreMap = new Map<number, number | null>();
    snapshots.forEach((s) => scoreMap.set(s.snapshot_id, s.current_score));

    if (Array.isArray(body.scores)) {
      for (const item of body.scores) {
        if (item && typeof item.snapshotId === 'number') {
          if (item.score === null || item.score === undefined) {
            scoreMap.set(item.snapshotId, null);
          } else {
            const num = Number(item.score);
            if (Number.isNaN(num) || num < 0 || num > 10) {
              res.status(400).json({ error: 'الدرجات يجب أن تكون بين 0 و 10' });
              return;
            }
            scoreMap.set(item.snapshotId, num);
          }
        }
      }
    }

    if (targetStatus === 'submitted') {
      for (const snap of snapshots) {
        const val = scoreMap.get(snap.snapshot_id);
        if (snap.is_required === 1 && (val === undefined || val === null)) {
          res.status(400).json({ error: `يرجى إدخال درجة المعيار الإلزامي: ${snap.name}` });
          return;
        }
      }
    }

    const numericScores = snapshots.map((s) => {
      const v = scoreMap.get(s.snapshot_id);
      return typeof v === 'number' ? v : 0;
    });
    const metrics = calculateReportMetrics(numericScores, disciplineScore, getRatingThresholds(db));

    db.transaction(() => {
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE reports
         SET evaluation_date = ?, evaluation_time = ?, shift = ?,
             criteria_average = ?, discipline_score = ?, overall_average = ?, overall_percentage = ?,
             rating_label = ?, rating_color = ?, notes_text = ?, suggestions_text = ?,
             status = ?, updated_by_user_id = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        evaluationDate,
        evaluationTime,
        shift,
        metrics.criteriaAverage,
        disciplineScore,
        metrics.overallAverage,
        metrics.overallPercentage,
        metrics.ratingLabel,
        metrics.ratingColor,
        notesText,
        suggestionsText,
        targetStatus,
        auth.id,
        now,
        reportId
      );

      for (const snap of snapshots) {
        db.prepare(
          `UPDATE report_scores SET score = ? WHERE report_id = ? AND snapshot_criterion_id = ?`
        ).run(scoreMap.get(snap.snapshot_id) ?? null, reportId, snap.snapshot_id);
      }

      writeAuditLog(db, {
        userId: auth.id,
        username: auth.username,
        action: 'UPDATE_REPORT',
        entityType: 'report',
        entityId: reportId,
        details: `تعديل التقرير ${existing.report_number} (الحالة الجديدة: ${targetStatus})`,
      });
    })();

    res.json({ ok: true, metrics });
  });

  // Review / Approve Report (Admin & Production Manager)
  router.post(
    '/reports/:id/review',
    requireAuth,
    requireRole('admin', 'production_manager'),
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.authUser!;
      const reportId = Number(req.params.id);
      const body = req.body as { status?: unknown; reviewComment?: unknown };
      const status = body.status;
      const reviewComment = typeof body.reviewComment === 'string' ? body.reviewComment.trim() : '';

      if (
        status !== 'under_review' &&
        status !== 'approved' &&
        status !== 'needs_corrective_action'
      ) {
        res.status(400).json({ error: 'حالة المراجعة غير صالحة' });
        return;
      }

      const existing = db
        .prepare(`SELECT id, report_number, status FROM reports WHERE id = ?`)
        .get(reportId) as { id: number; report_number: string; status: string } | undefined;

      if (!existing) {
        res.status(404).json({ error: 'التقرير غير موجود' });
        return;
      }

      if (existing.status === 'draft') {
        res.status(400).json({ error: 'لا يمكن اعتماد مسودة قبل إرسالها من المشرف' });
        return;
      }

      const now = new Date().toISOString();
      db.prepare(
        `UPDATE reports
         SET status = ?, reviewed_by_user_id = ?, reviewed_at = ?, review_comment = ?,
             updated_by_user_id = ?, updated_at = ?
         WHERE id = ?`
      ).run(status, auth.id, now, reviewComment, auth.id, now, reportId);

      writeAuditLog(db, {
        userId: auth.id,
        username: auth.username,
        action: 'REVIEW_REPORT',
        entityType: 'report',
        entityId: reportId,
        details: `تحديث حالة التقرير ${existing.report_number} إلى: ${status}`,
      });

      res.json({ ok: true });
    }
  );

  // Analytics endpoints (Daily, Weekly, Monthly, Supervisor Performance)
  router.get('/analytics/summary', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const auth = req.authUser!;
    const today = getTodayDateString();
    const startDate =
      typeof req.query.startDate === 'string' && req.query.startDate.trim()
        ? req.query.startDate.trim()
        : today.slice(0, 7) + '-01';
    const endDate =
      typeof req.query.endDate === 'string' && req.query.endDate.trim()
        ? req.query.endDate.trim()
        : today;
    const departmentId =
      typeof req.query.departmentId === 'string' && req.query.departmentId.trim()
        ? Number(req.query.departmentId)
        : null;
    const supervisorId =
      typeof req.query.supervisorId === 'string' && req.query.supervisorId.trim()
        ? Number(req.query.supervisorId)
        : null;
    const shift =
      req.query.shift === 'morning' || req.query.shift === 'evening' ? req.query.shift : null;

    const conditions: string[] = [
      `r.status != 'draft'`,
      `r.evaluation_date >= ?`,
      `r.evaluation_date <= ?`,
    ];
    const params: unknown[] = [startDate, endDate];

    if (auth.role === 'supervisor') {
      conditions.push(
        `r.department_id IN (SELECT department_id FROM supervisor_departments WHERE supervisor_id = ?)`
      );
      params.push(auth.supervisor_id ?? -1);
    }
    if (departmentId) {
      conditions.push(`r.department_id = ?`);
      params.push(departmentId);
    }
    if (supervisorId) {
      conditions.push(`r.supervisor_id = ?`);
      params.push(supervisorId);
    }
    if (shift) {
      conditions.push(`r.shift = ?`);
      params.push(shift);
    }

    const whereSql = `WHERE ${conditions.join(' AND ')}`;

    const departmentPerformance = db
      .prepare(
        `SELECT d.id AS department_id, d.name AS department_name, d.code AS department_code,
                COUNT(r.id) AS evaluations_count,
                ROUND(AVG(r.criteria_average), 2) AS avg_criteria,
                ROUND(AVG(r.discipline_score), 2) AS avg_discipline,
                ROUND(AVG(r.overall_average), 2) AS avg_overall,
                ROUND(AVG(r.overall_percentage), 2) AS avg_percentage
         FROM reports r
         JOIN departments d ON d.id = r.department_id
         ${whereSql}
         GROUP BY d.id, d.name, d.code
         ORDER BY avg_overall DESC`
      )
      .all(...params);

    const dailyTimeline = db
      .prepare(
        `SELECT r.evaluation_date AS date,
                COUNT(r.id) AS reports_count,
                ROUND(AVG(r.overall_average), 2) AS avg_overall,
                ROUND(AVG(r.discipline_score), 2) AS avg_discipline
         FROM reports r
         ${whereSql}
         GROUP BY r.evaluation_date
         ORDER BY r.evaluation_date ASC`
      )
      .all(...params);

    // Supervisor performance (report count shown strictly as independent follow-up indicator)
    const supervisorWhere =
      auth.role === 'supervisor' ? `WHERE s.id = ?` : `WHERE s.is_active = 1`;
    const supervisorParams = auth.role === 'supervisor' ? [auth.supervisor_id ?? -1] : [];

    const supervisorsRaw = db
      .prepare(
        `SELECT s.id, s.name,
                (SELECT COUNT(*) FROM supervisor_departments sd WHERE sd.supervisor_id = s.id) AS assigned_departments_count
         FROM supervisors s
         ${supervisorWhere}
         ORDER BY s.id ASC`
      )
      .all(...supervisorParams) as Array<{
      id: number;
      name: string;
      assigned_departments_count: number;
    }>;

    const supervisorReport = supervisorsRaw.map((sup) => {
      const supConditions = [...conditions, `r.supervisor_id = ?`];
      const supParams = [...params, sup.id];
      const stats = db
        .prepare(
          `SELECT COUNT(r.id) AS reports_executed_count,
                  COUNT(DISTINCT r.department_id) AS covered_departments_count,
                  COUNT(DISTINCT r.evaluation_date) AS active_days_count,
                  ROUND(AVG(r.overall_average), 2) AS departments_avg_score,
                  ROUND(AVG(r.overall_percentage), 2) AS departments_avg_percentage,
                  MAX(r.evaluation_date) AS last_report_date
           FROM reports r
           WHERE ${supConditions.join(' AND ')}`
        )
        .get(...supParams) as {
        reports_executed_count: number;
        covered_departments_count: number;
        active_days_count: number;
        departments_avg_score: number | null;
        departments_avg_percentage: number | null;
        last_report_date: string | null;
      };

      const deptBreakdown = db
        .prepare(
          `SELECT d.name AS department_name,
                  COUNT(r.id) AS reports_count,
                  ROUND(AVG(r.overall_average), 2) AS avg_score
           FROM reports r
           JOIN departments d ON d.id = r.department_id
           WHERE ${supConditions.join(' AND ')}
           GROUP BY d.id, d.name`
        )
        .all(...supParams);

      return {
        supervisorId: sup.id,
        supervisorName: sup.name,
        assignedDepartmentsCount: sup.assigned_departments_count,
        reportsExecutedCount: stats.reports_executed_count,
        coveredDepartmentsCount: stats.covered_departments_count,
        activeDaysCount: stats.active_days_count,
        departmentsAvgScore: stats.departments_avg_score,
        departmentsAvgPercentage: stats.departments_avg_percentage,
        lastReportDate: stats.last_report_date,
        departmentBreakdown: deptBreakdown,
      };
    });

    const recurringIssues = db
      .prepare(
        `SELECT d.name AS department_name, r.evaluation_date, r.report_number, r.notes_text, r.suggestions_text
         FROM reports r
         JOIN departments d ON d.id = r.department_id
         ${whereSql} AND (TRIM(r.notes_text) != '' OR TRIM(r.suggestions_text) != '')
         ORDER BY r.evaluation_date DESC, r.id DESC
         LIMIT 50`
      )
      .all(...params);

    res.json({
      period: { startDate, endDate },
      departmentPerformance,
      dailyTimeline,
      supervisorReport,
      recurringIssues,
    });
  });

  // Corrective Actions
  router.get('/corrective-actions', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const auth = req.authUser!;
    const today = getTodayDateString();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (auth.role === 'supervisor') {
      conditions.push(
        `ca.department_id IN (SELECT department_id FROM supervisor_departments WHERE supervisor_id = ?)`
      );
      params.push(auth.supervisor_id ?? -1);
    }
    if (typeof req.query.status === 'string' && req.query.status.trim()) {
      conditions.push(`ca.status = ?`);
      params.push(req.query.status.trim());
    }
    if (typeof req.query.departmentId === 'string' && req.query.departmentId.trim()) {
      conditions.push(`ca.department_id = ?`);
      params.push(Number(req.query.departmentId));
    }
    if (req.query.overdueOnly === '1') {
      conditions.push(`ca.status != 'completed' AND ca.target_date < ?`);
      params.push(today);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const actions = db
      .prepare(
        `SELECT ca.*, d.name AS department_name, r.report_number,
                cu.full_name AS created_by_name,
                CASE WHEN ca.status != 'completed' AND ca.target_date < ? THEN 1 ELSE 0 END AS is_overdue
         FROM corrective_actions ca
         JOIN departments d ON d.id = ca.department_id
         LEFT JOIN reports r ON r.id = ca.report_id
         JOIN users cu ON cu.id = ca.created_by_user_id
         ${whereSql}
         ORDER BY is_overdue DESC, ca.target_date ASC, ca.id DESC`
      )
      .all(today, ...params);

    res.json({ actions });
  });

  router.post(
    '/corrective-actions',
    requireAuth,
    requireRole('admin', 'production_manager'),
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.authUser!;
      const body = req.body as {
        reportId?: unknown;
        departmentId?: unknown;
        problemDescription?: unknown;
        rootCause?: unknown;
        requiredAction?: unknown;
        assignedTo?: unknown;
        recordedDate?: unknown;
        targetDate?: unknown;
        status?: unknown;
      };

      const departmentId = Number(body.departmentId);
      const reportId =
        body.reportId !== undefined && body.reportId !== null && Number(body.reportId) > 0
          ? Number(body.reportId)
          : null;
      const problemDescription =
        typeof body.problemDescription === 'string' ? body.problemDescription.trim() : '';
      const rootCause = typeof body.rootCause === 'string' ? body.rootCause.trim() : '';
      const requiredAction =
        typeof body.requiredAction === 'string' ? body.requiredAction.trim() : '';
      const assignedTo = typeof body.assignedTo === 'string' ? body.assignedTo.trim() : '';
      const recordedDate =
        typeof body.recordedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.recordedDate)
          ? body.recordedDate
          : getTodayDateString();
      const targetDate =
        typeof body.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)
          ? body.targetDate
          : getTodayDateString();
      const status =
        typeof body.status === 'string' &&
        ['new', 'in_progress', 'completed', 'not_resolved', 'needs_followup'].includes(body.status)
          ? body.status
          : 'new';

      if (!Number.isInteger(departmentId) || departmentId <= 0) {
        res.status(400).json({ error: 'يرجى تحديد القسم المعني' });
        return;
      }
      if (!problemDescription || !requiredAction || !assignedTo) {
        res.status(400).json({
          error: 'يرجى إدخال وصف المشكلة والإجراء المطلوب والشخص المسؤول عن التنفيذ',
        });
        return;
      }

      const now = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO corrective_actions (
             report_id, department_id, problem_description, root_cause, required_action,
             assigned_to, recorded_date, target_date, status, followup_notes, verification_result,
             created_by_user_id, updated_by_user_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?)`
        )
        .run(
          reportId,
          departmentId,
          problemDescription,
          rootCause,
          requiredAction,
          assignedTo,
          recordedDate,
          targetDate,
          status,
          auth.id,
          auth.id,
          now,
          now
        );

      const actionId = Number(info.lastInsertRowid);
      writeAuditLog(db, {
        userId: auth.id,
        username: auth.username,
        action: 'CREATE_CORRECTIVE_ACTION',
        entityType: 'corrective_action',
        entityId: actionId,
        details: `تسجيل إجراء تصحيحي #${actionId} للقسم #${departmentId}`,
      });

      res.status(201).json({ id: actionId });
    }
  );

  router.patch(
    '/corrective-actions/:id',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.authUser!;
      const actionId = Number(req.params.id);
      const existing = db
        .prepare(`SELECT * FROM corrective_actions WHERE id = ?`)
        .get(actionId) as
        | {
            id: number;
            department_id: number;
            problem_description: string;
            root_cause: string;
            required_action: string;
            assigned_to: string;
            target_date: string;
            status: string;
            followup_notes: string;
            verification_result: string;
          }
        | undefined;

      if (!existing) {
        res.status(404).json({ error: 'الإجراء التصحيحي غير موجود' });
        return;
      }

      const body = req.body as {
        problemDescription?: unknown;
        rootCause?: unknown;
        requiredAction?: unknown;
        assignedTo?: unknown;
        targetDate?: unknown;
        status?: unknown;
        followupNotes?: unknown;
        verificationResult?: unknown;
      };

      if (auth.role === 'supervisor') {
        const owns = db
          .prepare(
            `SELECT 1 FROM supervisor_departments WHERE supervisor_id = ? AND department_id = ?`
          )
          .get(auth.supervisor_id ?? -1, existing.department_id);
        if (!owns) {
          res.status(403).json({ error: 'غير مصرح لك بتحديث هذا الإجراء' });
          return;
        }
        // Supervisors can only update followupNotes and mark in_progress/needs_followup
        const followupNotes =
          typeof body.followupNotes === 'string'
            ? body.followupNotes.trim()
            : existing.followup_notes;
        const allowedStatus =
          body.status === 'in_progress' || body.status === 'needs_followup'
            ? body.status
            : existing.status;

        db.prepare(
          `UPDATE corrective_actions SET followup_notes = ?, status = ?, updated_by_user_id = ?, updated_at = ? WHERE id = ?`
        ).run(followupNotes, allowedStatus, auth.id, new Date().toISOString(), actionId);

        writeAuditLog(db, {
          userId: auth.id,
          username: auth.username,
          action: 'SUPERVISOR_UPDATE_ACTION',
          entityType: 'corrective_action',
          entityId: actionId,
          details: `تحديث متابعة المشرف للإجراء #${actionId}`,
        });

        res.json({ ok: true });
        return;
      }

      const problemDescription =
        typeof body.problemDescription === 'string' && body.problemDescription.trim()
          ? body.problemDescription.trim()
          : existing.problem_description;
      const rootCause =
        typeof body.rootCause === 'string' ? body.rootCause.trim() : existing.root_cause;
      const requiredAction =
        typeof body.requiredAction === 'string' && body.requiredAction.trim()
          ? body.requiredAction.trim()
          : existing.required_action;
      const assignedTo =
        typeof body.assignedTo === 'string' && body.assignedTo.trim()
          ? body.assignedTo.trim()
          : existing.assigned_to;
      const targetDate =
        typeof body.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)
          ? body.targetDate
          : existing.target_date;
      const status =
        typeof body.status === 'string' &&
        ['new', 'in_progress', 'completed', 'not_resolved', 'needs_followup'].includes(body.status)
          ? body.status
          : existing.status;
      const followupNotes =
        typeof body.followupNotes === 'string'
          ? body.followupNotes.trim()
          : existing.followup_notes;
      const verificationResult =
        typeof body.verificationResult === 'string'
          ? body.verificationResult.trim()
          : existing.verification_result;

      db.prepare(
        `UPDATE corrective_actions
         SET problem_description = ?, root_cause = ?, required_action = ?,
             assigned_to = ?, target_date = ?, status = ?,
             followup_notes = ?, verification_result = ?,
             updated_by_user_id = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        problemDescription,
        rootCause,
        requiredAction,
        assignedTo,
        targetDate,
        status,
        followupNotes,
        verificationResult,
        auth.id,
        new Date().toISOString(),
        actionId
      );

      writeAuditLog(db, {
        userId: auth.id,
        username: auth.username,
        action: 'UPDATE_CORRECTIVE_ACTION',
        entityType: 'corrective_action',
        entityId: actionId,
        details: `تحديث الإجراء التصحيحي #${actionId} (الحالة: ${status})`,
      });

      res.json({ ok: true });
    }
  );

  // Admin: Users & Supervisors Management
  router.get(
    '/admin/users',
    requireAuth,
    requireRole('admin'),
    (_req: AuthenticatedRequest, res: Response) => {
      const users = db
        .prepare(
          `SELECT u.id, u.username, u.full_name, u.role, u.is_active, u.can_edit_approved,
                  CASE WHEN u.password_hash IS NOT NULL THEN 1 ELSE 0 END AS has_password,
                  s.id AS supervisor_id, s.phone, u.created_at
           FROM users u
           LEFT JOIN supervisors s ON s.user_id = u.id
           ORDER BY u.id ASC`
        )
        .all() as Array<{
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
      }>;

      const assignments = db
        .prepare(
          `SELECT sd.supervisor_id, sd.department_id, d.name AS department_name
           FROM supervisor_departments sd
           JOIN departments d ON d.id = sd.department_id`
        )
        .all() as Array<{ supervisor_id: number; department_id: number; department_name: string }>;

      const result = users.map((u) => ({
        ...u,
        departments: u.supervisor_id
          ? assignments.filter((a) => a.supervisor_id === u.supervisor_id)
          : [],
      }));

      res.json({ users: result });
    }
  );

  router.post(
    '/admin/users',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.authUser!;
      const body = req.body as {
        username?: unknown;
        fullName?: unknown;
        role?: unknown;
        password?: unknown;
        phone?: unknown;
        canEditApproved?: unknown;
        departmentIds?: unknown;
      };

      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
      const role: UserRole =
        body.role === 'admin' || body.role === 'production_manager' || body.role === 'supervisor'
          ? body.role
          : 'supervisor';
      const password = typeof body.password === 'string' ? body.password : '';
      const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
      const canEditApproved = body.canEditApproved === true ? 1 : 0;
      const departmentIds = Array.isArray(body.departmentIds)
        ? body.departmentIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
        : [];

      if (!username || username.length < 3) {
        res.status(400).json({ error: 'اسم المستخدم يجب أن لا يقل عن 3 أحرف' });
        return;
      }
      if (!fullName) {
        res.status(400).json({ error: 'الاسم الكامل مطلوب' });
        return;
      }
      if (!password || password.length < 6) {
        res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 6 أحرف' });
        return;
      }

      try {
        const createdId = db.transaction(() => {
          const now = new Date().toISOString();
          const hash = hashPassword(password);
          const userInfo = db
            .prepare(
              `INSERT INTO users (username, full_name, role, password_hash, is_active, can_edit_approved, created_at, updated_at)
               VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
            )
            .run(username, fullName, role, hash, canEditApproved, now, now);

          const userId = Number(userInfo.lastInsertRowid);

          if (role === 'supervisor') {
            const supInfo = db
              .prepare(
                `INSERT INTO supervisors (user_id, name, phone, notes, is_active, created_at)
                 VALUES (?, ?, ?, '', 1, ?)`
              )
              .run(userId, fullName, phone, now);
            const supId = Number(supInfo.lastInsertRowid);

            for (const deptId of departmentIds) {
              db.prepare(`DELETE FROM supervisor_departments WHERE department_id = ?`).run(deptId);
              db.prepare(
                `INSERT INTO supervisor_departments (supervisor_id, department_id, assigned_at)
                 VALUES (?, ?, ?)`
              ).run(supId, deptId, now);
            }
          }

          writeAuditLog(db, {
            userId: auth.id,
            username: auth.username,
            action: 'CREATE_USER',
            entityType: 'user',
            entityId: userId,
            details: `إنشاء حساب (${username}) بدور ${role}`,
          });

          return userId;
        })();

        res.status(201).json({ id: createdId });
      } catch {
        res.status(400).json({ error: 'اسم المستخدم مسجل مسبقًا' });
      }
    }
  );

  router.patch(
    '/admin/users/:id',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.authUser!;
      const userId = Number(req.params.id);
      const existing = db
        .prepare(
          `SELECT u.*, s.id AS supervisor_id
           FROM users u
           LEFT JOIN supervisors s ON s.user_id = u.id
           WHERE u.id = ?`
        )
        .get(userId) as
        | {
            id: number;
            username: string;
            full_name: string;
            role: UserRole;
            is_active: number;
            can_edit_approved: number;
            supervisor_id: number | null;
          }
        | undefined;

      if (!existing) {
        res.status(404).json({ error: 'المستخدم غير موجود' });
        return;
      }

      const body = req.body as {
        fullName?: unknown;
        role?: unknown;
        isActive?: unknown;
        canEditApproved?: unknown;
        password?: unknown;
        phone?: unknown;
        departmentIds?: unknown;
      };

      const fullName =
        typeof body.fullName === 'string' && body.fullName.trim()
          ? body.fullName.trim()
          : existing.full_name;
      const role: UserRole =
        body.role === 'admin' || body.role === 'production_manager' || body.role === 'supervisor'
          ? body.role
          : existing.role;
      const isActive =
        typeof body.isActive === 'boolean' ? (body.isActive ? 1 : 0) : existing.is_active;
      const canEditApproved =
        typeof body.canEditApproved === 'boolean'
          ? body.canEditApproved
            ? 1
            : 0
          : existing.can_edit_approved;
      const phone = typeof body.phone === 'string' ? body.phone.trim() : '';

      if (existing.id === auth.id && isActive === 0) {
        res.status(400).json({ error: 'لا يمكنك تعطيل حسابك الحالي أثناء تسجيل الدخول' });
        return;
      }

      if (typeof body.password === 'string' && body.password.length > 0 && body.password.length < 6) {
        res.status(400).json({ error: 'كلمة المرور يجب أن لا تقل عن 6 أحرف' });
        return;
      }

      db.transaction(() => {
        const now = new Date().toISOString();
        if (typeof body.password === 'string' && body.password.length >= 6) {
          db.prepare(
            `UPDATE users SET full_name = ?, role = ?, is_active = ?, can_edit_approved = ?, password_hash = ?, updated_at = ?
             WHERE id = ?`
          ).run(fullName, role, isActive, canEditApproved, hashPassword(body.password), now, userId);
        } else {
          db.prepare(
            `UPDATE users SET full_name = ?, role = ?, is_active = ?, can_edit_approved = ?, updated_at = ?
             WHERE id = ?`
          ).run(fullName, role, isActive, canEditApproved, now, userId);
        }

        let supId = existing.supervisor_id;
        if (role === 'supervisor') {
          if (!supId) {
            const supInfo = db
              .prepare(
                `INSERT INTO supervisors (user_id, name, phone, notes, is_active, created_at)
                 VALUES (?, ?, ?, '', ?, ?)`
              )
              .run(userId, fullName, phone, isActive, now);
            supId = Number(supInfo.lastInsertRowid);
          } else {
            db.prepare(
              `UPDATE supervisors SET name = ?, phone = ?, is_active = ? WHERE id = ?`
            ).run(fullName, phone, isActive, supId);
          }

          if (Array.isArray(body.departmentIds)) {
            const deptIds = body.departmentIds
              .map(Number)
              .filter((n) => Number.isInteger(n) && n > 0);
            db.prepare(`DELETE FROM supervisor_departments WHERE supervisor_id = ?`).run(supId);
            for (const deptId of deptIds) {
              db.prepare(`DELETE FROM supervisor_departments WHERE department_id = ?`).run(deptId);
              db.prepare(
                `INSERT INTO supervisor_departments (supervisor_id, department_id, assigned_at)
                 VALUES (?, ?, ?)`
              ).run(supId, deptId, now);
            }
          }
        } else if (supId) {
          db.prepare(`UPDATE supervisors SET is_active = 0 WHERE id = ?`).run(supId);
        }

        writeAuditLog(db, {
          userId: auth.id,
          username: auth.username,
          action: 'UPDATE_USER',
          entityType: 'user',
          entityId: userId,
          details: `تحديث بيانات المستخدم: ${fullName} (${existing.username})`,
        });
      })();

      res.json({ ok: true });
    }
  );

  // Batch activate pending accounts with admin-supplied initial password
  router.post(
    '/admin/users/activate-pending',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.authUser!;
      const body = req.body as { initialPassword?: unknown };
      const initialPassword =
        typeof body.initialPassword === 'string' ? body.initialPassword : '';
      if (initialPassword.length < 6) {
        res.status(400).json({ error: 'كلمة المرور المبدئية يجب أن لا تقل عن 6 أحرف' });
        return;
      }

      const now = new Date().toISOString();
      const pendingUsers = db
        .prepare(`SELECT id, username FROM users WHERE password_hash IS NULL`)
        .all() as Array<{ id: number; username: string }>;

      db.transaction(() => {
        for (const u of pendingUsers) {
          db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(
            hashPassword(initialPassword),
            now,
            u.id
          );
        }
        writeAuditLog(db, {
          userId: auth.id,
          username: auth.username,
          action: 'ACTIVATE_PENDING_USERS',
          entityType: 'user',
          entityId: 'batch',
          details: `تفعيل ${pendingUsers.length} حسابات معلقة بكلمة مرور مبدئية`,
        });
      })();

      res.json({ activatedCount: pendingUsers.length });
    }
  );

  // Admin: Update Rating Thresholds
  router.put(
    '/admin/settings/thresholds',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.authUser!;
      const body = req.body as { thresholds?: unknown; restaurantName?: unknown };

      if (!Array.isArray(body.thresholds) || body.thresholds.length === 0) {
        res.status(400).json({ error: 'قائمة التصنيفات غير صالحة' });
        return;
      }

      const cleaned: RatingThreshold[] = body.thresholds.map((item: unknown, idx: number) => {
        const obj = item as Record<string, unknown>;
        return {
          id: typeof obj.id === 'string' && obj.id ? obj.id : `tier_${idx}`,
          label: typeof obj.label === 'string' && obj.label.trim() ? obj.label.trim() : `تصنيف ${idx + 1}`,
          minScore: Number(obj.minScore) || 0,
          color: typeof obj.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(obj.color) ? obj.color : '#0F766E',
        };
      });

      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ('rating_thresholds', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(JSON.stringify(cleaned), now);

      if (typeof body.restaurantName === 'string' && body.restaurantName.trim()) {
        db.prepare(
          `INSERT INTO system_settings (key, value, updated_at)
           VALUES ('restaurant_name', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        ).run(body.restaurantName.trim(), now);
      }

      writeAuditLog(db, {
        userId: auth.id,
        username: auth.username,
        action: 'UPDATE_THRESHOLDS',
        entityType: 'system_settings',
        entityId: 'rating_thresholds',
        details: 'تحديث حدود تصنيفات الأداء وإعدادات النظام',
      });

      res.json({ ok: true, thresholds: cleaned });
    }
  );

  // Admin: Audit Logs
  router.get(
    '/admin/audit-logs',
    requireAuth,
    requireRole('admin'),
    (_req: AuthenticatedRequest, res: Response) => {
      const logs = db
        .prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 250`)
        .all();
      res.json({ logs });
    }
  );

  // Admin: Full Database Backup (JSON)
  router.get(
    '/admin/backup',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.authUser!;
      const startDate =
        typeof req.query.startDate === 'string' && req.query.startDate.trim()
          ? req.query.startDate.trim()
          : null;
      const endDate =
        typeof req.query.endDate === 'string' && req.query.endDate.trim()
          ? req.query.endDate.trim()
          : null;

      const reportsQuery =
        startDate && endDate
          ? db
              .prepare(
                `SELECT * FROM reports WHERE evaluation_date >= ? AND evaluation_date <= ? ORDER BY id ASC`
              )
              .all(startDate, endDate)
          : db.prepare(`SELECT * FROM reports ORDER BY id ASC`).all();

      const reportIds = (reportsQuery as Array<{ id: number }>).map((r) => r.id);
      const idFilter =
        reportIds.length > 0 ? `WHERE report_id IN (${reportIds.map(() => '?').join(',')})` : 'WHERE 1=0';

      const payload = {
        backupVersion: 1,
        exportedAt: new Date().toISOString(),
        exportedBy: auth.username,
        periodFilter: startDate && endDate ? { startDate, endDate } : null,
        tables: {
          system_settings: db.prepare(`SELECT * FROM system_settings`).all(),
          users: db.prepare(`SELECT * FROM users ORDER BY id ASC`).all(),
          supervisors: db.prepare(`SELECT * FROM supervisors ORDER BY id ASC`).all(),
          departments: db.prepare(`SELECT * FROM departments ORDER BY id ASC`).all(),
          supervisor_departments: db
            .prepare(`SELECT * FROM supervisor_departments ORDER BY id ASC`)
            .all(),
          evaluation_criteria: db.prepare(`SELECT * FROM evaluation_criteria ORDER BY id ASC`).all(),
          report_counters: db.prepare(`SELECT * FROM report_counters`).all(),
          reports: reportsQuery,
          criteria_snapshots:
            reportIds.length > 0
              ? db
                  .prepare(`SELECT * FROM criteria_snapshots ${idFilter} ORDER BY id ASC`)
                  .all(...reportIds)
              : [],
          report_scores:
            reportIds.length > 0
              ? db
                  .prepare(`SELECT * FROM report_scores ${idFilter} ORDER BY id ASC`)
                  .all(...reportIds)
              : [],
          report_notes:
            reportIds.length > 0
              ? db
                  .prepare(`SELECT * FROM report_notes ${idFilter} ORDER BY id ASC`)
                  .all(...reportIds)
              : [],
          corrective_actions:
            startDate && endDate
              ? db
                  .prepare(
                    `SELECT * FROM corrective_actions WHERE recorded_date >= ? AND recorded_date <= ? ORDER BY id ASC`
                  )
                  .all(startDate, endDate)
              : db.prepare(`SELECT * FROM corrective_actions ORDER BY id ASC`).all(),
          audit_logs: db.prepare(`SELECT * FROM audit_logs ORDER BY id ASC`).all(),
        },
      };

      writeAuditLog(db, {
        userId: auth.id,
        username: auth.username,
        action: 'EXPORT_BACKUP',
        entityType: 'database',
        entityId: 'full',
        details: 'إنشاء وتنزيل نسخة احتياطية كاملة لقاعدة البيانات',
      });

      res.json(payload);
    }
  );

  // Admin: Restore Backup
  router.post(
    '/admin/restore',
    requireAuth,
    requireRole('admin'),
    (req: AuthenticatedRequest, res: Response) => {
      const auth = req.authUser!;
      const body = req.body as {
        backupVersion?: unknown;
        periodFilter?: unknown;
        tables?: Record<string, Array<Record<string, unknown>>>;
      };

      if (!body || body.backupVersion !== 1 || !body.tables || typeof body.tables !== 'object') {
        res.status(400).json({ error: 'ملف النسخة الاحتياطية غير صالح' });
        return;
      }
      if (body.periodFilter) {
        res.status(400).json({
          error: 'لا يمكن الاستعادة من نسخة فترة جزئية؛ يرجى استخدام نسخة احتياطية كاملة',
        });
        return;
      }

      const t = body.tables;
      const requiredTables = [
        'system_settings',
        'users',
        'supervisors',
        'departments',
        'supervisor_departments',
        'evaluation_criteria',
        'report_counters',
        'reports',
        'criteria_snapshots',
        'report_scores',
        'report_notes',
        'corrective_actions',
      ];
      for (const name of requiredTables) {
        if (!Array.isArray(t[name])) {
          res.status(400).json({ error: `النسخة الاحتياطية تفتقد جدول: ${name}` });
          return;
        }
      }

      try {
        db.pragma('foreign_keys = OFF');
        db.transaction(() => {
          const deleteOrder = [
            'audit_logs',
            'corrective_actions',
            'report_notes',
            'report_scores',
            'criteria_snapshots',
            'reports',
            'report_counters',
            'evaluation_criteria',
            'supervisor_departments',
            'departments',
            'supervisors',
            'users',
            'system_settings',
          ];
          for (const tbl of deleteOrder) {
            db.prepare(`DELETE FROM ${tbl}`).run();
          }

          const insertRows = (tbl: string, rows: Array<Record<string, unknown>>) => {
            if (rows.length === 0) return;
            const cols = Object.keys(rows[0]!).filter((c) => /^[a-zA-Z0-9_]+$/.test(c));
            const placeholders = cols.map(() => '?').join(',');
            const stmt = db.prepare(
              `INSERT INTO ${tbl} (${cols.join(',')}) VALUES (${placeholders})`
            );
            for (const row of rows) {
              stmt.run(...cols.map((c) => row[c] ?? null));
            }
          };

          insertRows('system_settings', t.system_settings ?? []);
          insertRows('users', t.users ?? []);
          insertRows('supervisors', t.supervisors ?? []);
          insertRows('departments', t.departments ?? []);
          insertRows('supervisor_departments', t.supervisor_departments ?? []);
          insertRows('evaluation_criteria', t.evaluation_criteria ?? []);
          insertRows('report_counters', t.report_counters ?? []);
          insertRows('reports', t.reports ?? []);
          insertRows('criteria_snapshots', t.criteria_snapshots ?? []);
          insertRows('report_scores', t.report_scores ?? []);
          insertRows('report_notes', t.report_notes ?? []);
          insertRows('corrective_actions', t.corrective_actions ?? []);
          insertRows('audit_logs', t.audit_logs ?? []);

          writeAuditLog(db, {
            userId: auth.id,
            username: auth.username,
            action: 'RESTORE_BACKUP',
            entityType: 'database',
            entityId: 'full',
            details: 'استعادة كاملة لقاعدة البيانات من نسخة احتياطية',
          });
        })();
      } catch (err) {
        db.pragma('foreign_keys = ON');
        res.status(400).json({
          error: err instanceof Error ? err.message : 'فشلت عملية استعادة النسخة الاحتياطية',
        });
        return;
      }

      db.pragma('foreign_keys = ON');
      res.json({ ok: true });
    }
  );

  // Multer & API error handler
  router.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: 'حجم الملف يتجاوز الحد المسموح (5 ميجابايت)' });
      return;
    }
    res.status(400).json({
      error: err instanceof Error ? err.message : 'حدث خطأ غير متوقع في الخادم',
    });
  });

  return router;
}
