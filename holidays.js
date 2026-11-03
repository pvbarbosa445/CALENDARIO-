// Calendário de feriados configurável: nacionais + estaduais + municipais + personalizados.
import { iso, addDays } from './dates.js';

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

// Feriados por localidade. Para adicionar um estado/cidade basta incluir uma entrada aqui.
// fixed: [mês, dia, nome]; movable: [deslocamento em dias a partir da Páscoa, nome]
export const LOCALES = {
  states: {
    RS: { name: 'Rio Grande do Sul', fixed: [[9, 20, 'Revolução Farroupilha']], movable: [] },
  },
  cities: {
    POA: {
      name: 'Porto Alegre', state: 'RS',
      fixed: [[2, 2, 'Nossa Senhora dos Navegantes'], [11, 2, 'Finados']],
      movable: [[-2, 'Sexta-feira da Paixão'], [60, 'Corpus Christi']],
    },
  },
};

const NATIONAL_FIXED = [
  [1, 1, 'Confraternização Universal'],
  [4, 21, 'Tiradentes'],
  [5, 1, 'Dia do Trabalho'],
  [9, 7, 'Independência do Brasil'],
  [10, 12, 'Nossa Senhora Aparecida'],
  [11, 2, 'Finados'],
  [11, 15, 'Proclamação da República'],
  [11, 20, 'Dia Nacional de Zumbi e da Consciência Negra'],
  [12, 25, 'Natal'],
];
const NATIONAL_MOVABLE = [[-2, 'Sexta-feira da Paixão']];
const OPTIONAL_MOVABLE = [[-48, 'Carnaval (segunda)'], [-47, 'Carnaval (terça)'], [60, 'Corpus Christi']];

/**
 * Cria uma função isHoliday(dateISO) -> nome | null, com cache por ano.
 * cfg: { state, city, optional (pontos facultativos), custom: [{date, name}] }
 */
export function makeHolidayLookup(cfg = {}) {
  const cache = new Map();
  const custom = new Map((cfg.custom || []).map(h => [h.date, h.name]));

  function build(y) {
    const map = new Map();
    const add = (date, name) => { if (!map.has(date)) map.set(date, name); };
    const e = easter(y);
    NATIONAL_FIXED.forEach(([m, d, n]) => add(iso(y, m, d), n));
    NATIONAL_MOVABLE.forEach(([o, n]) => add(addDays(e, o), n));
    if (cfg.optional) OPTIONAL_MOVABLE.forEach(([o, n]) => add(addDays(e, o), n));
    const st = cfg.state && LOCALES.states[cfg.state];
    if (st) {
      st.fixed.forEach(([m, d, n]) => add(iso(y, m, d), n));
      st.movable.forEach(([o, n]) => add(addDays(e, o), n));
    }
    const ct = cfg.city && LOCALES.cities[cfg.city];
    if (ct) {
      ct.fixed.forEach(([m, d, n]) => add(iso(y, m, d), n));
      ct.movable.forEach(([o, n]) => add(addDays(e, o), n));
    }
    return map;
  }

  return function isHoliday(date) {
    if (custom.has(date)) return custom.get(date);
    const y = +date.slice(0, 4);
    let map = cache.get(y);
    if (!map) { map = build(y); cache.set(y, map); }
    return map.get(date) || null;
  };
}
