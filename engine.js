// Motor financeiro: gera ocorrências a partir das regras de recorrência, aplica as
// alterações individuais (pago, adiado, cancelado...) e calcula os saldos acumulados.
// Módulo puro (sem DOM, sem IndexedDB) para poder ser testado isoladamente.
import { addDays, diffDays, weekday, daysInMonth, iso, parse, range, monthStart, monthEnd, addMonths } from './dates.js';

export const RULES = {
  once: 'Não repete',
  daily: 'Todos os dias',
  businessDays: 'Todos os dias úteis',
  weekends: 'Finais de semana',
  holidays: 'Somente feriados',
  weekendsHolidays: 'Finais de semana e feriados',
  weekly: 'Semanal (dias da semana)',
  monthlyDay: 'Mensal (dia fixo)',
  nthBusinessDay: 'N-ésimo dia útil do mês',
  interval: 'A cada N dias',
  dates: 'Datas personalizadas',
};

// Regras que já levam feriados em conta por definição (a política de feriado não se aplica).
const HOLIDAY_AWARE = new Set(['businessDays', 'weekends', 'holidays', 'weekendsHolidays', 'nthBusinessDay']);
const PAD = 12; // folga de dias para ocorrências transferidas entre meses

/** Dias da semana considerados úteis (0 = domingo … 6 = sábado). Padrão: segunda a sexta. Configurável. */
let WORKDAYS = new Set([1, 2, 3, 4, 5]);
export function setWorkdays(days) { WORKDAYS = new Set((days && days.length ? days : [1, 2, 3, 4, 5]).map(Number)); }
export const getWorkdays = () => [...WORKDAYS].sort();

export function isBusinessDay(d, isHoliday, saturday = false) {
  const w = weekday(d);
  if (w === 6 && saturday) return !isHoliday(d); // "contar sábado" de uma recorrência específica
  if (!WORKDAYS.has(w)) return false;
  return !isHoliday(d);
}

function shiftToBusiness(d, dir, isHoliday) {
  let x = d;
  for (let i = 0; i < 31; i++) {
    x = addDays(x, dir);
    if (isBusinessDay(x, isHoliday)) return x;
  }
  return d;
}

/** Datas-base (antes da política de feriado) da regra dentro de [from, to]. */
function rawDates(rule, from, to, isHoliday) {
  const out = [];
  const t = rule.type;
  if (t === 'once') {
    if (rule.start >= from && rule.start <= to) out.push(rule.start);
    return out;
  }
  if (t === 'dates') {
    for (const d of rule.dates || []) if (d >= from && d <= to) out.push(d);
    return out.sort();
  }
  if (t === 'nthBusinessDay') {
    let { y, m } = parse(from);
    const last = parse(to);
    while (y * 12 + m <= last.y * 12 + last.m) {
      const biz = [];
      for (let d = 1; d <= daysInMonth(y, m); d++) {
        const s = iso(y, m, d);
        if (isBusinessDay(s, isHoliday, !!rule.saturday)) biz.push(s);
      }
      const n = +rule.n || 1;
      // se o mês tiver menos dias úteis que o pedido (ex.: 20º), usa o último dia útil — a ocorrência nunca some
      const pick = n < 0 ? biz[biz.length + n] : (biz[n - 1] || biz[biz.length - 1]);
      if (pick && pick >= from && pick <= to) out.push(pick);
      ({ y, m } = addMonths(y, m, 1));
    }
    return out;
  }
  for (const d of range(from, to)) {
    const w = weekday(d);
    let ok = false;
    switch (t) {
      case 'daily': ok = true; break;
      case 'businessDays': ok = isBusinessDay(d, isHoliday); break;
      case 'weekends': ok = w === 0 || w === 6; break;
      case 'holidays': ok = !!isHoliday(d); break;
      case 'weekendsHolidays': ok = w === 0 || w === 6 || !!isHoliday(d); break;
      case 'weekly': {
        const days = rule.weekdays && rule.weekdays.length ? rule.weekdays : [weekday(rule.start)];
        if (!days.includes(w)) break;
        const every = Math.max(1, +rule.every || 1);
        const anchor = addDays(rule.start, -weekday(rule.start)); // domingo da semana inicial
        const weeks = Math.floor(diffDays(anchor, d) / 7);
        ok = weeks >= 0 && weeks % every === 0;
        break;
      }
      case 'interval': {
        const n = Math.max(1, +rule.every || 1);
        const k = diffDays(rule.start, d);
        ok = k >= 0 && k % n === 0;
        break;
      }
      case 'monthlyDay': {
        const { y, m, d: dd } = parse(d);
        ok = dd === Math.min(+rule.day || 1, daysInMonth(y, m));
        break;
      }
    }
    if (ok) out.push(d);
  }
  return out;
}

/**
 * Ocorrências de uma entrada com data final dentro de [from, to].
 * Retorna [{ orig, date }] — orig é a data-base (chave estável da ocorrência).
 */
export function occurrences(entry, from, to, isHoliday) {
  const rule = entry.rule;
  const pFrom = addDays(from, -PAD), pTo = addDays(to, PAD);
  const lo = rule.start > pFrom ? rule.start : pFrom;
  const hi = rule.end && rule.end < pTo ? rule.end : pTo;
  if (lo > hi) return [];
  const policy = HOLIDAY_AWARE.has(rule.type) ? 'keep' : (rule.holidayPolicy || 'keep');
  const res = [];
  for (const orig of rawDates(rule, lo, hi, isHoliday)) {
    let date = orig;
    if (policy !== 'keep') {
      const w = weekday(orig);
      const trigger = !!isHoliday(orig) || (rule.policyWeekends && (w === 0 || w === 6));
      if (trigger) {
        if (policy === 'skip') continue;
        date = shiftToBusiness(orig, policy === 'prev' ? -1 : 1, isHoliday);
      }
    }
    if (date >= from && date <= to) res.push({ orig, date });
  }
  return res;
}

export const occKey = (entryId, orig) => `${entryId}|${orig}`;

/**
 * Atributos vigentes de uma recorrência numa data. entry.segments guarda mudanças com
 * vigência ("a partir de"), preservando o passado: [{ from, amount?, title?, tagId? }]
 */
export function attrsAt(e, orig) {
  const a = { amount: e.amount, title: e.title, tagId: e.tagId ?? null, metaId: e.metaId ?? null };
  for (const s of e.segments || []) {
    if (s.from > orig) break;
    if (s.amount != null) a.amount = s.amount;
    if (s.title != null) a.title = s.title;
    if ('tagId' in s) a.tagId = s.tagId;
    if ('metaId' in s) a.metaId = s.metaId;
  }
  return a;
}

/**
 * Lista todos os itens (ocorrências) entre from e to, agrupados por data.
 * data: { entries: [], overrides: Map(key -> override), isHoliday }
 * Status: planned | paid | pending | cancelled | moved (marcador no dia de origem, não soma)
 */
export function itemsInRange(from, to, data) {
  const byDate = new Map();
  const push = (d, it) => { let a = byDate.get(d); if (!a) byDate.set(d, a = []); a.push(it); };
  const seen = new Set();

  const make = (e, orig, baseDate) => {
    const key = occKey(e.id, orig);
    const ov = data.overrides.get(key);
    const a = attrsAt(e, orig);
    const date = ov && ov.movedTo ? ov.movedTo : baseDate;
    return {
      key, entryId: e.id, kind: e.kind,
      accountId: e.accountId || data.defaultAccount || null, toAccountId: e.toAccountId || null,
      piggyId: e.piggyId || null, origin: e.origin || '', splits: e.splits || null, distOf: e.distOf || null,
      paidAmount: ov && ov.paidAmount, distPending: !!(ov && ov.distPending),
      title: ov && ov.title != null ? ov.title : a.title,
      tagId: ov && 'tagId' in ov ? ov.tagId : a.tagId,
      metaId: ov && 'metaId' in ov ? ov.metaId : a.metaId, // lançamento classificado só na meta (sem tag)
      amount: ov && ov.amount != null ? ov.amount : a.amount,
      plannedAmount: a.amount,
      status: ov && ov.status ? ov.status : 'planned',
      paidAt: ov && ov.paidAt, orig, baseDate, date,
      recurring: e.rule.type !== 'once', moved: !!(ov && ov.movedTo),
    };
  };

  for (const e of data.entries) {
    for (const { orig, date } of occurrences(e, from, to, data.isHoliday)) {
      const it = make(e, orig, date);
      seen.add(it.key);
      if (it.moved) {
        // marcador "adiado" no dia original (informativo, não entra no saldo)
        push(date, { ...it, status: 'moved', date, movedTo: it.date });
        if (it.date >= from && it.date <= to) push(it.date, it);
      } else push(date, it);
    }
  }
  // ocorrências adiadas PARA este intervalo cuja data-base está fora dele
  for (const ov of data.overrides.values()) {
    if (!ov.movedTo || ov.movedTo < from || ov.movedTo > to || seen.has(ov.key)) continue;
    const e = data.entries.find(x => x.id === ov.entryId);
    if (!e) continue;
    const occ = occurrences(e, addDays(ov.orig, -PAD), addDays(ov.orig, PAD), data.isHoliday)
      .find(o => o.orig === ov.orig);
    if (occ) push(ov.movedTo, make(e, ov.orig, occ.date));
  }
  return byDate;
}

export const counts = it => it.status === 'planned' || it.status === 'paid' || it.status === 'pending' || it.status === 'partial';
export const realizedOf = it => (it.status === 'paid' ? it.amount : it.status === 'partial' ? Math.min(it.paidAmount || 0, it.amount) : 0);
const sign = it => (it.kind === 'income' ? 1 : -1);
const inAcc = (id, set) => !set || set.has(id);

/**
 * Efeito de um item no saldo de um conjunto de contas (null = todas).
 * Transferências entre contas do conjunto se anulam; cofrinhos virtuais não mudam o saldo.
 */
export function flowOf(it, set) {
  if (!counts(it)) return null;
  const a = it.amount, r = realizedOf(it);
  if (it.kind === 'income') return inAcc(it.accountId, set) ? { inc: a, incR: r, tr: 0, trR: 0, exp: 0, expR: 0 } : null;
  if (it.kind === 'expense') return inAcc(it.accountId, set) ? { exp: a, expR: r, tr: 0, trR: 0, inc: 0, incR: 0 } : null;
  if (it.kind === 'transfer') {
    let tr = 0, trR = 0;
    if (inAcc(it.accountId, set)) { tr -= a; trR -= r; }
    if (inAcc(it.toAccountId, set)) { tr += a; trR += r; }
    return tr || trR ? { tr, trR, inc: 0, incR: 0, exp: 0, expR: 0 } : null;
  }
  return null;
}

function totalsOf(byDate, set, minDate) {
  const t = { inc: 0, exp: 0, incPaid: 0, expPaid: 0, tr: 0, trPaid: 0 };
  for (const [d, items] of byDate) {
    if (minDate && d < minDate) continue;
    for (const it of items) {
      const f = flowOf(it, set); if (!f) continue;
      t.inc += f.inc; t.exp += f.exp; t.incPaid += f.incR; t.expPaid += f.expR; t.tr += f.tr; t.trPaid += f.trR;
    }
  }
  return t;
}

/**
 * Calculadora com cache por mês. opts: { carry, initialBalance (centavos), startDate, accounts (Set|null) }
 */
export function createCalculator(data, opts = {}) {
  const monthCache = new Map();
  const set = opts.accounts || null;

  function month(y, m) {
    const k = y * 12 + m;
    let r = monthCache.get(k);
    if (!r) {
      const byDate = itemsInRange(monthStart(y, m), monthEnd(y, m), data);
      r = { byDate, totals: totalsOf(byDate, set) };
      monthCache.set(k, r);
    }
    return r;
  }

  function opening(y, m) {
    if (!opts.carry) return { planned: 0, realized: 0 };
    let planned = opts.initialBalance || 0, realized = opts.initialBalance || 0;
    const start = opts.startDate;
    if (!start) return { planned, realized };
    let { y: sy, m: sm } = parse(start);
    while (sy * 12 + sm < y * 12 + m) {
      const mm = month(sy, sm);
      const t = (sy === +start.slice(0, 4) && sm === +start.slice(5, 7)) ? totalsOf(mm.byDate, set, start) : mm.totals;
      planned += t.inc - t.exp + t.tr;
      realized += t.incPaid - t.expPaid + t.trPaid;
      ({ y: sy, m: sm } = addMonths(sy, sm, 1));
    }
    return { planned, realized };
  }

  /** Visão completa de um mês, dia a dia, com acumulados previstos e realizados. */
  function computeMonth(y, m) {
    const { byDate, totals } = month(y, m);
    const open = opening(y, m);
    const days = [];
    let cInc = 0, cExp = 0, cTr = 0, cIncR = 0, cExpR = 0, cTrR = 0;
    for (let d = 1; d <= daysInMonth(y, m); d++) {
      const date = iso(y, m, d);
      const items = byDate.get(date) || [];
      let inc = 0, exp = 0, tr = 0;
      for (const it of items) {
        const f = flowOf(it, set); if (!f) continue;
        inc += f.inc; exp += f.exp; tr += f.tr;
        cIncR += f.incR; cExpR += f.expR; cTrR += f.trR;
      }
      cInc += inc; cExp += exp; cTr += tr;
      days.push({
        date, items, inc, exp, tr,
        cumInc: cInc, cumExp: cExp, cumNet: open.planned + cInc - cExp + cTr,
        cumIncReal: cIncR, cumExpReal: cExpR, cumNetReal: open.realized + cIncR - cExpR + cTrR,
      });
    }
    return { y, m, days, totals, opening: open };
  }

  return { computeMonth, invalidate: () => monthCache.clear() };
}

export { sign, inAcc };
