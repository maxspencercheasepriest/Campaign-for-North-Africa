// The board's hex numbering: section letter A-E + column (2 digits) + row (2 digits), e.g. Tobruk = C4807.
// Sections are laid west to east; row 34 of one section is the same hexrow as row 01 of the next.
// Game coordinates: c = column - 1, r = 33 * section + row - 1.

const SECTIONS = 'ABCDE';

export function hexFromName(name) {
  const m = /^([A-E])\s?(\d{2})(\d{2})$/.exec(String(name).trim().toUpperCase());
  if (!m) return null;
  const s = SECTIONS.indexOf(m[1]);
  return [Number(m[2]) - 1, 33 * s + Number(m[3]) - 1];
}

// Preferred printed name for a hex (the later section for the shared hexrow).
export function nameOfHex(c, r) {
  let s = Math.min(4, Math.floor(r / 33));
  let row = r - 33 * s + 1;
  if (row < 1) { s -= 1; row = r - 33 * s + 1; }
  return `${SECTIONS[s]}${String(c + 1).padStart(2, '0')}${String(row).padStart(2, '0')}`;
}
