// A bolacha é a VISUALIZAÇÃO do sistema de Metas: cada segmento é uma Meta (de despesa ou de acumulação)
// e o círculo inteiro é 100% da receita do período, na conta exibida.
// Nada de cadastro paralelo: o valor ou o % vem da própria Meta; as tags só detalham a Meta.
//
//   · receita (base 100%) = receitas lançadas + a parte das metas de receita ainda sem lançamento;
//     doações/dízimo (opcional) saem antes;
//   · meta por VALOR: o valor fica fixo e o % é calculado sobre a receita;
//     meta por PORCENTAGEM: o % fica fixo e o valor é calculado sobre a receita;
//   · parte apagada = planejado; parte viva = realizado (gasto pago, depósito feito, recebimento confirmado);
//   · transferência para cofrinho/Tesouro é destinação, não despesa nem receita; nada é contado duas vezes.
import { itemsInRange, counts, realizedOf } from './engine.js';
import { metaShare, rangeLimit, piggyMoves, savingPlan, savingWindow } from './finance.js';
import { iso, daysInMonth, addDays } from './dates.js';

export const TREASURY = 'treasury';
/** Orientação de referência (não bloqueia nada): investir ~25% da renda, pelo menos 15% em meses apertados. */
export const GUIDE = { investIdeal: 25, investMin: 15 };

/** Configuração de exibição da bolacha (o conteúdo vem das Metas). */
export function budgetConfig(settings = {}) {
  const b = settings.budget || {};
  return {
    showOnCalendar: b.showOnCalendar !== false,
    showLegendValues: b.showLegendValues !== false,
    deduction: b.deduction && typeof b.deduction === 'object' ? b.deduction : { on: false, mode: 'value', value: 0 },
  };
}

/** Receita do período nas contas `ids`: prevista (com metas de receita) e recebida (só confirmada). */
export function incomeBase({ data, metas = [], ids, from, to, isHoliday }) {
  const set = new Set(ids);
  let planned = 0, received = 0;
  const incomeItems = [];
  for (const list of itemsInRange(from, to, data).values()) {
    for (const it of list) {
      if (it.status === 'moved' || !counts(it) || it.kind !== 'income' || !set.has(it.accountId)) continue;
      planned += it.amount; received += realizedOf(it); incomeItems.push(it);
    }
  }
  // meta de receita sem lançamento ainda: o valor esperado também forma a base
  let extra = 0;
  for (const m of metas) {
    if (m.archived || (m.kind || 'expense') !== 'income' || !m.amount) continue;
    if (m.accountIds && m.accountIds.length && !m.accountIds.some(id => set.has(id))) continue;
    const target = rangeLimit(m, from, to, isHoliday);
    let inMeta = 0;
    for (const it of incomeItems) { const s = metaShare(it, m); if (s) inMeta += s.planned; }
    extra += Math.max(0, target - inMeta);
  }
  return { planned: planned + extra, received, entries: planned, fromMetas: extra };
}

/** Converte uma Meta definida por % na sua forma em valor (por período da meta), sobre a receita mensal dada. */
export function resolvePercent(meta, monthlyIncome) {
  if (meta.basis !== 'percent') return meta;
  const month = Math.round(monthlyIncome * (+meta.pct || 0) / 100);
  if (meta.kind === 'saving') return { ...meta, monthlyContribution: month };
  const per = { month, week: Math.round(month * 12 / 52), year: month * 12, day: Math.round(month / 30), businessDay: Math.round(month / 21), weekend: Math.round(month / 9), custom: month };
  return { ...meta, amount: per[meta.period || 'month'] ?? month };
}

/** Quanto uma meta de acumulação planeja guardar em [from, to] (por valor: parcelas do plano; por %: % da receita). */
function savingTarget(meta, { piggy, data, today, from, to, base }) {
  if (meta.basis === 'percent') return Math.round(base * (+meta.pct || 0) / 100);
  const plan = savingPlan(meta, { piggy, data, today });
  if (!plan.perPeriod) return 0;
  let total = 0, w = savingWindow(meta, from);
  const start = String(meta.start || meta.createdAt || from).slice(0, 10);
  while (w.from <= to) {
    // conta a parcela do período que TERMINA dentro do intervalo: uma meta mensal não vira obrigação diária
    if (w.to >= from && w.to <= to && (!meta.deadline || w.from <= meta.deadline) && w.to >= start) total += plan.perPeriod;
    w = savingWindow(meta, addDays(w.to, 1));
  }
  return Math.round(total);
}

/**
 * A bolacha: um segmento por Meta de despesa ou de acumulação da conta exibida.
 * opts: { data, metas, ids, from, to, piggies, treasuryAccountId, isHoliday, today, deduction }
 */
export function metaDistribution({ data, metas = [], ids, from, to, piggies = [], treasuryAccountId = null, isHoliday = () => false, today = from, deduction = null }) {
  const set = new Set(ids);
  const inc = incomeBase({ data, metas, ids, from, to, isHoliday });
  const d = deduction || {};
  const dedOf = v => (!d.on ? 0 : d.mode === 'percent' ? Math.round(v * (+d.value || 0) / 100) : rangeLimit({ period: 'month', amount: +d.value || 0 }, from, to));
  const dedP = Math.min(inc.planned, dedOf(inc.planned)), dedR = Math.min(inc.received, d.mode === 'percent' ? dedOf(inc.received) : dedP);
  const base = inc.planned - dedP;
  const pigOf = id => (id === TREASURY ? (treasuryAccountId ? { id: TREASURY, type: 'real', accountId: treasuryAccountId } : null) : piggies.find(p => p.id === id) || null);
  const segs = [];
  const live = metas.filter(m => !m.archived && (m.kind === 'saving' || (m.kind || 'expense') === 'expense') && !(m.kind === 'saving' && m.completedAt)
    && (!(m.accountIds || []).length || m.accountIds.some(id => set.has(id)))); // cada conta tem a sua bolacha
  // despesas: cada lançamento entra na primeira meta que o reivindica (sem duplicar)
  const claimed = new Map();
  const other = { planned: 0, realized: 0, items: [] };
  for (const list of itemsInRange(from, to, data).values()) {
    for (const it of list) {
      if (it.status === 'moved' || !counts(it) || it.kind !== 'expense' || !set.has(it.accountId)) continue;
      let left = 1;
      for (const m of live) {
        if (m.kind === 'saving' || left <= 0) continue;
        const s = metaShare(it, m); if (!s) continue;
        const share = Math.min(left, it.amount ? s.planned / it.amount : 0);
        if (share <= 0) continue;
        const c = claimed.get(m.id) || { planned: 0, realized: 0, items: [] };
        c.planned += Math.round(it.amount * share); c.realized += Math.round(realizedOf(it) * share); c.items.push({ it, planned: Math.round(it.amount * share), real: Math.round(realizedOf(it) * share) });
        claimed.set(m.id, c); left -= share;
      }
      if (left > 0.0001) { other.planned += Math.round(it.amount * left); other.realized += Math.round(realizedOf(it) * left); other.items.push({ it, planned: Math.round(it.amount * left), real: Math.round(realizedOf(it) * left) }); }
    }
  }
  for (const m of live) {
    let target, realized, planned, items = [];
    if (m.kind === 'saving') {
      const piggy = pigOf(m.piggyId);
      target = savingTarget(m, { piggy, data, today, from, to, base });
      const moves = piggyMoves(piggy, data, from, to);
      realized = moves.reduce((s, x) => s + x.amount, 0);
      // depósitos ainda previstos no período (não contam como guardados)
      planned = realized;
      if (piggy) for (const list of itemsInRange(from, to, data).values()) for (const it of list) {
        if (it.status === 'moved' || !counts(it) || realizedOf(it)) continue;
        if ((piggy.type === 'real' && it.kind === 'transfer' && it.toAccountId === piggy.accountId) || (it.piggyId === piggy.id && it.kind === 'reserve')) planned += it.amount;
      }
      items = moves.map(x => ({ it: x.it, planned: x.amount, real: x.amount }));
    } else {
      target = m.amount ? rangeLimit(m, from, to, isHoliday) : 0;
      const c = claimed.get(m.id) || { planned: 0, realized: 0, items: [] };
      realized = c.realized; planned = c.planned; items = c.items;
    }
    if (!target && !planned && !realized) continue;
    const pct = base ? target / base * 100 : 0;
    segs.push({
      meta: m, kind: m.kind === 'saving' ? 'saving' : 'expense', basis: m.basis === 'percent' ? 'percent' : 'value', setPct: m.basis === 'percent' ? +m.pct || 0 : null,
      target, pct, realized, planned, items,
      left: Math.max(0, target - realized), over: Math.max(0, realized - target), plannedOver: Math.max(0, planned - target),
      status: realized > target && target ? (m.kind === 'saving' ? 'ahead' : 'over') : planned > target && target && m.kind !== 'saving' ? 'risk' : 'ok',
    });
  }
  const sumTarget = segs.reduce((s, x) => s + x.target, 0);
  const sumPct = base ? Math.round(sumTarget / base * 1000) / 10 : 0;
  return {
    from, to, income: inc, deduction: { planned: dedP, received: dedR, on: !!d.on }, base: { planned: base, received: inc.received - dedR },
    segs, other, sumPct, undistributed: Math.max(0, base - sumTarget), excess: Math.max(0, sumTarget - base),
  };
}

/** Receita mensal (prevista) da conta exibida, para converter metas definidas por %. */
export function monthlyIncome({ data, metas, ids, y, m, isHoliday }) {
  return incomeBase({ data, metas, ids, from: iso(y, m, 1), to: iso(y, m, daysInMonth(y, m)), isHoliday }).planned;
}
