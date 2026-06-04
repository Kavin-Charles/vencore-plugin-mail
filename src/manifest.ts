import type { PluginManifest } from '@vencore/plugin-types';

export const manifest: PluginManifest = {
  id: 'com.vencore.mail',
  name: 'Mail',
  version: '1.0.0',
  description: 'Gmail and IMAP email integration. Syncs emails, links to contacts and deals.',
  permissions: ['contacts:read', 'deals:read', 'activity:write'],
  tables: [],
  migrations: [
    {
      version: '1.0.0',
      up: `
        CREATE TABLE IF NOT EXISTS email_accounts (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workspace_id    UUID NOT NULL,
          user_id         UUID NOT NULL,
          provider        VARCHAR NOT NULL,
          email           VARCHAR NOT NULL,
          display_name    VARCHAR,
          access_token    TEXT,
          refresh_token   TEXT,
          imap_host       VARCHAR,
          imap_port       INTEGER,
          imap_user       VARCHAR,
          imap_pass       TEXT,
          smtp_host       VARCHAR,
          smtp_port       INTEGER,
          smtp_user       VARCHAR,
          smtp_pass       TEXT,
          use_ssl         BOOLEAN NOT NULL DEFAULT true,
          sync_status     VARCHAR NOT NULL DEFAULT 'idle',
          sync_error      TEXT,
          last_synced_at  TIMESTAMPTZ,
          gmail_history_id VARCHAR,
          gmail_watch_expiry TIMESTAMPTZ,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (workspace_id, user_id, email)
        );

        CREATE TABLE IF NOT EXISTS emails (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          account_id      UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
          workspace_id    UUID NOT NULL,
          user_id         UUID NOT NULL,
          message_id      VARCHAR NOT NULL,
          thread_id       VARCHAR,
          subject         TEXT,
          from_address    VARCHAR NOT NULL,
          from_name       VARCHAR,
          to_addresses    TEXT[] NOT NULL DEFAULT '{}',
          cc_addresses    TEXT[] NOT NULL DEFAULT '{}',
          bcc_addresses   TEXT[] NOT NULL DEFAULT '{}',
          snippet         TEXT,
          folder          VARCHAR NOT NULL DEFAULT 'INBOX',
          is_read         BOOLEAN NOT NULL DEFAULT false,
          is_starred      BOOLEAN NOT NULL DEFAULT false,
          sent_at         TIMESTAMPTZ NOT NULL,
          contact_id      UUID,
          deal_id         UUID,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (account_id, message_id)
        );

        CREATE INDEX IF NOT EXISTS emails_workspace_id_idx
          ON emails (workspace_id, sent_at DESC);
        CREATE INDEX IF NOT EXISTS emails_contact_id_idx
          ON emails (contact_id) WHERE contact_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS emails_deal_id_idx
          ON emails (deal_id) WHERE deal_id IS NOT NULL;
      `,
      down: `
        DROP TABLE IF EXISTS emails;
        DROP TABLE IF EXISTS email_accounts;
      `,
    },
  ],
};
