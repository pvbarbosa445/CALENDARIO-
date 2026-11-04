// Divisão percentual da renda ("bolacha" de 100%): o usuário diz como quer distribuir a renda
// e o app mostra, numa única rosca, quanto de cada parte foi planejado, previsto e realizado.
// Tudo puro e testável. Nada aqui cria lançamentos: só lê os dados que já existem.
//
// Regras:
//   · renda = receitas das contas escolhidas (transferências entre contas próprias não são renda);
//   · doações/dízimo (opcional, valor por mês ou % da renda) saem antes: a base da divisão é o que sobra;
//   · cada categoria tem um % da base e se liga a Metas, tags e cofrinhos que já existem;
//   · gasto entra pela meta/tag ligada; guardado entra pelos depósitos reais nos cofrinhos ligados
//     (transferência para cofrinho é destinação, não despesa nem receita);
//   · cada lançamento conta numa categoria só (a primeira que o reivindica), sem duplicar valores;
//   · previsto e realizado ficam separados: nada previsto conta como recebido ou depositado.
import { itemsInRange, counts, realizedOf } from './engine.js';
import { metaShare, rangeLimit } from './finance.js';

/** Modelo inicial inspirado no método do Investidor Sardinha. É só um ponto de partida editável. */
export const TEMPLATE_SARDINHA = {
  name: 'Método do Sardinha',
  cats: [
    { key: 'liberdade', name: 'Liberdade Financeira', pct: 25, color: '#45cf7f', kind: 'save' },
    { key: 'fixos', name: 'Custos Fixos', pct: 30, color: '#8cb6e4', kind: 'spend' },
    { key: 'conforto', name: 'Conforto', pct: 15, color: '#ffd60a', kind: 'spend' },
    { key: 'metas', name: 'Metas e objetivos', pct: 15, color: '#bf5af2', kind: 'save' },
    { key: 'prazeres', name: 'Prazeres', pct: 10, color: '#ff9f0a', kind: 'spend' },
    { key: 'conhecimento', name: 'Conhecimento', pct: 5, color: '#40c8e0', kind: 'spend' },
  ],
};
/** Orientação do método (não bloqueia nada). */
export const GUIDE = { investIdeal: 25, investMin: 15 };

const uidLocal = () => 'b' + Math.random().toString(36).slice(2, 10);
/** Cria um modelo a partir do modelo inicial (ids novos, sem nenhum vínculo pessoal). */
export function modelFromTemplate(tpl = TEMPLATE_SARDINHA, uid = uidLocal) {
  return {
    id: uid(), name: tpl.name, deduction: { on: false, mode: 'value', value: 0 },
    cats: tpl.cats.map(c => ({ id: uid(), name: c.name, pct: c.pct, color: c.color, kind: c.kind, metaIds: [], tagIds: [], piggyIds: [], archived: false })),
  };
}

/**
 * Configuração visual da bolacha. O modelo de distribuição não é cadastrado aqui:
 * as categorias vêm diretamente das Metas existentes. `models` é mantido apenas
 * para ler versões antigas e migrar seus percentuais/vínculos sem perder dados.
 */
export function budgetConfig(settings = {}) {
  const b = settings.budget || {};
  const models = Array.isArray(b.models) ? b.models : [];
  const legacy = models.find(m => m.id === b.activeModel) || models[0] || null;
  return {
    accounts: Array.isArray(b.accounts) ? b.accounts : [], // vazio = a conta que está sendo exibida
    showOnCalendar: b.showOnCalendar !== false,
    showLegendValues: b.showLegendValues !== false,
    showPlanVsReal: b.showPlanVsReal !== false,
    deduction: b.deduction || (legacy && legacy.deduction) || { on: false, mode: 'value', value: 0 },
    legacyModel: legacy,
  };
}

/** Recupera o percentual de modelos antigos apenas como migração de leitura. */
export function metaDistributionPct(meta, legacyModel = null, allMetas = []) {
  if (meta && meta.allocationPct != null && Number.isFinite(+meta.allocationPct)) return Math.max(0, Math.min(100, +meta.allocationPct));
  const cats = (legacyModel && legacyModel.cats || []).filter(c => !c.archived);
  let total = 0;
  for (const c of cats) {
    const mids = c.metaIds || [];
    if (mids.includes(meta.id)) { total += (+c.pct || 0) / Math.max(1, mids.length); continue; }
    if (meta.kind === 'saving' && meta.piggyId && (c.piggyIds || []).includes(meta.piggyId)) { total += (+c.pct || 0); continue; }
    const matched = (c.tagIds || []).filter(id => (meta.tagIds || []).includes(id));
    if (matched.length) {
      const peers = allMetas.filter(m => !m.archived && (m.tagIds || []).some(id => (c.tagIds || []).includes(id))).length || 1;
      total += (+c.pct || 0) / peers;
    }
  }
  return Math.max(0, Math.min(100, total));
}

/** Constrói a bolacha diretamente das Metas. Não cria categorias paralelas. */
export function modelFromMetas(metas = [], legacyModel = null) {
  const list = metas.filter(m => !m.archived && (m.kind || 'expense') !== 'income');
  return {
    id: 'metas-linked', name: 'Metas cadastradas',
    deduction: (legacyModel && legacyModel.deduction) || { on: false, mode: 'value', value: 0 },
    cats: list.map(m => ({
      id: m.id, metaId: m.id, name: m.name, pct: metaDistributionPct(m, legacyModel, metas),
      color: m.color || '#8cb6e4', kind: m.kind === 'saving' ? 'save' : 'spend',
      metaIds: [m.id], tagIds: [], piggyIds: m.kind === 'saving' && m.piggyId ? [m.piggyId] : [], archived: false,
    })),
  };
}
export const activeModelOf = cfg => cfg.legacyModel || { id: 'metas-linked', name: 'Metas cadastradas', deduction: cfg.deduction, cats: [] };
export const liveCats = model => (model.cats || []).filter(c => !c.archived);

/** Soma dos % das categorias ativas e quanto falta (positivo) ou passou (negativo) de 100%. */
export function pctCheck(model) {
  const sum = Math.round(liveCats(model).reduce((s, c) => s + (+c.pct || 0), 0) * 100) / 100;
  return { sum, missing: Math.round((100 - sum) * 100) / 100, ok: Math.abs(100 - sum) < 0.005 };
}

/** Redistribui explicitamente a diferença para 100% entre as outras categorias (proporcional). Só quando o usuário pede. */
export function rebalance(model, fixedId) {
  const cats = liveCats(model), fixed = cats.find(c => c.id === fixedId);
  const others = cats.filter(c => c !== fixed);
  const target = 100 - (fixed ? +fixed.pct || 0 : 0);
  const cur = others.reduce((s, c) => s + (+c.pct || 0), 0);
  if (!others.length || target < 0) return model;
  let acc = 0;
  const out = others.map((c, i) => {
    const v = i === others.length - 1 ? Math.round((target - acc) * 100) / 100 : Math.round((cur ? (+c.pct || 0) / cur : 1 / others.length) * target * 100) / 100;
    acc += v; return [c.id, v];
  });
  const map = new Map(out);
  return { ...model, cats: model.cats.map(c => (map.has(c.id) ? { ...c, pct: map.get(c.id) } : c)) };
}

/** Parte de um gasto que pertence às tags dadas (respeita divisão entre tags). */
function tagShare(it, tagIds) {
  if (!tagIds || !tagIds.length) return 0;
  if (it.splits && it.splits.length) {
    const total = it.splits.reduce((s, p) => s + p.amount, 0) || 1;
    return it.splits.filter(p => tagIds.includes(p.tagId)).reduce((s, p) => s + p.amount, 0) / total;
  }
  return tagIds.includes(it.tagId) ? 1 : 0;
}

/**
 * Distribuição da renda no período [from, to] para as contas `ids`.
 * opts: { data, model, ids, from, to, metas, piggies, treasuryAccountId }
 * Destinos de dinheiro guardado: cofrinhos (ids) e o Tesouro (id 'treasury'), cada um com seu saldo próprio.
 */
export const TREASURY = 'treasury';
export function distribution({ data, model, ids, from, to, metas = [], piggies = [], treasuryAccountId = null }) {
  const set = new Set(ids);
  const metaById = new Map(metas.map(m => [m.id, m]));
  const pigAccount = new Map(piggies.filter(p => p.type === 'real' && p.accountId).map(p => [p.accountId, p.id]));
  if (treasuryAccountId) pigAccount.set(treasuryAccountId, TREASURY); // aporte no Tesouro = transferência para a conta dele
  const cats = liveCats(model).map(c => ({ ...c, pct: +c.pct || 0, planned: 0, realized: 0, items: [] }));
  const other = { planned: 0, realized: 0, items: [] }; // gastos sem categoria
  const otherSaved = { planned: 0, realized: 0, items: [] }; // depósitos em cofrinhos sem categoria
  let incP = 0, incR = 0;
  const add = (bucket, it, planned, real) => { bucket.planned += planned; bucket.realized += real; bucket.items.push({ it, planned, real }); };
  for (const [, list] of itemsInRange(from, to, data)) {
    for (const it of list) {
      if (it.status === 'moved' || !counts(it)) continue;
      const a = it.amount, r = realizedOf(it);
      if (it.kind === 'income') { if (set.has(it.accountId)) { incP += a; incR += r; } continue; }
      // depósito/retirada em cofrinho (virtual: reserva; real: transferência para a conta do cofrinho)
      let pig = null, sign = 0;
      if ((it.kind === 'reserve' || it.kind === 'release') && set.has(it.accountId)) { pig = it.piggyId; sign = it.kind === 'reserve' ? 1 : -1; }
      else if (it.kind === 'transfer' && set.has(it.accountId) && pigAccount.has(it.toAccountId) && !set.has(it.toAccountId)) { pig = pigAccount.get(it.toAccountId); sign = 1; }
      else if (it.kind === 'transfer' && set.has(it.toAccountId) && pigAccount.has(it.accountId) && !set.has(it.accountId)) { pig = pigAccount.get(it.accountId); sign = -1; }
      if (pig) {
        const c = cats.find(x => (x.piggyIds || []).includes(pig));
        add(c || otherSaved, it, sign * a, sign * r);
        continue;
      }
      if (it.kind !== 'expense' || !set.has(it.accountId)) continue; // transferências internas não entram
      // gasto: a primeira categoria que reivindica (meta ou tag) leva — sem duplicar
      let left = 1;
      for (const c of cats) {
        if (left <= 0) break;
        let share = 0;
        for (const mid of c.metaIds || []) { const m = metaById.get(mid); if (!m) continue; const s = metaShare(it, m); if (s && it.amount) share = Math.max(share, s.planned / it.amount); }
        share = Math.max(share, tagShare(it, c.tagIds));
        share = Math.min(share, left);
        if (share > 0) { add(c, it, Math.round(a * share), Math.round(r * share)); left -= share; }
      }
      if (left > 0.0001) add(other, it, Math.round(a * left), Math.round(r * left));
    }
  }
  // doações/dízimo antes da divisão
  const d = model.deduction || {};
  const dedOf = inc => (!d.on ? 0 : d.mode === 'percent' ? Math.round(inc * (+d.value || 0) / 100) : rangeLimit({ period: 'month', amount: +d.value || 0 }, from, to));
  const dedP = Math.min(incP, dedOf(incP)), dedR = Math.min(incR, d.mode === 'percent' ? dedOf(incR) : dedP);
  const baseP = incP - dedP, baseR = incR - dedR;
  for (const c of cats) {
    c.target = Math.round(baseP * c.pct / 100); // quanto o plano destina (sobre a renda prevista)
    c.used = c.realized; // realizado: gasto pago ou depósito feito
    c.left = Math.max(0, c.target - c.realized);
    c.over = Math.max(0, c.realized - c.target);
    c.plannedOver = Math.max(0, c.planned - c.target);
    c.realPct = baseP ? c.realized / baseP * 100 : 0;
    c.status = c.over ? (c.kind === 'save' ? 'ahead' : 'over') : c.plannedOver && c.kind !== 'save' ? 'risk' : 'ok';
  }
  const pc = pctCheck(model);
  return {
    from, to, income: { planned: incP, received: incR }, deduction: { planned: dedP, received: dedR, on: !!d.on },
    base: { planned: baseP, received: baseR }, cats, other, otherSaved, pct: pc,
    undistributed: pc.missing > 0 ? Math.round(baseP * pc.missing / 100) : 0,
  };
}
