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
 * Lista os feriados de um ano com o nível de cada um (nacional, estadual, municipal, personalizado).
 * cfg: { state, city, optional, custom: [{ date, name, scope, yearly }], disabled: [nomes desligados] }
 */
export function listHolidays(y, cfg = {}) {
  const out = new Map();
  const add = (date, name, scope) => { if (!out.has(date)) out.set(date, { date, name, scope }); };
  const e = easter(y);
  NATIONAL_FIXED.forEach(([m, d, n]) => add(iso(y, m, d), n, 'nacional'));
  NATIONAL_MOVABLE.forEach(([o, n]) => add(addDays(e, o), n, 'nacional'));
  if (cfg.optional) OPTIONAL_MOVABLE.forEach(([o, n]) => add(addDays(e, o), n, 'facultativo'));
  const st = cfg.state && LOCALES.states[cfg.state];
  if (st) {
    st.fixed.forEach(([m, d, n]) => add(iso(y, m, d), n, 'estadual'));
    st.movable.forEach(([o, n]) => add(addDays(e, o), n, 'estadual'));
  }
  const ct = cfg.city && LOCALES.cities[cfg.city];
  if (ct) {
    ct.fixed.forEach(([m, d, n]) => add(iso(y, m, d), n, 'municipal'));
    ct.movable.forEach(([o, n]) => add(addDays(e, o), n, 'municipal'));
  }
  for (const h of cfg.custom || []) {
    const date = h.yearly ? `${y}-${h.date.slice(5)}` : h.date;
    if (date.slice(0, 4) === String(y)) out.set(date, { date, name: h.name, scope: h.scope || 'personalizado', custom: true });
  }
  const off = new Set(cfg.disabled || []);
  return [...out.values()].filter(h => !off.has(h.name)).sort((a, b) => a.date.localeCompare(b.date));
}

/** Cria isHoliday(dataISO) -> nome | null, com cache por ano. */
export function makeHolidayLookup(cfg = {}) {
  const cache = new Map();
  return function isHoliday(date) {
    const y = +date.slice(0, 4);
    let map = cache.get(y);
    if (!map) { map = new Map(listHolidays(y, cfg).map(h => [h.date, h.name])); cache.set(y, map); }
    return map.get(date) || null;
  };
}

/** Todos os nomes de feriados possíveis (para ligar/desligar individualmente). */
export function holidayNames(cfg = {}) {
  const y = new Date().getFullYear();
  return listHolidays(y, { ...cfg, disabled: [] });
}

/** Todos os estados (UF), para escolher a localização. Feriados estaduais/municipais existem só onde estão em LOCALES. */
export const UFS = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
  PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
  SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};
