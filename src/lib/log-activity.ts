import type { Kysely } from 'kysely';
import type { Database } from '../types';

interface ActivityPayload {
  workspace_id: string;
  user_id: string;
  type: 'email' | 'call' | 'note' | 'meeting' | 'deal_change' | 'infra_alert';
  body?: string;
  contact_id?: string;
  record_id?: string;
  meta?: Record<string, unknown>;
}

export async function logActivity(
  db: Kysely<Database>,
  payload: ActivityPayload,
): Promise<void> {
  try {
    await db.insertInto('activities').values({
      workspace_id: payload.workspace_id,
      user_id: payload.user_id,
      type: payload.type,
      body: payload.body ?? null,
      contact_id: payload.contact_id ?? null,
      record_id: payload.record_id ?? null,
      meta: payload.meta ?? null,
      created_at: new Date().toISOString() as any,
    }).execute();
  } catch (err) {
    console.error('logActivity: failed to insert activity', err);
  }
}
