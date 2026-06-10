import type { Request } from 'express';

/** Minimal shape of an authenticated Vencore request (injected by host middleware). */
export interface AuthenticatedRequest extends Request {
  workspace: { id: string };
  user: { id: string; workspace_id: string; role: 'admin' | 'member' };
}
export type { Database, EmailAccount, Email, WorkspaceImapConfig } from './schema';
