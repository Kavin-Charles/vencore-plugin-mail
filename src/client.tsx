import React, { useEffect, useState } from 'react';
import { createFrontendPlugin } from '@vencore/plugin-sdk/react';
import type { VencoreFrontendAPI } from '@vencore/plugin-sdk/react';

const MailPage = ({ vencore }: { vencore: VencoreFrontendAPI }) => {
  const [emails, setEmails] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    vencore.table('emails').list({ limit: 10 }).then(data => {
      setEmails(data);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      vencore.toast('Failed to load emails', 'error');
      setLoading(false);
    });
  }, [vencore]);

  return (
    <div style={{ padding: '24px', fontFamily: 'sans-serif', maxWidth: '1000px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '16px' }}>Mail Plugin</h1>
      <p style={{ color: '#666', marginBottom: '24px' }}>Welcome to the mail plugin.</p>
      
      {loading ? (
        <div>Loading emails...</div>
      ) : emails.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', backgroundColor: '#f9f9f9', borderRadius: '8px' }}>
          No emails found.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {emails.map(email => (
            <div key={email.id as string} style={{ padding: '16px', border: '1px solid #eee', borderRadius: '8px', backgroundColor: '#fff' }}>
              <div style={{ fontWeight: 'bold' }}>{email.subject as string}</div>
              <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>From: {email.from_address as string}</div>
              <div style={{ fontSize: '14px', marginTop: '8px' }}>{(email.snippet as string) || 'No snippet available'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default createFrontendPlugin({
  setup(vencore) {
    vencore.registerPage('/mail', () => <MailPage vencore={vencore} />);
  },
});
