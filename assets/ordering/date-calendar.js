// Calendar dates are civil dates, never local-midnight timestamps.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const pad = value => String(value).padStart(2, '0');
const dateUTC = value => new Date(`${value}T12:00:00Z`);

export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = dateUTC(value);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function calendarDates(values) {
  return [...new Set((Array.isArray(values) ? values : String(values || '').split(/\r?\n/)).filter(isCalendarDate))].sort();
}
export function shiftCalendarMonth(month, amount) {
  const date = dateUTC(`${month}-01`);
  if (Number.isNaN(date.getTime()) || !Number.isInteger(amount)) throw new Error('Invalid calendar month');
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}
export function calendarMonthDays(month) {
  if (!isCalendarDate(`${month}-01`)) throw new Error('Invalid calendar month');
  const first = dateUTC(`${month}-01`);
  const end = dateUTC(`${month}-01`);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  const cells = Array(first.getUTCDay()).fill(null);
  for (let day = 1; day <= end.getUTCDate(); day++) cells.push(`${month}-${pad(day)}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
export function toggleCalendarDate(values, date) {
  if (!isCalendarDate(date)) throw new Error('Invalid calendar date');
  const selected = new Set(calendarDates(values));
  if (selected.has(date)) selected.delete(date); else selected.add(date);
  return [...selected].sort();
}
export function calendarKeyDate(date, key, shiftKey = false) {
  if (!isCalendarDate(date)) return null;
  const next = dateUTC(date);
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -next.getUTCDay(), End: 6 - next.getUTCDay() };
  if (Object.hasOwn(moves, key)) next.setUTCDate(next.getUTCDate() + moves[key]);
  else if (key === 'PageUp' || key === 'PageDown') {
    const target = shiftCalendarMonth(date.slice(0, 7), (key === 'PageUp' ? -1 : 1) * (shiftKey ? 12 : 1));
    const days = calendarMonthDays(target).filter(Boolean);
    return `${target}-${pad(Math.min(next.getUTCDate(), days.length))}`;
  } else return null;
  return next.toISOString().slice(0, 10);
}
const dateLabel = value => `${Number(value.slice(8))} ${MONTHS[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}`;
const monthLabel = value => `${MONTHS[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}`;

function calendarView(name, month, selected, today, focusDate, disabled, options = {}) {
  const selectedSet = new Set(selected);
  const cells = calendarMonthDays(month);
  const tabDate = focusDate?.startsWith(month) ? focusDate : today.startsWith(month) ? today : `${month}-01`;
  const rows = [];
  for (let index = 0; index < cells.length; index += 7) {
    rows.push(`<tr>${cells.slice(index, index + 7).map(date => date ? `<td><button type="button" class="calendar-day" data-calendar-date="${date}" aria-label="${dateLabel(date)}" aria-pressed="${selectedSet.has(date)}" ${date === today ? 'aria-current="date"' : ''} tabindex="${date === tabDate ? 0 : -1}" ${disabled || (options.minDate && date < options.minDate) ? 'disabled' : ''}>${Number(date.slice(8))}</button></td>` : '<td></td>').join('')}</tr>`);
  }
  return `<div class="calendar-toolbar"><button type="button" class="calendar-nav" data-calendar-move="-1" aria-label="Previous month">‹</button><strong id="calendar-${escape(name)}-month" aria-live="polite">${monthLabel(month)}</strong><button type="button" class="calendar-nav" data-calendar-move="1" aria-label="Next month">›</button></div><table class="calendar-month" aria-labelledby="calendar-${escape(name)}-title calendar-${escape(name)}-month"><thead><tr>${WEEKDAYS.map(day => `<th scope="col">${day}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table><div class="calendar-footer"><span><span class="calendar-selected-key" aria-hidden="true">✓</span> ${escape(options.selectionLabel || (name === 'nonproduction_dates' ? 'Selected non-production dates' : 'Selected dates are closed'))}</span><button type="button" class="calendar-today" data-calendar-today>Current month</button></div><details class="calendar-selection" ${selected.length > 0 && selected.length <= 6 ? 'open' : ''}><summary>${selected.length} selected date${selected.length === 1 ? '' : 's'}</summary>${selected.length ? `<div class="calendar-date-list">${selected.map(date => `<button type="button" data-calendar-remove="${date}" aria-label="Remove ${dateLabel(date)}" ${disabled ? 'disabled' : ''}>${dateLabel(date)} <span aria-hidden="true">×</span></button>`).join('')}</div>` : '<p>No additional dates selected.</p>'}</details>`;
}

export function dateCalendar(name, title, values, hint, today, disabled = false, options = {}) {
  if (!isCalendarDate(today)) throw new Error('Invalid current calendar date');
  const selected = calendarDates(values);
  const month = (options.minDate && selected[0] ? selected[0] : today).slice(0, 7);
  return `<fieldset class="date-calendar" data-date-calendar data-month="${month}" data-today="${today}" data-disabled="${disabled}" data-save-label="${escape(options.saveLabel || 'Save shop settings')}" data-selection-label="${escape(options.selectionLabel || '')}" data-min-date="${escape(options.minDate || '')}"><legend id="calendar-${escape(name)}-title">${escape(title)}</legend><p class="calendar-hint">${escape(hint)} Select a date to mark it; select it again to remove it. Click ${escape(options.saveLabel || 'Save shop settings')} when finished.</p><textarea name="${escape(name)}" hidden>${selected.join('\n')}</textarea><div data-calendar-view>${calendarView(name, month, selected, today, today, disabled, options)}</div><p class="sr-only" aria-live="polite" data-calendar-status></p></fieldset>`;
}

// Delegation is bound once; replacing one calendar never re-renders its form.
export function bindDateCalendars(root) {
  const render = (calendar, { month, selected, focusDate, focusSelector } = {}) => {
    const field = calendar.querySelector('textarea');
    const dates = selected || calendarDates(field.value);
    if (month) calendar.dataset.month = month;
    if (selected) {
      field.value = dates.join('\n');
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    calendar.querySelector('[data-calendar-view]').innerHTML = calendarView(field.name, calendar.dataset.month, dates, calendar.dataset.today, focusDate, calendar.dataset.disabled === 'true', { selectionLabel: calendar.dataset.selectionLabel, minDate: calendar.dataset.minDate });
    if (focusDate) calendar.querySelector(`[data-calendar-date="${focusDate}"]`)?.focus();
    else if (focusSelector) calendar.querySelector(focusSelector)?.focus();
  };
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    const calendar = button?.closest('[data-date-calendar]');
    if (!calendar || !root.contains(calendar) || button.disabled || calendar.closest('form')?.dataset.busy === 'true') return;
    const field = calendar.querySelector('textarea');
    const selected = calendarDates(field.value);
    if (button.hasAttribute('data-calendar-move')) {
      const move = Number(button.dataset.calendarMove);
      render(calendar, { month: shiftCalendarMonth(calendar.dataset.month, move), focusSelector: `[data-calendar-move="${move}"]` });
    } else if (button.hasAttribute('data-calendar-today')) {
      render(calendar, { month: calendar.dataset.today.slice(0, 7), focusDate: calendar.dataset.today });
    } else if (button.dataset.calendarDate || button.dataset.calendarRemove) {
      if (calendar.dataset.disabled === 'true') return;
      const date = button.dataset.calendarDate || button.dataset.calendarRemove;
      const dates = toggleCalendarDate(selected, date);
      render(calendar, { selected: dates, ...(button.dataset.calendarDate ? { focusDate: date } : { focusSelector: '.calendar-selection summary' }) });
      calendar.querySelector('[data-calendar-status]').textContent = `${dateLabel(date)} ${dates.includes(date) ? 'selected' : 'removed'}. ${dates.length} dates selected. ${calendar.dataset.saveLabel} to apply.`;
    }
  });
  root.addEventListener('keydown', event => {
    const button = event.target.closest('[data-calendar-date]');
    const calendar = button?.closest('[data-date-calendar]');
    if (!calendar || !root.contains(calendar) || button.disabled || calendar.closest('form')?.dataset.busy === 'true') return;
    const date = calendarKeyDate(button.dataset.calendarDate, event.key, event.shiftKey);
    if (!date) return;
    event.preventDefault();
    if (calendar.dataset.minDate && date < calendar.dataset.minDate) return;
    render(calendar, { month: date.slice(0, 7), focusDate: date });
  });
}
