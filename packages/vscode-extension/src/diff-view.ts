/**
 * Diff Viewer — VS Code extension integration for AI-generated patches.
 * 
 * Renders side-by-side diffs using VS Code's built-in diff editor.
 * Supports approve/reject per-hunk and full undo via checkpoint restore.
 * 
 * @see Continue.dev: gui/src/components/diff/ (patterns studied)
 */
import * as vscode from 'vscode';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
  approved: boolean;
}

export interface PatchFile {
  id: string;
  filePath: string;
  originalContent: string;
  newContent: string;
  hunks: DiffHunk[];
  status: 'pending' | 'approved' | 'applied' | 'rejected';
}

export interface PatchSession {
  id: string;
  conversationId: string;
  files: PatchFile[];
  status: 'pending' | 'approved' | 'applied' | 'rejected';
  createdAt: number;
}

/**
 * Diff Viewer Manager: handles the lifecycle of AI-generated patches.
 * 
 * Workflow:
 * 1. Agent generates edits → createPatchSession()
 * 2. User sees diff in VS Code diff editor → showDiff()
 * 3. User approves/rejects → approveFile() / rejectFile()
 * 4. Approved patches applied → applyApproved()
 * 5. Undo via checkpoint restore → undo()
 */
export class DiffViewManager {
  private patches: Map<string, PatchSession> = new Map();
  private tempDir: string;
  private onApplyCallback?: (filePath: string, content: string) => Promise<void>;
  private onUndoCallback?: (filePath: string) => Promise<void>;

  constructor(storageDir: string) {
    this.tempDir = join(storageDir, '.lambda128', 'patches');
    mkdirSync(this.tempDir, { recursive: true });
  }

  /**
   * Set callback for applying approved patches.
   */
  onApply(callback: (filePath: string, content: string) => Promise<void>): void {
    this.onApplyCallback = callback;
  }

  /**
   * Set callback for undoing applied patches.
   */
  onUndo(callback: (filePath: string) => Promise<void>): void {
    this.onUndoCallback = callback;
  }

  /**
   * Create a new patch session from AI-generated edits.
   */
  createPatchSession(
    conversationId: string,
    edits: Array<{ filePath: string; originalContent: string; newContent: string }>
  ): PatchSession {
    const session: PatchSession = {
      id: randomUUID(),
      conversationId,
      files: edits.map(e => ({
        id: randomUUID(),
        filePath: e.filePath,
        originalContent: e.originalContent,
        newContent: e.newContent,
        hunks: this.computeHunks(e.originalContent, e.newContent),
        status: 'pending' as const,
      })),
      status: 'pending',
      createdAt: Date.now(),
    };

    this.patches.set(session.id, session);
    return session;
  }

  /**
   * Show a diff for a specific file in the patch session.
   * Opens VS Code's built-in diff editor.
   */
  async showDiff(sessionId: string, fileIndex: number = 0): Promise<void> {
    const session = this.patches.get(sessionId);
    if (!session) throw new Error(`Patch session ${sessionId} not found`);

    const file = session.files[fileIndex];
    if (!file) throw new Error(`File index ${fileIndex} not found in session`);

    // Write original and new content to temp files
    const originalPath = join(this.tempDir, `${sessionId}-${fileIndex}-original.tmp`);
    const newPath = join(this.tempDir, `${sessionId}-${fileIndex}-new.tmp`);

    writeFileSync(originalPath, file.originalContent, 'utf-8');
    writeFileSync(newPath, file.newContent, 'utf-8');

    const originalUri = vscode.Uri.file(originalPath);
    const newUri = vscode.Uri.file(newPath);

    // Show diff with title
    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      newUri,
      `AI Edit: ${file.filePath} (Original ↔ Proposed)`,
      { preview: true }
    );
  }

  /**
   * Approve a specific file in the patch session.
   */
  approveFile(sessionId: string, fileIndex: number): void {
    const session = this.patches.get(sessionId);
    if (!session) return;
    const file = session.files[fileIndex];
    if (file) {
      file.status = 'approved';
      file.hunks.forEach(h => h.approved = true);
    }
  }

  /**
   * Reject a specific file in the patch session.
   */
  rejectFile(sessionId: string, fileIndex: number): void {
    const session = this.patches.get(sessionId);
    if (!session) return;
    const file = session.files[fileIndex];
    if (file) {
      file.status = 'rejected';
    }
  }

  /**
   * Approve a specific hunk within a file.
   */
  approveHunk(sessionId: string, fileIndex: number, hunkIndex: number): void {
    const session = this.patches.get(sessionId);
    if (!session) return;
    const file = session.files[fileIndex];
    if (file && file.hunks[hunkIndex]) {
      file.hunks[hunkIndex].approved = true;
    }
  }

  /**
   * Apply all approved files in the session.
   */
  async applyApproved(sessionId: string): Promise<string[]> {
    const session = this.patches.get(sessionId);
    if (!session) return [];

    const applied: string[] = [];
    for (const file of session.files) {
      if (file.status === 'approved') {
        try {
          // Ensure directory exists
          const dir = dirname(file.filePath);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

          writeFileSync(file.filePath, file.newContent, 'utf-8');
          file.status = 'applied';
          applied.push(file.filePath);

          if (this.onApplyCallback) {
            await this.onApplyCallback(file.filePath, file.newContent);
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to apply patch to ${file.filePath}: ${err.message}`);
        }
      }
    }

    if (applied.length > 0) {
      session.status = 'applied';
      vscode.window.showInformationMessage(`Applied ${applied.length} file(s)`);
    }

    return applied;
  }

  /**
   * Undo the last applied patch session (restore from checkpoints).
   */
  async undo(sessionId: string): Promise<string[]> {
    const session = this.patches.get(sessionId);
    if (!session) return [];

    const restored: string[] = [];
    for (const file of session.files) {
      if (file.status === 'applied') {
        try {
          writeFileSync(file.filePath, file.originalContent, 'utf-8');
          file.status = 'pending';
          restored.push(file.filePath);

          if (this.onUndoCallback) {
            await this.onUndoCallback(file.filePath);
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to undo ${file.filePath}: ${err.message}`);
        }
      }
    }

    if (restored.length > 0) {
      session.status = 'pending';
      vscode.window.showInformationMessage(`Undid ${restored.length} file(s)`);
    }

    return restored;
  }

  /**
   * Get a patch session by ID.
   */
  getSession(sessionId: string): PatchSession | undefined {
    return this.patches.get(sessionId);
  }

  /**
   * List all pending patch sessions.
   */
  listPendingSessions(): PatchSession[] {
    return Array.from(this.patches.values()).filter(s => s.status === 'pending');
  }

  /**
   * Clean up old patch sessions.
   */
  cleanup(olderThanMs: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - olderThanMs;
    for (const [id, session] of this.patches) {
      if (session.createdAt < cutoff) {
        this.patches.delete(id);
      }
    }
  }

  /**
   * Compute hunks from original and new content.
   * Simple line-by-line diff (no external dependency).
   */
  private computeHunks(original: string, newContent: string): DiffHunk[] {
    const oldLines = original.split('\n');
    const newLines = newContent.split('\n');
    const hunks: DiffHunk[] = [];

    // Simple diff: find first and last differing lines
    let firstDiff = 0;
    while (firstDiff < oldLines.length && firstDiff < newLines.length &&
           oldLines[firstDiff] === newLines[firstDiff]) {
      firstDiff++;
    }

    let lastOldDiff = oldLines.length - 1;
    let lastNewDiff = newLines.length - 1;
    while (lastOldDiff > firstDiff && lastNewDiff > firstDiff &&
           oldLines[lastOldDiff] === newLines[lastNewDiff]) {
      lastOldDiff--;
      lastNewDiff--;
    }

    if (firstDiff <= lastOldDiff || firstDiff <= lastNewDiff) {
      const context = 3; // lines of context
      const hunkStart = Math.max(0, firstDiff - context);
      const hunkOldEnd = Math.min(oldLines.length, lastOldDiff + 1 + context);
      const hunkNewEnd = Math.min(newLines.length, lastNewDiff + 1 + context);

      const hunkLines: string[] = [];
      for (let i = hunkStart; i < hunkOldEnd; i++) {
        hunkLines.push(`-${oldLines[i]}`);
      }
      for (let i = hunkStart; i < hunkNewEnd; i++) {
        hunkLines.push(`+${newLines[i]}`);
      }

      hunks.push({
        oldStart: hunkStart + 1,
        oldLines: hunkOldEnd - hunkStart,
        newStart: hunkStart + 1,
        newLines: hunkNewEnd - hunkStart,
        content: hunkLines.join('\n'),
        approved: false,
      });
    }

    return hunks;
  }
}