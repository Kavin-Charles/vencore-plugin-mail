import { Router, type Router as ExpressRouter } from 'express';
import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { Database, EmailAccount } from '../types';
import type { AuthenticatedRequest } from '../types';
import { decryptSecret } from '../lib/mail-crypto';
import { createGmailProvider } from '../lib/gmail-provider';
import { createImapProvider } from '../lib/imap-provider';
import type { MailProvider } from '../lib/mail-provider';
// logger provided by host
import { logActivity } from '../lib/log-activity';
import { mailNotifier } from '../lib/mail-notifier';

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
  account_id: z.string().uuid().optional(),
  folder: z.enum(['inbox', 'sent', 'drafts', 'trash', 'spam']).optional(),
  contact_id: z.string().uuid().optional(),
  deal_id: z.string().uuid().optional(),
  q: z.string().optional(),
});

export const sendSchema = z.object({
  account_id: z.string().uuid(),
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().min(1),
  body_html: z.string().min(1),
  reply_to_message_id: z.string().optional(),
  deal_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
});

const patchSchema = z.object({
  is_read: z.boolean().optional(),
  is_starred: z.boolean().optional(),
  folder: z.enum(['inbox', 'sent', 'drafts', 'trash', 'spam']).optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'At least one field required' });

function getProvider(account: EmailAccount): MailProvider {
  if (account.provider === 'gmail') {
    return createGmailProvider({
      accessToken: decryptSecret(account.access_token!),
      refreshToken: decryptSecret(account.refresh_token!),
    });
  }
  return createImapProvider({
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

import type { VencoreBackendAPI } from '@vencore/plugin-types';
import { getGlobalDb } from '../lib/global-db';

export function registerMailEmailsEndpoints(vencore: VencoreBackendAPI) {
  // GET /emails
  (vencore.http as any).onEndpoint('/emails', async (req: any) => {
    try {
      const user = await vencore.user.get();
      const workspace = await vencore.workspace.get();
      const db = getGlobalDb();
      const q = listQuerySchema.parse(req.query);

      let query = db.selectFrom('emails').where('workspace_id', '=', workspace.id);
      // Personal inbox: scope to current user only; deal/contact context: workspace-wide
      if (!q.deal_id && !q.contact_id) {
        query = query.where('user_id', '=', user.id);
      }
      if (q.account_id) query = query.where('account_id', '=', q.account_id);
      if (q.folder) query = query.where('folder', '=', q.folder);
      if (q.contact_id) query = query.where('contact_id', '=', q.contact_id);
      if (q.deal_id) query = query.where('deal_id', '=', q.deal_id);
      if (q.q) {
        const term = `%${q.q}%`;
        query = query.where(eb => eb.or([
          eb('subject', 'ilike', term),
          eb('snippet', 'ilike', term),
        ]));
      }

      const countRow = await query
        .select(db.fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow();

      const emails = await query
        .selectAll()
        .orderBy('sent_at', 'desc')
        .limit(q.per_page)
        .offset((q.page - 1) * q.per_page)
        .execute();

      return { status: 200, body: JSON.stringify({ data: emails, total: Number(countRow.count), page: q.page, per_page: q.per_page, error: null }) };
    } catch (err) {
      console.error(err);
      return { status: 500, body: JSON.stringify({ data: null, error: { message: 'Internal Server Error' } }) };
    }
  });

  // GET /emails/:id
  (vencore.http as any).onEndpoint('/emails/:id', async (req: any) => {
    if (req.method === 'PATCH' || req.method === 'DELETE') return { status: 405, body: '' }; // handled by other matches (Wait, onEndpoint matches by path only? No, we should check method inside!)
    // Actually, onEndpoint does NOT match method. The SDK passes req.method. So we need to handle multiple methods inside /emails/:id!
    if (req.method === 'GET') {
      try {
        const user = await vencore.user.get();
        const db = getGlobalDb();
        const email = await db
          .selectFrom('emails')
          .where('id', '=', req.params['id']!)
          .where('user_id', '=', user.id)
          .selectAll()
          .executeTakeFirst();
        if (!email) {
          return { status: 404, body: JSON.stringify({ data: null, error: { code: 'NOT_FOUND', message: 'Email not found' } }) };
        }
        return { status: 200, body: JSON.stringify({ data: email, error: null }) };
      } catch (err) {
        console.error(err);
        return { status: 500, body: JSON.stringify({ data: null, error: { message: 'Internal Server Error' } }) };
      }
    }

    if (req.method === 'PATCH') {
      try {
        const user = await vencore.user.get();
        const db = getGlobalDb();
        const body = patchSchema.parse(req.body ? JSON.parse(req.body) : {});

        const email = await db
          .selectFrom('emails')
          .where('id', '=', req.params['id']!)
          .where('user_id', '=', user.id)
          .select(['id', 'account_id', 'message_id'])
          .executeTakeFirst();
        if (!email) {
          return { status: 404, body: JSON.stringify({ data: null, error: { code: 'NOT_FOUND', message: 'Email not found' } }) };
        }

        const updated = await db
          .updateTable('emails')
          .set(body)
          .where('id', '=', email.id)
          .returningAll()
          .executeTakeFirstOrThrow();

        // Mirror to provider (fire-and-forget)
        void (async () => {
          try {
            const account = await db
              .selectFrom('email_accounts')
              .where('id', '=', email.account_id)
              .selectAll()
              .executeTakeFirst();
            if (!account) return;
            await getProvider(account).updateEmail(email.message_id, body);
          } catch (err) { console.error({ err }, 'mail: provider mirror failed'); }
        })();

        return { status: 200, body: JSON.stringify({ data: updated, error: null }) };
      } catch (err) {
        console.error(err);
        return { status: 500, body: JSON.stringify({ data: null, error: { message: 'Internal Server Error' } }) };
      }
    }

    if (req.method === 'DELETE') {
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

        await db
          .updateTable('emails')
          .set({ folder: 'trash' })
          .where('id', '=', email.id)
          .execute();

        void (async () => {
          try {
            const account = await db
              .selectFrom('email_accounts')
              .where('id', '=', email.account_id)
              .selectAll()
              .executeTakeFirst();
            if (!account) return;
            await getProvider(account).updateEmail(email.message_id, { folder: 'trash' });
          } catch (err) { console.error({ err }, 'mail: provider trash failed'); }
        })();

        return { status: 200, body: JSON.stringify({ data: { trashed: true }, error: null }) };
      } catch (err) {
        console.error(err);
        return { status: 500, body: JSON.stringify({ data: null, error: { message: 'Internal Server Error' } }) };
      }
    }

    return { status: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  });

  // POST /emails/send
  (vencore.http as any).onEndpoint('/emails/send', async (req: any) => {
    try {
      const user = await vencore.user.get();
      const db = getGlobalDb();
      const body = sendSchema.parse(req.body ? JSON.parse(req.body) : {});

      const account = await db
        .selectFrom('email_accounts')
        .where('id', '=', body.account_id)
        .where('user_id', '=', user.id)
        .selectAll()
        .executeTakeFirst();
      if (!account) {
        return { status: 404, body: JSON.stringify({ data: null, error: { code: 'NOT_FOUND', message: 'Account not found' } }) };
      }

      const { message_id } = await getProvider(account).sendEmail({
        to: body.to,
        cc: body.cc,
        bcc: body.bcc,
        subject: body.subject,
        body_html: body.body_html,
        reply_to_message_id: body.reply_to_message_id,
      });

      // Store sent email in DB so it appears in Sent folder immediately
      const sentEmail = await db.insertInto('emails').values({
        account_id: account.id,
        workspace_id: account.workspace_id,
        user_id: user.id,
        message_id,
        thread_id: message_id,
        subject: body.subject,
        from_address: account.email,
        from_name: account.display_name ?? account.email,
        to_addresses: JSON.stringify(body.to) as unknown as string[],
        cc_addresses: JSON.stringify(body.cc ?? []) as unknown as string[],
        bcc_addresses: JSON.stringify(body.bcc ?? []) as unknown as string[],
        snippet: body.body_html.replace(/<[^>]+>/g, '').slice(0, 300),
        folder: 'sent',
        is_read: true,
        is_starred: false,
        sent_at: new Date().toISOString(),
        contact_id: body.contact_id ?? null,
        deal_id: body.deal_id ?? null,
      }).onConflict(oc => oc.columns(['account_id', 'message_id']).doNothing())
        .returningAll()
        .executeTakeFirst();

      if (sentEmail) {
        void logActivity(db, {
          workspace_id: account.workspace_id,
          user_id: user.id,
          type: 'email',
          body: body.subject,
          contact_id: body.contact_id,
          record_id: body.deal_id,
          meta: {
            email_id: sentEmail.id,
            direction: 'outbound',
            snippet: sentEmail.snippet ?? undefined,
          },
        });
        mailNotifier.broadcast(user.id, { type: 'new_email', email: sentEmail });
      }

      return { status: 201, body: JSON.stringify({ data: { message_id }, error: null }) };
    } catch (err) {
      console.error('[mail:send]', err);
      return { status: 500, body: JSON.stringify({ data: null, error: { message: 'Internal Server Error' } }) };
    }
  });
}
