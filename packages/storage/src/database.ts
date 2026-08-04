import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { STORAGE_PATHS } from '@lambda128/shared';

/**
 * SQLite database manager.
 * Creates and manages the database connection with WAL mode for better concurrency.
 */
export class DatabaseManager {
  private db: Database.Database;
  private dbPath: string;

  constructor(storageDir: string) {
    const baseDir = path.join(storageDir, STORAGE_PATHS.BASE_DIR);
    fs.mkdirSync(baseDir, { recursive: true });

    this.dbPath = path.join(baseDir, STORAGE_PATHS.DB_FILE);
    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  getPath(): string {
    return this.dbPath;
  }

  /**
   * Run migrations to set up the initial schema.
   */
  runMigrations(): void {
    this.db.exec(`
      -- Conversations table
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived INTEGER DEFAULT 0,
        metadata TEXT
      );

      -- Messages table
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT,
        tool_calls TEXT,
        tool_call_id TEXT,
        token_usage TEXT,
        created_at INTEGER NOT NULL,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

      -- Agent sessions table
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        objective TEXT,
        plan TEXT,
        current_step INTEGER DEFAULT 0,
        max_steps INTEGER DEFAULT 25,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        metadata TEXT
      );

      -- Tool executions audit log
      CREATE TABLE IF NOT EXISTS tool_executions (
        id TEXT PRIMARY KEY,
        agent_session_id TEXT REFERENCES agent_sessions(id),
        conversation_id TEXT REFERENCES conversations(id),
        tool_id TEXT NOT NULL,
        parameters TEXT NOT NULL,
        result TEXT,
        status TEXT NOT NULL,
        duration_ms INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tool_exec_session ON tool_executions(agent_session_id);

      -- Patches table
      CREATE TABLE IF NOT EXISTS patches (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        agent_session_id TEXT REFERENCES agent_sessions(id),
        file_path TEXT NOT NULL,
        original_content TEXT,
        new_content TEXT,
        diff TEXT NOT NULL,
        status TEXT NOT NULL,
        hunks_json TEXT,
        created_at INTEGER NOT NULL,
        applied_at INTEGER
      );

      -- Workspace metadata cache
      CREATE TABLE IF NOT EXISTS workspace_meta (
        workspace_path TEXT PRIMARY KEY,
        project_name TEXT,
        languages TEXT,
        frameworks TEXT,
        file_count INTEGER,
        last_indexed_at INTEGER,
        metadata TEXT
      );

      -- User settings
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Recent projects
      CREATE TABLE IF NOT EXISTS recent_projects (
        path TEXT PRIMARY KEY,
        last_opened_at INTEGER NOT NULL,
        conversation_count INTEGER DEFAULT 0
      );
    `);
  }

  close(): void {
    this.db.close();
  }
}