export function academyErrorMessage(error) {
  if (error?.code === 'ACADEMY_STALE') return '';
  const code = String(error?.code || ''), message = String(error?.message || '');
  if (code === '42501') return 'This Academy content is not available to your account. Return to your dashboard or sign in again.';
  if (code === '22P02' || /invalid input syntax|invalid.*uuid/i.test(message)) return 'This Academy link is invalid. Open the item again from your dashboard.';
  if (code === '23505') return 'This change was already saved. Reload to see the latest information.';
  if (code === '23503') return 'That item is no longer available in this class. Reload and choose it again.';
  if (code === '23514' || code === '23502') return 'Check the required fields and photo limits, then try again.';
  if (code && !['P0001', '22023'].includes(code) && (/^[0-9A-Z]{5}$/.test(code) || code.startsWith('PGRST'))) return 'Academy could not complete that request. Please try again, or contact TLB if it continues.';
  if (/JWT|token.*expired|session.*expired/i.test(message)) return 'Your session has expired. Sign in again to continue.';
  if (/fetch failed|failed to fetch|networkerror|network request|timed? ?out/i.test(message)) return 'We could not connect to the Academy. Check your connection and try again.';
  if (/constraint|relation .*does not exist|schema cache|stack trace|SQLSTATE|PGRST|permission denied for|column .*does not exist|function .*does not exist|record .*has no field|column reference .*ambiguous/i.test(message)) return 'Academy could not complete that request. Please try again, or contact TLB if it continues.';
  return message || 'Academy could not complete that request. Please try again.';
}
