import { config } from './config.js';

let availability;
// Read only the public provider flag. OAuth credentials remain in Supabase.
// Failure to discover Google must never block ordinary email/password login.
export function googleSignInEnabled() {
  return availability ||= (async () => {
    try {
      const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/settings`, {
        headers: { apikey: config.supabasePublishableKey }, signal: AbortSignal.timeout(5000), cache: 'no-store',
      });
      if (!response.ok) return false;
      const settings = await response.json();
      return settings?.external?.google === true;
    } catch { return false; }
  })();
}
