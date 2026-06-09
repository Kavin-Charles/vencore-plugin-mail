import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database } from '../types';
import type { AuthenticatedRequest } from '../types';

const workspaceImapConfigSchema = z.object({
  imap_host: z.string().min(1),
  imap_port: z.coerce.number().int().min(1).max(65535),
  smtp_host: z.string().min(1),
  smtp_port: z.coerce.number().int().min(1).max(65535),
  use_ssl: z.boolean().default(true),
});

import type { VencoreBackendAPI } from '@vencore/plugin-types';
import { getGlobalDb } from '../lib/global-db';

export function registerMailConfigEndpoints(vencore: VencoreBackendAPI) {
  // GET /config
  (vencore.http as any).onEndpoint('/config', async (req: any) => {
    if (req.method === 'GET') {
      try {
        const workspace = await vencore.workspace.get();
        const db = getGlobalDb();
        const config = await db
          .selectFrom('workspace_imap_config')
          .where('workspace_id', '=', workspace.id)
          .selectAll()
          .executeTakeFirst();
        return { status: 200, body: JSON.stringify({ data: config ?? null, error: null }) };
      } catch (err) {
        console.error(err);
        return { status: 500, body: JSON.stringify({ data: null, error: { message: 'Internal Server Error' } }) };
      }
    }

    // PUT /config — admin only
    if (req.method === 'PUT') {
      try {
        const workspace = await vencore.workspace.get();
        const db = getGlobalDb();
        const body = workspaceImapConfigSchema.parse(req.body ? JSON.parse(req.body) : {});
        const config = await db
          .insertInto('workspace_imap_config')
          .values({ workspace_id: workspace.id, ...body })
          .onConflict(oc =>
            oc.column('workspace_id').doUpdateSet({
              imap_host: body.imap_host,
              imap_port: body.imap_port,
              smtp_host: body.smtp_host,
              smtp_port: body.smtp_port,
              use_ssl: body.use_ssl,
              updated_at: new Date().toISOString() as any, // kysely wants string or Date
            }),
          )
          .returningAll()
          .executeTakeFirstOrThrow();
        return { status: 200, body: JSON.stringify({ data: config, error: null }) };
      } catch (err) {
        console.error(err);
        return { status: 500, body: JSON.stringify({ data: null, error: { message: 'Internal Server Error' } }) };
      }
    }

    return { status: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  });
}
