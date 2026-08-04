import type Database from 'better-sqlite3';
import type { Conversation, StoredMessage } from '@lambda128/shared';
import { randomUUID } from 'node:crypto';

export class ConversationRepository {
  constructor(private db: Database.Database) {}

  create(workspacePath: string, title?: string): Conversation {
    const id = randomUUID();
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, workspace_path, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, workspacePath, title || 'New Conversation', now, now);

    return {
      id,
      workspacePath,
      title: title || 'New Conversation',
      createdAt: now,
      updatedAt: now,
      archived: false,
    };
  }

  getById(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToConversation(row);
  }

  listByWorkspace(workspacePath: string): Conversation[] {
    const rows = this.db.prepare(
      'SELECT * FROM conversations WHERE workspace_path = ? AND archived = 0 ORDER BY updated_at DESC'
    ).all(workspacePath) as any[];
    return rows.map((r: any) => this.rowToConversation(r));
  }

  updateTitle(id: string, title: string): void {
    this.db.prepare(
      'UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?'
    ).run(title, Date.now(), id);
  }

  touch(id: string): void {
    this.db.prepare(
      'UPDATE conversations SET updated_at = ? WHERE id = ?'
    ).run(Date.now(), id);
  }

  archive(id: string): void {
    this.db.prepare(
      'UPDATE conversations SET archived = 1, updated_at = ? WHERE id = ?'
    ).run(Date.now(), id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  }

  private rowToConversation(row: any): Conversation {
    return {
      id: row.id,
      workspacePath: row.workspace_path,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archived: Boolean(row.archived),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}

export class MessageRepository {
  constructor(private db: Database.Database) {}

  create(message: Omit<StoredMessage, 'createdAt'>): StoredMessage {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, token_usage, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id, message.conversationId, message.role, message.content,
      message.toolCalls || null, message.toolCallId || null,
      message.tokenUsage || null, now
    );

    return { ...message, createdAt: now };
  }

  getByConversation(conversationId: string): StoredMessage[] {
    const rows = this.db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).all(conversationId) as any[];
    return rows.map((r: any) => this.rowToMessage(r));
  }

  getRecentByConversation(conversationId: string, limit: number): StoredMessage[] {
    const rows = this.db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(conversationId, limit) as any[];
    return rows.reverse().map((r: any) => this.rowToMessage(r));
  }

  deleteByConversation(conversationId: string): void {
    this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
  }

  private rowToMessage(row: any): StoredMessage {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      toolCalls: row.tool_calls,
      toolCallId: row.tool_call_id,
      tokenUsage: row.token_usage,
      createdAt: row.created_at,
    };
  }
}