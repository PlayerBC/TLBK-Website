import { calendarKeyDate, calendarMonthDays, isCalendarDate, shiftCalendarMonth } from './date-calendar.js';
import { customerBookingWindow, customerDateIssue, sameDayOpen } from './shop-rules.js?v=production-cutoff-1';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const labelDate = date => `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
const labelMonth = month => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const clamp = (value, minimum, maximum) => value < minimum ? minimum : value > maximum ? maximum : value;
const nextDate = (date, direction) => calendarKeyDate(date, direction < 0 ? 'ArrowLeft' : 'ArrowRight');
const labelCutoff = value => {
  if (!/^\d{2}:\d{2}/.test(value || '')) return '';
  const [hour, minute, second = 0] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')}${second ? `:${String(second).padStart(2, '0')}` : ''} ${hour < 12 ? 'AM' : 'PM'}`;
};

// This model also bounds months restored from an old browser session.
export function customerCalendarModel({ value = '', settings = {}, method = 'pickup', month, focusDate, now = new Date(), allowSameDay = false } = {}) {
  const sameDayAvailable = allowSameDay && sameDayOpen(settings, now);
  const window = customerBookingWindow(now, sameDayAvailable);
  const selected = isCalendarDate(value) ? value : '';
  const initialMonth = selected && !customerDateIssue(selected, settings, method, now, allowSameDay) ? selected.slice(0, 7) : window.minMonth;
  const displayedMonth = clamp(isCalendarDate(`${month}-01`) ? month : initialMonth, window.minMonth, window.maxMonth);
  const cells = calendarMonthDays(displayedMonth).map(date => date ? {
    date,
    reason: customerDateIssue(date, settings, method, now, allowSameDay),
    selected: date === selected,
    today: date === window.today
  } : null);
  const available = cells.filter(day => day && !day.reason);
  const focused = available.find(day => day.date === focusDate) || available.find(day => day.selected) || available[0];
  return { ...window, month: displayedMonth, selected, cells, focusDate: focused?.date || '', method, allowSameDay, sameDayAvailable, cutoff: labelCutoff(settings.cutoff_time),
    previousDisabled: displayedMonth <= window.minMonth,
    nextDisabled: displayedMonth >= window.maxMonth,
    selectionIssue: value ? customerDateIssue(value, settings, method, now, allowSameDay) : '' };
}

// Arrow keys skip unavailable days and cannot escape the same booking bounds as clicks.
export function customerCalendarKeyTarget(date, key, settings = {}, method = 'pickup', now = new Date(), shiftKey = false, allowSameDay = false) {
  const moved = calendarKeyDate(date, key, shiftKey);
  if (!moved) return null;
  const { minDate, maxDate } = customerBookingWindow(now, allowSameDay && sameDayOpen(settings, now));
  let target = clamp(moved, minDate, maxDate);
  const direction = moved < date ? -1 : 1;
  while (target >= minDate && target <= maxDate) {
    if (!customerDateIssue(target, settings, method, now, allowSameDay)) return target;
    target = nextDate(target, direction);
  }
  return null;
}

export function customerCalendarView(model) {
  const rows = [];
  const sameDayHelp = model.sameDayAvailable
    ? `Same-day booking is available for eligible products${model.cutoff ? ` before ${model.cutoff} Philippine time` : ''}, subject to stock and closures.`
    : model.allowSameDay
      ? `Today's order cutoff${model.cutoff ? ` (${model.cutoff} Philippine time)` : ''} has passed. Choose tomorrow or a later date.`
      : `Same-day booking requires eligible products${model.cutoff ? ` and ordering before ${model.cutoff} Philippine time` : ''}. Choose tomorrow or a later date for this basket.`;
  for (let index = 0; index < model.cells.length; index += 7) {
    rows.push(`<tr>${model.cells.slice(index, index + 7).map(day => day ? `<td><button type="button" class="customer-calendar-day" data-customer-date="${day.date}" aria-label="${escape(`${labelDate(day.date)}${day.reason ? `. ${day.reason}` : ''}`)}" aria-pressed="${day.selected}" ${day.today ? 'aria-current="date"' : ''} ${day.reason ? `disabled title="${escape(day.reason)}"` : ''} tabindex="${day.date === model.focusDate ? 0 : -1}">${Number(day.date.slice(8))}</button></td>` : '<td></td>').join('')}</tr>`);
  }
  return `<div class="customer-calendar-heading"><h2 id="customer-calendar-title">Choose a date</h2><button type="button" class="customer-calendar-close" data-customer-close aria-label="Close calendar">×</button></div>
    <p id="customer-calendar-guidance" class="customer-calendar-guidance">${model.method === 'delivery' ? 'Delivery' : 'Pickup'} dates · Book through ${labelDate(model.maxDate)}.</p>
    <div class="customer-calendar-toolbar"><button type="button" class="customer-calendar-nav" data-customer-month="-1" aria-label="Previous month" ${model.previousDisabled ? 'disabled' : ''}>‹</button><strong id="customer-calendar-month" aria-live="polite">${labelMonth(model.month)}</strong><button type="button" class="customer-calendar-nav" data-customer-month="1" aria-label="Next month" ${model.nextDisabled ? 'disabled' : ''}>›</button></div>
    <table class="customer-calendar-month" aria-labelledby="customer-calendar-month" aria-describedby="customer-calendar-guidance"><thead><tr>${WEEKDAYS.map(day => `<th scope="col">${day}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>
    ${!model.focusDate ? '<p class="customer-calendar-empty">No dates are available in this month.</p>' : ''}
    <div class="customer-calendar-legend"><span><i class="customer-calendar-selected-key" aria-hidden="true"></i> Selected</span><span><i class="customer-calendar-unavailable-key" aria-hidden="true"></i> Unavailable</span></div>
    <p class="customer-calendar-help">${escape(sameDayHelp)} Past dates and closed dates are unavailable. Dates use Philippine time.</p>
    ${model.selectionIssue ? `<p class="customer-calendar-error" role="status">${escape(model.selectionIssue)}</p>` : ''}
    <div class="customer-calendar-footer"><button type="button" data-customer-clear ${!model.selected ? 'disabled' : ''}>Clear date</button><button type="button" data-customer-current>Current month</button></div>`;
}

export function mountCustomerCalendar(container, { value = '', settings = {}, method = 'pickup', allowSameDay = false, onSelect, now = () => new Date() } = {}) {
  const ownerDocument = container.ownerDocument;
  const controller = new AbortController();
  const listener = { signal: controller.signal };
  let state = { value, settings, method, allowSameDay };
  let month;
  let destroyed = false;
  let returnFocus = true;
  let clockTimer;
  let clockKey;
  const trigger = ownerDocument.createElement('button');
  trigger.id = 'fulfillment-date';
  trigger.type = 'button';
  trigger.className = 'customer-calendar-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'customer-calendar-popup');
  const popup = ownerDocument.createElement('dialog');
  popup.id = 'customer-calendar-popup';
  popup.className = 'customer-calendar-popup';
  popup.setAttribute('aria-labelledby', 'customer-calendar-title');
  popup.setAttribute('aria-describedby', 'customer-calendar-guidance');
  container.replaceChildren(trigger);
  ownerDocument.body.append(popup);

  const updateTrigger = () => {
    const valid = isCalendarDate(state.value);
    const issue = state.value ? customerDateIssue(state.value, state.settings, state.method, now(), state.allowSameDay) : '';
    trigger.value = state.value;
    trigger.innerHTML = `<span>${valid ? labelDate(state.value) : 'Choose a date'}</span><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M8 15h1M15 15h1"/></svg>`;
    trigger.setAttribute('aria-label', valid ? `Fulfillment date: ${labelDate(state.value)}. Change date.` : 'Choose fulfillment date');
    trigger.setAttribute('aria-invalid', issue ? 'true' : 'false');
    trigger.title = issue;
  };
  const render = ({ focusDate, focusSelector, focus = false } = {}) => {
    const model = customerCalendarModel({ ...state, month, focusDate, now: now() });
    month = model.month;
    clockKey = `${model.today}:${model.sameDayAvailable}`;
    popup.innerHTML = customerCalendarView(model);
    updateTrigger();
    if (focus && popup.open) {
      const requested = focusSelector && popup.querySelector(focusSelector);
      const dateButton = model.focusDate && popup.querySelector(`[data-customer-date="${model.focusDate}"]`);
      (requested && !requested.disabled ? requested : dateButton || popup.querySelector('[data-customer-close]'))?.focus();
    }
    return model;
  };
  const refreshClock = () => {
    clearTimeout(clockTimer);
    if (!popup.open || destroyed) return;
    const instant = now();
    const window = customerBookingWindow(instant);
    const freshKey = `${window.today}:${state.allowSameDay && sameDayOpen(state.settings, instant)}`;
    if (freshKey !== clockKey) {
      const focused = ownerDocument.activeElement;
      render({ focusDate: focused?.dataset.customerDate, focus: popup.contains(focused) });
    }
    // Wake at the next cutoff or Manila midnight; no repeated API or clock polling.
    let boundary = new Date(`${nextDate(window.today, 1)}T00:00:00+08:00`).getTime();
    if (state.settings.cutoff_time) {
      const cutoff = new Date(`${window.today}T${state.settings.cutoff_time.length === 5 ? state.settings.cutoff_time + ':00' : state.settings.cutoff_time}+08:00`).getTime();
      if (cutoff > instant.getTime()) boundary = Math.min(boundary, cutoff);
    }
    clockTimer = setTimeout(refreshClock, Math.max(1, boundary - instant.getTime() + 5));
  };
  const close = () => {
    clearTimeout(clockTimer);
    if (popup.open) popup.close();
    trigger.setAttribute('aria-expanded', 'false');
  };
  const choose = date => {
    // Recheck at activation: a popup can remain open over midnight or settings updates.
    if (date && customerDateIssue(date, state.settings, state.method, now(), state.allowSameDay)) {
      render({ focus: true });
      return;
    }
    state.value = date;
    updateTrigger();
    close();
    onSelect?.(date);
  };
  trigger.addEventListener('click', () => {
    if (popup.open) return;
    month = undefined;
    render();
    popup.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    render({ focus: true });
    refreshClock();
  }, listener);
  popup.addEventListener('close', () => {
    clearTimeout(clockTimer);
    trigger.setAttribute('aria-expanded', 'false');
    if (!destroyed && returnFocus && trigger.isConnected) trigger.focus();
  }, listener);
  popup.addEventListener('cancel', event => {
    event.preventDefault();
    close();
  }, listener);
  popup.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button && popup.contains(button) && !button.disabled) {
      if (button.hasAttribute('data-customer-close')) close();
      else if (button.hasAttribute('data-customer-clear')) choose('');
      else if (button.hasAttribute('data-customer-current')) {
        month = customerBookingWindow(now()).minMonth;
        render({ focus: true });
      } else if (button.hasAttribute('data-customer-month')) {
        const move = Number(button.dataset.customerMonth);
        const fresh = customerCalendarModel({ ...state, month, now: now() });
        month = shiftCalendarMonth(fresh.month, move);
        render({ focus: true, focusSelector: `[data-customer-month="${move}"]` });
      } else if (button.dataset.customerDate) choose(button.dataset.customerDate);
    } else if (event.target === popup) {
      const bounds = popup.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    }
  }, listener);
  popup.addEventListener('keydown', event => {
    const button = event.target.closest('[data-customer-date]');
    if (!button || button.disabled) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
    event.preventDefault();
    const target = customerCalendarKeyTarget(button.dataset.customerDate, event.key, state.settings, state.method, now(), event.shiftKey, state.allowSameDay);
    if (target) month = target.slice(0, 7);
    render({ focusDate: target || button.dataset.customerDate, focus: true });
  }, listener);
  updateTrigger();
  return {
    update(changes = {}) {
      for (const key of ['value', 'settings', 'method', 'allowSameDay']) if (Object.hasOwn(changes, key)) state[key] = changes[key];
      updateTrigger();
      if (popup.open) { render({ focus: true }); refreshClock(); }
    },
    destroy() {
      destroyed = true;
      returnFocus = false;
      controller.abort();
      close();
      popup.remove();
      trigger.remove();
    }
  };
}
