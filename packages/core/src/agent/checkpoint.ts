/**
 * Checkpoint/Restore System — ported patterns from Cline's production SDK.
 * 
 * Before any write/edit/delete operation, we snapshot the affected files.
 * This enables undo of AI-generated changes via restore.
 * 
 * @see Cline: sdk/packages/core/src/session/checkpoint-diff.ts
 * @see Cline: sdk/packages/core/src/session/checkpoint-restore.ts
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface FileCheckpoint {
  id: string;
  filePath: string;
  originalContent: string;
  timestamp: number;
  toolCallId?: string;
}

export class CheckpointManager {
  private checkpoints: Map<string, FileCheckpoint[]> = new Map();
  private maxCheckpointsPerFile = 5;

  /**
   * Snapshot a file before an AI edit. Call this BEFORE write_file / edit_file.
   */
  snapshot(filePath: string, toolCallId?: string): FileCheckpoint | null {
    try {
      if (!existsSync(filePath)) return null; // file doesn't exist yet (create, not edit)
      const content = readFileSync(filePath, 'utf-8');
      const cp: FileCheckpoint = {
        id: randomUUID(),
        filePath,
        originalContent: content,
        timestamp: Date.now(),
        toolCallId,
      };

      let fileCheckpoints = this.checkpoints.get(filePath) || [];
      fileCheckpoints.push(cp);
      // Keep only last N checkpoints
      if (fileCheckpoints.length > this.maxCheckpointsPerFile) {
        fileCheckpoints = fileCheckpoints.slice(-this.maxCheckpointsPerFile);
      }
      this.checkpoints.set(filePath, fileCheckpoints);
      return cp;
    } catch {
      return null;
    }
  }

  /**
   * Snapshots all files that would be affected by a write/edit operation.
   * For write_file: snapshots the target path (if exists).
   * For edit_file: snapshots the target path.
   * For delete_file: snapshots before deleting.
   * For rename_file: snapshots both source and dest (if dest exists).
   */
  snapshotForTool(toolName: string, params: Record<string, unknown>): FileCheckpoint[] {
    const snapshots: FileCheckpoint[] = [];
    switch (toolName) {
      case 'write_file':
      case 'edit_file':
      case 'delete_file': {
        const fp = this.snapshot(params.filePath as string);
        if (fp) snapshots.push(fp);
        break;
      }
      case 'rename_file': {
        const src = this.snapshot(params.oldPath as string);
        if (src) snapshots.push(src);
        const dst = this.snapshot(params.newPath as string);
        if (dst) snapshots.push(dst);
        break;
      }
    }
    return snapshots;
  }

  /**
   * Restore the most recent checkpoint for a file (undo last AI edit).
   */
  restore(filePath: string): boolean {
    const fileCheckpoints = this.checkpoints.get(filePath);
    if (!fileCheckpoints || fileCheckpoints.length === 0) return false;

    const cp = fileCheckpoints.pop()!;
    try {
      writeFileSync(cp.filePath, cp.originalContent, 'utf-8');
      this.checkpoints.set(filePath, fileCheckpoints);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the most recent checkpoint for a file (for diff display).
   */
  getLatest(filePath: string): FileCheckpoint | undefined {
    const fileCheckpoints = this.checkpoints.get(filePath);
    if (!fileCheckpoints || fileCheckpoints.length === 0) return undefined;
    return fileCheckpoints[fileCheckpoints.length - 1];
  }

  /**
   * List all files with checkpoints (for UI undo menu).
   */
  listCheckpointedFiles(): string[] {
    return Array.from(this.checkpoints.keys());
  }

  /**
   * Clear all checkpoints (e.g., when session ends).
   */
  clear(): void {
    this.checkpoints.clear();
  }

  /**
   * Check if a file has any checkpoints available.
   */
  hasCheckpoint(filePath: string): boolean {
    const cps = this.checkpoints.get(filePath);
    return cps !== undefined && cps.length > 0;
  }
}