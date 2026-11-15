// Canonical mailbox protection. Never merge records or strip email aliases.
export function canonicalMailbox(value?: string | null): string { return (value || '').trim().toLowerCase(); }
export function mailboxSearch(value: string): string { return '%' + canonicalMailbox(value).replace(/[\\%_]/g, '\\$&') + '%'; }
export interface MailboxLead { id: string; email?: string | null; tenant_id: string; opt_out?: boolean | null; bounced?: boolean | null; complained?: boolean | null; status?: string | null }
export interface MailboxHistory { direction?: string | null; message_type?: string | null; sent_at?: string | null; provider_message_id?: string | null; replied_at?: string | null }
export function mailboxSendBlock(recipient: string, messageType: string, peers: MailboxLead[], history: MailboxHistory[]): string | null {
  const matches = peers.filter(p => canonicalMailbox(p.email) === canonicalMailbox(recipient));
  if (!matches.length) return 'Canonical recipient could not be verified';
  if (matches.some(p => p.opt_out || p.complained || p.bounced || p.status === 'Do Not Contact' || p.status === 'Bad Email')) return 'Canonical mailbox is suppressed';
  if (!/^email_[123]$/.test(messageType)) return null;
  if (matches.length > 1) return 'Duplicate CRM mailbox requires owner review';
  if (history.some(h => h.direction === 'inbound' || h.replied_at)) return 'Canonical mailbox already replied';
  if (history.some(h => h.direction === 'outbound' && h.message_type === messageType && (h.sent_at || h.provider_message_id))) return 'This mailbox already received this outreach touch';
  return null;
}
