export { createRouter } from './server-entry';
export { handleGmailCallback } from './routes/mail-accounts';
export { startMailSync, stopMailSync, runFullSync, runIncrementalSync } from './workers/mail-sync';
export { startGmailWatchRenew } from './workers/gmail-watch-renew';
export { startImapIdle } from './workers/imap-idle';
export { handleMailWsUpgrade } from './ws/mail-ws';
export { mailNotifier } from './lib/mail-notifier';

import { createPlugin } from '@vencore/plugin-sdk';
import { registerMailAccountsEndpoints } from './routes/mail-accounts';
import { registerMailEmailsEndpoints } from './routes/mail-emails';
import { registerMailBodyEndpoints } from './routes/mail-body';
import { registerMailWebhookEndpoints } from './routes/mail-webhook';
import { registerMailConfigEndpoints } from './routes/mail-config';

export default createPlugin({
  setup(vencore) {
    // Register SDK HTTP endpoints
    registerMailAccountsEndpoints(vencore);
    registerMailEmailsEndpoints(vencore);
    registerMailBodyEndpoints(vencore);
    registerMailWebhookEndpoints(vencore, process.env['GOOGLE_PUBSUB_TOKEN'] ?? '');
    registerMailConfigEndpoints(vencore);
  }
});
