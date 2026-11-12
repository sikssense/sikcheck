import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

// 로컬 MVP용 SQLite. 공유 서비스로 올릴 때 Postgres로 교체한다.
const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "crosscheck.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  site_url TEXT NOT NULL DEFAULT '',
  env TEXT NOT NULL DEFAULT 'dev',
  figma_links TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  prev_round_id TEXT REFERENCES rounds(id),
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(id),
  seq INTEGER NOT NULL,
  scope TEXT NOT NULL DEFAULT '전체',
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(id),
  run_id TEXT REFERENCES runs(id),
  screen_id TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT '보통',
  title TEXT NOT NULL,
  expected TEXT NOT NULL DEFAULT '',
  actual TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  judge TEXT NOT NULL DEFAULT 'ai',
  confidence REAL,
  verdict TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT '신규',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS mappings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  screen_key TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  confidence REAL,
  reason TEXT NOT NULL DEFAULT '',
  confirmed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (project_id, screen_key)
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  actions TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  round_id TEXT REFERENCES rounds(id),
  question TEXT NOT NULL,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

// 기존 DB에 컬럼을 추가하는 변경. 이미 있으면 무시한다.
const MIGRATIONS = [
  "ALTER TABLE runs ADD COLUMN progress TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE runs ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0",
  "ALTER TABLE runs ADD COLUMN error TEXT",
  "ALTER TABLE runs ADD COLUMN model TEXT",
  "ALTER TABLE runs ADD COLUMN phase TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE runs ADD COLUMN done INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE runs ADD COLUMN total INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE runs ADD COLUMN screens TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE runs ADD COLUMN title TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE findings ADD COLUMN source TEXT NOT NULL DEFAULT 'ai'",
  "ALTER TABLE findings ADD COLUMN note TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE questions ADD COLUMN screen_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE questions ADD COLUMN run_id TEXT",
];

function migrate(db: DatabaseSync) {
  db.exec(SCHEMA);
  for (const sql of MIGRATIONS) {
    try {
      db.exec(sql);
    } catch {
      // duplicate column: 이미 적용됨
    }
  }
}

const globalForDb = globalThis as unknown as { __ccDb?: DatabaseSync; __ccSchema?: string };

function open(): DatabaseSync {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(db);
  const ws = db.prepare("SELECT COUNT(*) AS n FROM workspaces").get() as { n: number };
  if (ws.n === 0) {
    db.prepare("INSERT INTO workspaces (id, name) VALUES (?, ?)").run("ws-personal", "개인");
  }
  return db;
}

// 처음 쓸 때 연다. 빌드 시 여러 작업자가 동시에 열지 않게 하고,
// dev 서버의 핫 리로드 때마다 연결이 새로 열리지 않도록 전역에 보관
export function getDb(): DatabaseSync {
  const db = globalForDb.__ccDb ?? (globalForDb.__ccDb = open());
  // 개발 중 스키마에 테이블이 추가되면 열린 연결에도 다시 적용
  const version = SCHEMA + MIGRATIONS.join(";");
  if (globalForDb.__ccSchema !== version) {
    migrate(db);
    globalForDb.__ccSchema = version;
  }
  return db;
}

export const newId = () => crypto.randomUUID();
