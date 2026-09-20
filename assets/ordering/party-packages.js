import { config } from './config.js';
import { packageCard, packageInclusions } from './party-packages-view.js';

const root = document.querySelector('[data-party-packages]');
if (root) {
  const results = root.querySelector('[data-party-results]');
  const status = root.querySelector('[data-party-status]');
  const retry = root.querySelector('[data-party-retry]');
  async function load() {
    retry.hidden = true; status.textContent = 'Loading party packages…';
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/party_packages_api`, {
        method: 'POST', headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_action: 'browse', p_payload: {} }), signal: controller.signal,
      });
      if (!response.ok) throw new Error('Packages unavailable');
      const data = await response.json();
      results.innerHTML = data.items.length ? packageInclusions(data.settings.inclusions) + `<div class="party-grid">${data.items.map(item => packageCard(item)).join('')}</div>` : '';
      status.textContent = data.items.length ? '' : 'We’re updating our party packages. Please contact us to plan your cart.';
    } catch {
      status.textContent = 'Party packages could not load. Please try again, or contact us for current packages and prices.';
      retry.hidden = false;
    } finally { clearTimeout(timeout); }
  }
  retry.addEventListener('click', load);
  void load();
}
