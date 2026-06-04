import type { Kysely } from 'kysely';
import type { Database } from '@vencore/db';

interface ActivityPayload {
  workspace_id: string;
  user_id: string;
  type: 'email' | 'call' | 'note' | 'meeting' | 'deal_change' | 'infra_alert';
  body?: string;
  contact_id?: string;
  deal_id?: string;
  meta?: Record<string, unknown>;
}

export async function logActivity(
  db: Kysely<Database>,
  payload: ActivityPayload,
): Promise<void> {
  try {
    await db
      .insertInto('activities')
      .values({
        workspace_id: payload.workspace_id,
        user_id: payload.user_id,
        type: payload.type,
        body: payload.body ?? null,
        contact_id: payload.contact_id ?? null,
        deal_id: payload.deal_id ?? null,
        meta: payload.meta ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (err) {
    console.error('logActivity: failed to insert activity', err);
  }
}
