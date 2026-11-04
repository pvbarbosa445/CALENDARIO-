// Simulação do cofrinho (estilo Tesouro): quanto o cofrinho pode acumular em 1, 3, 5 e 10 anos
// se as metas de economia forem cumpridas. Tudo aqui é puro e testável.
//
// Regras (definidas pelo Pedro):
//   · ponto de partida = dinheiro realmente guardado no cofrinho (depósitos − retiradas reais),
//     com rendimento estimado a partir da data de cada aporte;
//   · fonte "sobra mensal": a sobra planejada de cada mês das contas escolhidas (receitas − despesas
//     ± transferências, sem contar o que vai para o próprio cofrinho e descontando reservas em outros cofrinhos);
//     12 primeiros meses = mês a mês; depois, a média desses 12 meses;
//   · todas as contas escolhidas entram pela sobra mensal, que já considera as Metas cadastradas
//     (limite de gasto ainda não lançado sai da sobra; meta de receita ainda não lançada entra);
//   · mês planejado com sobra negativa = contribuição zero (nunca retira do cofrinho);
//   · mês sem nenhum planejamento não vira zero: usa a média dos meses planejados;
//   · rendimento real (acima do IPCA) editável; nominal = (1 + real) × (1 + IPCA) − 1 (sem somar taxas);
//   · "dinheiro de hoje" = valor nominal descontado pelo IPCA estimado.
// Nada disso cria lançamentos: são só números de projeção.
import { itemsInRange, counts, realizedOf, flowOf } from './engine.js';
import { metaShare, appliesOn } from './finance.js';
import { addDays, diffDays, parse, iso, daysInMonth, addMonths, weekday } from './dates.js';

export const SIM_DEFAULT = { rate: 7.58, ipca: 4.0 };
export const HORIZONS = [1, 3, 5, 10];
const YEAR = 365.25;

/** Configuração da simulação de um cofrinho, com padrões. Todas as contas entram pela sobra mensal. */
export function simConfig(piggy, accounts = [], defaultAccount = null) {
  const s = (piggy && piggy.sim) || {};
  const sources = {};
  for (const a of accounts) {
    const cur = (s.sources || {})[a.id];
    sources[a.id] = { on: cur ? !!cur.on : a.id === defaultAccount, mode: 'surplus' };
  }
  const num = (v, d) => (Number.isFinite(+v) && v !== '' && v != null ? +v : d);
  return { rate: num(s.rate, SIM_DEFAULT.rate), ipca: num(s.ipca, SIM_DEFAULT.ipca), sources, basis: s.basis === 'plan' ? 'plan' : 'surplus' };
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

/** Limite (ou valor) de uma meta convertido para um mês: semana, dia útil, fim de semana… viram valor mensal. */
export function metaMonthAmount(meta, y, m, isHoliday = () => false) {
  const a = meta.amount || 0;
  if (!a) return 0;
  const n = daysInMonth(y, m), first = iso(y, m, 1), last = iso(y, m, n);
  switch (meta.period) {
    case 'month': return a;
    case 'year': return Math.round(a / 12);
    case 'week': return Math.round(a * n / 7);
    case 'custom': {
      if (!meta.from || !meta.to || meta.to < first || meta.from > last) return 0;
      const total = diffDays(meta.from, meta.to) + 1;
      const from = meta.from > first ? meta.from : first, to = meta.to < last ? meta.to : last;
      return Math.round(a * (diffDays(from, to) + 1) / total);
    }
    default: { // por dia, por dia útil, por fim de semana/feriado
      let count = 0;
      for (let d = 1; d <= n; d++) if (appliesOn(meta, iso(y, m, d), isHoliday)) count++;
      return a * count;
    }
  }
}

/**
 * Sobra planejada de um mês para um conjunto de contas (transferências entre elas se anulam),
 * sem contar o que vai para o próprio cofrinho e descontando reservas em outros cofrinhos.
 * Também usa as Metas: o limite de gasto que ainda não tem lançamento sai da sobra, e a meta de
 * receita que ainda não tem lançamento entra. Retorna { value, planned } — planned = o mês tem planejamento.
 * ctx: { metas, isHoliday, defaultAccount }
 */
export function monthSurplus(data, accIds, y, m, piggy, ctx = {}) {
  const set = new Set(accIds);
  const own = ownAccount(piggy);
  let v = 0, planned = false;
  const inMonth = [];
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
      if ((it.kind === 'income' || it.kind === 'expense') && set.has(it.accountId)) { planned = true; inMonth.push(it); }
    }
  }
  for (const meta of ctx.metas || []) {
    if (meta.archived || !meta.amount) continue;
    const ids = meta.accountIds && meta.accountIds.length ? meta.accountIds : [ctx.defaultAccount];
    if (!ids.some(id => set.has(id))) continue;
    const L = metaMonthAmount(meta, y, m, ctx.isHoliday);
    if (!L) continue;
    planned = true;
    let P = 0;
    for (const it of inMonth) { const sh = metaShare(it, meta); if (sh) P += sh.planned; }
    const extra = Math.max(0, L - P);
    v += (meta.kind === 'income' ? 1 : -1) * extra;
  }
  return { value: v, planned };
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
 * 12 primeiros meses: a sobra de cada mês planejado (negativa = 0); mês sem planejamento e meses
 * seguintes: a média dos meses planejados (sem dividir por meses vazios).
 * opts: { data, piggy, cfg, today, until, flows, metas, isHoliday, defaultAccount }
 */
export function plannedContributions({ data, piggy, cfg, today, until, flows = [], metas = [], isHoliday, defaultAccount = null, planMonth = null }) {
  const out = [];
  const { y, m } = parse(today);
  const ids = Object.entries(cfg.sources).filter(([, s]) => s.on).map(([id]) => id);
  const months = [];
  let avg = 0;
  if (ids.length) {
    // o que já foi guardado neste mês vindo dessas contas não entra de novo
    const mStart = iso(y, m, 1);
    const already = flows.filter(f => f.date >= mStart && f.date <= today && f.amount > 0 && ids.includes(f.from)).reduce((s, f) => s + f.amount, 0);
    for (let k = 0; k < 12; k++) {
      const mm = addMonths(y, m, k);
      // base: sobra mensal (padrão) ou o % da divisão da renda destinado a este cofrinho
      const r = cfg.basis === 'plan' && planMonth ? planMonth(ids, mm.y, mm.m) : monthSurplus(data, ids, mm.y, mm.m, piggy, { metas, isHoliday, defaultAccount });
      months.push({ y: mm.y, m: mm.m, planned: r.planned, raw: r.value, value: r.planned ? Math.max(0, r.value) : null });
    }
    const pl = months.filter(x => x.planned);
    avg = pl.length ? Math.round(pl.reduce((s, x) => s + x.value, 0) / pl.length) : 0;
    for (let k = 0; ; k++) {
      const mm = addMonths(y, m, k);
      const end = iso(mm.y, mm.m, daysInMonth(mm.y, mm.m));
      if (end > until) break;
      let v = k < 12 && months[k].planned ? months[k].value : avg;
      if (k === 0) v = Math.max(0, v - already);
      if (v > 0) out.push({ date: end, amount: v, source: 'surplus' });
    }
  }
  return { list: out, months, avg, ids };
}

/**
 * Projeção completa. Retorna o ponto de partida e, para cada horizonte, o total nominal,
 * o total em dinheiro de hoje, quanto foi aportado e quanto é rendimento.
 */
export function simulate({ data, piggy, cfg, today, horizons = HORIZONS, account = null, metas = [], isHoliday, defaultAccount = null, planMonth = null }) {
  const rn = nominalRate(cfg.rate, cfg.ipca), inf = cfg.ipca / 100;
  const grow = (amount, from, to) => amount * Math.pow(1 + rn, Math.max(0, diffDays(from, to)) / YEAR);
  const flows = piggyFlows(piggy, data, today, account);
  const saved = flows.reduce((s, f) => s + f.amount, 0);
  const deposited = flows.filter(f => f.amount > 0).reduce((s, f) => s + f.amount, 0);
  const withdrawn = -flows.filter(f => f.amount < 0).reduce((s, f) => s + f.amount, 0);
  // rendimento estimado desde a data de cada aporte (hipótese: aplicado na taxa configurada)
  const startValue = Math.max(0, flows.reduce((s, f) => s + grow(f.amount, f.date, today), 0));
  horizons = [...new Set(horizons.map(Number).filter(n => n >= 1 && n <= 40))].sort((a, b) => a - b);
  if (!horizons.length) horizons = HORIZONS;
  const last = addYears(today, Math.max(...horizons));
  const opts = { data, piggy, cfg, today, flows, metas, isHoliday, defaultAccount, planMonth };
  const plan = plannedContributions({ ...opts, until: last });
  const results = horizons.map(n => {
    const H = addYears(today, n);
    let nominal = grow(startValue, today, H), contributed = Math.max(0, saved);
    for (const c of plan.list) { if (c.date > H) break; nominal += grow(c.amount, c.date, H); contributed += c.amount; }
    const real = nominal / Math.pow(1 + inf, diffDays(today, H) / YEAR);
    // se parar de contribuir em H: o patrimônio continua investido, sem novos depósitos.
    // Em dinheiro de hoje, a renda que se pode tirar sem perder poder de compra = taxa real;
    // em valores da época (nominal), o rendimento bruto = taxa nominal.
    const rr = cfg.rate / 100;
    return {
      years: n, date: H, nominal: Math.round(nominal), real: Math.round(real), contributed: Math.round(contributed), yield: Math.round(nominal - contributed),
      incomeMonthReal: Math.round(real * (Math.pow(1 + rr, 1 / 12) - 1)), incomeYearReal: Math.round(real * rr),
      incomeMonthNominal: Math.round(nominal * (Math.pow(1 + rn, 1 / 12) - 1)), incomeYearNominal: Math.round(nominal * rn),
    };
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
      const H0 = addYears(today, 40), more = plannedContributions({ ...opts, until: H0 }).list;
      for (let k = 1; k <= 480 && !goalAt; k++) {
        const { y, m } = parse(today), mm = addMonths(y, m, k), H = iso(mm.y, mm.m, daysInMonth(mm.y, mm.m));
        let v = grow(startValue, today, H);
        for (const c of more) { if (c.date > H) break; v += grow(c.amount, c.date, H); }
        if (v / Math.pow(1 + inf, diffDays(today, H) / YEAR) >= piggy.goal) goalAt = H;
      }
    }
  }
  return { flows, saved, deposited, withdrawn, startValue: Math.round(startValue), results, perMonth, perWeek, months: plan.months, avg: plan.avg, contributions: plan.list, goalAt, nominalRate: rn };
}
