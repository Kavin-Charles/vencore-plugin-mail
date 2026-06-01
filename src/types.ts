import type { Request } from 'express';

/** Minimal shape of an authenticated Vantage request (injected by host middleware). */
export interface AuthenticatedRequest extends Request {
  workspace: { id: string };
  user: { id: string; workspace_id: string; role: 'admin' | 'member' };
}
