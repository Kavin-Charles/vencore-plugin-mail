import { Router, type Router as ExpressRouter } from 'express';
import type { Kysely } from 'kysely';
import type { Database } from '../types';
import { runIncrementalSync } from '../workers/mail-sync';
// logger provided by host

import type { VencoreBackendAPI } from '@vencore/plugin-types';
import { getGlobalDb } from '../lib/global-db';

export function registerMailWebhookEndpoints(
  vencore: VencoreBackendAPI,
  pubsubToken: string,
) {
  // POST /webhook/gmail
  // Called by Google Pub/Sub push subscription.
  (vencore.http as any).onEndpoint('/webhook/gmail', async (req: any) => {
    const incomingToken = req.headers['x-goog-channel-token'];
    if (!incomingToken || incomingToken !== pubsubToken) {
      return { status: 401, body: '' };
    }

    try {
      const db = getGlobalDb();
      const body = req.body ? JSON.parse(req.body) : {};
      const raw = body?.message?.data;
      if (!raw) { return { status: 204, body: '' }; }

      const payload = JSON.parse(Buffer.from(raw as string, 'base64').toString('utf8')) as {
        emailAddress?: string;
      };

      const emailAddress = payload.emailAddress;
      if (!emailAddress) { return { status: 204, body: '' }; }

      const account = await db
        .selectFrom('email_accounts')
        .where('email', '=', emailAddress)
        .where('provider', '=', 'gmail')
        .select('id')
        .executeTakeFirst();

      if (account) {
        void runIncrementalSync(db, account.id);
      }
    } catch (err) {
      console.error({ err }, 'mail-webhook: failed to process Gmail push');
    }

    return { status: 204, body: '' };
  });
}
