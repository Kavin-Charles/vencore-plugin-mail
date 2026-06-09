import { Router, type Router as ExpressRouter, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import type { Kysely } from 'kysely';
import type { Database } from '../types';
import type { AuthenticatedRequest } from '../types';
import { encryptSecret, decryptSecret } from '../lib/mail-crypto';
import { runFullSync, runIncrementalSync } from '../workers/mail-sync';
import { registerGmailWatch } from '../workers/gmail-watch-renew';
// logger provided by host
import { ImapFlow } from 'imapflow';

const connectImapSchema = z.object({
  email: z.string().email(),
  display_name: z.string().optional(),
  imap_pass: z.string().min(1),
  smtp_pass: z.string().min(1),
  imap_user: z.string().optional(),
  imap_host: z.string().optional(),
  imap_port: z.coerce.number().int().min(1).max(65535).optional(),
  smtp_user: z.string().optional(),
  smtp_host: z.string().optional(),
  smtp_port: z.coerce.number().int().min(1).max(65535).optional(),
  use_ssl: z.boolean().optional(),
});

function sanitizeImapError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('auth') || lower.includes('login') || lower.includes('password') || lower.includes('credential')) {
    return 'Authentication failed — check your email and password.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'Connection timed out — check host and port.';
  }
  if (lower.includes('econnrefused') || lower.includes('connection refused')) {
    return 'Connection refused — check host and port.';
  }
  if (lower.includes('enotfound') || lower.includes('not found') || lower.includes('getaddrinfo')) {
    return 'Host not found — check the IMAP host.';
  }
  // Return generic message for anything unrecognised to avoid leaking server internals
  return 'Connection failed — check your server settings.';
}

function makeOAuth2() {
  return new google.auth.OAuth2(
    process.env['GOOGLE_CLIENT_ID'],
    process.env['GOOGLE_CLIENT_SECRET'],
    process.env['GOOGLE_REDIRECT_URI'],
  );
}

import type { VencoreBackendAPI } from '@vencore/plugin-types';
import { getGlobalDb } from '../lib/global-db';

export function registerMailAccountsEndpoints(vencore: VencoreBackendAPI) {
  // GET /accounts
  (vencore.http as any).onEndpoint('/accounts', async () => {
    try {
      const user = await vencore.user.get();
      const db = getGlobalDb();
      const accounts = await db
        .selectFrom('email_accounts')
        .where('user_id', '=', user.id)
        .select(['id', 'provider', 'email', 'display_name', 'sync_status', 'sync_error', 'last_synced_at', 'created_at'])
        .orderBy('created_at', 'asc')
        .execute();
      return { status: 200, body: JSON.stringify({ data: accounts, error: null }) };
    } catch (err) {
      console.error(err);
      return { status: 500, body: JSON.stringify({ data: null, error: { message: 'Internal Server Error' } }) };
    }
  });

  // POST /accounts/gmail/auth-url
  (vencore.http as any).onEndpoint('/accounts/gmail/auth-url', async () => {
    try {
      const user = await vencore.user.get();
      if (!process.env['GOOGLE_CLIENT_ID']) {
        return { status: 503, body: JSON.stringify({ data: null, error: { code: 'NOT_CONFIGURED', message: 'Gmail OAuth not configured' } }) };
      }
      const state = jwt.sign({ userId: user.id }, process.env['JWT_SECRET']!, { expiresIn: '10m' });
      const url = makeOAuth2().generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/gmail.modify'],
        state,
        prompt: 'consent',
      });
      return { status: 200, body: JSON.stringify({ data: { url }, error: null }) };
    } catch (err) {
      console.error(err);
      return { status: 500, body: JSON.stringify({ data: null, error: { message: 'Internal Server Error' } }) };
    }
  });

  // POST /accounts/imap/test
  (vencore.http as any).onEndpoint('/accounts/imap/test', async (req: any) => {
    try {
      const workspace = await vencore.workspace.get();
      const db = getGlobalDb();
      const body = z.object({
        email: z.string().email(),
        imap_pass: z.string().min(1),
      }).parse(req.body ? JSON.parse(req.body) : {});

      const config = await db
        .selectFrom('workspace_imap_config')
        .where('workspace_id', '=', workspace.id)
        .selectAll()
        .executeTakeFirst();
      if (!config) {
        return { status: 400, body: JSON.stringify({ data: null, error: { code: 'NO_WORKSPACE_CONFIG', message: 'Workspace mail server not configured' } }) };
      }

      const client = new ImapFlow({
        host: config.imap_host,
        port: config.imap_port,
        secure: config.use_ssl,
        auth: { user: body.email, pass: body.imap_pass },
        logger: false,
      });
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            await client.connect();
            await client.logout();
          })(),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              client.close();
              reject(new Error('Connection timed out — check host and port'));
            }, 8000);
          }),
        ]);
        clearTimeout(timeoutId);
        return { status: 200, body: JSON.stringify({ data: { ok: true }, error: null }) };
      } catch (err) {
        clearTimeout(timeoutId);
        try { client.close(); } catch { /* already closed */ }
        const raw = err instanceof Error ? err.message : 'Connection failed';
        const message = sanitizeImapError(raw);
        return { status: 400, body: JSON.stringify({ data: null, error: { code: 'IMAP_TEST_FAILED', message } }) };
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Connection failed';
      const message = sanitizeImapError(raw);
      return { status: 400, body: JSON.stringify({ data: null, error: { code: 'IMAP_TEST_FAILED', message } }) };
    }
  });

  // POST /accounts/imap
  (vencore.http as any).onEndpoint('/accounts/imap', async (req: any) => {
    try {
      const workspace = await vencore.workspace.get();
      const user = await vencore.user.get();
      const db = getGlobalDb();
      const body = connectImapSchema.parse(req.body ? JSON.parse(req.body) : {});

      let imapHost = body.imap_host;
      let imapPort = body.imap_port;
      let smtpHost = body.smtp_host;
      let smtpPort = body.smtp_port;
      let useSsl = body.use_ssl;

      if (!imapHost || !imapPort || !smtpHost || !smtpPort) {
        const wsConfig = await db
          .selectFrom('workspace_imap_config')
          .where('workspace_id', '=', workspace.id)
          .selectAll()
          .executeTakeFirst();
        if (!wsConfig) {
          return { status: 400, body: JSON.stringify({ data: null, error: { code: 'NO_WORKSPACE_CONFIG', message: 'Workspace mail server not configured' } }) };
        }
        imapHost = imapHost ?? wsConfig.imap_host;
        imapPort = imapPort ?? wsConfig.imap_port;
        smtpHost = smtpHost ?? wsConfig.smtp_host;
        smtpPort = smtpPort ?? wsConfig.smtp_port;
        useSsl = useSsl ?? wsConfig.use_ssl;
      }

      const account = await db
        .insertInto('email_accounts')
        .values({
          user_id: user.id,
          workspace_id: workspace.id,
          provider: 'imap',
          email: body.email,
          display_name: body.display_name ?? body.email,
          imap_host: imapHost,
          imap_port: imapPort,
          imap_user: body.imap_user ?? body.email,
          imap_pass: encryptSecret(body.imap_pass),
          smtp_host: smtpHost,
          smtp_port: smtpPort,
          smtp_user: body.smtp_user ?? body.email,
          smtp_pass: encryptSecret(body.smtp_pass),
          use_ssl: useSsl ?? true,
          sync_status: 'syncing',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const { imap_pass: _ip, smtp_pass: _sp, access_token: _at, refresh_token: _rt, ...safe } = account;
      void runFullSync(db, account.id);
      return { status: 201, body: JSON.stringify({ data: safe, error: null }) };
    } catch (err) {
      console.error(err);
      return { status: 500, body: JSON.stringify({ data: null, error: { message: 'Internal Server Error' } }) };
    }
  });

  // POST /accounts/:id/sync
  (vencore.http as any).onEndpoint('/accounts/:id/sync', async (req: any) => {
    try {
      const user = await vencore.user.get();
      const db = getGlobalDb();
      const account = await db
        .selectFrom('email_accounts')
        .where('id', '=', req.params['id']!)
        .where('user_id', '=', user.id)
        .select('id')
        .executeTakeFirst();
      if (!account) {
        return { status: 404, body: JSON.stringify({ data: null, error: { code: 'NOT_FOUND', message: 'Account not found' } }) };
      }
      void runIncrementalSync(db, account.id);
      return { status: 200, body: JSON.stringify({ data: { queued: true }, error: null }) };
    } catch (err) {
      console.error(err);
      return { status: 500, body: JSON.stringify({ data: null, error: { message: 'Internal Server Error' } }) };
    }
  });

  // DELETE /accounts/:id
  (vencore.http as any).onEndpoint('/accounts/:id', async (req: any) => {
    if (req.method !== 'DELETE') return { status: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    try {
      const user = await vencore.user.get();
      const db = getGlobalDb();
      const account = await db
        .selectFrom('email_accounts')
        .where('id', '=', req.params['id']!)
        .where('user_id', '=', user.id)
        .select('id')
        .executeTakeFirst();
      if (!account) {
        return { status: 404, body: JSON.stringify({ data: null, error: { code: 'NOT_FOUND', message: 'Account not found' } }) };
      }
      await db.deleteFrom('email_accounts').where('id', '=', account.id).execute();
      return { status: 200, body: JSON.stringify({ data: { deleted: true }, error: null }) };
    } catch (err) {
      console.error(err);
      return { status: 500, body: JSON.stringify({ data: null, error: { message: 'Internal Server Error' } }) };
    }
  });
}

/**
 * Gmail OAuth2 callback handler — registered WITHOUT requireAuth because the user
 * arrives via Google redirect. Identity verified via the signed state JWT.
 */
export async function handleGmailCallback(
  db: Kysely<Database>,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) { res.status(400).send('Missing code or state'); return; }

    let userId: string;
    try {
      const decoded = jwt.verify(state, process.env['JWT_SECRET']!) as { userId: string };
      userId = decoded.userId;
    } catch {
      res.status(400).send('Invalid or expired state');
      return;
    }

    const user = await db
      .selectFrom('users')
      .where('id', '=', userId)
      .select(['id', 'workspace_id'])
      .executeTakeFirst();
    if (!user) { res.status(400).send('User not found'); return; }

    const oauth2 = makeOAuth2();
    const { tokens } = await oauth2.getToken(code);
    oauth2.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress ?? '';

    const existing = await db
      .selectFrom('email_accounts')
      .where('user_id', '=', userId)
      .where('email', '=', email)
      .select('id')
      .executeTakeFirst();

    if (existing) {
      await db.updateTable('email_accounts')
        .set({
          access_token: encryptSecret(tokens.access_token!),
          refresh_token: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : undefined,
          updated_at: new Date().toISOString(),
        })
        .where('id', '=', existing.id)
        .execute();
      void runIncrementalSync(db, existing.id);
      void registerGmailWatch(db, existing.id).catch(err =>
        console.error({ err }, 'mail: gmail watch registration failed'),
      );
    } else {
      const account = await db
        .insertInto('email_accounts')
        .values({
          user_id: userId,
          workspace_id: user.workspace_id,
          provider: 'gmail',
          email,
          display_name: email,
          access_token: encryptSecret(tokens.access_token!),
          refresh_token: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
          sync_status: 'syncing',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      void runFullSync(db, account.id);
      void registerGmailWatch(db, account.id).catch(err =>
        console.error({ err }, 'mail: gmail watch registration failed'),
      );
    }

    const appUrl = process.env['APP_URL'] ?? 'http://localhost:3000';
    res.redirect(`${appUrl}/settings/mail?connected=gmail`);
  } catch (err) {
    console.error({ err }, 'gmail: oauth callback failed');
    const appUrl = process.env['APP_URL'] ?? 'http://localhost:3000';
    const message = err instanceof Error ? err.message : 'oauth_failed';
    res.redirect(`${appUrl}/settings/mail?error=${encodeURIComponent(message)}`);
  }
}
