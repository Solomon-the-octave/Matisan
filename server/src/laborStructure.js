// Matisan's own Labor Structure chart: every job title falls under one of
// two categories, Skilled or Non-Skilled ("D.L" / Day Laborer on the paper
// sheets). Headquarters tracks payroll cost split across these two groups,
// so this list is shared by every route that reports on workers or payroll.
// Keep in sync with the client's copy in FieldAttendance.jsx.
export const SKILLED_TITLES = [
  'Carpenter', 'Assistant Carpenter', 'Mason', 'Assistant Mason', 'Bar-bender',
  'Assistant Bar-bender', 'Chiseler', 'Mixer Operator', 'Vibrator Operator',
  'Winch Operator', 'Electrician Plumber', 'Tiller', 'Painter', 'Driller',
];

export function laborType(trade) {
  return SKILLED_TITLES.includes(trade) ? 'Skilled' : 'Non-Skilled';
}
