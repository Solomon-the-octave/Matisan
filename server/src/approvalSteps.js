// The paper "critical path", in order. `scope` says where the person sitting
// in that position comes from: the project's own team (site) or head office.
export const APPROVAL_STEPS = [
  { step: 1, action: 'Submit', label: 'Prepared By',     positionId: 'time-keeper', name: 'Time Keeper',        scope: 'site' },
  { step: 2, action: 'Check', label: 'Checked By',      positionId: 'foreman', name: 'Foreman',            scope: 'site' },
  { step: 3, action: 'Re-check', label: 'Re-Checked By',   positionId: 'site-engineer', name: 'Site Engineer',      scope: 'site' },
  { step: 4, action: 'Prepare', label: 'Prepared By',     positionId: 'site-finance', name: 'Site Finance',       scope: 'site' },
  { step: 5, action: 'Check', label: 'Checked By',      positionId: 'ho-office-engineer', name: 'Office Engineer', scope: 'head_office' },
  { step: 6, action: 'Re-check', label: 'Re-Checked By',   positionId: 'ho-contract', name: 'Contract Department',        scope: 'head_office' },
  { step: 7, action: 'Approve', label: 'Approved By',     positionId: 'ho-core-manager', name: 'Core Department Manager',    scope: 'head_office' },
  { step: 8, action: 'Re-approve', label: 'Re-Approved By',  positionId: 'ho-dgm', name: 'Deputy General Manager',             scope: 'head_office' },
  { step: 9, action: 'Verify', label: 'Verified By',     positionId: 'ho-gm', name: 'General Manager',              scope: 'head_office' },
  { step: 10, action: 'Mark as paid', label: 'Paid By',        positionId: 'ho-finance', name: 'Finance',         scope: 'head_office' },
];
export const LAST_STEP = APPROVAL_STEPS.length; // 10
export const SITE_LAST_STEP = 3; // after this the week is locked for the field

export function statusForStep(pointer) {
  if (pointer > LAST_STEP) return 'paid';
  if (pointer > SITE_LAST_STEP) return 'in_review';
  return 'submitted';
}
