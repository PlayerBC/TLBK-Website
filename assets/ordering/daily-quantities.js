import { calendarDates } from './date-calendar.js?v=daily-quantities-1';

// Missing rows and null capacities both mean unlimited. Drafts contain only
// products explicitly edited, so mixed or untouched limits are never replaced.
export function quantitySelection(productId, dates, inventory, drafts = {}) {
  const rows = dates.map(date => inventory.find(row => row.product_id === productId && row.date === date));
  const values = rows.map(row => row?.capacity == null ? '' : String(row.capacity));
  const edited = Object.hasOwn(drafts, productId);
  const mixed = !edited && new Set(values).size > 1;
  return {
    edited, mixed, value: edited ? drafts[productId] : mixed ? '' : values[0] ?? '',
    reserved: rows.map(row => Number(row?.reserved || 0)),
    paused: rows.some(row => row?.available === false),
  };
}

export function quantitySaveRows(products, inventory, selectedDates, drafts, today) {
  const dates = calendarDates(selectedDates);
  if (!dates.length) throw new Error('Select at least one date in the calendar.');
  if (dates.some(date => date < today)) throw new Error('Choose today or a future date.');
  if (dates.length > 180) throw new Error('Select up to 180 dates at a time.');
  const rows = [];
  for (const product of products) {
    if (!Object.hasOwn(drafts, product.id)) continue;
    const value = String(drafts[product.id]).trim();
    if (value !== '' && (!/^\d+$/.test(value) || Number(value) > 1000000)) throw new Error(`${product.name}: enter a whole quantity from 0 to 1,000,000, or leave it blank for no limit.`);
    const capacity = value === '' ? null : Number(value);
    for (const date of dates) {
      const saved = inventory.find(row => row.product_id === product.id && row.date === date);
      if (capacity !== null && capacity < Number(saved?.reserved || 0)) throw new Error(`${product.name}: ${saved.reserved} already ordered on ${date}. The total cannot be lower than that.`);
      if ((saved?.capacity ?? null) !== capacity || saved?.available === false) rows.push({ product_id: product.id, date, capacity, available: true });
    }
  }
  return rows;
}

export function quantityStatus(selection, dates) {
  if (!dates.length) return 'Select a date to view quantities';
  if (selection.paused && !selection.edited) return 'Orders paused on a selected date. Edit the quantity or choose No limit to reopen.';
  const min = Math.min(...selection.reserved), max = Math.max(...selection.reserved);
  const ordered = min === max ? String(min) : `${min}–${max}`;
  const suffix = `${ordered} already ordered${dates.length > 1 ? ' per date' : ''}`;
  if (selection.mixed) return `Different saved limits · ${suffix}`;
  if (selection.value === '') return `No limit · ${suffix}`;
  const capacity = Number(selection.value);
  if (!Number.isInteger(capacity) || capacity < 0) return 'Enter a whole quantity or leave blank';
  if (capacity < max) return `Below the ${max} already ordered on a selected date`;
  const remaining = min === max ? String(capacity - max) : `${capacity - max}–${capacity - min}`;
  return `${remaining} left · ${suffix}`;
}
