// Cálculos financeiros de alto nível (puros, testáveis): saldos por conta, cofrinhos,
// metas/orçamentos com sobras, distribuição automática de receitas, alertas e relatórios.
//
// Conceitos separados (regra arquitetural):
//   conta = onde o dinheiro está · origem = de onde veio · tag = por quê · meta = limite/objetivo
//   cofrinho = quanto está reservado · transferência = movimento entre contas próprias
import { itemsInRange, counts, realizedOf, flowOf, isBusinessDay } from './engine.js';
import { addDays, weekday, parse, iso, daysInMonth, range } from './dates.js';

export const flat = byDate => [...byDate.values()].flat().filter(i => i.status !== 'moved');

export function firstDate(entries, fallback, overrides) {
  let min = fallback;
  for (const e of entries) if (e.rule.start < min) min = e.rule.start;
  // ocorrências antecipadas para antes do primeiro lançamento (ex.: receita recebida adiantada) também contam
  if (overrides) for (const o of overrides.values()) if (o.movedTo && o.movedTo < min) min = o.movedTo;
  return min;
}

// ---------------------------------------------------------------- saldos
/**
 * Saldos de cada conta (realizado = o que já aconteceu; previsto = até planUpto),
 * cofrinhos e totais consolidados (sem contar duas vezes o mesmo dinheiro).
 */
export function balances({ data, accounts, piggies = [], today, planUpto }) {
  const acc = new Map(accounts.map(a => [a.id, { id: a.id, real: a.initialBalance || 0, planned: a.initialBalance || 0, reserved: 0, committed: 0, pendingOut: 0, pendingIn: 0 }]));
  const pig = new Map(piggies.map(p => [p.id, { id: p.id, saved: 0 }]));
  const from = firstDate(data.entries, today, data.overrides);
  const items = flat(itemsInRange(from, planUpto, data));
  const A = id => acc.get(id);
  for (const it of items) {
    if (!counts(it)) continue;
    const r = realizedOf(it), a = it.amount, open = a - r;
    if (it.kind === 'income' || it.kind === 'expense') {
      const s = it.kind === 'income' ? 1 : -1, x = A(it.accountId);
      if (!x) continue;
      x.real += s * r; x.planned += s * a;
      if (it.kind === 'expense' && open > 0) x.committed += open;
    } else if (it.kind === 'transfer') {
      const f = A(it.accountId), t = A(it.toAccountId);
      if (f) { f.real -= r; f.planned -= a; if (open > 0) f.pendingOut += open; }
      if (t) { t.real += r; t.planned += a; if (open > 0) t.pendingIn += open; }
    } else if (it.kind === 'reserve' || it.kind === 'release') {
      const s = it.kind === 'reserve' ? 1 : -1;
      const x = A(it.accountId); if (x) x.reserved += s * r;
      const p = pig.get(it.piggyId); if (p) p.saved += s * r;
    }
  }
  for (const p of piggies) if (p.type === 'real' && acc.get(p.accountId)) pig.get(p.id).saved = acc.get(p.accountId).real;
  const included = accounts.filter(a => a.includeInTotal !== false && !a.archived);
  const totals = { total: 0, reserved: 0, available: 0, committed: 0, pendingTransfers: 0, planned: 0 };
  const inc = new Set(included.map(a => a.id));
  for (const a of included) {
    const x = acc.get(a.id);
    totals.total += x.real; totals.planned += x.planned; totals.reserved += x.reserved; totals.committed += x.committed;
  }
  // transferências pendentes: só as que saem de uma conta incluída (não duplica a ponta de entrada)
  for (const it of items) if (it.kind === 'transfer' && counts(it) && inc.has(it.accountId)) totals.pendingTransfers += it.amount - realizedOf(it);
  totals.available = totals.total - totals.reserved;
  return { accounts: acc, piggies: pig, totals };
}

// ---------------------------------------------------------------- metas e orçamentos
export const PERIODS = {
  day: 'Por dia', businessDay: 'Por dia útil', weekend: 'Por fim de semana/feriado',
  week: 'Por semana', month: 'Por mês', year: 'Por ano', custom: 'Período personalizado',
};
export const DAY_PERIODS = new Set(['day', 'businessDay', 'weekend']);

export function appliesOn(meta, d, isHoliday) {
  if (meta.period === 'businessDay') return isBusinessDay(d, isHoliday);
  if (meta.period === 'weekend') { const w = weekday(d); return w === 0 || w === 6 || !!isHoliday(d); }
  return true;
}

export function periodRange(meta, date, mondayFirst = false) {
  const { y, m } = parse(date);
  switch (meta.period) {
    case 'week': { const from = addDays(date, -((weekday(date) - (mondayFirst ? 1 : 0) + 7) % 7)); return { from, to: addDays(from, 6) }; }
    case 'year': return { from: iso(y, 1, 1), to: iso(y, 12, 31) };
    case 'custom': return { from: meta.from || date, to: meta.to || date };
    default: return { from: iso(y, m, 1), to: iso(y, m, daysInMonth(y, m)) }; // mês e metas diárias (vista mensal)
  }
}

/** Parte de um item que pertence à meta (respeita a divisão entre tags). */
export function metaShare(it, meta) {
  if (!counts(it)) return null;
  const kind = meta.kind || 'expense';
  if (it.kind !== kind) return null;
  if (meta.accountIds && meta.accountIds.length && !meta.accountIds.includes(it.accountId)) return null;
  if (kind === 'income' && meta.origins && meta.origins.length && !meta.origins.includes(it.origin)) return null;
  let share = 1;
  // Metas e tags (como no app antigo): a meta é a categoria e as tags ficam dentro dela.
  // Um lançamento entra na meta pela tag (que pertence à meta) ou por ter sido lançado direto na meta, sem tag.
  const tagged = !!(meta.tagIds && meta.tagIds.length);
  const legacyAll = !tagged && !meta.onlyAssigned; // metas antigas sem tags = "todas"
  if (it.metaId && !legacyAll) {
    if (it.metaId !== meta.id) return null;
  } else if (!tagged && meta.onlyAssigned) {
    return null;
  } else if (tagged) {
    if (it.splits && it.splits.length) {
      const total = it.splits.reduce((s, p) => s + p.amount, 0) || 1;
      const part = it.splits.filter(p => meta.tagIds.includes(p.tagId)).reduce((s, p) => s + p.amount, 0);
      if (!part) return null;
      share = part / total;
    } else if (!meta.tagIds.includes(it.tagId)) return null;
  }
  return { planned: Math.round(it.amount * share), real: Math.round(realizedOf(it) * share) };
}

function spentByDate(meta, from, to, data) {
  const out = new Map();
  for (const [d, items] of itemsInRange(from, to, data)) {
    let planned = 0, real = 0;
    for (const it of items) { const s = metaShare(it, meta); if (s) { planned += s.planned; real += s.real; } }
    out.set(d, { planned, real, pending: Math.max(0, planned - real) });
  }
  return out;
}

/**
 * Orçamento diário com sobras. Retorna Map(data -> { limit, avail, spent, planned, status, saved }).
 * status: future | open | pending | saved | ok | over | zero (conferido sem gastos)
 * rollover: none | week | month | reserve   carryExcess: o excedente reduz os próximos dias
 */
export function dailyBudget(meta, from, to, { data, checks, today, isHoliday, mondayFirst }) {
  const roll = meta.rollover || 'none';
  const winStart = d => (roll === 'week' ? periodRange({ period: 'week' }, d, mondayFirst).from : iso(+d.slice(0, 4), +d.slice(5, 7), 1));
  const start = roll === 'none' || roll === 'reserve' ? from : winStart(from);
  const spent = spentByDate(meta, start, to, data);
  const out = new Map();
  let carry = 0, win = null;
  for (const d of range(start, to)) {
    if ((roll === 'week' || roll === 'month') && winStart(d) !== win) { win = winStart(d); carry = 0; }
    if (!appliesOn(meta, d, isHoliday)) continue;
    const limit = meta.amount;
    const avail = limit + (roll === 'week' || roll === 'month' ? carry : 0);
    const sp = spent.get(d) || { planned: 0, real: 0, pending: 0 };
    const chk = checks.get(d);
    // Regras: excedente confirmado = vermelho; conferido e sem pendências = verde (economia) ou no limite;
    // qualquer dia passado com lançamentos pendentes ou sem conferência = pendente (amarelo).
    // Um gasto previsto ainda não pago NUNCA conta como economia.
    let status, saved = 0;
    const diff = avail - sp.real;
    const resolved = !!chk && sp.pending === 0;
    if (d <= today && diff < 0) {
      status = 'over';
      saved = limit - sp.real;
      if (roll === 'week' || roll === 'month') carry = meta.carryExcess ? diff : 0;
    } else if (d <= today && resolved) {
      status = chk.noExpenses && sp.real === 0 ? 'zero' : diff > 0 ? 'saved' : 'ok';
      saved = limit - sp.real;
      if (roll === 'week' || roll === 'month') carry = Math.max(0, diff);
    } else status = d > today ? 'future' : d === today && !chk ? 'open' : 'pending';
    if (d >= from) out.set(d, { limit, avail, spent: sp.real, planned: sp.planned, pending: sp.pending, status, saved });
  }
  return out;
}

/** Progresso de uma meta no período que contém `date`. */
export function metaProgress(meta, date, ctx) {
  const { from, to } = periodRange(meta, date, ctx.mondayFirst);
  let limit = meta.amount || 0, real = 0, planned = 0, saved = 0, overDays = 0;
  const items = [];
  for (const [d, list] of itemsInRange(from, to, ctx.data)) {
    for (const it of list) { const s = metaShare(it, meta); if (s) { real += s.real; planned += s.planned; items.push({ it, ...s }); } }
  }
  if (DAY_PERIODS.has(meta.period)) {
    const days = dailyBudget(meta, from, to, ctx);
    limit = 0;
    for (const v of days.values()) { limit += v.limit; if (['saved', 'ok', 'zero', 'over'].includes(v.status)) saved += v.saved; if (v.status === 'over') overDays++; }
  }
  const base = meta.kind === 'income' ? real : real;
  return {
    from, to, limit, real, planned, items: items.sort((a, b) => a.it.date.localeCompare(b.it.date)),
    pct: limit ? base / limit : 0, remaining: limit ? limit - real : 0, over: limit ? Math.max(0, real - limit) : 0,
    saved, overDays,
  };
}

// ---------------------------------------------------------------- distribuição automática
/**
 * Calcula como distribuir uma receita recebida conforme as regras da conta.
 * steps: [{ type: fixed|percent|remainder, value, target: 'piggy:ID' | 'account:ID', min?, max?, capToGoal? }]
 * Retorna [{ target, amount }] na ordem de prioridade.
 */
export function distribute(amount, ruleSet, { piggySaved = () => 0, piggies = [] } = {}) {
  let remaining = amount;
  const out = [];
  for (const st of ruleSet.steps || []) {
    if (remaining <= 0) break;
    let v = st.type === 'fixed' ? st.value : st.type === 'percent' ? Math.round(amount * st.value / 100) : remaining;
    if (st.max) v = Math.min(v, st.max);
    if (st.min) v = Math.max(v, st.min);
    if (st.capToGoal && st.target.startsWith('piggy:')) {
      const p = piggies.find(x => x.id === st.target.slice(6));
      if (p && p.goal) v = Math.min(v, Math.max(0, p.goal - piggySaved(p.id)));
    }
    v = Math.min(v, remaining);
    if (v > 0) { out.push({ target: st.target, amount: v }); remaining -= v; }
  }
  return out;
}

export function ruleFor(account, origin) {
  const rules = (account && account.rules) || [];
  return rules.find(r => r.origin && r.origin === origin) || rules.find(r => !r.origin) || null;
}

// ---------------------------------------------------------------- alertas
export const ALERT_TYPES = {
  budgetDay: 'Orçamento diário ultrapassado',
  budgetPeriod: 'Orçamento ou meta perto do limite',
  unpaid: 'Despesas vencidas não pagas',
  unreceived: 'Receitas previstas não recebidas',
  negative: 'Saldo futuro negativo',
  unchecked: 'Dias anteriores não conferidos',
  backup: 'Backup desatualizado',
};

export function computeAlerts(ctx) {
  const { data, metas, checks, today, isHoliday, mondayFirst, enabled, set, startBalance, lastBackup, hasData } = ctx;
  const on = k => !enabled || enabled[k] !== false;
  const out = [];
  // atrasos não expiram: olha desde o primeiro lançamento até ontem
  const past = flat(itemsInRange(firstDate(data.entries, addDays(today, -1), data.overrides), addDays(today, -1), data));
  if (on('unpaid')) {
    const l = past.filter(i => i.kind === 'expense' && (i.status === 'planned' || i.status === 'pending' || i.status === 'partial') && (!set || set.has(i.accountId)));
    if (l.length) out.push({ type: 'unpaid', level: 'warn', text: `${l.length} ${l.length === 1 ? 'despesa vencida não paga' : 'despesas vencidas não pagas'}`, date: l[0].date, items: l });
  }
  if (on('unreceived')) {
    const l = past.filter(i => i.kind === 'income' && (i.status === 'planned' || i.status === 'pending' || i.status === 'partial') && (!set || set.has(i.accountId)));
    if (l.length) out.push({ type: 'unreceived', level: 'warn', text: `${l.length} ${l.length === 1 ? 'receita prevista não recebida' : 'receitas previstas não recebidas'}`, date: l[0].date, items: l });
  }
  if (on('unchecked')) {
    const days = [];
    for (let i = 1; i <= 7; i++) {
      const d = addDays(today, -i);
      if (checks.has(d)) continue;
      const l = past.filter(x => x.date === d && x.kind === 'expense' && x.status === 'planned');
      if (l.length) days.push(d);
    }
    if (days.length) out.push({ type: 'unchecked', level: 'info', text: `${days.length} ${days.length === 1 ? 'dia não conferido' : 'dias não conferidos'} na última semana`, date: days[days.length - 1], days });
  }
  const bctx = { data, checks, today, isHoliday, mondayFirst };
  for (const m of metas || []) {
    if (m.archived || (m.kind || 'expense') !== 'expense') continue;
    if (DAY_PERIODS.has(m.period)) {
      if (!on('budgetDay')) continue;
      const v = dailyBudget(m, today, today, bctx).get(today);
      const sp = v ? Math.max(v.spent, 0) : 0;
      if (v && sp > v.avail) out.push({ type: 'budgetDay', level: 'bad', text: `${m.name}: hoje passou ${fmtC(sp - v.avail)} do limite`, date: today, metaId: m.id });
    } else if (on('budgetPeriod')) {
      const p = metaProgress(m, today, bctx);
      const pct = (m.alertPct || 80) / 100;
      if (p.limit && p.real > p.limit) out.push({ type: 'budgetPeriod', level: 'bad', text: `${m.name}: ${fmtC(p.over)} acima do limite`, metaId: m.id });
      else if (p.limit && p.real >= p.limit * pct) out.push({ type: 'budgetPeriod', level: 'warn', text: `${m.name}: ${Math.round(p.pct * 100)}% usado`, metaId: m.id });
    }
  }
  if (on('negative') && startBalance != null) {
    const d = projectNegative(data, set, startBalance, today, 60);
    if (d) out.push({ type: 'negative', level: 'bad', text: `Saldo previsto fica negativo em ${d.slice(8)}/${d.slice(5, 7)}`, date: d });
  }
  if (on('backup') && hasData && (!lastBackup || (Date.parse(today) - Date.parse(lastBackup.slice(0, 10))) / 864e5 > 30)) {
    out.push({ type: 'backup', level: 'info', text: lastBackup ? 'Último backup há mais de 30 dias' : 'Você ainda não fez nenhum backup' });
  }
  return out;
}
const fmtC = c => 'R$ ' + (c / 100).toFixed(2).replace('.', ',');

/** Primeira data (até `days` à frente) em que o saldo consolidado previsto fica negativo. */
export function projectNegative(data, set, startBalance, today, days) {
  // saldo de hoje (realizado) + tudo que ainda falta acontecer, inclusive atrasados
  let bal = startBalance;
  const overdue = flat(itemsInRange(firstDate(data.entries, addDays(today, -1), data.overrides), addDays(today, -1), data));
  for (const it of overdue) { const f = flowOf(it, set); if (f) bal += (f.inc - f.incR) - (f.exp - f.expR) + (f.tr - f.trR); }
  const by = itemsInRange(today, addDays(today, days), data);
  for (const d of range(today, addDays(today, days))) {
    for (const it of by.get(d) || []) { const f = flowOf(it, set); if (f) bal += (f.inc - f.incR) - (f.exp - f.expR) + (f.tr - f.trR); }
    if (bal < 0) return d;
  }
  return null;
}

// ---------------------------------------------------------------- relatórios
export function periodReport(from, to, data, set) {
  const r = { inc: 0, exp: 0, incReal: 0, expReal: 0, byTag: new Map(), count: 0 };
  for (const it of flat(itemsInRange(from, to, data))) {
    const f = flowOf(it, set); if (!f) continue;
    r.inc += f.inc; r.exp += f.exp; r.incReal += f.incR; r.expReal += f.expR; r.count++;
    if (it.kind === 'expense' && f.expR) {
      const parts = it.splits && it.splits.length ? it.splits.map(p => [p.tagId, Math.round(f.expR * p.amount / it.splits.reduce((s, q) => s + q.amount, 0))]) : [[it.tagId || (it.metaId ? `meta:${it.metaId}` : ''), f.expR]]; // sem tag, mas lançado direto na meta
      for (const [t, v] of parts) r.byTag.set(t || '', (r.byTag.get(t || '') || 0) + v);
    }
  }
  return r;
}

// ---------------------------------------------------------------- desfazer recebimento com segurança
/**
 * Antes de desfazer um recebimento, verifica se o dinheiro (inclusive o distribuído) já foi usado.
 * Simula o estado sem o recebimento e sem a distribuição: se algum cofrinho ou conta ficaria negativo
 * (e não estava antes), o desfazer simples é bloqueado.
 * Retorna { ok, problems: [{ kind, id, missing }] }
 */
export function undoReceiptCheck(itemKey, { data, accounts, piggies = [], today }) {
  let upto = today;
  for (const ov of data.overrides.values()) if ((ov.status === 'paid' || ov.status === 'partial') && (ov.movedTo || ov.orig) > upto) upto = ov.movedTo || ov.orig;
  const before = balances({ data, accounts, piggies, today: upto, planUpto: upto });
  const overrides = new Map(data.overrides);
  const ov = overrides.get(itemKey);
  if (ov) { const n = { ...ov }; delete n.status; delete n.paidAmount; delete n.paidAt; overrides.set(itemKey, n); }
  const drop = new Set(data.entries.filter(e => e.distOf === itemKey).map(e => e.id));
  const after = balances({ data: { ...data, entries: data.entries.filter(e => !drop.has(e.id)), overrides }, accounts, piggies, today: upto, planUpto: upto });
  const problems = [];
  for (const [id, p] of after.piggies) { const b = before.piggies.get(id); if (p.saved < 0 && (!b || b.saved >= 0)) problems.push({ kind: 'piggy', id, missing: -p.saved }); }
  for (const [id, a] of after.accounts) { const b = before.accounts.get(id); const free = a.real - a.reserved, freeB = b ? b.real - b.reserved : 0; if (free < 0 && freeB >= 0) problems.push({ kind: 'account', id, missing: -free }); }
  return { ok: !problems.length, problems };
}

// ---------------------------------------------------------------- metas abaixo do calendário (acompanha a visualização)
const DAY_MS = 864e5;
const nDays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS) + 1;
const shortDM = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Limite (ou valor esperado) de uma meta dentro de [from, to]. */
export function rangeLimit(meta, from, to, isHoliday = () => false) {
  const a = meta.amount || 0;
  if (!a) return 0;
  if (DAY_PERIODS.has(meta.period)) { let c = 0; for (const d of range(from, to)) if (appliesOn(meta, d, isHoliday)) c++; return a * c; }
  const days = nDays(from, to);
  switch (meta.period) {
    case 'week': return Math.round(a * days / 7);
    case 'month': {
      // soma, mês a mês, a fração de cada mês dentro do intervalo
      let v = 0, { y, m } = parse(from);
      for (;;) {
        const f = iso(y, m, 1), l = iso(y, m, daysInMonth(y, m));
        if (f > to) break;
        const lo = f > from ? f : from, hi = l < to ? l : to;
        if (lo <= hi) v += a * nDays(lo, hi) / daysInMonth(y, m);
        m++; if (m > 12) { m = 1; y++; }
      }
      return Math.round(v);
    }
    case 'year': return Math.round(a * days / (parse(from).y % 4 === 0 ? 366 : 365));
    case 'custom': {
      if (!meta.from || !meta.to || meta.to < from || meta.from > to) return 0;
      const lo = meta.from > from ? meta.from : from, hi = meta.to < to ? meta.to : to;
      return Math.round(a * nDays(lo, hi) / nDays(meta.from, meta.to));
    }
    default: return a;
  }
}

/** Previsto e realizado de uma meta em [from, to] (cada lançamento conta uma vez). */
export function rangeStats(meta, from, to, data, isHoliday) {
  let real = 0, planned = 0;
  for (const list of itemsInRange(from, to, data).values()) for (const it of list) { if (it.status === 'moved') continue; const s = metaShare(it, meta); if (s) { real += s.real; planned += s.planned; } }
  const limit = rangeLimit(meta, from, to, isHoliday);
  const inc = (meta.kind || 'expense') === 'income';
  return {
    from, to, limit, real, planned,
    // despesa: restante e excedente do limite; receita: quanto falta receber e o que passou da meta
    remaining: limit ? Math.max(0, limit - real) : 0,
    over: limit ? Math.max(0, real - limit) : 0,
    status: !limit ? 'none' : inc ? (real >= limit ? 'met' : 'open') : real > limit ? 'over' : planned > limit ? 'risk' : 'ok',
  };
}

/**
 * Metas que aparecem abaixo do calendário, conforme a visualização:
 * dia → diárias do dia · semana → diárias (dia a dia) e semanais · mês → diárias, semanais (semana a semana) e mensais ·
 * ano → anuais e mensais (mês a mês) · personalizadas → quando o período cruza o intervalo exibido.
 * Retorna { from, to, title, groups: [{ title, rows: [{ meta, label, ...stats, parts? }] }] }.
 */
export function metaPanel({ metas, view, date, data, isHoliday, mondayFirst = false, piggies = [], today = date }) {
  const { y, m } = parse(date);
  const wk = periodRange({ period: 'week' }, date, mondayFirst);
  const R = view === 'day' ? { from: date, to: date, title: `dia ${shortDM(date)}` }
    : view === 'week' ? { from: wk.from, to: wk.to, title: `semana ${shortDM(wk.from)} a ${shortDM(wk.to)}` }
    : view === 'year' ? { from: iso(y, 1, 1), to: iso(y, 12, 31), title: String(y) }
    : { from: iso(y, m, 1), to: iso(y, m, daysInMonth(y, m)), title: `${MONTH_ABBR[m - 1]}/${y}` };
  const live = metas.filter(x => !x.archived && x.amount && x.kind !== 'saving');
  const by = p => live.filter(x => (p === 'daily' ? DAY_PERIODS.has(x.period) : x.period === p));
  const row = (meta, from, to, label, parts) => ({ meta, label, ...rangeStats(meta, from, to, data, isHoliday), ...(parts ? { parts } : {}) });
  const days = (from, to) => [...range(from, to)];
  const weeksOfMonth = () => {
    const out = []; let s = periodRange({ period: 'week' }, R.from, mondayFirst).from;
    while (s <= R.to) { out.push({ from: s, to: addDays(s, 6) }); s = addDays(s, 7); }
    return out;
  };
  const groups = [];
  const push = (title, rows) => { if (rows.length) groups.push({ title, rows }); };
  if (view === 'day') {
    push('Metas do dia', by('daily').filter(x => appliesOn(x, date, isHoliday)).map(x => row(x, date, date, shortDM(date))));
  } else if (view === 'week') {
    push('Metas diárias', by('daily').map(x => row(x, R.from, R.to, 'na semana',
      days(R.from, R.to).filter(d => appliesOn(x, d, isHoliday)).map(d => ({ label: d.slice(8, 10), ...rangeStats(x, d, d, data, isHoliday) })))));
    push('Metas semanais', by('week').map(x => row(x, R.from, R.to, R.title)));
  } else if (view === 'year') {
    push('Metas anuais', by('year').map(x => row(x, R.from, R.to, R.title)));
    push('Metas mensais', by('month').map(x => row(x, R.from, R.to, 'no ano',
      Array.from({ length: 12 }, (_, i) => ({ label: MONTH_ABBR[i], ...rangeStats(x, iso(y, i + 1, 1), iso(y, i + 1, daysInMonth(y, i + 1)), data, isHoliday) })))));
    push('Metas semanais e diárias', [...by('week'), ...by('daily')].map(x => row(x, R.from, R.to, 'no ano')));
  } else {
    push('Metas mensais', by('month').map(x => row(x, R.from, R.to, R.title)));
    push('Metas semanais', by('week').map(x => row(x, R.from, R.to, 'no mês',
      weeksOfMonth().map(w => ({ label: `${w.from.slice(8, 10)}–${w.to.slice(8, 10)}`, ...rangeStats(x, w.from, w.to, data, isHoliday) })))));
    push('Metas diárias', by('daily').map(x => {
      const r = row(x, R.from, R.to, 'no mês');
      r.overDays = days(R.from, R.to).filter(d => appliesOn(x, d, isHoliday) && rangeStats(x, d, d, data, isHoliday).status === 'over').length;
      return r;
    }));
  }
  const pigs = new Map(piggies.map(p => [p.id, p]));
  push('Metas de acumulação', metas.filter(x => !x.archived && x.kind === 'saving' && x.amount && !x.completedAt).map(x => savingRow(x, { piggy: pigs.get(x.piggyId), data, today, view, date, from: R.from, to: R.to, mondayFirst })));
  push('Períodos personalizados', by('custom').filter(x => x.from && x.to && x.to >= R.from && x.from <= R.to).map(x => row(x, x.from, x.to, `${shortDM(x.from)} a ${shortDM(x.to)}`)));
  return { ...R, groups };
}

// ---------------------------------------------------------------- metas de acumulação (juntar um valor até uma data)
// A meta define quanto juntar e até quando; o app calcula quanto guardar por período; o cofrinho ligado
// registra quanto foi guardado de verdade (só depósitos reais, cada um contado uma vez).
export const SAVING_FREQ = { week: 'Toda semana', biweek: 'A cada 15 dias', month: 'Todo mês', days: 'A cada N dias' };
const freqDays = meta => (meta.freq === 'biweek' ? 14 : meta.freq === 'days' ? Math.max(1, +meta.freqDays || 1) : 7);

/** Depósitos e retiradas reais de um cofrinho em [from, to] (virtual: reservas; real: transferências na conta dele). */
export function piggyMoves(piggy, data, from, to) {
  const out = [];
  if (!piggy) return out;
  for (const [d, list] of itemsInRange(from, to, data)) {
    for (const it of list) {
      if (it.status === 'moved' || !counts(it)) continue;
      const r = realizedOf(it); if (!r) continue;
      if (piggy.type === 'real') {
        if (it.kind === 'transfer' && it.toAccountId === piggy.accountId && it.accountId !== piggy.accountId) out.push({ date: d, amount: r, it });
        else if (it.kind === 'transfer' && it.accountId === piggy.accountId && it.toAccountId !== piggy.accountId) out.push({ date: d, amount: -r, it });
      } else if (it.piggyId === piggy.id && (it.kind === 'reserve' || it.kind === 'release')) out.push({ date: d, amount: it.kind === 'reserve' ? r : -r, it });
    }
  }
  return out;
}

/** Janela do período de contribuição que contém `date` (semana, quinzena, mês ou a cada N dias). */
export function savingWindow(meta, date, mondayFirst = false) {
  if (meta.freq === 'month') { const { y, m } = parse(date); return { from: iso(y, m, 1), to: iso(y, m, daysInMonth(y, m)) }; }
  if (meta.freq === 'week' || !meta.freq) return periodRange({ period: 'week' }, date, mondayFirst);
  const start = String(meta.start || meta.createdAt || date).slice(0, 10), n = freqDays(meta);
  const k = Math.floor((Date.parse(date) - Date.parse(start)) / DAY_MS / n);
  const from = addDays(start, k * n);
  return { from, to: addDays(from, n - 1) };
}

/** Quantos períodos de contribuição faltam de `today` até o prazo (sempre pelo menos 1). */
export function periodsLeft(meta, today) {
  const deadline = meta.deadline;
  if (!deadline || deadline < today) return 1;
  if (meta.freq === 'month') {
    const a = parse(today), b = parse(deadline);
    return Math.max(1, (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0));
  }
  return Math.max(1, Math.floor((Date.parse(deadline) - Date.parse(today)) / DAY_MS / freqDays(meta)));
}

/**
 * Plano de uma meta de acumulação: quanto falta e quanto guardar por período a partir de hoje.
 * Mudar prazo, valor ou frequência recalcula daqui pra frente; o que já foi guardado continua valendo.
 */
export function savingPlan(meta, { piggy, data, today }) {
  const goal = meta.amount || 0;
  const all = piggyMoves(piggy, data, '1900-01-01', today);
  const saved = Math.max(0, all.reduce((s, x) => s + x.amount, 0));
  const left = Math.max(0, goal - saved);
  const periods = periodsLeft(meta, today);
  // o que foi guardado no período atual conta para a contribuição deste período (não reduz a parcela duas vezes)
  const w = savingWindow(meta, today);
  const before = Math.max(0, all.filter(x => x.date < w.from).reduce((s, x) => s + x.amount, 0));
  const perPeriod = left ? Math.ceil(Math.max(0, goal - before) / periods) : 0;
  return { goal, saved, left, periods, perPeriod, done: goal > 0 && saved >= goal, pct: goal ? Math.min(1, saved / goal) : 0, moves: all };
}
const FREQ_UNIT = { week: 'semana', biweek: 'quinzena', month: 'mês', days: 'período' };
export const freqUnit = meta => (meta.freq === 'days' && +meta.freqDays === 1 ? 'dia' : FREQ_UNIT[meta.freq || 'week']);

/**
 * Acompanhamento de uma meta de acumulação no intervalo exibido.
 * Período da meta maior que o intervalo (ex.: mensal na semana) → mostra o período da meta que contém a data;
 * menor ou igual (ex.: semanal no mês) → soma os períodos que terminam no intervalo, com as partes.
 * Dia: só mostra contribuição quando a frequência é diária; senão, só a evolução.
 */
export function savingRow(meta, { piggy, data, today, view, date, from, to, mondayFirst = false }) {
  const plan = savingPlan(meta, { piggy, data, today });
  const base = { meta, kind: 'saving', ...plan, unit: freqUnit(meta) };
  const dep = (a, b) => piggyMoves(piggy, data, a, b).reduce((s, x) => s + x.amount, 0);
  const daily = meta.freq === 'days' && +meta.freqDays === 1;
  if (view === 'day' && !daily) return { ...base, label: 'evolução', target: null, done$: dep(from, to) };
  const len = meta.freq === 'month' ? 30 : freqDays(meta), span = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
  if (len > span) {
    const w = savingWindow(meta, date, mondayFirst);
    return { ...base, label: meta.freq === 'month' ? 'neste mês' : `${w.from.slice(8, 10)}/${w.from.slice(5, 7)} a ${w.to.slice(8, 10)}/${w.to.slice(5, 7)}`, target: plan.perPeriod, done$: dep(w.from, w.to), from: w.from, to: w.to };
  }
  const parts = [];
  let w = savingWindow(meta, from, mondayFirst);
  while (w.from <= to) {
    if (w.to >= from && w.to <= to && (!meta.deadline || w.from <= meta.deadline) && w.to >= String(meta.start || meta.createdAt || '').slice(0, 10)) parts.push({ label: meta.freq === 'month' ? MONTH_ABBR[parse(w.from).m - 1] : `${w.from.slice(8, 10)}–${w.to.slice(8, 10)}`, from: w.from, to: w.to, target: w.to < today ? null : plan.perPeriod, done$: dep(w.from, w.to) });
    w = savingWindow(meta, addDays(w.to, 1), mondayFirst);
  }
  const target = parts.filter(x => x.target != null).reduce((s, x) => s + x.target, 0) + parts.filter(x => x.target == null).reduce((s, x) => s + Math.max(0, x.done$), 0);
  return { ...base, label: view === 'year' ? 'no ano' : view === 'month' ? 'no mês' : 'na semana', target, done$: dep(from, to), parts };
}
