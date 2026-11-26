import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DEFAULT_RATING_THRESHOLDS } from './calculations.ts';
import { SEED_DEPARTMENTS, SEED_SUPERVISORS } from './seedData.ts';
import type { RatingThreshold } from './types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const DB_PATH = path.join(DATA_DIR, 'almadhaq.db');

export function getUploadsDir(): string {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  return UPLOADS_DIR;
}

export function initDatabase(): Database.Database {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  getUploadsDir();

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'production_manager', 'supervisor')),
      password_hash TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      can_edit_approved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supervisors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      criteria_count INTEGER NOT NULL DEFAULT 9,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supervisor_departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supervisor_id INTEGER NOT NULL REFERENCES supervisors(id) ON DELETE CASCADE,
      department_id INTEGER NOT NULL UNIQUE REFERENCES departments(id) ON DELETE CASCADE,
      assigned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evaluation_criteria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      is_required INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS report_counters (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      last_seq INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_number TEXT NOT NULL UNIQUE,
      evaluation_date TEXT NOT NULL,
      evaluation_time TEXT NOT NULL,
      shift TEXT NOT NULL CHECK(shift IN ('morning', 'evening')),
      department_id INTEGER NOT NULL REFERENCES departments(id),
      supervisor_id INTEGER NOT NULL REFERENCES supervisors(id),
      created_by_user_id INTEGER NOT NULL REFERENCES users(id),
      updated_by_user_id INTEGER NOT NULL REFERENCES users(id),
      criteria_average REAL NOT NULL,
      discipline_score REAL NOT NULL CHECK(discipline_score >= 0 AND discipline_score <= 10),
      overall_average REAL NOT NULL,
      overall_percentage REAL NOT NULL,
      rating_label TEXT NOT NULL,
      rating_color TEXT NOT NULL,
      notes_text TEXT NOT NULL DEFAULT '',
      suggestions_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('draft', 'submitted', 'under_review', 'approved', 'needs_corrective_action')),
      reviewed_by_user_id INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      review_comment TEXT NOT NULL DEFAULT '',
      client_submission_token TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS criteria_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      original_criterion_id INTEGER REFERENCES evaluation_criteria(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      is_required INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS report_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      snapshot_criterion_id INTEGER NOT NULL REFERENCES criteria_snapshots(id) ON DELETE CASCADE,
      score REAL CHECK(score IS NULL OR (score >= 0 AND score <= 10))
    );

    CREATE TABLE IF NOT EXISTS report_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      department_id INTEGER NOT NULL REFERENCES departments(id),
      note_type TEXT NOT NULL CHECK(note_type IN ('observation', 'issue', 'suggestion')),
      content TEXT NOT NULL,
      attachment_path TEXT,
      attachment_name TEXT,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS corrective_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER REFERENCES reports(id) ON DELETE SET NULL,
      note_id INTEGER REFERENCES report_notes(id) ON DELETE SET NULL,
      department_id INTEGER NOT NULL REFERENCES departments(id),
      problem_description TEXT NOT NULL,
      root_cause TEXT NOT NULL,
      required_action TEXT NOT NULL,
      assigned_to TEXT NOT NULL,
      recorded_date TEXT NOT NULL,
      target_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('new', 'in_progress', 'completed', 'not_resolved', 'needs_followup')),
      followup_notes TEXT NOT NULL DEFAULT '',
      verification_result TEXT NOT NULL DEFAULT '',
      created_by_user_id INTEGER NOT NULL REFERENCES users(id),
      updated_by_user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  seedInitialConfiguration(db);
  return db;
}

function seedInitialConfiguration(db: Database.Database): void {
  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO report_counters (id, last_seq) VALUES (1, 0)`).run();

    db.prepare(
      `INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)`
    ).run('rating_thresholds', JSON.stringify(DEFAULT_RATING_THRESHOLDS), now);

    db.prepare(
      `INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)`
    ).run('restaurant_name', 'مطاعم المذاق اليمني – صالة الإنتاج', now);

    // Ensure baseline Admin and Production Manager accounts exist (unclaimed until password set)
    const userCountRow = db.prepare(`SELECT COUNT(*) AS cnt FROM users`).get() as { cnt: number };
    if (userCountRow.cnt === 0) {
      db.prepare(
        `INSERT INTO users (username, full_name, role, password_hash, is_active, can_edit_approved, created_at, updated_at)
         VALUES (?, ?, 'admin', NULL, 1, 1, ?, ?)`
      ).run('admin', 'مدير النظام', now, now);

      db.prepare(
        `INSERT INTO users (username, full_name, role, password_hash, is_active, can_edit_approved, created_at, updated_at)
         VALUES (?, ?, 'production_manager', NULL, 1, 0, ?, ?)`
      ).run('prod_manager', 'مسؤول الإنتاج', now, now);
    }

    // Seed the 4 Supervisors only if supervisors table is empty
    const supCountRow = db.prepare(`SELECT COUNT(*) AS cnt FROM supervisors`).get() as { cnt: number };
    const supervisorIdByUsername = new Map<string, number>();

    if (supCountRow.cnt === 0) {
      for (const sup of SEED_SUPERVISORS) {
        db.prepare(
          `INSERT OR IGNORE INTO users (username, full_name, role, password_hash, is_active, can_edit_approved, created_at, updated_at)
           VALUES (?, ?, 'supervisor', NULL, 1, 0, ?, ?)`
        ).run(sup.username, sup.fullName, now, now);

        const userRow = db
          .prepare(`SELECT id FROM users WHERE username = ?`)
          .get(sup.username) as { id: number };

        const info = db
          .prepare(
            `INSERT INTO supervisors (user_id, name, phone, notes, is_active, created_at)
             VALUES (?, ?, ?, '', 1, ?)`
          )
          .run(userRow.id, sup.fullName, sup.phone, now);

        supervisorIdByUsername.set(sup.username, Number(info.lastInsertRowid));
      }
    }

    // Seed the 19 Departments and their 9 specialized criteria each only if departments table is empty
    const deptCountRow = db.prepare(`SELECT COUNT(*) AS cnt FROM departments`).get() as { cnt: number };
    if (deptCountRow.cnt === 0) {
      for (const dept of SEED_DEPARTMENTS) {
        const deptInfo = db
          .prepare(
            `INSERT INTO departments (code, name, criteria_count, is_active, created_at, updated_at)
             VALUES (?, ?, ?, 1, ?, ?)`
          )
          .run(dept.code, dept.name, dept.criteria.length, now, now);

        const deptId = Number(deptInfo.lastInsertRowid);
        const supId = supervisorIdByUsername.get(dept.supervisorUsername);
        if (supId) {
          db.prepare(
            `INSERT INTO supervisor_departments (supervisor_id, department_id, assigned_at)
             VALUES (?, ?, ?)`
          ).run(supId, deptId, now);
        }

        dept.criteria.forEach((criterion, index) => {
          db.prepare(
            `INSERT INTO evaluation_criteria (department_id, name, description, sort_order, is_required, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
          ).run(
            deptId,
            criterion.name,
            criterion.description,
            index + 1,
            criterion.is_required ? 1 : 0,
            now,
            now
          );
        });
      }
    }
  })();
}

export function getRatingThresholds(db: Database.Database): RatingThreshold[] {
  const row = db
    .prepare(`SELECT value FROM system_settings WHERE key = 'rating_thresholds'`)
    .get() as { value: string } | undefined;
  if (!row) {
    return DEFAULT_RATING_THRESHOLDS;
  }
  try {
    const parsed = JSON.parse(row.value) as RatingThreshold[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_RATING_THRESHOLDS;
  } catch {
    return DEFAULT_RATING_THRESHOLDS;
  }
}

export function writeAuditLog(
  db: Database.Database,
  params: {
    userId: number | null;
    username: string;
    action: string;
    entityType: string;
    entityId: string | number;
    details: string;
  }
): void {
  db.prepare(
    `INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.userId,
    params.username,
    params.action,
    params.entityType,
    String(params.entityId),
    params.details,
    new Date().toISOString()
  );
}
