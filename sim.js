// Simulação do cofrinho (estilo Tesouro): quanto o cofrinho pode acumular em 1, 3, 5 e 10 anos
// se as metas de economia forem cumpridas. Tudo aqui é puro e testável.
//
// Regras (definidas pelo Pedro):
//   · ponto de partida = dinheiro realmente guardado no cofrinho (depósitos − retiradas reais),
//     com rendimento estimado a partir da data de cada aporte;
//   · fonte "sobra mensal": a sobra planejada de cada mês das contas escolhidas (receitas − despesas
//     ± transferências, sem contar o que vai para o próprio cofrinho e descontando reservas em outros cofrinhos);
//     12 primeiros meses = mês a mês; depois, a média desses 12 meses;
//   · fonte "meta semanal": um valor fixo por semana (a semana atual só com o que ainda falta);
//   · mês com sobra negativa = contribuição zero (nunca retira do cofrinho);
//   · rendimento real (acima do IPCA) editável; nominal = (1 + real) × (1 + IPCA) − 1 (sem somar taxas);
//   · "dinheiro de hoje" = valor nominal descontado pelo IPCA estimado.
// Nada disso cria lançamentos: são só números de projeção.
import { itemsInRange, counts, realizedOf, flowOf } from './engine.js';
import { addDays, diffDays, parse, iso, daysInMonth, addMonths, weekday } from './dates.js';

export const SIM_DEFAULT = { rate: 7.58, ipca: 4.0 };
export const HORIZONS = [1, 3, 5, 10];
const YEAR = 365.25;

/** Configuração da simulação de um cofrinho, com padrões. */
export function simConfig(piggy, accounts = [], defaultAccount = null) {
  const s = (piggy && piggy.sim) || {};
  const sources = {};
  for (const a of accounts) {
    const cur = (s.sources || {})[a.id];
    sources[a.id] = cur ? { on: !!cur.on, mode: cur.mode === 'weekly' ? 'weekly' : 'surplus', weekly: Math.max(0, +cur.weekly || 0) }
      : { on: a.id === defaultAccount, mode: a.id === defaultAccount ? 'surplus' : 'weekly', weekly: 0 };
  }
  const num = (v, d) => (Number.isFinite(+v) && v !== '' && v != null ? +v : d);
  return { rate: num(s.rate, SIM_DEFAULT.rate), ipca: num(s.ipca, SIM_DEFAULT.ipca), sources };
}

/** Taxa nominal anual a partir da real e do IPCA (composição, não soma). */
export const nominalRate = (real, ipca) => (1 + real / 100) * (1 + ipca / 100) - 1;

/** Contas cujo dinheiro é o próprio cofrinho (cofrinho real = conta separada). */
const ownAccount = p => (p && p.type === 'real' ? p.accountId : null);

/**
 * Movimentos reais do cofrinho (só o que aconteceu de fato): [{ date, amount (+ entra, − sai), from }].
 * Cofrinho real: transferências e lançamentos na conta dele; virtual: reservas e retiradas.
 */
export function piggyFlows(piggy, data, today, account = null) {
  const out = [];
  const own = ownAccount(piggy);
  // cofrinho real criado com saldo inicial na conta separada: conta como um aporte na criação
  if (own && account && account.initialBalance) out.push({ date: String(account.createdAt || today).slice(0, 10), amount: account.initialBalance, from: own });
  for (const [d, list] of itemsInRange(firstStart(data, today), today, data)) {
    if (d > today) continue;
    for (const it of list) {
      if (it.status === 'moved' || !counts(it)) continue;
      const r = realizedOf(it); if (!r) continue;
      if (own) {
        if (it.kind === 'transfer' && it.toAccountId === own && it.accountId !== own) out.push({ date: d, amount: r, from: it.accountId });
        else if (it.kind === 'transfer' && it.accountId === own && it.toAccountId !== own) out.push({ date: d, amount: -r, from: it.toAccountId });
        else if (it.kind === 'income' && it.accountId === own) out.push({ date: d, amount: r, from: own });
        else if (it.kind === 'expense' && it.accountId === own) out.push({ date: d, amount: -r, from: own });
      } else if (it.piggyId === piggy.id && (it.kind === 'reserve' || it.kind === 'release')) {
        out.push({ date: d, amount: it.kind === 'reserve' ? r : -r, from: it.accountId });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
function firstStart(data, fallback) {
  let min = fallback;
  for (const e of data.entries) if (e.rule.start < min) min = e.rule.start;
  if (data.overrides) for (const o of data.overrides.values()) if (o.movedTo && o.movedTo < min) min = o.movedTo;
  return min;
}

/**
 * Sobra planejada de um mês para um conjunto de contas (transferências entre elas se anulam),
 * sem contar o que vai para o próprio cofrinho e descontando reservas em outros cofrinhos.
 */
export function monthSurplus(data, accIds, y, m, piggy) {
  const set = new Set(accIds);
  const own = ownAccount(piggy);
  let v = 0;
  for (const list of itemsInRange(iso(y, m, 1), iso(y, m, daysInMonth(y, m)), data).values()) {
    for (const it of list) {
      if (it.status === 'moved' || !counts(it)) continue;
      if (it.kind === 'reserve' || it.kind === 'release') {
        if (it.piggyId === (piggy && piggy.id) || !set.has(it.accountId)) continue;
        v += it.kind === 'reserve' ? -it.amount : it.amount;
        continue;
      }
      // depósitos e retiradas do próprio cofrinho não são "gasto": a sobra é o que pode ir para ele
      if (own && it.kind === 'transfer' && (it.toAccountId === own || it.accountId === own)) continue;
      const f = flowOf(it, set); if (!f) continue;
      v += f.inc - f.exp + f.tr;
    }
  }
  return v;
}

/** Início e fim da semana que contém d. */
export function weekOf(d, mondayFirst = false) {
  const back = (weekday(d) - (mondayFirst ? 1 : 0) + 7) % 7;
  const start = addDays(d, -back);
  return { start, end: addDays(start, 6) };
}

const addYears = (d, n) => { const { y, m, d: dd } = parse(d); return iso(y + n, m, Math.min(dd, daysInMonth(y + n, m))); };

/**
 * Lista de contribuições futuras previstas [{ date, amount, source }] até `until`.
 * opts: { data, piggy, cfg, today, mondayFirst, flows }
 */
export function plannedContributions({ data, piggy, cfg, today, until, mondayFirst = false, flows = [] }) {
  const out = [];
  const { y, m } = parse(today);
  const surplusIds = Object.entries(cfg.sources).filter(([, s]) => s.on && s.mode === 'surplus').map(([id]) => id);
  const monthly = [];
  if (surplusIds.length) {
    // o que já foi guardado neste mês vindo dessas contas não entra de novo
    const mStart = iso(y, m, 1);
    const already = flows.filter(f => f.date >= mStart && f.date <= today && f.amount > 0 && surplusIds.includes(f.from)).reduce((s, f) => s + f.amount, 0);
    for (let k = 0; k < 12; k++) {
      const mm = addMonths(y, m, k);
      monthly.push(Math.max(0, monthSurplus(data, surplusIds, mm.y, mm.m, piggy)));
    }
    const avg = Math.round(monthly.reduce((s, v) => s + v, 0) / 12);
    for (let k = 0; ; k++) {
      const mm = addMonths(y, m, k);
      const end = iso(mm.y, mm.m, daysInMonth(mm.y, mm.m));
      if (end > until) break;
      const v = k < 12 ? (k === 0 ? Math.max(0, monthly[0] - already) : monthly[k]) : avg;
      if (v > 0) out.push({ date: end, amount: v, source: 'surplus' });
    }
  }
  for (const [id, s] of Object.entries(cfg.sources)) {
    if (!s.on || s.mode !== 'weekly' || !s.weekly) continue;
    const wk = weekOf(today, mondayFirst);
    const done = flows.filter(f => f.date >= wk.start && f.date <= today && f.amount > 0 && f.from === id).reduce((a, f) => a + f.amount, 0);
    for (let end = wk.end, first = true; end <= until; end = addDays(end, 7), first = false) {
      const v = first ? Math.max(0, s.weekly - done) : s.weekly;
      if (v > 0) out.push({ date: end, amount: v, source: id });
    }
  }
  return { list: out.sort((a, b) => a.date.localeCompare(b.date)), monthly, surplusIds };
}

/**
 * Projeção completa. Retorna o ponto de partida e, para cada horizonte, o total nominal,
 * o total em dinheiro de hoje, quanto foi aportado e quanto é rendimento.
 */
export function simulate({ data, piggy, cfg, today, mondayFirst = false, horizons = HORIZONS, account = null }) {
  const rn = nominalRate(cfg.rate, cfg.ipca), inf = cfg.ipca / 100;
  const grow = (amount, from, to) => amount * Math.pow(1 + rn, Math.max(0, diffDays(from, to)) / YEAR);
  const flows = piggyFlows(piggy, data, today, account);
  const saved = flows.reduce((s, f) => s + f.amount, 0);
  const deposited = flows.filter(f => f.amount > 0).reduce((s, f) => s + f.amount, 0);
  const withdrawn = -flows.filter(f => f.amount < 0).reduce((s, f) => s + f.amount, 0);
  // rendimento estimado desde a data de cada aporte (hipótese: aplicado na taxa configurada)
  const startValue = Math.max(0, flows.reduce((s, f) => s + grow(f.amount, f.date, today), 0));
  const last = addYears(today, Math.max(...horizons));
  const plan = plannedContributions({ data, piggy, cfg, today, until: last, mondayFirst, flows });
  const results = horizons.map(n => {
    const H = addYears(today, n);
    let nominal = grow(startValue, today, H), contributed = Math.max(0, saved);
    for (const c of plan.list) { if (c.date > H) break; nominal += grow(c.amount, c.date, H); contributed += c.amount; }
    const real = nominal / Math.pow(1 + inf, diffDays(today, H) / YEAR);
    return { years: n, date: H, nominal: Math.round(nominal), real: Math.round(real), contributed: Math.round(contributed), yield: Math.round(nominal - contributed) };
  });
  // ritmo planejado: média dos 12 primeiros meses
  const yearEnd = addYears(today, 1);
  const firstYear = plan.list.filter(c => c.date <= yearEnd).reduce((s, c) => s + c.amount, 0);
  const perMonth = Math.round(firstYear / 12), perWeek = Math.round(firstYear / 52);
  // quando a meta de patrimônio (em dinheiro de hoje) seria atingida
  let goalAt = null;
  if (piggy && piggy.goal) {
    if (saved >= piggy.goal) goalAt = today;
    else {
      const H0 = addYears(today, 40), more = plannedContributions({ data, piggy, cfg, today, until: H0, mondayFirst, flows }).list;
      for (let k = 1; k <= 480 && !goalAt; k++) {
        const { y, m } = parse(today), mm = addMonths(y, m, k), H = iso(mm.y, mm.m, daysInMonth(mm.y, mm.m));
        let v = grow(startValue, today, H);
        for (const c of more) { if (c.date > H) break; v += grow(c.amount, c.date, H); }
        if (v / Math.pow(1 + inf, diffDays(today, H) / YEAR) >= piggy.goal) goalAt = H;
      }
    }
  }
  return { flows, saved, deposited, withdrawn, startValue: Math.round(startValue), results, perMonth, perWeek, monthly: plan.monthly, contributions: plan.list, goalAt, nominalRate: rn };
}

/** Progresso da meta semanal de uma conta: quanto já foi guardado nesta semana e quanto falta. */
export function weekProgress(flows, accountId, weekly, today, mondayFirst = false) {
  const wk = weekOf(today, mondayFirst);
  const done = flows.filter(f => f.date >= wk.start && f.date <= today && f.amount > 0 && f.from === accountId).reduce((s, f) => s + f.amount, 0);
  return { ...wk, done, left: Math.max(0, weekly - done) };
}
