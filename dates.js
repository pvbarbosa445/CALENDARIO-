// Utilidades de data trabalhando sempre com strings ISO "AAAA-MM-DD".
// Todas as contas são feitas em UTC para evitar qualquer efeito de fuso/horário de verão.

const DAY = 86400000;

export function iso(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parse(s) {
  return { y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10) };
}

export function toUTC(s) {
  return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
}

export function fromUTC(t) {
  const dt = new Date(t);
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(s, n) {
  return fromUTC(toUTC(s) + n * DAY);
}

export function diffDays(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / DAY);
}

/** 0 = domingo ... 6 = sábado */
export function weekday(s) {
  return new Date(toUTC(s)).getUTCDay();
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthStart(y, m) { return iso(y, m, 1); }
export function monthEnd(y, m) { return iso(y, m, daysInMonth(y, m)); }

export function addMonths(y, m, n) {
  const t = (y * 12 + (m - 1)) + n;
  return { y: Math.floor(t / 12), m: (t % 12) + 1 };
}

export function todayISO() {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Itera de a até b (inclusive). */
export function* range(a, b) {
  for (let t = toUTC(a), end = toUTC(b); t <= end; t += DAY) yield fromUTC(t);
}

export const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
  'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const WEEKDAYS_SHORT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
export const WEEKDAYS_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado'];
