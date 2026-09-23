export function newsletterPromoStatus(promo,now=Date.now()) {
  if(Number(promo.redeemed_count)>0)return 'used';
  if(Number(promo.reserved_count)>0)return 'reserved';
  if(!promo.active||promo.deleted_at)return 'inactive';
  return Date.parse(promo.expires_at)<=now?'expired':'active';
}

export function newsletterPromoStats(promos=[],now=Date.now()) {
  return promos.reduce((stats,promo)=>{
    stats.issued++;stats[newsletterPromoStatus(promo,now)]++;
    stats.sales_cents+=Number(promo.sales_cents)||0;
    stats.discount_cents+=Number(promo.discount_cents)||0;
    return stats;
  },{issued:0,used:0,reserved:0,active:0,expired:0,inactive:0,sales_cents:0,discount_cents:0});
}

export function renderNewsletterPromos(promos,{money,escapeHtml:esc,dateTime,now=Date.now()}) {
  const stats=newsletterPromoStats(promos,now);
  const cards=[['Codes issued',stats.issued],['Used',stats.used],['Active',stats.active],['Expired unused',stats.expired],['Reserved',stats.reserved],['Product sales',money(stats.sales_cents)],['Discounts given',money(stats.discount_cents)]];
  return `<section class="newsletter-promo-panel" aria-labelledby="newsletter-promos-title">
    <div class="section-heading"><div><h2 id="newsletter-promos-title">Newsletter welcome codes</h2><p class="muted">New subscribers receive a personal, single-use 5% code. Valid for 30 days · ₱300 minimum products · ₱100 maximum discount · Delivery excluded.</p></div><button class="button button-secondary" data-action="refresh">Refresh</button></div>
    <div class="newsletter-promo-metrics">${cards.map(([label,value])=>`<div class="panel"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
    <p class="muted">All time. Used = paid orders, including later cancellations or refunds. Reserved = awaiting payment or review. Active = available to use now. Expired = unused codes past their expiry. Product sales are after discounts, excluding delivery, cancelled orders and refunds; discounts given follow the same sales rules.${stats.inactive?` ${stats.inactive} inactive code${stats.inactive===1?'':'s'}.`:''}</p>
    <div class="panel">${promos.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Subscriber / code</th><th>Issued · Manila</th><th>Expires · Manila</th><th>Status</th><th>Product sales</th><th>Discount</th></tr></thead><tbody>${promos.map(promo=>`<tr><td><strong>${esc(promo.email)}</strong><small>${esc(promo.code)}</small></td><td>${esc(dateTime(promo.issued_at))}</td><td>${esc(dateTime(promo.expires_at))}</td><td><span class="badge">${esc(newsletterPromoStatus(promo,now))}</span></td><td>${money(promo.sales_cents||0)}</td><td>${money(promo.discount_cents||0)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No welcome codes issued yet. Codes will appear here when new subscribers join.</p>'}</div>
  </section>`;
}
