// Operações sobre lançamentos e ocorrências. Funções puras: recebem o estado atual e
// devolvem um conjunto de mudanças { entries, overrides, checks } (Map id -> registro | null).
// null = apagar. O app aplica as mudanças, guarda o inverso (desfazer) e registra o histórico.
import { itemsInRange, attrsAt, occKey } from './engine.js';
import { addDays, weekday, parse, iso, daysInMonth } from './dates.js';

export const SCOPES = {
  one: 'Somente neste lançamento',
  day: 'Somente neste dia',
  week: 'Somente nesta semana',
  month: 'Somente neste mês',
  year: 'Somente neste ano',
  future: 'Nesta data e nas próximas',
  all: 'Na recorrência inteira',
};

export const newChanges = () => ({ entries: new Map(), overrides: new Map(), checks: new Map() });
export const changeCount = ch => ch.entries.size + ch.overrides.size + ch.checks.size;

const OV_FIELDS = ['status', 'amount', 'title', 'tagId', 'movedTo'];
const meaningful = o => OV_FIELDS.some(f => f in o && (f === 'tagId' || o[f] != null));

function curOv(ch, data, key) {
  return ch.overrides.has(key) ? ch.overrides.get(key) : data.overrides.get(key);
}

/** Mescla campos no ajuste da ocorrência. Campo com valor undefined é removido. */
export function setOv(ch, data, item, fields, now = new Date().toISOString()) {
  const prev = curOv(ch, data, item.key);
  const ov = { ...(prev || { key: item.key, entryId: item.entryId, orig: item.orig }) };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) delete ov[k]; else ov[k] = v;
  }
  if (ov.status !== 'paid') delete ov.paidAt;
  if (ov.movedTo && ov.movedTo === item.baseDate) delete ov.movedTo;
  ov.updatedAt = now;
  ch.overrides.set(item.key, meaningful(ov) ? ov : null);
  return ch;
}

/** Ocorrências (reais, sem marcadores de adiamento) de uma entrada num intervalo. */
export function entryItems(entry, from, to, data) {
  const by = itemsInRange(from, to, { ...data, entries: [entry] });
  const out = [];
  for (const list of by.values()) for (const it of list) if (it.status !== 'moved') out.push(it);
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function scopeRange(scope, date, mondayFirst = false) {
  const { y, m } = parse(date);
  switch (scope) {
    case 'day': return { from: date, to: date };
    case 'week': {
      const back = (weekday(date) - (mondayFirst ? 1 : 0) + 7) % 7;
      const from = addDays(date, -back);
      return { from, to: addDays(from, 6) };
    }
    case 'month': return { from: iso(y, m, 1), to: iso(y, m, daysInMonth(y, m)) };
    case 'year': return { from: iso(y, 1, 1), to: iso(y, 12, 31) };
    default: return null;
  }
}

/** Data a partir da qual "a recorrência inteira" muda: hoje (o passado fica intacto). */
export const allFrom = (entry, today) => (entry.rule.start > today ? entry.rule.start : today);

/** Quantos lançamentos cada alcance afeta — para mostrar antes de confirmar. */
export function scopePreview(scope, { entry, item, today, data, mondayFirst }) {
  if (scope === 'one') return { count: 1, from: item.date, to: item.date };
  const r = scopeRange(scope, item.date, mondayFirst);
  if (r) {
    const its = entryItems(entry, r.from, r.to, data).filter(i => i.key === item.key || i.status !== 'paid');
    return { count: its.length, from: its.length ? its[0].date : r.from, to: its.length ? its[its.length - 1].date : r.to };
  }
  const from = scope === 'future' ? item.orig : allFrom(entry, today);
  return { count: Infinity, from, to: entry.rule.end || null };
}

/**
 * Edição de valores (valor, descrição, tag) com alcance.
 * patch: { amount?, title?, tagId? }  pay: marcar a ocorrência selecionada como paga
 */
export function planEdit({ entry, item, patch, pay, scope, today, data, mondayFirst, now }) {
  const ch = newChanges();
  const payFields = pay ? { status: 'paid', paidAt: now || new Date().toISOString() } : {};
  if (scope === 'one' || entry.rule.type === 'once') {
    return setOv(ch, data, item, { ...patch, ...payFields }, now);
  }
  const r = scopeRange(scope, item.date, mondayFirst);
  if (r) {
    for (const it of entryItems(entry, r.from, r.to, data)) {
      if (it.key !== item.key && it.status === 'paid') continue; // pagamentos preservam o valor efetivo
      setOv(ch, data, it, it.key === item.key ? { ...patch, ...payFields } : patch, now);
    }
    return ch;
  }
  // future / all: nova vigência dos atributos a partir de D
  const D = scope === 'future' ? item.orig : allFrom(entry, today);
  const fields = Object.keys(patch);
  const e = { ...entry, segments: (entry.segments || []).map(s => ({ ...s })) };
  if (D <= entry.rule.start) {
    Object.assign(e, patch);
    e.segments.forEach(s => fields.forEach(f => delete s[f]));
  } else {
    e.segments.forEach(s => { if (s.from >= D) fields.forEach(f => delete s[f]); });
    e.segments.push({ from: D, ...patch });
  }
  e.segments = e.segments.filter(s => Object.keys(s).length > 1).sort((a, b) => a.from.localeCompare(b.from));
  e.updatedAt = now || new Date().toISOString();
  ch.entries.set(e.id, e);
  // ajustes individuais futuros (não pagos) passam a seguir o novo valor
  for (const ov of data.overrides.values()) {
    if (ov.entryId !== entry.id || ov.orig < D || ov.status === 'paid') continue;
    const clear = {};
    fields.forEach(f => { if (f in ov) clear[f] = undefined; });
    if (Object.keys(clear).length) setOv(ch, data, { key: ov.key, entryId: ov.entryId, orig: ov.orig }, clear, now);
  }
  if (pay || item.orig < D) setOv(ch, data, item, item.orig < D ? { ...patch, ...payFields } : payFields, now);
  return ch;
}

/** Status em lote: 'paid' | 'pending' | 'cancelled' | null (voltar a previsto). */
export function planStatus(items, status, data, now = new Date().toISOString(), ch = newChanges()) {
  for (const it of items) {
    if (it.status === 'moved') continue;
    setOv(ch, data, it, status ? { status, ...(status === 'paid' ? { paidAt: now } : {}) } : { status: undefined }, now);
  }
  return ch;
}

/** Novo valor em lote (pagamentos realizados são preservados). */
export function planAmount(items, amount, data, now, ch = newChanges()) {
  for (const it of items) if (it.status !== 'paid' && it.status !== 'moved') setOv(ch, data, it, { amount }, now);
  return ch;
}

/** Adiar: transfere a ocorrência, sem duplicar. target: data ISO ou função(item) -> data. */
export function planMove(items, target, data, now, ch = newChanges()) {
  for (const it of items) {
    if (it.status === 'moved' || it.status === 'paid') continue;
    const to = typeof target === 'function' ? target(it) : target;
    setOv(ch, data, it, { movedTo: to }, now);
  }
  return ch;
}

/** Transforma uma ocorrência paga num lançamento avulso (preserva o histórico ao mudar a regra). */
function materialize(ch, entry, ov, data, uid, now) {
  const it = entryItems(entry, addDays(ov.orig, -14), addDays(ov.orig, 14), data).find(i => i.key === ov.key);
  const a = attrsAt(entry, ov.orig);
  const date = it ? it.date : (ov.movedTo || ov.orig);
  const id = uid();
  ch.entries.set(id, {
    id, seriesId: entry.seriesId || entry.id, kind: entry.kind, accountId: entry.accountId ?? null,
    title: ov.title ?? a.title, amount: a.amount, tagId: 'tagId' in ov ? ov.tagId : a.tagId,
    rule: { type: 'once', start: date }, createdAt: entry.createdAt, updatedAt: now,
  });
  const k = occKey(id, date);
  ch.overrides.set(k, { key: k, entryId: id, orig: date, status: 'paid', paidAt: ov.paidAt || now,
    ...(ov.amount != null ? { amount: ov.amount } : {}), updatedAt: now });
}

/** Encerra a recorrência antes de D (D e seguintes deixam de existir). Pagos são preservados. */
export function planEndSeries({ entry, from, data, uid, now = new Date().toISOString() }) {
  const ch = newChanges();
  for (const ov of data.overrides.values()) {
    if (ov.entryId !== entry.id || ov.orig < from) continue;
    if (ov.status === 'paid') materialize(ch, entry, ov, data, uid, now);
    ch.overrides.set(ov.key, null);
  }
  if (from <= entry.rule.start) ch.entries.set(entry.id, null);
  else ch.entries.set(entry.id, { ...entry, rule: { ...entry.rule, end: addDays(from, -1) }, updatedAt: now });
  return ch;
}

/** Mudança de regra (tipo de repetição, dias...) válida a partir de D. O passado continua na regra antiga. */
export function planRuleChange({ entry, fields, from, data, uid, now = new Date().toISOString() }) {
  const ch = planEndSeries({ entry, from, data, uid, now });
  const keepId = from <= entry.rule.start;
  const id = keepId ? entry.id : uid();
  const start = fields.rule.start > from ? fields.rule.start : from;
  ch.entries.set(id, {
    ...entry, ...fields, id, seriesId: entry.seriesId || entry.id, segments: [],
    rule: { ...fields.rule, start }, createdAt: keepId ? entry.createdAt : now, updatedAt: now,
  });
  return ch;
}

/** Exclusão definitiva (inclusive histórico desta entrada). */
export function planDelete(entry, data) {
  const ch = newChanges();
  ch.entries.set(entry.id, null);
  for (const ov of data.overrides.values()) if (ov.entryId === entry.id) ch.overrides.set(ov.key, null);
  return ch;
}

/** Concluir a conferência de dias: o que não foi confirmado vira pendente. */
export function planCheckDays(dates, itemsByDate, data, now = new Date().toISOString()) {
  const ch = newChanges();
  for (const d of dates) {
    const items = itemsByDate(d);
    for (const it of items) if (it.status === 'planned') setOv(ch, data, it, { status: 'pending' }, now);
    const spent = items.some(it => it.kind === 'expense' && it.status === 'paid');
    ch.checks.set(d, { date: d, checkedAt: now, noExpenses: !spent });
  }
  return ch;
}

export function mergeChanges(a, b) {
  for (const k of ['entries', 'overrides', 'checks']) for (const [id, v] of b[k]) a[k].set(id, v);
  return a;
}

/** Lança a distribuição de uma receita recebida (cofrinho virtual = reserva; real/conta = transferência). */
export function planDistribution(item, outputs, { piggies = [], uid, now = new Date().toISOString(), title = 'Distribuição' }) {
  const ch = newChanges();
  for (const o of outputs) {
    const [kind, id] = o.target.split(':');
    const p = kind === 'piggy' ? piggies.find(x => x.id === id) : null;
    const e = {
      id: uid(), title, amount: o.amount, accountId: item.accountId, distOf: item.key,
      rule: { type: 'once', start: item.date }, createdAt: now, updatedAt: now,
    };
    if (p && p.type !== 'real') Object.assign(e, { kind: 'reserve', piggyId: p.id });
    else Object.assign(e, { kind: 'transfer', toAccountId: p ? p.accountId : id, piggyId: p ? p.id : null });
    ch.entries.set(e.id, e);
    const k = occKey(e.id, item.date);
    ch.overrides.set(k, { key: k, entryId: e.id, orig: item.date, status: 'paid', paidAt: now, updatedAt: now });
  }
  return ch;
}

/** Remove a distribuição gerada por uma receita (ao desfazer o recebimento). */
export function planUndistribute(itemKey, data, ch = newChanges()) {
  for (const e of data.entries) {
    if (e.distOf !== itemKey) continue;
    ch.entries.set(e.id, null);
    for (const ov of data.overrides.values()) if (ov.entryId === e.id) ch.overrides.set(ov.key, null);
  }
  return ch;
}
