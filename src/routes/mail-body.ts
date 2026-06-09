import { Router, type Router as ExpressRouter } from 'express';
import type { Kysely } from 'kysely';
import type { Database } from '../types';
import type { AuthenticatedRequest } from '../types';
import { decryptSecret } from '../lib/mail-crypto';
import { createGmailProvider } from '../lib/gmail-provider';
import { createImapProvider } from '../lib/imap-provider';
// logger provided by host

import type { VencoreBackendAPI } from '@vencore/plugin-types';
import { getGlobalDb } from '../lib/global-db';
import { encryptSecret } from '../lib/mail-crypto';

export function registerMailBodyEndpoints(vencore: VencoreBackendAPI) {
  // GET /body/:id
  // We'll map the SDK route path to `/body/:id` instead of `/emails/:id/body`
  // so the router matches it efficiently. Wait, the manifest says `/body`.
  // The original router was mounted at `/body`, and the path was `/:id/body`.
  // So the full path was `/body/:id/body`. Let's use `/body/:id/body` to match original behaviour.
  (vencore.http as any).onEndpoint('/body/:id/body', async (req: any) => {
    try {
      const user = await vencore.user.get();
      const db = getGlobalDb();

      const email = await db
        .selectFrom('emails')
        .where('id', '=', req.params['id']!)
        .where('user_id', '=', user.id)
        .select(['id', 'account_id', 'message_id'])
        .executeTakeFirst();
      if (!email) {
        return { status: 404, body: JSON.stringify({ data: null, error: { code: 'NOT_FOUND', message: 'Email not found' } }) };
      }

      const account = await db
        .selectFrom('email_accounts')
        .where('id', '=', email.account_id)
        .selectAll()
        .executeTakeFirst();
      if (!account) {
        return { status: 404, body: JSON.stringify({ data: null, error: { code: 'NOT_FOUND', message: 'Account not found' } }) };
      }

      let provider;
      if (account.provider === 'gmail') {
        provider = createGmailProvider({
          accessToken: decryptSecret(account.access_token!),
          refreshToken: decryptSecret(account.refresh_token!),
          onTokenRefreshed: async (newToken) => {
            await db.updateTable('email_accounts')
              .set({ access_token: encryptSecret(newToken), updated_at: new Date().toISOString() }) // need encryptSecret here? Yes.
              .where('id', '=', account.id)
              .execute();
          },
        });
      } else {
        provider = createImapProvider({
          imap_host: account.imap_host!,
          imap_port: account.imap_port!,
          imap_user: account.imap_user!,
          imap_pass: decryptSecret(account.imap_pass!),
          smtp_host: account.smtp_host!,
          smtp_port: account.smtp_port!,
          smtp_user: account.smtp_user!,
          smtp_pass: decryptSecret(account.smtp_pass!),
          use_ssl: account.use_ssl,
        });
      }

      const { body_html, body_text } = await provider.fetchBody(email.message_id);

      return { status: 200, body: JSON.stringify({ data: { body_html, body_text }, error: null }) };
    } catch (err) {
      console.error({ err }, 'mail: fetchBody failed');
      return { status: 500, body: JSON.stringify({ data: null, error: { message: 'Internal Server Error' } }) };
    }
  });
}
