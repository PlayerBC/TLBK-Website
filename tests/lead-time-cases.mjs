// Expected business outcomes shared by browser and PostgreSQL regression tests.
export const leadTimeCases = [
  { name: 'two-day cake just before noon counts September 19', at: '2026-09-19T11:59:59.999+08:00', days: 2, expected: '2026-09-21' },
  { name: 'noon starts production on September 20', at: '2026-09-19T12:00:00+08:00', days: 2, expected: '2026-09-22' },
  { name: 'after noon adds no extra production requirement', at: '2026-09-19T23:59:59.999+08:00', days: 2, expected: '2026-09-22' },
  { name: 'UTC evening uses the new Manila production date', at: '2026-09-18T16:00:00Z', days: 2, expected: '2026-09-21' },
  { name: 'excluded order date never counts before cutoff', at: '2026-09-19T09:00:00+08:00', days: 2, settings: { nonproduction_dates: ['2026-09-19'] }, expected: '2026-09-22' },
  { name: 'excluded order date adds no penalty at cutoff', at: '2026-09-19T12:00:00+08:00', days: 2, settings: { nonproduction_dates: ['2026-09-19'] }, expected: '2026-09-22' },
  { name: 'future production exclusion is skipped', at: '2026-09-19T09:00:00+08:00', days: 2, settings: { nonproduction_dates: ['2026-09-20'] }, expected: '2026-09-22' },
  { name: 'disabled weekend production skips Saturday and Sunday', at: '2026-09-19T09:00:00+08:00', days: 2, settings: { production_weekdays: [1,2,3,4,5] }, expected: '2026-09-23' },
  { name: 'fulfillment closure does not remove a production day', at: '2026-09-19T09:00:00+08:00', days: 2, settings: { blocked_dates: ['2026-09-19','2026-09-20'] }, expected: '2026-09-21' },
  { name: 'cutoff seconds are honored before the boundary', at: '2026-09-19T12:00:29.999+08:00', days: 1, settings: { cutoff_time: '12:00:30' }, expected: '2026-09-20' },
  { name: 'cutoff seconds are honored at the boundary', at: '2026-09-19T12:00:30+08:00', days: 1, settings: { cutoff_time: '12:00:30' }, expected: '2026-09-21' },
  { name: 'zero days before cutoff still means tomorrow without same-day opt-in', at: '2026-09-19T09:00:00+08:00', days: 0, expected: '2026-09-20' },
  { name: 'zero days after cutoff still means tomorrow', at: '2026-09-19T12:00:00+08:00', days: 0, expected: '2026-09-20' },
  { name: 'no cutoff preserves next-day production start', at: '2026-09-19T09:00:00+08:00', days: 2, settings: { cutoff_time: null }, expected: '2026-09-22' },
  { name: 'blank cutoff preserves next-day production start', at: '2026-09-19T09:00:00+08:00', days: 2, settings: { cutoff_time: '' }, expected: '2026-09-22' },
];
