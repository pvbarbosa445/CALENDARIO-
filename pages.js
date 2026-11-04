// Telas de gestão abertas pelo menu: contas, cofrinhos, metas, relatórios, histórico e alertas,
// além dos painéis recolhíveis da tela inicial e do backup/restauração.
// Tudo fica numa única folha (#pageSheet) com navegação interna, para não multiplicar telas.
import { itemsInRange, occKey, counts, realizedOf } from './engine.js';
import { addDays, parse, iso, daysInMonth, addMonths, MONTHS } from './dates.js';
import * as db from './db.js';
import * as SIM from './sim.js';
import * as B from './budget.js';

let C;            // contexto compartilhado do app (estado, formatação, diálogos, gravação)
let el;           // a folha das páginas
const stack = []; // pilha de telas dentro da folha

const ACC_TYPES = {
  checking: 'Conta corrente', savings: 'Poupança', digital: 'Carteira digital', cash: 'Dinheiro em espécie',
  payment: 'Conta de pagamento', investment: 'Investimento', piggy: 'Cofrinho (conta separada)', treasury: 'Tesouro (investimentos)',
};
const ROLLOVER = { none: 'Não acumular', week: 'Acumular na semana', month: 'Acumular no mês', reserve: 'Enviar para um cofrinho' };

// ------------------------------------------------------------------ estrutura
export function init(ctx) {
  C = ctx;
  el = document.createElement('section');
  el.className = 'sheet tall stack';
  el.id = 'pageSheet';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="sheet-head" id="pgHead"></div><div class="sheet-body" id="pgBody"></div>';
  document.body.appendChild(el);
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onInput);
  // aviso de nova versão instalada pelo Service Worker
  if ('serviceWorker' in navigator) {
    let reloading = false;
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!had || reloading) return;
      C.toast('Nova versão instalada', () => { reloading = true; location.reload(); }, 'Recarregar');
    });
  }
}

export function open(page) {
  stack.length = 0;
  stack.push(VIEWS[page]());
  render();
  if (!C.isOpen(el)) C.openLayer(el, () => { stack.length = 0; });
}
function push(view) { stack.push(view); render(); el.querySelector('#pgBody').scrollTop = 0; }
function back() { if (stack.length > 1) { stack.pop(); render(); } else C.closeTop(); }
export function onChange() { if (stack.length && C.isOpen(el)) render(); }
const top = () => stack[stack.length - 1];

function render() {
  const v = top(); if (!v) return;
  const { icon, esc } = C;
  const right = v.right ? `<button class="text-btn strong" data-nav="right">${v.right.icon ? icon(v.right.icon) : esc(v.right.label)}</button>` : '';
  el.querySelector('#pgHead').innerHTML = `<button class="icon-btn" data-nav="back" aria-label="Voltar">${icon(stack.length > 1 ? 'left' : 'close')}</button>
    <div class="grow"><div class="sheet-title sm">${esc(v.title)}</div>${v.sub ? `<div class="sheet-sub">${v.sub}</div>` : ''}</div>${right}`;
  el.querySelector('#pgBody').innerHTML = v.body();
}

async function onClick(e) {
  const nav = e.target.closest('[data-nav]');
  if (nav) { if (nav.dataset.nav === 'back') back(); else top().right.fn(); return; }
  const v = top(); if (!v) return;
  const col = e.target.closest('[data-color]');
  if (col && v.vals) { v.vals[col.dataset.k] = col.dataset.color; render(); return; }
  const mul = e.target.closest('[data-multi]');
  if (mul && v.vals) {
    const k = mul.dataset.multi, id = mul.dataset.v;
    const set = new Set(v.vals[k] || []);
    set.has(id) ? set.delete(id) : set.add(id);
    v.vals[k] = [...set]; render(); return;
  }
  const a = e.target.closest('[data-a]');
  if (a && v.actions && v.actions[a.dataset.a]) v.actions[a.dataset.a](a.dataset.id, a);
}
function onInput(e) {
  const v = top(); const t = e.target;
  if (!v || !t.dataset.k) return;
  if (v.onField) { v.onField(t, e.type); return; }
  if (!v.vals) return;
  const k = t.dataset.k, type = t.dataset.type;
  v.vals[k] = type === 'money' ? (C.parseMoney(t.value) || 0) : type === 'switch' ? t.checked : type === 'number' ? (t.value === '' ? null : +t.value) : t.value;
  if (e.type === 'change' && (type === 'select' || type === 'switch' || type === 'money' || t.type === 'date' || type === 'number')) render();
}

// ------------------------------------------------------------------ formulário genérico
function fieldsHTML(fields, vals) {
  const { esc, moneyInput } = C;
  let html = '', open = false;
  const openG = () => { if (!open) { html += '<div class="group">'; open = true; } };
  const closeG = () => { if (open) { html += '</div>'; open = false; } };
  for (const f of fields) {
    if (f.show && !f.show(vals)) continue;
    if (f.section !== undefined) { closeG(); if (f.section) html += `<div class="group-title">${esc(f.section)}</div>`; continue; }
    if (f.hint) { closeG(); html += `<p class="hint">${typeof f.hint === 'function' ? f.hint(vals) : f.hint}</p>`; continue; }
    const v = vals[f.k];
    const L = esc(f.label);
    openG();
    switch (f.type) {
      case 'money': html += `<label class="row field"><span>${L}</span><input data-k="${f.k}" data-type="money" type="text" inputmode="decimal" placeholder="0,00" value="${v ? moneyInput(v) : ''}"></label>`; break;
      case 'number': html += `<label class="row field"><span>${L}</span><input data-k="${f.k}" data-type="number" type="number" inputmode="numeric" value="${v ?? ''}" ${f.min != null ? `min="${f.min}"` : ''}></label>`; break;
      case 'date': html += `<label class="row field"><span>${L}</span><input data-k="${f.k}" type="date" value="${v || ''}"></label>`; break;
      case 'select': html += `<label class="row field"><span>${L}</span><select data-k="${f.k}" data-type="select">${(typeof f.options === 'function' ? f.options() : f.options).map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v ?? '') ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select></label>`; break;
      case 'switch': html += `<label class="row"><span>${L}</span><input data-k="${f.k}" data-type="switch" type="checkbox" class="switch" ${v ? 'checked' : ''}></label>`; break;
      case 'color': html += `<div class="row col"><span class="muted small">${L}</span><div class="swatches sm">${C.PALETTE.map(c => `<button type="button" data-k="${f.k}" data-color="${c}" class="${c === v ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div></div>`; break;
      case 'multi': {
        const sel = new Set(v || []);
        const opts = f.options();
        html += `<div class="row col"><span class="muted small">${L}</span><div class="chips">${opts.length ? opts.map(([ov, ol, color]) => `<button type="button" class="chip${sel.has(ov) ? ' on' : ''}" data-multi="${f.k}" data-v="${esc(ov)}">${color ? `<i class="cdot" style="background:${color}"></i>` : ''}${esc(ol)}</button>`).join('') : '<span class="muted small">Nada cadastrado ainda</span>'}</div></div>`;
        break;
      }
      default: html += `<label class="row field"><span>${L}</span><input data-k="${f.k}" type="text" value="${esc(v || '')}" placeholder="${esc(f.placeholder || '')}" maxlength="60" ${f.list ? `list="${f.list}"` : ''}></label>`;
    }
  }
  closeG();
  return html;
}

function formView({ title, fields, value, onSave, onDelete, deleteLabel = 'Excluir', extra, extraActions = {} }) {
  const view = {
    title, vals: structuredClone(value),
    right: {
      label: 'Salvar', fn: async () => {
        for (const f of fields) if (f.required && (!f.show || f.show(view.vals)) && !view.vals[f.k]) { C.toast(`Preencha: ${f.label}`); return; }
        const ok = await onSave(view.vals);
        if (ok !== false) back();
      },
    },
    body: () => fieldsHTML(fields, view.vals) + (extra ? extra(view.vals) : '') + (onDelete ? `<button class="danger-btn" data-a="del">${deleteLabel}</button>` : ''),
    actions: { ...extraActions, del: async () => { if (await onDelete(view.vals)) { stack.pop(); back(); } } },
  };
  return view;
}

// ------------------------------------------------------------------ utilidades
const S = () => C.S;
function bal() {
  const t = C.today(), { y, m } = parse(t);
  return C.F.balances({ data: S().data, accounts: C.accountsList(true), piggies: [...S().piggies.values()], today: t, planUpto: iso(y, m, daysInMonth(y, m)) });
}
const tagOptions = kind => () => C.tagsSorted().filter(t => !kind || t.kind === 'both' || t.kind === kind).map(t => [t.id, t.name, C.tagColor(t)]);
const accOptions = () => C.accountsList().map(a => [a.id, a.name, a.color]);
function stat(label, value, cls = '', big = false) { return `<div class="${big ? 'big' : ''}"><small>${label}</small><b class="${cls}">${value}</b></div>`; }
function progress(pct, color, over) { return `<div class="progress${over ? ' over' : ''}"><i style="width:${Math.min(100, Math.max(0, pct * 100)).toFixed(1)}%;background:${color}"></i></div>`; }
function row({ a, id, dot, t, s, v, vs, cls = '' }) {
  const { esc } = C;
  return `<button class="card-row" ${a ? `data-a="${a}"` : ''} ${id ? `data-id="${esc(id)}"` : ''}>${dot ? `<span class="dot" style="background:${dot}"></span>` : ''}
    <span class="grow"><div class="t">${t}</div>${s ? `<div class="s">${s}</div>` : ''}</span>${v != null ? `<span class="v ${cls}">${v}${vs ? `<small>${vs}</small>` : ''}</span>` : ''}</button>`;
}
const STORE_LABEL = { accounts: 'Conta', piggies: 'Cofrinho', metas: 'Meta' };
const FIELD_LABEL = { name: 'nome', initialBalance: 'saldo inicial', amount: 'limite', goal: 'valor desejado', deadline: 'prazo', type: 'tipo', period: 'período',
  purpose: 'finalidade', institution: 'instituição', includeInTotal: 'soma no total', archived: 'arquivada', color: 'cor', rollover: 'sobras', carryExcess: 'excedente',
  showOnCalendar: 'colorir dias', alertPct: 'alerta (%)', tagIds: 'tags', accountIds: 'contas', allowedTags: 'despesas permitidas', rules: 'regras de distribuição', accountId: 'conta', kind: 'tipo' };
const MONEY_FIELDS = new Set(['initialBalance', 'amount', 'goal']);
/** Diferenças campo a campo (antes → depois) para o histórico. */
function diffRecord(before, after) {
  if (!before) return ['Criado'];
  const out = [];
  for (const k of Object.keys(FIELD_LABEL)) {
    const a = JSON.stringify(before[k] ?? null), b = JSON.stringify(after[k] ?? null);
    if (a === b) continue;
    const fmt = v => (v == null || v === '' ? '—' : MONEY_FIELDS.has(k) ? C.money(v) : Array.isArray(v) ? `${v.length} item(ns)` : typeof v === 'boolean' ? (v ? 'sim' : 'não') : String(v));
    out.push(k === 'color' ? 'cor alterada' : `${FIELD_LABEL[k]}: ${fmt(before[k])} → ${fmt(after[k])}`);
  }
  return out;
}
async function saveStore(store, map, obj, what) {
  const before = S()[map].get(obj.id) || null;
  await db.put(store, obj); S()[map].set(obj.id, obj);
  db.log(what || `${STORE_LABEL[store]} ${before ? 'alterada' : 'criada'}: ${obj.name}`.replace('Cofrinho alterada', 'Cofrinho alterado').replace('Cofrinho criada', 'Cofrinho criado'), { details: diffRecord(before, obj), before, after: obj });
  C.refresh();
}
async function deleteStore(store, map, obj) {
  await db.del(store, obj.id); S()[map].delete(obj.id);
  db.log(`${STORE_LABEL[store]} excluíd${store === 'piggies' ? 'o' : 'a'}: ${obj.name}`, { before: obj });
  C.refresh();
}
function onceEntry({ kind, amount, date, accountId, toAccountId = null, piggyId = null, title = '', paid = true }) {
  const id = C.uid(), now = C.nowISO();
  const ch = C.ops.newChanges();
  ch.entries.set(id, { id, kind, title, amount, tagId: null, accountId, toAccountId, piggyId, rule: { type: 'once', start: date }, segments: [], createdAt: now, updatedAt: now });
  if (paid) { const k = occKey(id, date); ch.overrides.set(k, { key: k, entryId: id, orig: date, status: 'paid', paidAt: now, updatedAt: now }); }
  return ch;
}
function itemsFor(pred, from, to) {
  const out = [];
  for (const list of itemsInRange(from, to, S().data).values()) for (const it of list) if (it.status !== 'moved' && pred(it)) out.push(it);
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
function movementRow(it, accId) {
  const { money, esc, dm } = C;
  const sign = it.kind === 'income' || (it.kind === 'transfer' && it.toAccountId === accId) || it.kind === 'release' ? '+' : it.kind === 'reserve' ? '' : '−';
  const internal = it.kind === 'reserve' || it.kind === 'release';
  const st = internal ? (S().piggies.get(it.piggyId) || {}).name || '' : it.status === 'planned' ? 'previsto' : C.statusLabel(it).toLowerCase();
  return row({ a: 'goDay', id: it.date, dot: C.itemColor(it), t: esc(C.itemTitle(it)), s: `${dm(it.date)}${st ? ' · ' + esc(st) : ''}`, v: `${sign}${money(it.amount)}`, cls: sign === '+' ? 'pos' : sign === '−' ? 'neg' : 'muted' });
}
async function goDay(date) { await C.closeAll(); C.openDay(date); }

// ------------------------------------------------------------------ CONTAS
function accountsView() {
  return {
    title: 'Contas', right: { icon: 'plus', fn: () => push(accountForm()) },
    body: () => {
      const b = bal(), { money, signed, sgnCls, esc } = C, T = b.totals;
      const list = C.accountsList(true);
      return `<div class="stats">
          ${stat('Saldo consolidado', signed(T.total), sgnCls(T.total), true)}
          ${stat('Disponível', money(T.available))}
          ${stat('Reservado em cofrinhos', money(T.reserved))}
          ${stat('Comprometido até o fim do mês', money(T.committed))}
          ${stat('Transferências pendentes', money(T.pendingTransfers))}
        </div>
        <div class="btn-row"><button class="primary-btn ghost" data-a="transfer">Transferir entre contas</button></div>
        <div class="section-label"><span>CONTAS</span></div>
        ${list.map(a => { const x = b.accounts.get(a.id); return row({ a: 'open', id: a.id, dot: a.color, t: esc(a.name) + (a.archived ? ' <span class="muted small">arquivada</span>' : '') + (a.includeInTotal === false ? ' <span class="muted small">fora do total</span>' : ''), s: [ACC_TYPES[a.type] || '', a.purpose].filter(Boolean).map(esc).join(' · '), v: signed(x.real), vs: x.reserved ? `livre ${money(x.real - x.reserved)}` : '', cls: sgnCls(x.real) }); }).join('')}
        <p class="hint">Transferências entre suas contas não contam como receita nem despesa. Valores guardados em cofrinhos virtuais continuam na conta, mas deixam de ser dinheiro livre.</p>`;
    },
    actions: {
      open: id => push(accountDetail(id)),
      transfer: async () => { await C.closeAll(); C.openForm({ kind: 'transfer', date: C.today() }); },
    },
  };
}

function accountDetail(id) {
  const view = {
    get title() { return (S().accounts.get(id) || {}).name || 'Conta'; },
    get sub() { const a = S().accounts.get(id); return a ? C.esc([ACC_TYPES[a.type], a.institution].filter(Boolean).join(' · ')) : ''; },
    right: { label: 'Editar', fn: () => push(accountForm(S().accounts.get(id))) },
    body: () => {
      const a = S().accounts.get(id); if (!a) return '';
      const b = bal(), x = b.accounts.get(id), { money, signed, sgnCls, esc } = C;
      const pigs = [...S().piggies.values()].filter(p => p.accountId === id && p.type !== 'real');
      const t = C.today();
      const moves = itemsFor(it => it.accountId === id || it.toAccountId === id, addDays(t, -45), addDays(t, 30));
      const rules = a.rules || [];
      const allowed = (a.allowedTags || []).map(tid => (C.tag(tid) || {}).name).filter(Boolean);
      return `<div class="stats">
          ${stat('Saldo atual', signed(x.real), sgnCls(x.real), true)}
          ${stat('Disponível', money(x.real - x.reserved))}
          ${stat('Reservado', money(x.reserved))}
          ${stat('Previsto no fim do mês', signed(x.planned), sgnCls(x.planned))}
          ${stat('Comprometido', money(x.committed))}
        </div>
        <div class="btn-row"><button class="primary-btn ghost" data-a="tr">Transferir</button><button class="primary-btn ghost" data-a="add">Lançamento</button><button class="primary-btn ghost" data-a="rec">Conciliar</button></div>
        ${a.lastReconciled ? `<p class="hint">Última conciliação: ${C.dmy(a.lastReconciled.date)} · banco ${money(a.lastReconciled.real)} · app ${money(a.lastReconciled.app)}</p>` : ''}
        ${(() => {
          const pend = pendingDists(id);
          return pend.length ? `<div class="section-label"><span>DISTRIBUIÇÕES PENDENTES</span></div>${pend.map(it => row({ a: 'dist', id: `${it.key}@${it.date}`, dot: 'var(--green)', t: esc(C.itemTitle(it)), s: `${C.dm(it.date)} · recebido, aguardando distribuição`, v: money(it.amount), cls: 'pos' })).join('')}` : '';
        })()}
        ${a.purpose ? `<p class="hint">Finalidade: ${esc(a.purpose)}</p>` : ''}
        <p class="hint">${allowed.length ? `Despesas permitidas: ${allowed.map(esc).join(', ')}` : 'Todas as despesas são permitidas nesta conta.'}</p>
        <div class="section-label"><span>DISTRIBUIÇÃO AUTOMÁTICA DE RECEITAS</span></div>
        ${rules.map((r, i) => row({ a: 'rule', id: String(i), t: r.origin ? `Receitas de ${esc(r.origin)}` : 'Qualquer receita', s: `${(r.steps || []).length} ${(r.steps || []).length === 1 ? 'passo' : 'passos'} · ${r.auto ? 'automática' : 'pede confirmação'}` })).join('') || '<p class="hint">Nenhuma regra. Ao receber nesta conta, nada é distribuído.</p>'}
        <button class="link-btn pad" data-a="newRule">Nova regra</button>
        ${pigs.length ? `<div class="section-label"><span>COFRINHOS NESTA CONTA</span></div>${pigs.map(p => row({ a: 'pig', id: p.id, dot: p.color, t: esc(p.name), v: money((b.piggies.get(p.id) || {}).saved || 0) })).join('')}` : ''}
        <div class="section-label"><span>MOVIMENTAÇÕES</span><span>45 dias atrás a 30 à frente</span></div>
        ${moves.map(it => movementRow(it, id)).join('') || '<p class="hint">Sem movimentações neste período.</p>'}`;
    },
    actions: {
      tr: async () => { await C.closeAll(); C.openForm({ kind: 'transfer', date: C.today(), from: id }); },
      add: async () => { await C.closeAll(); C.openForm({ date: C.today(), from: id }); },
      rule: i => push(ruleForm(id, +i)),
      dist: async v => { const [key, date] = v.split('@'); await C.distributeNow(key, date); render(); },
      rec: () => reconcile(id),
      newRule: () => push(ruleForm(id, -1)),
      pig: pid => push(piggyDetail(pid)),
      goDay,
    },
  };
  return view;
}

function accountForm(a = null) {
  const value = a ? { ...a } : { name: '', institution: '', type: 'checking', initialBalance: 0, color: C.PALETTE[(S().accounts.size * 5 + 6) % C.PALETTE.length], purpose: '', includeInTotal: true, archived: false, allowedTags: [] };
  return formView({
    title: a ? 'Editar conta' : 'Nova conta', value,
    fields: [
      { k: 'name', label: 'Nome', required: true, placeholder: 'Ex.: Conta iFood' },
      { k: 'institution', label: 'Instituição', placeholder: 'Opcional' },
      { k: 'type', label: 'Tipo', type: 'select', options: Object.entries(ACC_TYPES) },
      { k: 'initialBalance', label: 'Saldo inicial', type: 'money' },
      { k: 'purpose', label: 'Finalidade', placeholder: 'Ex.: ganhos com entregas' },
      { k: 'includeInTotal', label: 'Somar no saldo consolidado', type: 'switch' },
      { k: 'color', label: 'Cor', type: 'color' },
      { section: 'Despesas permitidas' },
      { k: 'allowedTags', label: 'Nenhuma marcada = todas permitidas', type: 'multi', options: tagOptions('expense') },
      { hint: 'Ao pagar algo fora da lista, o app avisa e deixa liberar só aquela vez.' },
      { section: '' },
      { k: 'archived', label: 'Arquivar (some das listas, mantém o histórico)', type: 'switch', show: () => !!a },
    ],
    onSave: async v => {
      if (a && v.archived && !a.archived && !(await resolveRuleLinks('account:' + a.id, a.name))) return false;
      const obj = { ...(a || { id: C.uid(), rules: [], order: S().accounts.size, createdAt: C.nowISO() }), ...v };
      await saveStore('accounts', 'accounts', obj);
      C.syncDrawer();
      C.toast(a ? 'Conta atualizada' : 'Conta criada');
    },
    onDelete: a && (async () => {
      const used = S().data.entries.some(e => e.accountId === a.id || e.toAccountId === a.id) || [...S().piggies.values()].some(p => p.accountId === a.id);
      if (used) { C.toast('A conta tem movimentações. Arquive em vez de excluir.'); return false; }
      if (a.id === S().settings.defaultAccount) { C.toast('A conta principal não pode ser excluída'); return false; }
      if (!(await C.confirmDlg('Excluir conta?', '', 'Excluir', 'danger'))) return false;
      await deleteStore('accounts', 'accounts', a); C.syncDrawer();
      return true;
    }),
  });
}

/** Regras de distribuição: passos em ordem de prioridade. */
function ruleForm(accId, idx) {
  const acc = S().accounts.get(accId);
  const rule = idx >= 0 ? structuredClone(acc.rules[idx]) : { id: C.uid(), origin: '', auto: false, steps: [] };
  const targets = () => [
    ...[...S().piggies.values()].map(p => [`piggy:${p.id}`, `Cofrinho ${p.name}`]),
    ...C.accountsList().filter(a => a.id !== accId).map(a => [`account:${a.id}`, `Conta ${a.name}`]),
  ];
  const STEP = { fixed: 'Valor fixo', percent: 'Percentual', remainder: 'Restante' };
  const origins = [...new Set(S().data.entries.map(e => e.origin).filter(Boolean))];
  const view = {
    title: 'Regra de distribuição', sub: C.esc(acc.name), vals: rule,
    right: {
      label: 'Salvar', fn: async () => {
        if (view.vals.steps.some(s => !s.target)) { C.toast('Escolha o destino de cada passo'); return; }
        const rules = [...(acc.rules || [])];
        if (idx >= 0) rules[idx] = view.vals; else rules.push(view.vals);
        await saveStore('accounts', 'accounts', { ...acc, rules }, `Regra de distribuição salva: ${acc.name}`);
        C.toast('Regra salva'); back();
      },
    },
    body: () => {
      const v = view.vals, { esc, moneyInput, money } = C;
      const opts = targets();
      const sim = C.F.distribute(100000, v, { piggies: [...S().piggies.values()] });
      return `<div class="group">
          <label class="row field"><span>Quando a origem for</span><input data-k="origin" type="text" list="pgOrigins" value="${esc(v.origin)}" placeholder="Qualquer origem"></label>
          <label class="row"><span>Distribuir automaticamente</span><input data-k="auto" type="checkbox" class="switch" ${v.auto ? 'checked' : ''}></label>
        </div>
        <datalist id="pgOrigins">${origins.map(o => `<option value="${esc(o)}">`).join('')}</datalist>
        <p class="hint">${v.auto ? 'Ao marcar uma receita como recebida, a distribuição é feita na hora (dá para desfazer).' : 'Ao receber, o app mostra a distribuição e pede confirmação.'}</p>
        <div class="section-label"><span>PASSOS, EM ORDEM DE PRIORIDADE</span></div>
        ${v.steps.map((s, i) => `<div class="step">
            <div class="step-top"><b>${i + 1}</b>
              <select data-k="type" data-i="${i}">${Object.entries(STEP).map(([k, l]) => `<option value="${k}" ${s.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
              ${s.type === 'remainder' ? '' : `<input data-k="value" data-i="${i}" type="text" inputmode="decimal" value="${s.type === 'fixed' ? moneyInput(s.value) : s.value ?? ''}" placeholder="${s.type === 'fixed' ? 'R$' : '%'}">`}
            </div>
            <select data-k="target" data-i="${i}"><option value="">Destino…</option>${opts.map(([k, l]) => `<option value="${k}" ${s.target === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
            <div class="step-opts">
              <label>Máximo <input data-k="max" data-i="${i}" type="text" inputmode="decimal" value="${s.max ? moneyInput(s.max) : ''}" placeholder="sem limite"></label>
              ${s.target && s.target.startsWith('piggy:') ? `<label class="inline"><input data-k="capToGoal" data-i="${i}" type="checkbox" ${s.capToGoal ? 'checked' : ''}> parar ao atingir a meta</label>` : ''}
            </div>
            <div class="step-tools"><button type="button" class="link-btn" data-a="up" data-id="${i}" ${i ? '' : 'disabled'}>Subir</button><button type="button" class="link-btn" data-a="down" data-id="${i}" ${i < v.steps.length - 1 ? '' : 'disabled'}>Descer</button><button type="button" class="link-btn danger" data-a="rm" data-id="${i}">Remover</button></div>
          </div>`).join('')}
        <button class="link-btn pad" data-a="addStep">Adicionar passo</button>
        ${v.steps.length ? `<p class="hint">Simulação para ${money(100000)}: ${sim.map(o => `${esc((opts.find(x => x[0] === o.target) || [0, '?'])[1])} ${money(o.amount)}`).join(' · ') || 'nada distribuído'}${sim.reduce((s, o) => s + o.amount, 0) < 100000 ? ` · fica na conta ${money(100000 - sim.reduce((s, o) => s + o.amount, 0))}` : ''}</p>` : ''}
        ${idx >= 0 ? '<button class="danger-btn" data-a="del">Excluir regra</button>' : ''}`;
    },
    onField: (t, type) => {
      const v = view.vals, k = t.dataset.k;
      if (t.dataset.i === undefined) { v[k] = t.type === 'checkbox' ? t.checked : t.value.trim(); if (type === 'change') render(); return; }
      const s = v.steps[+t.dataset.i];
      if (k === 'type') { s.type = t.value; s.value = t.value === 'remainder' ? undefined : s.value; }
      else if (k === 'value') s.value = s.type === 'fixed' ? C.parseMoney(t.value) || 0 : Math.min(100, Math.max(0, parseFloat(String(t.value).replace(',', '.')) || 0));
      else if (k === 'max') s.max = C.parseMoney(t.value) || undefined;
      else if (k === 'capToGoal') s.capToGoal = t.checked;
      else s[k] = t.value;
      if (type === 'change' && (k === 'type' || k === 'target' || k === 'capToGoal')) render();
      if (type === 'change' && (k === 'value' || k === 'max')) render();
    },
    actions: {
      addStep: () => { view.vals.steps.push({ type: view.vals.steps.length ? 'remainder' : 'fixed', value: undefined, target: '' }); render(); },
      rm: i => { view.vals.steps.splice(+i, 1); render(); },
      up: i => { const s = view.vals.steps; i = +i; if (i > 0) [s[i - 1], s[i]] = [s[i], s[i - 1]]; render(); },
      down: i => { const s = view.vals.steps; i = +i; if (i < s.length - 1) [s[i + 1], s[i]] = [s[i], s[i + 1]]; render(); },
      del: async () => {
        if (!(await C.confirmDlg('Excluir regra?', '', 'Excluir', 'danger'))) return;
        const rules = [...acc.rules]; rules.splice(idx, 1);
        await saveStore('accounts', 'accounts', { ...acc, rules }, `Regra de distribuição excluída: ${acc.name}`); back();
      },
    },
  };
  return view;
}


/**
 * Um cofrinho/conta usado como destino de regras de distribuição não pode sumir sem resolver o vínculo:
 * o usuário escolhe um novo destino ou encerra esses passos. Retorna true quando pode prosseguir.
 */
async function resolveRuleLinks(target, name) {
  const links = [];
  for (const a of S().accounts.values()) (a.rules || []).forEach((r, ri) => (r.steps || []).forEach((st, si) => { if (st.target === target) links.push({ a, ri, si }); }));
  if (!links.length) return true;
  const options = [
    ...[...S().piggies.values()].filter(p => !p.archived && 'piggy:' + p.id !== target).map(p => [`piggy:${p.id}`, `Cofrinho ${p.name}`]),
    ...C.accountsList().filter(a => 'account:' + a.id !== target).map(a => [`account:${a.id}`, `Conta ${a.name}`]),
  ];
  const where = [...new Set(links.map(l => l.a.name))].map(C.esc).join(', ');
  const res = await C.dialog({
    title: 'Vínculo com distribuição',
    html: `<p>“${C.esc(name)}” é destino de ${links.length} passo(s) de distribuição automática (${where}).</p>
      <p class="small">Escolha um novo destino ou encerre esses passos. Nada será enviado a destinos inexistentes.</p>
      ${options.length ? `<select id="rlTarget">${options.map(([v, l]) => `<option value="${v}">Novo destino: ${C.esc(l)}</option>`).join('')}</select>` : ''}`,
    actions: [{ label: 'Cancelar', value: null }, { label: 'Encerrar passos', value: 'end', cls: 'danger' }, ...(options.length ? [{ label: 'Trocar destino', value: () => document.getElementById('rlTarget').value, cls: 'primary' }] : [])],
  });
  if (!res) return false;
  const byAcc = new Map();
  for (const l of links) { if (!byAcc.has(l.a.id)) byAcc.set(l.a.id, structuredClone(l.a)); }
  for (const acc of byAcc.values()) {
    acc.rules = (acc.rules || []).map(r => ({ ...r, steps: res === 'end' ? r.steps.filter(st => st.target !== target) : r.steps.map(st => (st.target === target ? { ...st, target: res } : st)) })).filter(r => r.steps.length);
    await saveStore('accounts', 'accounts', acc, res === 'end' ? `Passos de distribuição encerrados (destino removido): ${acc.name}` : `Destino de distribuição trocado: ${acc.name}`);
  }
  return true;
}


/** Recebimentos já confirmados cuja distribuição ficou para depois. */
function pendingDists(accId) {
  const out = [];
  for (const ov of S().overrides.values()) {
    if (!ov.distPending || ov.status !== 'paid') continue;
    const e = S().entries.get(ov.entryId);
    if (!e || (e.accountId || S().settings.defaultAccount) !== accId) continue;
    const d = ov.movedTo || ov.orig;
    const it = C.findItem(ov.key, d);
    if (it) out.push(it);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Conciliação: compara o saldo do app com o saldo real e registra a diferença como ajuste (sem apagar nada). */
async function reconcile(accId) {
  const acc = S().accounts.get(accId);
  const x = bal().accounts.get(accId);
  const app = x ? x.real : 0;
  const real = await C.dialog({
    title: `Conciliar ${acc.name}`,
    html: `<p>Saldo no app hoje: <b>${C.money(app)}</b></p><input type="text" inputmode="decimal" id="rcReal" placeholder="Saldo real no banco">`,
    actions: [{ label: 'Cancelar', value: null }, { label: 'Conferir', cls: 'primary', validate: () => Number.isFinite(C.parseMoney(document.getElementById('rcReal').value)) || (C.toast('Informe o saldo real'), false), value: () => C.parseMoney(document.getElementById('rcReal').value) }],
    onOpen: b => setTimeout(() => b.querySelector('#rcReal').focus(), 150),
  });
  if (real == null) return;
  const diff = real - app;
  const stamp = { date: C.today(), real, app, diff };
  if (!diff) {
    await saveStore('accounts', 'accounts', { ...acc, lastReconciled: stamp }, `Conta conciliada sem diferença: ${acc.name}`);
    C.toast('Saldo confere com o banco');
    return;
  }
  const ok = await C.confirmDlg('Registrar diferença?', `O banco mostra ${C.money(real)} e o app ${C.money(app)}.<br>Será lançado um <b>ajuste de ${C.money(Math.abs(diff))}</b> (${diff > 0 ? 'entrada' : 'saída'}) com a data de hoje. Nada do histórico é apagado.`, 'Registrar ajuste');
  if (!ok) return;
  const ch = onceEntry({ kind: diff > 0 ? 'income' : 'expense', amount: Math.abs(diff), date: C.today(), accountId: accId, title: 'Ajuste de conciliação' });
  for (const e of ch.entries.values()) e.reconcile = true;
  await C.commit(`Ajuste de conciliação: ${acc.name}`, ch);
  await saveStore('accounts', 'accounts', { ...S().accounts.get(accId), lastReconciled: stamp }, `Conta conciliada: ${acc.name} (diferença ${C.money(diff)})`);
}

// ------------------------------------------------------------------ FECHAMENTO MENSAL
function closingView() {
  let ref = C.today();
  const view = {
    title: 'Fechamento do mês',
    body: () => {
      const { money, signed, sgnCls, esc, dm } = C;
      const { y, m } = parse(ref);
      const from = iso(y, m, 1), to = iso(y, m, daysInMonth(y, m));
      const t = C.today();
      const ym = from.slice(0, 7);
      const r = C.F.periodReport(from, to, S().data, S().set);
      const items = itemsFor(it => C.accVisible(it), from, to);
      const tr = items.filter(i => i.kind === 'transfer' && counts(i));
      const pend = items.filter(i => i.date <= t && (i.kind === 'income' || i.kind === 'expense') && (i.status === 'planned' || i.status === 'pending' || i.status === 'partial')).reverse();
      const unchecked = [];
      for (let d = 1; d <= daysInMonth(y, m); d++) { const ds = iso(y, m, d); if (ds <= t && !S().checks.has(ds) && items.some(i => i.date === ds && i.kind === 'expense' && i.status === 'planned')) unchecked.push(ds); }
      const closed = (S().settings.closedMonths || {})[ym];
      return `<div class="period-nav"><button class="icon-btn" data-a="prev">${C.icon('left')}</button><span>${MONTHS[m - 1]} ${y}</span><button class="icon-btn" data-a="next">${C.icon('right')}</button></div>
        ${closed ? `<p class="hint">Mês fechado em ${C.dmy(closed.at.slice(0, 10))}${closed.pending ? ` com ${closed.pending} pendência(s)` : ''}.</p>` : ''}
        <div class="stats">
          ${stat('Resultado realizado', signed(r.incReal - r.expReal), sgnCls(r.incReal - r.expReal), true)}
          ${stat('Receitas recebidas', `${money(r.incReal)} de ${money(r.inc)}`, 'pos')}
          ${stat('Despesas pagas', `${money(r.expReal)} de ${money(r.exp)}`, 'neg')}
          ${stat('Transferências', `${tr.length} · ${money(tr.reduce((s2, i) => s2 + i.amount, 0))}`)}
          ${stat('Pendências até hoje', String(pend.length), pend.length ? 'neg' : 'pos')}
          ${stat('Dias não conferidos', String(unchecked.length), unchecked.length ? 'neg' : 'pos')}
        </div>
        ${unchecked.length ? `<div class="btn-row"><button class="primary-btn ghost" data-a="check">Concluir conferência de ${unchecked.length} dia(s)</button></div>` : ''}
        ${pend.length ? `<div class="section-label"><span>PENDÊNCIAS</span></div>${pend.slice(0, 40).map(it => movementRow(it)).join('')}` : '<p class="hint">Nenhuma pendência neste mês.</p>'}
        <div class="btn-row"><button class="primary-btn" data-a="close">${closed ? 'Fechar novamente' : 'Fechar o mês'}</button>${closed ? '<button class="primary-btn ghost" data-a="reopen">Reabrir</button>' : ''}</div>
        <p class="hint">Fechar o mês só registra a conferência. Nada é bloqueado ou apagado: lançamentos antigos continuam editáveis.</p>`;
    },
    actions: {
      prev: () => { const { y, m } = parse(ref); const n = addMonths(y, m, -1); ref = iso(n.y, n.m, 1); render(); },
      next: () => { const { y, m } = parse(ref); const n = addMonths(y, m, 1); ref = iso(n.y, n.m, 1); render(); },
      goDay,
      check: async () => {
        const { y, m } = parse(ref); const t = C.today(); const days = [];
        for (let d = 1; d <= daysInMonth(y, m); d++) { const ds = iso(y, m, d); if (ds <= t && !S().checks.has(ds)) days.push(ds); }
        await C.finishCheck(days); render();
      },
      close: async () => {
        const { y, m } = parse(ref); const ym = iso(y, m, 1).slice(0, 7);
        const t = C.today();
        const pend = itemsFor(it => C.accVisible(it) && it.date <= t && (it.kind === 'income' || it.kind === 'expense') && (it.status === 'planned' || it.status === 'pending' || it.status === 'partial'), iso(y, m, 1), iso(y, m, daysInMonth(y, m))).length;
        if (pend && !(await C.confirmDlg('Fechar com pendências?', `Ainda há ${pend} lançamento(s) não confirmados neste mês. Eles continuam pendentes depois do fechamento.`, 'Fechar mesmo assim'))) return;
        S().settings.closedMonths = { ...(S().settings.closedMonths || {}), [ym]: { at: C.nowISO(), pending: pend } };
        C.saveSettings(); db.log(`Mês fechado: ${MONTHS[m - 1]} ${y}`, { details: [`${pend} pendência(s) no fechamento`] });
        C.toast('Mês fechado'); render();
      },
      reopen: () => {
        const { y, m } = parse(ref); const ym = iso(y, m, 1).slice(0, 7);
        const cm = { ...(S().settings.closedMonths || {}) }; delete cm[ym];
        S().settings.closedMonths = cm; C.saveSettings(); db.log(`Mês reaberto: ${MONTHS[m - 1]} ${y}`, {}); render();
      },
    },
  };
  return view;
}

// ------------------------------------------------------------------ COFRINHOS
function piggiesView() {
  return {
    title: 'Cofrinhos', right: { icon: 'plus', fn: () => push(piggyForm()) },
    body: () => {
      const b = bal(), { money, esc } = C;
      const list = [...S().piggies.values()].filter(p => !p.archived && (p.type === 'real' || !S().set || S().set.has(p.accountId)));
      const total = list.reduce((s, p) => s + ((b.piggies.get(p.id) || {}).saved || 0), 0);
      return `<div class="stats">${stat('Total guardado', money(total), '', true)}</div>
        ${list.map(p => {
          const saved = (b.piggies.get(p.id) || {}).saved || 0;
          return `<button class="card-row col" data-a="open" data-id="${p.id}">
            <span class="line"><span class="dot" style="background:${p.color}"></span><span class="grow t">${esc(p.name)}</span><span class="v">${money(saved)}</span></span>
            ${p.goal ? progress(saved / p.goal, p.color) + `<span class="s">${Math.round(saved / p.goal * 100)}% de ${money(p.goal)}${p.deadline ? ` · até ${C.dmy(p.deadline)}` : ''} · ${p.type === 'real' ? 'conta separada' : `em ${esc(C.accName(p.accountId))}`}</span>` : `<span class="s">${p.type === 'real' ? 'Conta separada' : `Reservado em ${esc(C.accName(p.accountId))}`}</span>`}
          </button>`;
        }).join('') || '<div class="empty">Nenhum cofrinho. Crie um para separar dinheiro com uma finalidade.</div>'}
        <p class="hint">Virtual: o dinheiro continua na conta, mas fica reservado. Real: é uma conta separada e cada depósito é uma transferência.</p>`;
    },
    actions: { open: id => push(piggyDetail(id)) },
  };
}

// ------------------------------------------------------------------ COFRINHO (detalhe)
// Cofrinho = dinheiro guardado para um objetivo. Não rende sozinho; para investir, transfere para o Tesouro.
function piggyDetail(id) {
  const pig = () => S().piggies.get(id);
  return {
    get title() { return (pig() || {}).name || 'Cofrinho'; },
    get sub() { const p = pig(); return p ? (p.type === 'real' ? 'Conta separada' : `Virtual · em ${C.esc(C.accName(p.accountId))}`) : ''; },
    right: { label: 'Editar', fn: () => push(piggyForm(pig())) },
    body: () => {
      const p = pig(); if (!p) return '';
      const b = bal(), saved = (b.piggies.get(id) || {}).saved || 0, { money, dmy } = C;
      let plan = '';
      if (p.goal && p.deadline && saved < p.goal) {
        const months = Math.max(1, (parse(p.deadline).y - parse(C.today()).y) * 12 + parse(p.deadline).m - parse(C.today()).m);
        plan = stat('Para chegar no prazo', `${money(Math.ceil((p.goal - saved) / months))}/mês`);
      }
      const t = C.today();
      const moves = itemsFor(it => it.piggyId === id || (p.type === 'real' && (it.accountId === p.accountId || it.toAccountId === p.accountId)), addDays(t, -365), addDays(t, 60));
      const tr = treasury();
      return `<div class="stats">
          ${stat('Guardado', money(saved), '', true)}
          ${p.goal ? stat('Meta', money(p.goal)) + stat('Falta', money(Math.max(0, p.goal - saved))) : ''}
          ${p.deadline ? stat('Prazo', dmy(p.deadline)) : ''}${plan}
        </div>
        ${p.goal ? progress(saved / p.goal, p.color) : ''}
        <div class="btn-row"><button class="primary-btn" data-a="in">Guardar</button><button class="primary-btn ghost" data-a="out" ${saved > 0 ? '' : 'disabled'}>Retirar</button></div>
        ${tr.accountId && saved > 0 ? `<button class="sim-toggle" data-a="invest">Investir no ${C.esc(treasuryName())}</button>` : ''}
        <div class="section-label"><span>MOVIMENTAÇÕES</span></div>
        ${moves.map(it => movementRow(it, p.accountId)).join('') || '<p class="hint">Nada guardado ainda.</p>'}
        <p class="hint">O cofrinho guarda dinheiro para um objetivo e não rende sozinho. Para acompanhar rendimento e projeções, invista no ${C.esc(treasuryName())}.</p>`;
    },
    actions: { in: () => piggyMove(id, 'in'), out: () => piggyMove(id, 'out'), goDay, invest: () => treasuryMove('in', { from: 'piggy:' + id }) },
  };
}

// ------------------------------------------------------------------ TESOURO (aba própria)
// Investimentos de longo prazo: patrimônio investido (só aportes reais), projeções e renda se parar de aportar.
// O dinheiro investido fica numa conta própria (tipo "treasury"): aporte e retirada são transferências,
// então o patrimônio consolidado não aumenta artificialmente e nada vira receita ou despesa.
const TR_ITEMS = {
  saved: 'Patrimônio investido', projected: 'Patrimônio projetado', income: 'Renda se parar de aportar',
  breakdown: 'Aportado e rendimentos', contrib: 'Contribuição mensal média', sources: 'Fontes de contribuição',
};
const TR_DEFAULT_VIEW = { order: ['saved', 'projected', 'income', 'breakdown', 'contrib', 'sources'], hidden: ['contrib'], highlight: 'projected', horizons: [1, 3, 5, 10], valueMode: 'both', showDetails: true };
const HORIZON_CHOICES = [1, 2, 3, 5, 10, 15, 20, 25, 30];
const treasury = () => S().settings.treasury || {};
const treasuryName = () => { const a = S().accounts.get(treasury().accountId); return a ? a.name : 'Tesouro'; };
function trView() {
  const v = { ...TR_DEFAULT_VIEW, ...(treasury().view || {}) };
  v.order = [...v.order.filter(k => TR_ITEMS[k]), ...Object.keys(TR_ITEMS).filter(k => !v.order.includes(k))];
  v.horizons = (v.horizons || []).map(Number).filter(n => HORIZON_CHOICES.includes(n)).sort((a, b) => a - b);
  if (!v.horizons.length) v.horizons = [...TR_DEFAULT_VIEW.horizons];
  return v;
}
async function saveTreasury(patch) {
  S().settings.treasury = { ...treasury(), ...patch };
  C.saveSettings(); render(); C.refresh();
}
const simSources = () => C.accountsList().filter(a => a.type !== 'piggy' && a.type !== 'treasury');
const simCfgOf = () => SIM.simConfig(treasury(), simSources(), S().settings.defaultAccount);
const pctTxt = v => String(Math.round(v * 100) / 100).replace('.', ',');
/** % da divisão da renda destinado ao Tesouro, mês a mês (base "divisão da renda" da simulação). */
function treasuryPlanMonth(ids, y, m) {
  const cfg = budgetCfg(), model = B.activeModelOf(cfg);
  const pct = B.liveCats(model).filter(c => (c.piggyIds || []).includes(B.TREASURY)).reduce((s, c) => s + (+c.pct || 0), 0);
  if (!pct) return { value: 0, planned: false };
  const d = B.distribution({ data: S().data, model, ids, from: iso(y, m, 1), to: iso(y, m, daysInMonth(y, m)), metas: [...S().metas.values()], piggies: [...S().piggies.values()], treasuryAccountId: treasury().accountId });
  return { value: Math.round(d.base.planned * pct / 100), planned: d.income.planned > 0 };
}
const trRun = (cfg, horizons) => SIM.simulate({
  data: S().data, piggy: { id: 'treasury', type: 'real', accountId: treasury().accountId }, cfg, today: C.today(), horizons,
  account: S().accounts.get(treasury().accountId), metas: [...S().metas.values()].filter(m => !m.archived),
  isHoliday: S().isHoliday, defaultAccount: S().settings.defaultAccount, planMonth: treasuryPlanMonth,
});

function treasuryView() {
  let years = null, details = false;
  return {
    get title() { return treasuryName(); },
    get sub() { return treasury().accountId ? 'Investimentos de longo prazo' : ''; },
    get right() { return treasury().accountId ? { icon: 'gear', fn: () => push(treasuryConfigView()) } : null; },
    body: () => {
      const tr = treasury(), { money, dmy, esc } = C;
      if (!tr.accountId || !S().accounts.get(tr.accountId)) {
        const reals = [...S().piggies.values()].filter(p => p.type === 'real' && !p.archived);
        return `<div class="sim-card"><div class="sim-main"><small>Tesouro</small><b class="plain">Acompanhe seus investimentos</b>
            <span>Registre aportes reais, veja o patrimônio investido, as projeções e quanto ele pode render por mês se você parar de aportar.</span></div>
            <button class="primary-btn" data-a="setup">Começar</button>
            ${reals.map(p => `<button class="primary-btn ghost" data-a="adopt" data-id="${p.id}">Usar o cofrinho “${esc(p.name)}” como Tesouro</button>`).join('')}
          </div>
          <p class="hint">O Tesouro é separado dos cofrinhos: cofrinhos guardam dinheiro para objetivos; o Tesouro acompanha dinheiro investido.</p>`;
      }
      const v = trView(), cfg = simCfgOf(), accs = simSources(), t = C.today();
      const r = trRun(cfg, v.horizons);
      if (!years || !v.horizons.includes(years)) years = v.horizons.includes(10) ? 10 : v.horizons[v.horizons.length - 1];
      const h = r.results.find(x => x.years === years) || r.results[r.results.length - 1];
      const on = accs.filter(a => cfg.sources[a.id] && cfg.sources[a.id].on);
      const saved = r.saved;
      const showReal = v.valueMode !== 'nominal', showNom = v.valueMode !== 'real';
      const projVal = showReal ? h.real : h.nominal, projSub = showReal ? 'em dinheiro de hoje' : 'em valores da época';
      const yl = `${years} ${years === 1 ? 'ano' : 'anos'}`;
      const blocks = {
        saved: () => `<div class="sim-have"><small>Patrimônio investido</small><b>${money(saved)}</b></div>`,
        projected: big => `<div class="sim-main${big ? '' : ' small'}"><small>Em ${yl} você poderá acumular</small><b>${money(projVal)}*</b><span>${projSub} · ${dmy(h.date)}${showReal && showNom ? ` · nominal ${money(h.nominal)}` : ''}</span></div>`,
        income: big => `<div class="sim-stop${big ? ' big' : ''}"><small>Se parar de aportar em ${dmy(h.date)}, poderá render</small>
            <b>${money(showReal ? h.incomeMonthReal : h.incomeMonthNominal)} <em>por mês*</em></b>
            <span>${money(showReal ? h.incomeYearReal : h.incomeYearNominal)} por ano · ${showReal ? 'em dinheiro de hoje' : 'em valores da época'}</span>
            ${showReal && showNom ? `<span class="nom">Em valores da época: ${money(h.incomeMonthNominal)}/mês · ${money(h.incomeYearNominal)}/ano</span>` : ''}</div>`,
        breakdown: () => `<div class="sim-facts"><div><small>Valor nominal futuro</small><b>${money(h.nominal)}</b></div><div><small>Aportado</small><b>${money(h.contributed)}</b></div><div><small>Rendimentos</small><b class="pos">${money(h.yield)}</b></div></div>`,
        contrib: () => `<div class="sim-facts"><div><small>Contribuição mensal média</small><b>${money(r.perMonth)}</b></div><div><small>Por semana</small><b>${money(r.perWeek)}</b></div><div><small>Base</small><b>${cfg.basis === 'plan' ? 'divisão da renda' : 'sobra mensal'}</b></div></div>`,
        sources: () => `<p class="sim-src-line">${cfg.basis === 'plan' ? 'Divisão da renda' : 'Sobra'} de ${on.length ? on.map(a => esc(a.name)).join(' + ') : 'nenhuma conta'} · ~${money(r.perMonth)}/mês · IPCA + ${pctTxt(cfg.rate)}% a.a.</p>`,
      };
      const hl = v.highlight === 'income' ? 'income' : 'projected';
      const visible = v.order.filter(k => !v.hidden.includes(k));
      const main = on.length ? visible.map(k => (k === 'saved' ? blocks.saved() : blocks[k](k === hl))).join('')
        : `${visible.includes('saved') ? blocks.saved() : ''}<div class="sim-main"><small>Projeção desligada</small><span>Escolha, na engrenagem, de quais contas vem o dinheiro para a projeção.</span></div>`;
      const years$ = v.horizons.length > 1 ? `<div class="segmented sim-years">${v.horizons.map(n => `<button class="${n === years ? 'on' : ''}" data-a="years" data-id="${n}">${n} ${n === 1 ? 'ano' : 'anos'}</button>`).join('')}</div>` : '';
      // o seletor de prazos fica logo depois do patrimônio investido
      const idx = main.indexOf('</div>', main.indexOf('sim-have')) + 6;
      const card = `<div class="sim-card">${visible.includes('saved') && on.length ? main.slice(0, idx) + years$ + main.slice(idx) : years$ + main}</div>`;
      let more = '';
      if (details) {
        const moves = itemsFor(it => it.accountId === tr.accountId || it.toAccountId === tr.accountId, addDays(t, -3650), addDays(t, 60));
        const tab = r.results.map(x => `<div class="sim-row"><span class="h">${x.years} ${x.years === 1 ? 'ano' : 'anos'}<small>${dmy(x.date)}</small></span>
            <span class="v"><b>${money(x.real)}</b><small>hoje</small></span><span class="v">${money(x.nominal)}<small>nominal</small></span>
            <span class="v">${money(x.contributed)}<small>aportado</small></span><span class="v pos">${money(x.yield)}<small>rendimento</small></span>
            <span class="v stop">${money(x.incomeMonthReal)}/mês<small>se parar de aportar</small></span></div>`).join('');
        let cmp = '';
        if (accs.length > 1) {
          const scen = accs.map(a => ({ n: `Só ${a.name}`, c: { ...cfg, sources: Object.fromEntries(accs.map(x => [x.id, { on: x.id === a.id }])) } }));
          scen.push({ n: 'Todas as contas', c: { ...cfg, sources: Object.fromEntries(accs.map(x => [x.id, { on: true }])) } });
          cmp = `<div class="section-label"><span>COMPARAR FONTES EM ${yl.toUpperCase()}</span><span>hoje · renda/mês</span></div>
            ${scen.map(sc => { const rr = trRun(sc.c, [years]).results[0]; return `<div class="kv"><span>${esc(sc.n)}</span><span>${money(rr.real)} · ${money(rr.incomeMonthReal)}/mês</span></div>`; }).join('')}`;
        }
        const surplus = r.months.length ? `<div class="section-label"><span>CONTRIBUIÇÕES PREVISTAS</span><span>${cfg.basis === 'plan' ? 'divisão da renda' : 'sobras com metas'}</span></div>
          <div class="sim-months">${r.months.map(x => `<span><small>${MONTHS[x.m - 1].slice(0, 3)}/${String(x.y).slice(2)}</small><b class="${x.value ? '' : 'muted'}">${x.planned ? money(x.value) : 'sem plano'}</b></span>`).join('')}</div>
          <p class="hint">Mês planejado negativo conta como zero. Mês sem planejamento e os meses depois do 12º usam a média dos meses planejados: ${money(r.avg)}/mês.</p>` : '';
        more = `<div class="sim-more">
          <div class="section-label"><span>DINHEIRO INVESTIDO DE VERDADE</span></div>
          <div class="kv"><span>Total aportado</span><span>${money(r.deposited)}</span></div>
          ${r.withdrawn ? `<div class="kv"><span>Retirado</span><span>${money(r.withdrawn)}</span></div>` : ''}
          <div class="kv"><span>Valor estimado com rendimento</span><span>${money(r.startValue)}</span></div>
          ${on.length ? `<div class="section-label"><span>PROJEÇÃO</span></div>
          <div class="kv"><span>Contribuição mensal média</span><span>${money(r.perMonth)}</span></div>
          <div class="kv"><span>Por semana</span><span>${money(r.perWeek)}</span></div>
          <div class="sim-tab">${tab}</div>${surplus}${cmp}` : ''}
          <div class="section-label"><span>APORTES E RETIRADAS</span></div>
          ${moves.map(it => movementRow(it, tr.accountId)).join('') || '<p class="hint">Nenhum aporte registrado ainda.</p>'}
        </div>`;
      }
      return `${card}
        <div class="btn-row"><button class="primary-btn" data-a="in">Aportar</button><button class="primary-btn ghost" data-a="out" ${saved > 0 ? '' : 'disabled'}>Retirar</button></div>
        ${v.showDetails ? `<button class="sim-toggle${details ? ' on' : ''}" data-a="details">${details ? 'Ocultar detalhes' : 'Ver detalhes'}</button>${more}` : ''}
        <ul class="sim-foot">
          <li>*Projeção se as contribuições planejadas acontecerem; não é rendimento garantido.</li>
          <li>*Só aportes registrados contam como patrimônio investido. Inflação estimada: ${pctTxt(cfg.ipca)}% a.a.</li>
          <li>*Renda se parar de aportar: o patrimônio continua investido, sem novos aportes. Em dinheiro de hoje, é quanto dá para tirar sem perder poder de compra.</li>
        </ul>`;
    },
    actions: {
      setup: async () => {
        const a = { id: C.uid(), name: 'Tesouro', type: 'treasury', institution: '', initialBalance: 0, color: '#45cf7f', purpose: 'Investimentos de longo prazo', includeInTotal: true, archived: false, allowedTags: [], rules: [], order: S().accounts.size, createdAt: C.nowISO() };
        await saveStore('accounts', 'accounts', a, 'Tesouro criado');
        await saveTreasury({ accountId: a.id });
      },
      adopt: async pid => {
        const p = S().piggies.get(pid); if (!p) return;
        if (!(await C.confirmDlg(`Usar “${C.esc(p.name)}” como Tesouro?`, 'A conta separada deste cofrinho e todo o histórico passam para a aba Tesouro. O dinheiro não muda; ele só deixa de aparecer como cofrinho.', 'Usar como Tesouro'))) return;
        const acc = S().accounts.get(p.accountId);
        if (acc) await saveStore('accounts', 'accounts', { ...acc, type: 'treasury' }, `Cofrinho ${p.name} passou a ser o Tesouro`);
        await saveTreasury({ accountId: p.accountId, sim: p.sim || treasury().sim });
        await saveStore('piggies', 'piggies', { ...p, archived: true, movedToTreasury: true });
      },
      years: n => { years = +n; render(); },
      details: () => { details = !details; render(); },
      config: () => push(treasuryConfigView()),
      in: () => treasuryMove('in'), out: () => treasuryMove('out'), goDay,
    },
  };
}

/** Aporte (de uma conta ou de um cofrinho) e retirada (para uma conta). Tudo é transferência real. */
async function treasuryMove(dir, preset = {}) {
  const tr = treasury(); if (!tr.accountId) return;
  const b = bal(), { money, esc, today } = C;
  const tAcc = tr.accountId, invested = (b.accounts.get(tAcc) || {}).real || 0;
  const accs = C.accountsList().filter(a => a.id !== tAcc && a.type !== 'treasury' && a.type !== 'piggy');
  const pigs = [...S().piggies.values()].filter(p => !p.archived).map(p => ({ p, saved: (b.piggies.get(p.id) || {}).saved || 0 })).filter(x => x.saved > 0);
  const opts = [
    ...accs.map(a => [`acc:${a.id}`, `${dir === 'in' ? 'De' : 'Para'} ${a.name} (${money((b.accounts.get(a.id) || {}).real || 0)})`]),
    ...(dir === 'in' ? pigs.map(x => [`piggy:${x.p.id}`, `Do cofrinho ${x.p.name} (${money(x.saved)})`]) : []),
  ];
  if (!opts.length) { C.toast('Cadastre uma conta primeiro'); return; }
  const res = await C.dialog({
    title: dir === 'in' ? `Aportar no ${treasuryName()}` : `Retirar do ${treasuryName()}`,
    html: `<input type="text" inputmode="decimal" id="tmAmount" placeholder="0,00" value="${preset.amount ? C.moneyInput(preset.amount) : ''}">
      <select id="tmFrom">${opts.map(([v, l]) => `<option value="${v}" ${v === preset.from ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <input type="date" id="tmDate" value="${today()}">
      <p class="small">${dir === 'in' ? 'É uma transferência: sai da conta ou do cofrinho e entra no Tesouro. Não é receita nem despesa.' : `Investido: ${money(invested)}`}</p>`,
    actions: [{ label: 'Cancelar', value: null }, {
      label: dir === 'in' ? 'Aportar' : 'Retirar', cls: 'primary',
      validate: () => {
        const v = C.parseMoney(document.getElementById('tmAmount').value);
        if (!(v > 0)) { C.toast('Informe o valor'); return false; }
        const from = document.getElementById('tmFrom').value;
        if (dir === 'out' && v > invested) { C.toast(`Só há ${money(invested)} investidos`); return false; }
        if (from.startsWith('piggy:')) { const x = pigs.find(q => 'piggy:' + q.p.id === from); if (x && v > x.saved) { C.toast(`O cofrinho tem ${money(x.saved)}`); return false; } }
        return true;
      },
      value: () => ({ amount: C.parseMoney(document.getElementById('tmAmount').value), from: document.getElementById('tmFrom').value, date: document.getElementById('tmDate').value || today() }),
    }],
    onOpen: body => setTimeout(() => body.querySelector('#tmAmount').focus(), 150),
  });
  if (!res) return;
  const [kind, id] = res.from.split(':');
  let ch;
  if (dir === 'out') ch = onceEntry({ kind: 'transfer', amount: res.amount, date: res.date, accountId: tAcc, toAccountId: id, title: `Retirada do ${treasuryName()}` });
  else if (kind === 'acc') ch = onceEntry({ kind: 'transfer', amount: res.amount, date: res.date, accountId: id, toAccountId: tAcc, title: `Aporte no ${treasuryName()}` });
  else {
    const p = S().piggies.get(id);
    if (p.type === 'real') ch = onceEntry({ kind: 'transfer', amount: res.amount, date: res.date, accountId: p.accountId, toAccountId: tAcc, title: `Aporte no ${treasuryName()} (do cofrinho ${p.name})` });
    else {
      // cofrinho virtual: libera a reserva e transfere da conta onde ela estava
      ch = onceEntry({ kind: 'release', amount: res.amount, date: res.date, accountId: p.accountId, piggyId: p.id, title: `Para o ${treasuryName()}` });
      C.ops.mergeChanges(ch, onceEntry({ kind: 'transfer', amount: res.amount, date: res.date, accountId: p.accountId, toAccountId: tAcc, title: `Aporte no ${treasuryName()} (do cofrinho ${p.name})` }));
    }
  }
  await C.commit(dir === 'in' ? `${money(res.amount)} aportados no ${treasuryName()}` : `${money(res.amount)} retirados do ${treasuryName()}`, ch);
}

/** Engrenagem do Tesouro: fontes, base, rendimento, o que aparece na tela, destaque, ordem e prazos. */
function treasuryConfigView() {
  const parsePct = x => { const n = parseFloat(String(x).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const saveSim = cfg => saveTreasury({ sim: { rate: cfg.rate, ipca: cfg.ipca, basis: cfg.basis, sources: Object.fromEntries(Object.entries(cfg.sources).map(([k, s]) => [k, { on: !!s.on }])) } });
  const saveView = v => saveTreasury({ view: v });
  return {
    title: 'Configurações', get sub() { return C.esc(treasuryName()); },
    body: () => {
      const cfg = simCfgOf(), v = trView(), { esc } = C, rn = SIM.nominalRate(cfg.rate, cfg.ipca);
      const planPct = B.liveCats(B.activeModelOf(budgetCfg())).filter(c => (c.piggyIds || []).includes(B.TREASURY)).reduce((s, c) => s + (+c.pct || 0), 0);
      const sw = (k, on, extra = '') => `<input type="checkbox" class="switch" data-k="${k}" ${extra} ${on ? 'checked' : ''}>`;
      return `<div class="group-title">Contas que entram na projeção</div>
        <div class="group sim-srcs">${simSources().map(a => `<label class="row"><span class="grow"><b>${esc(a.name)}</b></span>${sw('src-on', cfg.sources[a.id] && cfg.sources[a.id].on, `data-acc="${a.id}"`)}</label>`).join('')}</div>
        <div class="group-title">Fonte do dinheiro</div>
        <div class="segmented seg-sm"><button class="${cfg.basis !== 'plan' ? 'on' : ''}" data-a="basis" data-id="surplus">Sobra mensal</button><button class="${cfg.basis === 'plan' ? 'on' : ''}" data-a="basis" data-id="plan">Divisão da renda</button></div>
        <p class="hint">${cfg.basis === 'plan' ? (planPct ? `Usa ${pctTxt(planPct)}% da renda dessas contas, conforme as categorias da divisão da renda ligadas ao Tesouro.` : 'Nenhuma categoria da divisão da renda está ligada ao Tesouro. Ligue uma em Metas › Divisão da renda.') : 'Usa a sobra planejada de cada mês dessas contas (lançamentos, compromissos e Metas).'}</p>
        <div class="group-title">Rendimento</div>
        <div class="group sim-rates">
          <label class="row field"><span>Acima do IPCA (% a.a.)</span><input type="text" inputmode="decimal" data-k="rate" value="${pctTxt(cfg.rate)}"></label>
          <label class="row field"><span>IPCA estimado (% a.a.)</span><input type="text" inputmode="decimal" data-k="ipca" value="${pctTxt(cfg.ipca)}"></label>
        </div>
        <p class="hint">IPCA + ${pctTxt(cfg.rate)}% ≈ ${pctTxt(rn * 100)}% ao ano nominal (taxas compostas, não somadas).</p>
        <div class="group-title">Prazos das projeções</div>
        <div class="chips">${HORIZON_CHOICES.map(n => `<button type="button" class="chip${v.horizons.includes(n) ? ' on' : ''}" data-a="hz" data-id="${n}">${n} ${n === 1 ? 'ano' : 'anos'}</button>`).join('')}</div>
        <div class="group-title">Valores</div>
        <div class="segmented seg-sm"><button class="${v.valueMode === 'both' ? 'on' : ''}" data-a="vm" data-id="both">Hoje e nominal</button><button class="${v.valueMode === 'real' ? 'on' : ''}" data-a="vm" data-id="real">Só hoje</button><button class="${v.valueMode === 'nominal' ? 'on' : ''}" data-a="vm" data-id="nominal">Só nominal</button></div>
        <div class="group-title">Maior destaque</div>
        <div class="segmented seg-sm"><button class="${v.highlight !== 'income' ? 'on' : ''}" data-a="hl" data-id="projected">Patrimônio projetado</button><button class="${v.highlight === 'income' ? 'on' : ''}" data-a="hl" data-id="income">Renda se parar</button></div>
        <div class="group-title">Tela principal · o que aparece e em que ordem</div>
        <div class="group">${v.order.map((k, i) => `<div class="row tr-item"><span class="grow">${esc(TR_ITEMS[k])}</span>
            <button class="icon-btn sm" data-a="up" data-id="${k}" ${i ? '' : 'disabled'} aria-label="Subir">${C.icon('left')}</button><button class="icon-btn sm" data-a="down" data-id="${k}" ${i < v.order.length - 1 ? '' : 'disabled'} aria-label="Descer">${C.icon('right')}</button>
            ${sw('item-on', !v.hidden.includes(k), `data-item="${k}"`)}</div>`).join('')}</div>
        <div class="group"><label class="row"><span class="grow">Botão "Ver detalhes"</span>${sw('details-on', v.showDetails)}</label></div>
        <p class="hint">Tudo é salvo na hora. O nome do Tesouro muda em Contas, como qualquer conta.</p>`;
    },
    onField: (el2, type) => {
      if (type !== 'change') return;
      const cfg = simCfgOf(), v = trView(), k = el2.dataset.k;
      if (k === 'src-on') { cfg.sources[el2.dataset.acc] = { on: el2.checked }; return saveSim(cfg); }
      if (k === 'item-on') { const set = new Set(v.hidden); el2.checked ? set.delete(el2.dataset.item) : set.add(el2.dataset.item); return saveView({ ...v, hidden: [...set] }); }
      if (k === 'details-on') return saveView({ ...v, showDetails: el2.checked });
      if (k === 'rate' || k === 'ipca') {
        const x = parsePct(el2.value);
        if (x == null || x < -50 || x > 100) { C.toast('Informe uma taxa válida'); render(); return; }
        cfg[k] = x; return saveSim(cfg);
      }
    },
    actions: {
      basis: b2 => { const cfg = simCfgOf(); cfg.basis = b2; saveSim(cfg); },
      hz: n => { const v = trView(), set = new Set(v.horizons); set.has(+n) ? set.delete(+n) : set.add(+n); if (!set.size) { C.toast('Deixe pelo menos um prazo'); return; } saveView({ ...v, horizons: [...set] }); },
      vm: m => saveView({ ...trView(), valueMode: m }),
      hl: k => saveView({ ...trView(), highlight: k }),
      up: k => { const v = trView(), o = [...v.order], i = o.indexOf(k); if (i > 0) { [o[i - 1], o[i]] = [o[i], o[i - 1]]; saveView({ ...v, order: o }); } },
      down: k => { const v = trView(), o = [...v.order], i = o.indexOf(k); if (i >= 0 && i < o.length - 1) { [o[i + 1], o[i]] = [o[i], o[i + 1]]; saveView({ ...v, order: o }); } },
    },
  };
}

async function piggyMove(id, dir, preset = {}) {
  const p = S().piggies.get(id);
  const b = bal(), saved = (b.piggies.get(id) || {}).saved || 0;
  const { money, esc, today } = C;
  const accs = C.accountsList().filter(a => a.id !== p.accountId && a.type !== 'treasury');
  const real = p.type === 'real';
  const res = await C.dialog({
    title: dir === 'in' ? `Guardar em ${p.name}` : `Retirar de ${p.name}`,
    html: `<input type="text" inputmode="decimal" id="pmAmount" placeholder="0,00" value="${preset.amount ? C.moneyInput(preset.amount) : ''}">
      ${real ? `<select id="pmAcc">${accs.map(a => `<option value="${a.id}" ${a.id === preset.from ? 'selected' : ''}>${dir === 'in' ? 'De' : 'Para'} ${esc(a.name)} (${money((b.accounts.get(a.id) || {}).real || 0)})</option>`).join('')}</select>` : `<p class="small">${dir === 'in' ? `Livre em ${esc(C.accName(p.accountId))}: ${money(((b.accounts.get(p.accountId) || {}).real || 0) - ((b.accounts.get(p.accountId) || {}).reserved || 0))}` : `Guardado: ${money(saved)}`}</p>`}
      <input type="date" id="pmDate" value="${today()}">`,
    actions: [{ label: 'Cancelar', value: null }, {
      label: dir === 'in' ? 'Guardar' : 'Retirar', cls: 'primary',
      validate: () => {
        const v = C.parseMoney(document.getElementById('pmAmount').value);
        if (!(v > 0)) { C.toast('Informe o valor'); return false; }
        if (dir === 'out' && v > saved) { C.toast(`Só há ${money(saved)} guardados`); return false; }
        if (real && !accs.length) { C.toast('Crie outra conta primeiro'); return false; }
        return true;
      },
      value: () => ({ amount: C.parseMoney(document.getElementById('pmAmount').value), date: document.getElementById('pmDate').value || today(), acc: real ? document.getElementById('pmAcc').value : null }),
    }],
    onOpen: body => setTimeout(() => body.querySelector('#pmAmount').focus(), 150),
  });
  if (!res) return;
  let ch;
  if (real) {
    ch = dir === 'in'
      ? onceEntry({ kind: 'transfer', amount: res.amount, date: res.date, accountId: res.acc, toAccountId: p.accountId, title: `Depósito em ${p.name}` })
      : onceEntry({ kind: 'transfer', amount: res.amount, date: res.date, accountId: p.accountId, toAccountId: res.acc, title: `Retirada de ${p.name}` });
  } else {
    ch = onceEntry({ kind: dir === 'in' ? 'reserve' : 'release', amount: res.amount, date: res.date, accountId: p.accountId, piggyId: p.id });
  }
  await C.commit(dir === 'in' ? `${money(res.amount)} guardados em ${p.name}` : `${money(res.amount)} retirados de ${p.name}`, ch);
}

function piggyForm(p = null) {
  const value = p ? { ...p } : { name: '', type: 'virtual', accountId: [...(S().set || [])][0] || S().settings.defaultAccount, goal: 0, deadline: '', color: C.PALETTE[(S().piggies.size * 5 + 3) % C.PALETTE.length] };
  return formView({
    title: p ? 'Editar cofrinho' : 'Novo cofrinho', value,
    fields: [
      { k: 'name', label: 'Nome', required: true, placeholder: 'Ex.: Emergência' },
      { k: 'type', label: 'Tipo', type: 'select', options: [['virtual', 'Virtual (reserva dentro da conta)'], ['real', 'Real (conta separada)']], show: () => !p },
      { k: 'accountId', label: 'Conta onde fica reservado', type: 'select', options: accOptions(), show: v => v.type !== 'real' },
      { k: 'goal', label: 'Valor desejado (opcional)', type: 'money' },
      { k: 'deadline', label: 'Prazo', type: 'date' },
      { k: 'color', label: 'Cor', type: 'color' },
      { k: 'archived', label: 'Arquivar', type: 'switch', show: () => !!p },
    ],
    onSave: async v => {
      if (p && v.archived && !p.archived && !(await resolveRuleLinks('piggy:' + p.id, p.name))) return false;
      const obj = { ...(p || { id: C.uid(), createdAt: C.nowISO() }), ...v };
      if (!p && v.type === 'real') {
        const acc = { id: C.uid(), name: v.name, type: 'piggy', institution: '', initialBalance: 0, color: v.color, purpose: `Cofrinho ${v.name}`, includeInTotal: true, archived: false, allowedTags: [], rules: [], order: S().accounts.size, createdAt: C.nowISO() };
        await saveStore('accounts', 'accounts', acc);
        obj.accountId = acc.id;
      }
      if (p && p.type === 'real') { const acc = S().accounts.get(p.accountId); if (acc && (acc.name !== v.name || acc.color !== v.color)) await saveStore('accounts', 'accounts', { ...acc, name: v.name, color: v.color }); }
      await saveStore('piggies', 'piggies', obj);
      C.toast(p ? 'Cofrinho atualizado' : 'Cofrinho criado');
    },
    onDelete: p && (async () => {
      if (!(await resolveRuleLinks('piggy:' + p.id, p.name))) return false;
      if (p.type === 'real' && !(await resolveRuleLinks('account:' + p.accountId, p.name))) return false;
      const saved = (bal().piggies.get(p.id) || {}).saved || 0;
      if (p.type === 'real') {
        // cofrinho real = conta separada: a conta e o dinheiro continuam existindo, só deixa de ser cofrinho
        const acc = S().accounts.get(p.accountId);
        if (!(await C.confirmDlg('Excluir cofrinho?', `A conta “${C.esc(acc ? acc.name : p.name)}” continua existindo${saved ? ` com ${C.money(saved)}` : ''}, junto com todas as transferências. Só deixa de aparecer como cofrinho.`, 'Excluir', 'danger'))) return false;
        if (acc) await saveStore('accounts', 'accounts', { ...acc, type: acc.type === 'piggy' ? 'savings' : acc.type, purpose: acc.purpose || `Antigo cofrinho ${p.name}` }, `Conta mantida após excluir cofrinho: ${acc.name}`);
        // reservas/transferências antigas que apontavam para o cofrinho continuam válidas (só perdem o vínculo visual)
        await deleteStore('piggies', 'piggies', p);
        C.syncDrawer();
        return true;
      }
      if (saved > 0) { C.toast('Retire o valor guardado antes de excluir (ou arquive).'); return false; }
      if (!(await C.confirmDlg('Excluir cofrinho?', 'O histórico de movimentações continua no calendário.', 'Excluir', 'danger'))) return false;
      await deleteStore('piggies', 'piggies', p);
      return true;
    }),
  });
}

// ------------------------------------------------------------------ METAS E ORÇAMENTOS
function metasView() {
  // a bolacha mostra a divisão de 100% da renda do mês exibido (gastos e dinheiro guardado juntos)
  let sel = null, only = null;
  const view = {
    title: 'Metas', right: { icon: 'plus', fn: () => push(metaForm()) },
    body: () => {
      const { y, m } = S().view;
      const { cfg, d } = budgetDist(iso(y, m, 1), iso(y, m, daysInMonth(y, m)), only);
      const all = [...S().metas.values()].filter(C.metaVisible).sort((a, b) => ((a.order ?? 0) - (b.order ?? 0)) || a.name.localeCompare(b.name, 'pt-BR'));
      const bctx = C.budgetCtx();
      const cards = k => all.filter(x => (x.kind || 'expense') === k).map(x => metaCard(x, C.F.metaProgress(C.scopedMeta(x), C.today(), bctx))).join('');
      const exp = cards('expense'), inc = cards('income'), sav = all.filter(x => x.kind === 'saving').map(savingCard).join('');
      return `<div class="donut-card"><div class="donut-head"><b>Divisão da renda · ${MONTHS[m - 1]} ${y}</b><button class="icon-btn sm" data-a="bcfg" aria-label="Configurar a divisão da renda">${C.icon('gear')}</button></div>
          <p class="hint dist-model">${C.esc(B.activeModelOf(cfg).name)}</p>${rendaBolacha(cfg, d, sel, only, 'd')}</div>
        ${exp ? `<div class="section-label"><span>METAS DE GASTOS</span></div>${exp}` : ''}
        ${inc ? `<div class="section-label"><span>METAS DE RECEITAS</span></div>${inc}` : ''}
        ${sav ? `<div class="section-label"><span>METAS DE ACUMULAÇÃO</span></div>${sav}` : ''}
        ${exp || inc || sav ? '' : '<div class="empty">Nenhuma meta. Toque em + para criar.</div>'}`;
    },
    actions: {
      open: id => push(metaDetail(id)),
      dsel: id => { sel = String(sel) === String(id) ? null : id; render(); },
      dacc: id => { only = id || null; sel = null; render(); },
      bcfg: () => push(budgetConfigView()),
      goDay,
    },
  };
  return view;
}

// ------------------------------------------------------------------ DIVISÃO DA RENDA (bolacha de 100%)
function budgetCfg() {
  const cfg = B.budgetConfig(S().settings, C.uid);
  // o modelo inicial é gravado na primeira vez, para os ids das categorias ficarem estáveis
  if (!S().settings.budget || !Array.isArray(S().settings.budget.models) || !S().settings.budget.models.length) {
    S().settings.budget = { ...(S().settings.budget || {}), models: cfg.models, activeModel: cfg.activeModel };
    C.saveSettings();
  }
  return cfg;
}
function saveBudget(cfg) {
  S().settings.budget = { models: cfg.models, activeModel: cfg.activeModel, accounts: cfg.accounts, showOnCalendar: cfg.showOnCalendar, showLegendValues: cfg.showLegendValues, showPlanVsReal: cfg.showPlanVsReal };
  C.saveSettings(); render(); C.refresh();
}
/** Contas da análise: as escolhidas na configuração (ou a conta exibida). `only` = ver uma conta só. */
function budgetIds(cfg, only) {
  const valid = cfg.accounts.filter(id => S().accounts.get(id) && !S().accounts.get(id).archived);
  const ids = valid.length ? valid : [...(S().set || [])];
  return only && ids.includes(only) ? [only] : ids;
}
function budgetDist(from, to, only) {
  const cfg = budgetCfg();
  return { cfg, d: B.distribution({ data: S().data, model: B.activeModelOf(cfg), ids: budgetIds(cfg, only), from, to, metas: [...S().metas.values()], piggies: [...S().piggies.values()], treasuryAccountId: treasury().accountId }) };
}
/**
 * A bolacha da renda: cada categoria é uma fatia do tamanho do que o plano destina (ou do que já foi, se passou);
 * a parte forte é o realizado (gasto pago ou depósito feito), a apagada é o que ainda cabe. Excesso fica marcado em vermelho.
 * `act` = prefixo das ações (dsel/dacc), para funcionar na página de Metas e embaixo do calendário.
 */
function rendaBolacha(cfg, d, sel, only, act = 'd') {
  const { money, esc } = C;
  const base = d.base.planned;
  const segs = d.cats.map((c, i) => ({ i, n: c.name, col: c.color || '#8cb6e4', size: Math.max(c.target, c.realized), strong: Math.min(c.realized, Math.max(c.target, c.realized)), over: c.kind !== 'save' ? c.over : 0, c }));
  if (d.other.planned > 0) segs.push({ i: 'o', n: 'Gastos sem categoria', col: '#8E8E93', size: d.other.planned, strong: d.other.realized, over: 0 });
  if (d.undistributed > 0) segs.push({ i: 'u', n: 'Não distribuído', col: '#3A3A3C', size: d.undistributed, strong: 0, over: 0 });
  const T = Math.max(base, segs.reduce((s, x) => s + x.size, 0));
  const accs = budgetIds(cfg, null);
  const accChips = accs.length > 1 ? `<div class="chips dist-accs"><button type="button" class="chip${!only ? ' on' : ''}" data-a="${act}acc" data-id="">Todas</button>${accs.map(id => `<button type="button" class="chip${only === id ? ' on' : ''}" data-a="${act}acc" data-id="${id}">${esc(C.accName(id))}</button>`).join('')}</div>` : '';
  if (!base && !segs.some(x => x.size)) return `${accChips}<div class="empty donut-empty">Nenhuma renda prevista neste período${accs.length ? ` em ${accs.map(id => esc(C.accName(id))).join(' + ')}` : ''}.</div>`;
  const r = 78, Cc = 2 * Math.PI * r, n = segs.filter(x => x.size > 0).length;
  let off = 0, svg = '';
  const circ = (col, dash, offset, op, sw) => `<circle cx="110" cy="110" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-dasharray="${dash} ${Cc - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 110 110)" opacity="${op}"/>`;
  for (const x of segs) {
    if (!(x.size > 0)) continue;
    const len = x.size / T * Cc, L = Math.max(0, len - (n > 1 ? 1.6 : 0)), f = Math.min(L, L * (x.strong / x.size));
    const dim = sel != null && sel !== '' && String(sel) !== String(x.i) ? 0.3 : 1, sw = String(sel) === String(x.i) ? 32 : 26;
    if (L - f > 0) svg += circ(x.col, L - f, off + f, 0.28 * dim, sw);
    if (f > 0) svg += circ(x.col, f, off, dim, sw);
    if (x.over > 0) { const ol = Math.min(L, x.over / T * Cc); svg += `<circle cx="110" cy="110" r="${r + 18}" fill="none" stroke="var(--red)" stroke-width="3" stroke-dasharray="${ol} ${Cc * 1.3}" stroke-dashoffset="${-(off + L - ol) * (r + 18) / r}" transform="rotate(-90 110 110)"/>`; }
    off += len;
  }
  const o = sel != null && sel !== '' ? segs.find(x => String(x.i) === String(sel)) : null;
  const pct = x => base ? Math.round(x / base * 1000) / 10 : 0;
  const big = o ? (o.c ? `${pctTxt(o.c.pct)}%` : money(o.size)) : money(base);
  const small = o ? (o.c ? money(o.c.target) : o.n) : (d.deduction.planned ? `renda após doações` : 'renda do período');
  const note = o && o.c ? (o.c.kind === 'save' ? `guardado ${money(o.c.realized)}` : `usado ${money(o.c.realized)}`) : `recebido ${money(d.base.received)}`;
  const legend = segs.map(x => `<button class="${String(sel) === String(x.i) ? 'on' : ''}" data-a="${act}sel" data-id="${x.i}"><i style="background:${x.col}"></i>${esc(x.n)}${x.c ? ` <b>${pctTxt(x.c.pct)}%</b>` : ''}${cfg.showLegendValues ? ` <small>${x.c ? money(x.c.target) : money(x.size)}</small>` : ''}${x.over ? ' <small class="neg">excedeu</small>' : ''}</button>`).join('');
  let detail = '';
  if (o && o.c) {
    const c = o.c, save = c.kind === 'save';
    const items = [...c.items].sort((a, b) => b.it.date.localeCompare(a.it.date)).slice(0, 8);
    detail = `<div class="dist-detail">
      <div class="kv"><span>Planejado</span><span>${pctTxt(c.pct)}% · ${money(c.target)}</span></div>
      <div class="kv"><span>${save ? 'Guardado de verdade' : 'Gasto (pago)'}</span><span>${money(c.realized)} · ${pctTxt(pct(c.realized))}%</span></div>
      ${cfg.showPlanVsReal ? `<div class="kv"><span>Previsto no período</span><span>${money(c.planned)}</span></div>` : ''}
      <div class="kv"><span>${save ? 'Falta guardar' : 'Disponível no limite'}</span><span>${money(c.left)}</span></div>
      ${c.over ? `<div class="kv"><span>${save ? 'Guardou além do plano' : 'Excedeu o limite'}</span><span class="${save ? 'pos' : 'neg'}">${money(c.over)}</span></div>` : ''}
      ${!save && c.plannedOver && !c.over ? `<div class="kv"><span>O previsto passa do limite em</span><span class="warn">${money(c.plannedOver)}</span></div>` : ''}
      ${(() => {
        // as metas são o agrupamento principal dentro da categoria; as tags detalham cada meta
        const by = new Map();
        for (const x of c.items) {
          const it = x.it, mt = it.metaId ? S().metas.get(it.metaId) : [...S().metas.values()].find(m => (m.tagIds || []).includes(it.tagId));
          const key = it.piggyId ? 'pig:' + it.piggyId : it.kind === 'transfer' ? 'tr' : mt ? mt.id : '';
          const g = by.get(key) || { name: it.piggyId ? `Cofrinho ${(S().piggies.get(it.piggyId) || {}).name || ''}` : it.kind === 'transfer' ? treasuryName() : mt ? mt.name : 'Sem meta', planned: 0, real: 0, tags: new Map() };
          g.planned += x.planned; g.real += x.real;
          const tn = it.tagId ? (C.tag(it.tagId) || {}).name : '';
          if (tn) g.tags.set(tn, (g.tags.get(tn) || 0) + (x.real || x.planned));
          by.set(key, g);
        }
        return by.size ? `<div class="dist-by">${[...by.values()].sort((a, b) => b.planned - a.planned).map(g => `<div class="kv"><span><b>${esc(g.name)}</b>${g.tags.size ? `<small> · ${esc([...g.tags.keys()].join(', '))}</small>` : ''}</span><span>${money(g.real)} de ${money(g.planned)}</span></div>`).join('')}</div>` : '';
      })()}
      ${items.length ? items.map(x => `<button class="card-row" data-a="goDay" data-id="${x.it.date}"><span class="grow"><div class="t">${esc(C.itemTitle(x.it))}</div><div class="s">${C.dm(x.it.date)} · ${x.real ? (save ? 'feito' : 'pago') : 'previsto'}</div></span><span class="v">${money(x.real || x.planned)}</span></button>`).join('') : `<p class="hint">${(c.metaIds || []).length + (c.tagIds || []).length + (c.piggyIds || []).length ? 'Nada lançado nesta categoria no período.' : 'Ligue metas, tags, cofrinhos ou o Tesouro a esta categoria na engrenagem.'}</p>`}
    </div>`;
  } else if (o) {
    const list = o.i === 'o' ? d.other.items : [];
    detail = `<div class="dist-detail"><p class="hint">${o.i === 'u' ? `${pctTxt(d.pct.missing)}% da renda ainda não tem destino na divisão.` : 'Gastos que não estão ligados a nenhuma categoria da divisão.'}</p>
      ${list.slice(0, 8).map(x => `<button class="card-row" data-a="goDay" data-id="${x.it.date}"><span class="grow"><div class="t">${esc(C.itemTitle(x.it))}</div><div class="s">${C.dm(x.it.date)}</div></span><span class="v">${money(x.real || x.planned)}</span></button>`).join('')}</div>`;
  }
  const warn = !d.pct.ok ? `<p class="hint ${d.pct.missing < 0 ? 'neg' : 'warn'}">A divisão soma ${pctTxt(d.pct.sum)}%: ${d.pct.missing > 0 ? `faltam ${pctTxt(d.pct.missing)}% para distribuir` : `passou ${pctTxt(-d.pct.missing)}%`}.</p>` : '';
  return `${accChips}<div class="donut"><svg viewBox="0 0 220 220" role="img" aria-label="Divisão da renda">
      <circle cx="110" cy="110" r="${r}" fill="none" stroke="#2A2A2E" stroke-width="26"/>${svg}
      <text x="110" y="101" text-anchor="middle" fill="#F5F5F5" font-size="${big.length > 11 ? 15 : 18}" font-weight="700">${esc(big)}</text>
      <text x="110" y="120" text-anchor="middle" fill="#A5ACB8" font-size="11">${esc(small.length > 26 ? small.slice(0, 25) + '…' : small)}</text>
      <text x="110" y="136" text-anchor="middle" fill="#A5ACB8" font-size="11">${esc(note)}</text>
    </svg></div>
    ${d.deduction.planned ? `<p class="hint center">Doações/dízimo antes da divisão: ${money(d.deduction.planned)} (renda ${money(d.income.planned)})</p>` : ''}
    <div class="donut-legend dist-legend">${legend}</div>${detail}${warn}`;
}

/** Engrenagem da divisão da renda: exibição, contas, modelo, doações e categorias. */
function budgetConfigView() {
  return {
    title: 'Divisão da renda', right: { icon: 'plus', fn: () => push(budgetCatForm(null)) },
    body: () => {
      const cfg = budgetCfg(), model = B.activeModelOf(cfg), { esc } = C, pc = B.pctCheck(model);
      const d = model.deduction || {};
      const sw = (k, on) => `<input type="checkbox" class="switch" data-k="${k}" ${on ? 'checked' : ''}>`;
      const accs = C.accountsList().filter(a => a.type !== 'piggy' && a.type !== 'treasury');
      const cats = B.liveCats(model), arch = (model.cats || []).filter(c => c.archived);
      const invest = cats.filter(c => c.kind === 'save' && ((c.piggyIds || []).includes(B.TREASURY) || /invest|liberdade/i.test(c.name))).reduce((s, c) => s + (+c.pct || 0), 0);
      const links = c => [...(c.metaIds || []).map(id => (S().metas.get(id) || {}).name), ...(c.tagIds || []).map(id => (C.tag(id) || {}).name), ...(c.piggyIds || []).map(id => (id === B.TREASURY ? treasuryName() : (S().piggies.get(id) || {}).name))].filter(Boolean);
      return `<div class="group">
          <label class="row"><span class="grow">Mostrar a bolacha abaixo do calendário</span>${sw('showOnCalendar', cfg.showOnCalendar)}</label>
          <label class="row"><span class="grow">Valores na legenda</span>${sw('showLegendValues', cfg.showLegendValues)}</label>
          <label class="row"><span class="grow">Planejado x previsto nos detalhes</span>${sw('showPlanVsReal', cfg.showPlanVsReal)}</label>
        </div>
        <div class="group-title">Contas da renda</div>
        <div class="chips">${accs.map(a => `<button type="button" class="chip${cfg.accounts.includes(a.id) ? ' on' : ''}" data-a="acc" data-id="${a.id}">${esc(a.name)}</button>`).join('')}</div>
        <p class="hint">${cfg.accounts.length ? 'Com mais de uma conta, a renda é somada sem contar transferências entre elas; dá para ver uma conta por vez na própria bolacha.' : 'Nenhuma marcada: usa a conta que está sendo exibida.'}</p>
        <div class="group-title">Modelo</div>
        <div class="group">
          <label class="row field"><span>Modelo em uso</span><select data-k="model">${cfg.models.map(m => `<option value="${m.id}" ${m.id === model.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
          <label class="row field"><span>Nome</span><input type="text" data-k="modelName" value="${esc(model.name)}" maxlength="40"></label>
        </div>
        <div class="btn-row"><button class="primary-btn ghost sm" data-a="dup">Salvar como novo</button><button class="primary-btn ghost sm" data-a="tpl">Novo pelo modelo do Sardinha</button>${cfg.models.length > 1 ? '<button class="primary-btn ghost sm" data-a="delModel">Excluir modelo</button>' : ''}</div>
        <div class="group-title">Doações e dízimo (antes da divisão)</div>
        <div class="group">
          <label class="row"><span class="grow">Descontar antes de dividir</span>${sw('dedOn', d.on)}</label>
          ${d.on ? `<label class="row field"><span>Tipo</span><select data-k="dedMode"><option value="value" ${d.mode !== 'percent' ? 'selected' : ''}>Valor por mês</option><option value="percent" ${d.mode === 'percent' ? 'selected' : ''}>% da renda</option></select></label>
          <label class="row field"><span>${d.mode === 'percent' ? 'Percentual (%)' : 'Valor por mês'}</span><input type="text" inputmode="decimal" data-k="dedValue" value="${d.mode === 'percent' ? pctTxt(+d.value || 0) : C.moneyInput(+d.value || 0)}"></label>` : ''}
        </div>
        <div class="group-title">Categorias <span class="${pc.ok ? 'pos' : pc.missing < 0 ? 'neg' : 'warn'}">${pctTxt(pc.sum)}%</span></div>
        ${!pc.ok ? `<p class="hint ${pc.missing < 0 ? 'neg' : 'warn'}">${pc.missing > 0 ? `Faltam ${pctTxt(pc.missing)}% para fechar 100%.` : `Passou ${pctTxt(-pc.missing)}% de 100%.`} Ajuste os percentuais ou abra uma categoria e toque em "Ajustar as outras".</p>` : ''}
        <div class="group">${cats.map(c => `<button class="row dist-cat" data-a="cat" data-id="${c.id}"><span class="dot" style="background:${c.color}"></span><span class="grow"><b>${esc(c.name)}</b><small>${c.kind === 'save' ? 'guardar/investir' : 'gastar'}${links(c).length ? ' · ' + esc(links(c).join(', ')) : ' · sem vínculos'}</small></span><b>${pctTxt(+c.pct || 0)}%</b></button>`).join('')}</div>
        ${invest < B.GUIDE.investMin ? `<p class="hint">Orientação do método: destinar ${B.GUIDE.investIdeal}% a investimentos (pelo menos ${B.GUIDE.investMin}% em meses apertados). É só uma referência.</p>` : ''}
        ${arch.length ? `<div class="group-title">Arquivadas</div><div class="group">${arch.map(c => `<button class="row dist-cat" data-a="cat" data-id="${c.id}"><span class="dot" style="background:${c.color}"></span><span class="grow muted">${esc(c.name)}</span><b class="muted">${pctTxt(+c.pct || 0)}%</b></button>`).join('')}</div>` : ''}
        <p class="hint">Cada categoria usa as metas, tags, cofrinhos e o Tesouro que já existem. Um lançamento conta numa categoria só.</p>`;
    },
    onField: (el2, type) => {
      if (type !== 'change') return;
      const cfg = budgetCfg(), model = B.activeModelOf(cfg), k = el2.dataset.k;
      const setModel = m => { cfg.models = cfg.models.map(x => (x.id === m.id ? m : x)); saveBudget(cfg); };
      if (['showOnCalendar', 'showLegendValues', 'showPlanVsReal'].includes(k)) { cfg[k] = el2.checked; return saveBudget(cfg); }
      if (k === 'model') { cfg.activeModel = el2.value; return saveBudget(cfg); }
      if (k === 'modelName') return setModel({ ...model, name: el2.value.trim() || model.name });
      if (k === 'dedOn') return setModel({ ...model, deduction: { ...(model.deduction || { mode: 'value', value: 0 }), on: el2.checked } });
      if (k === 'dedMode') return setModel({ ...model, deduction: { ...model.deduction, mode: el2.value, value: 0 } });
      if (k === 'dedValue') {
        const v = model.deduction.mode === 'percent' ? parseFloat(String(el2.value).replace(',', '.')) : C.parseMoney(el2.value);
        if (!Number.isFinite(v) || v < 0 || (model.deduction.mode === 'percent' && v > 100)) { C.toast('Valor inválido'); render(); return; }
        return setModel({ ...model, deduction: { ...model.deduction, value: v } });
      }
    },
    actions: {
      cat: id => push(budgetCatForm(id)),
      acc: id => { const cfg = budgetCfg(), set = new Set(cfg.accounts); set.has(id) ? set.delete(id) : set.add(id); cfg.accounts = [...set]; saveBudget(cfg); },
      dup: () => { const cfg = budgetCfg(), m = B.activeModelOf(cfg); const copy = { ...structuredClone(m), id: C.uid(), name: `${m.name} (cópia)`, cats: m.cats.map(c => ({ ...structuredClone(c), id: C.uid() })) }; cfg.models = [...cfg.models, copy]; cfg.activeModel = copy.id; saveBudget(cfg); C.toast('Modelo salvo'); },
      tpl: () => { const cfg = budgetCfg(), m = B.modelFromTemplate(B.TEMPLATE_SARDINHA, C.uid); cfg.models = [...cfg.models, m]; cfg.activeModel = m.id; saveBudget(cfg); C.toast('Modelo do Sardinha criado'); },
      delModel: async () => { const cfg = budgetCfg(); if (cfg.models.length < 2) return; if (!(await C.confirmDlg('Excluir este modelo?', 'Os lançamentos, metas e cofrinhos não são afetados.', 'Excluir', 'danger'))) return; cfg.models = cfg.models.filter(m => m.id !== cfg.activeModel); cfg.activeModel = cfg.models[0].id; saveBudget(cfg); },
    },
  };
}

/** Categoria da divisão: nome, %, cor, tipo e vínculos com metas, tags, cofrinhos e Tesouro. */
function budgetCatForm(catId) {
  const cfg0 = budgetCfg(), model0 = B.activeModelOf(cfg0);
  const c = catId ? model0.cats.find(x => x.id === catId) : null;
  const value = c ? { ...c, metaIds: [...(c.metaIds || [])], tagIds: [...(c.tagIds || [])], piggyIds: [...(c.piggyIds || [])] }
    : { name: '', pct: Math.max(0, B.pctCheck(model0).missing), color: C.PALETTE[(model0.cats.length * 5 + 2) % C.PALETTE.length], kind: 'spend', metaIds: [], tagIds: [], piggyIds: [], archived: false };
  const saveCat = v => {
    const cfg = budgetCfg(), model = B.activeModelOf(cfg);
    const obj = { ...(c || { id: C.uid() }), ...v, pct: Math.max(0, +v.pct || 0) };
    const cats = c ? model.cats.map(x => (x.id === c.id ? obj : x)) : [...model.cats, obj];
    cfg.models = cfg.models.map(x => (x.id === model.id ? { ...model, cats } : x));
    saveBudget(cfg);
    return obj;
  };
  const view = formView({
    title: c ? 'Categoria' : 'Nova categoria', value,
    fields: [
      { k: 'name', label: 'Nome', required: true, placeholder: 'Ex.: Custos Fixos' },
      { k: 'pct', label: 'Percentual da renda (%)', type: 'number', min: 0 },
      { k: 'kind', label: 'Tipo', type: 'select', options: [['spend', 'Gastar (limite de despesas)'], ['save', 'Guardar ou investir']] },
      { k: 'color', label: 'Cor', type: 'color' },
      { section: 'Vínculos' },
      { k: 'metaIds', label: 'Metas', type: 'multi', options: () => [...S().metas.values()].filter(m => !m.archived && (m.kind || 'expense') === 'expense').map(m => [m.id, m.name, m.color]) },
      { k: 'tagIds', label: 'Tags', type: 'multi', options: tagOptions('expense') },
      { k: 'piggyIds', label: 'Cofrinhos e Tesouro', type: 'multi', options: () => [...(treasury().accountId ? [[B.TREASURY, treasuryName(), '#45cf7f']] : []), ...[...S().piggies.values()].filter(p => !p.archived).map(p => [p.id, `Cofrinho ${p.name}`, p.color])] },
      { hint: 'Gastos entram pelas metas e tags; dinheiro guardado entra pelos depósitos reais nos cofrinhos e aportes no Tesouro. Nada é contado duas vezes.' },
      { section: '' },
      { k: 'archived', label: 'Arquivar (some da bolacha, sem apagar)', type: 'switch', show: () => !!c },
    ],
    onSave: async v => { saveCat(v); C.toast(c ? 'Categoria atualizada' : 'Categoria criada'); },
    onDelete: c && (async () => {
      if (!(await C.confirmDlg('Excluir categoria?', 'Os lançamentos, metas e cofrinhos ligados não são afetados.', 'Excluir', 'danger'))) return false;
      const cfg = budgetCfg(), model = B.activeModelOf(cfg);
      cfg.models = cfg.models.map(x => (x.id === model.id ? { ...model, cats: model.cats.filter(q => q.id !== c.id) } : x));
      saveBudget(cfg); back(); return false; // volta só para a lista de categorias
    }),
    extra: () => (c ? '<div class="btn-row"><button class="primary-btn ghost" data-a="rebal">Ajustar as outras para fechar 100%</button></div>' : ''),
    extraActions: {
      rebal: async () => {
        const obj = saveCat(view.vals);
        const cfg = budgetCfg(), model = B.activeModelOf(cfg);
        cfg.models = cfg.models.map(x => (x.id === model.id ? B.rebalance(model, obj.id) : x));
        saveBudget(cfg); C.toast('As outras categorias foram ajustadas proporcionalmente'); back();
      },
    },
  });
  return view;
}

function savingCard(m) {
  const { money, esc, dmy } = C;
  const pig = S().piggies.get(m.piggyId);
  const plan = C.F.savingPlan(m, { piggy: pig, data: S().data, today: C.today() });
  const u = C.F.freqUnit(m);
  return `<button class="card-row col" data-a="open" data-id="${m.id}">
    <span class="line"><span class="dot" style="background:${m.color}"></span><span class="grow t">${esc(m.name)}${m.completedAt ? ' <span class="muted small">concluída</span>' : ''}</span><span class="v">${Math.round(plan.pct * 100)}%</span></span>
    ${progress(plan.pct, m.color)}
    <span class="s">${money(plan.saved)} de ${money(plan.goal)} · ${plan.done ? 'valor atingido' : `guardar ${money(plan.perPeriod)} por ${u}`} · até ${m.deadline ? dmy(m.deadline) : '—'}${pig ? ` · cofrinho ${esc(pig.name)}` : ''}</span>
  </button>`;
}
function metaCard(m, p) {
  if (m.kind === 'saving') return savingCard(m);
  const { money, esc } = C;
  const inc = m.kind === 'income';
  if (!p.limit) {
    return `<button class="card-row col" data-a="open" data-id="${m.id}">
      <span class="line"><span class="dot" style="background:${m.color}"></span><span class="grow t">${esc(m.name)}</span><span class="v">${money(p.real)}</span></span>
      <span class="s">${inc ? 'recebido' : 'pago'} · previsto ${money(p.planned)} · sem limite definido</span>${metaTags(m)}
    </button>`;
  }
  const label = `${money(p.real)} de ${money(p.limit)}`;
  const sub = inc ? (p.real >= p.limit ? 'Meta atingida' : `Faltam ${money(p.limit - p.real)}`)
    : p.over ? `Excedeu ${money(p.over)}` : `Restam ${money(p.remaining)}`;
  return `<button class="card-row col" data-a="open" data-id="${m.id}">
    <span class="line"><span class="dot" style="background:${m.color}"></span><span class="grow t">${esc(m.name)}</span><span class="v">${Math.round(p.pct * 100)}%</span></span>
    ${progress(p.pct, m.color, !inc && p.over > 0)}
    <span class="s">${label} · ${sub} · ${C.F.PERIODS[m.period].toLowerCase()}</span>${metaTags(m)}
  </button>`;
}
/** Tags que ficam dentro da meta (ex.: Assinaturas → Internet · Spotify · Gemini). */
function metaTags(m) {
  const names = (m.tagIds || []).map(id => S().tags.get(id)).filter(Boolean).map(t => C.esc(t.name));
  return names.length ? `<span class="s meta-tags">Tags: ${names.join(' · ')}</span>` : '';
}

function savingDetail(id) {
  return {
    get title() { return (S().metas.get(id) || {}).name || 'Meta'; },
    right: { label: 'Editar', fn: () => push(metaForm(S().metas.get(id))) },
    body: () => {
      const m = S().metas.get(id); if (!m) return '';
      const { money, dmy, esc } = C;
      const pig = S().piggies.get(m.piggyId);
      const plan = C.F.savingPlan(m, { piggy: pig, data: S().data, today: C.today() });
      const u = C.F.freqUnit(m);
      return `<div class="stats">
          ${stat('Guardado', money(plan.saved), '', true)}
          ${stat('Objetivo', money(plan.goal))}${stat('Falta', money(plan.left))}
          ${stat('Prazo', m.deadline ? dmy(m.deadline) : '—')}
          ${stat(`Guardar por ${u}`, plan.done ? '—' : money(plan.perPeriod))}
          ${stat('Períodos restantes', String(plan.periods))}
        </div>
        ${progress(plan.pct, m.color)}
        ${m.completedAt ? '<p class="hint">Meta concluída. O dinheiro continua no cofrinho até você decidir usar.</p>' : plan.done ? '<p class="hint">Valor atingido! Você pode marcar a meta como concluída em Editar.</p>' : `<p class="hint">${C.F.SAVING_FREQ[m.freq] || ''}: o valor por ${u} é recalculado a partir de hoje com o que falta; o que já foi guardado continua valendo. Sem rendimento.</p>`}
        ${pig ? `<div class="btn-row"><button class="primary-btn" data-a="pig">Abrir o cofrinho ${esc(pig.name)}</button></div>` : '<p class="hint">Nenhum cofrinho ligado. Escolha um em Editar.</p>'}
        <div class="section-label"><span>DEPÓSITOS NO COFRINHO</span></div>
        ${plan.moves.slice().reverse().map(x => row({ a: 'goDay', id: x.date, t: esc(C.itemTitle(x.it)), s: C.dm(x.date), v: (x.amount < 0 ? '−' : '+') + money(Math.abs(x.amount)), cls: x.amount < 0 ? 'neg' : 'pos' })).join('') || '<p class="hint">Nada guardado ainda.</p>'}`;
    },
    actions: { pig: () => push(piggyDetail(S().metas.get(id).piggyId)), goDay },
  };
}
function metaDetail(id) {
  if ((S().metas.get(id) || {}).kind === 'saving') return savingDetail(id);
  let ref = C.today();
  const view = {
    get title() { return (S().metas.get(id) || {}).name || 'Meta'; },
    right: { label: 'Editar', fn: () => push(metaForm(S().metas.get(id))) },
    body: () => {
      const m = S().metas.get(id); if (!m) return '';
      const { money, dm, dmy, esc } = C;
      const bctx = C.budgetCtx();
      const p = C.F.metaProgress(C.scopedMeta(m), ref, bctx);
      const inc = m.kind === 'income';
      const daily = C.F.DAY_PERIODS.has(m.period);
      const tags = (m.tagIds || []).map(t => C.tag(t)).filter(Boolean);
      let days = '';
      if (daily) {
        const map = C.F.dailyBudget(m, p.from, p.to, bctx);
        days = `<div class="section-label"><span>DIAS</span></div><div class="daygrid">${[...map].map(([d, v]) => {
          const col = v.status === 'over' ? m.colorBad || 'var(--red)' : ['saved', 'ok', 'zero'].includes(v.status) ? m.colorGood || 'var(--green)' : 'var(--s3)';
          return `<button class="dg" data-a="goDay" data-id="${d}" title="${dmy(d)}"><i style="background:${col}"></i><span>${+d.slice(8)}</span></button>`;
        }).join('')}</div>`;
      }
      return `<div class="period-nav"><button class="icon-btn" data-a="prev">${C.icon('left')}</button><span>${dm(p.from)} a ${dm(p.to)}</span><button class="icon-btn" data-a="next">${C.icon('right')}</button></div>
        <div class="stats">
          ${stat(inc ? 'Recebido' : 'Usado', money(p.real), '', true)}
          ${p.limit ? stat(inc ? 'Meta' : 'Limite', money(p.limit)) : stat(inc ? 'Meta' : 'Limite', 'Não definido')}
          ${!p.limit ? '' : inc ? stat('Falta', money(Math.max(0, p.limit - p.real))) : p.over ? stat('Excedente', money(p.over), 'neg') : stat('Restante', money(p.remaining), 'pos')}
          ${stat('Previsto no período', money(p.planned))}
          ${daily ? stat('Economia acumulada', money(Math.max(0, p.saved)), p.saved > 0 ? 'pos' : '') + stat('Dias acima do limite', String(p.overDays)) : ''}
        </div>
        ${p.limit ? progress(p.pct, m.color, !inc && p.over > 0) : '<p class="hint">Toque em Editar para definir o limite desta meta.</p>'}
        <p class="hint">${C.F.PERIODS[m.period]}${daily ? ` · ${ROLLOVER[m.rollover || 'none'].toLowerCase()}${m.carryExcess ? ', excedente desconta dos próximos dias' : ''}` : ''}${tags.length ? ` · tags: ${tags.map(t => esc(t.name)).join(', ')}` : inc ? '' : ' · todas as despesas'}${inc && m.origins && m.origins.length ? ` · origem: ${m.origins.map(esc).join(', ')}` : ''}</p>
        ${daily && m.rollover === 'reserve' && p.saved > 0 ? `<div class="btn-row"><button class="primary-btn ghost" data-a="reserve">Guardar ${money(p.saved)} num cofrinho</button></div>` : ''}
        ${days}
        <div class="section-label"><span>MOVIMENTAÇÕES</span></div>
        ${p.items.slice().reverse().map(({ it, real, planned }) => row({ a: 'goDay', id: it.date, dot: C.itemColor(it), t: esc(C.itemTitle(it)), s: `${dm(it.date)} · ${it.status === 'planned' ? 'previsto' : C.statusLabel(it).toLowerCase()}`, v: money(real || planned), cls: real ? '' : 'muted' })).join('') || '<p class="hint">Nada neste período.</p>'}`;
    },
    actions: {
      prev: () => { const m = S().metas.get(id); ref = addDays(C.F.periodRange(m, ref, S().settings.mondayFirst).from, -1); render(); },
      next: () => { const m = S().metas.get(id); ref = addDays(C.F.periodRange(m, ref, S().settings.mondayFirst).to, 1); render(); },
      goDay,
      reserve: async () => {
        const m = S().metas.get(id);
        const p = C.F.metaProgress(m, ref, C.budgetCtx());
        const pigs = [...S().piggies.values()].filter(x => !x.archived);
        if (!pigs.length) { C.toast('Crie um cofrinho primeiro'); return; }
        const pid = await C.dialog({
          title: `Guardar ${C.money(p.saved)}`, html: `<select id="mrPig">${pigs.map(x => `<option value="${x.id}" ${x.id === m.reservePiggy ? 'selected' : ''}>${C.esc(x.name)}</option>`).join('')}</select>`,
          actions: [{ label: 'Cancelar', value: null }, { label: 'Guardar', cls: 'primary', value: () => document.getElementById('mrPig').value }],
        });
        if (!pid) return;
        const pig = S().piggies.get(pid);
        const ch = pig.type === 'real'
          ? onceEntry({ kind: 'transfer', amount: p.saved, date: C.today(), accountId: S().settings.defaultAccount, toAccountId: pig.accountId, title: `Economia de ${m.name}` })
          : onceEntry({ kind: 'reserve', amount: p.saved, date: C.today(), accountId: pig.accountId, piggyId: pig.id, title: `Economia de ${m.name}` });
        await C.commit(`Economia guardada em ${pig.name}`, ch);
      },
    },
  };
  return view;
}

/** Meta nova nasce na conta que está sendo vista (ou na principal), para cada conta ter as suas metas. */
function newMetaAccounts() {
  if (C.accountsList().length < 2) return [];
  const shown = C.accountsList().filter(x => S().set && S().set.has(x.id)).map(x => x.id);
  return C.filtering() && shown.length ? shown : [S().settings.defaultAccount];
}
/** Quanto guardar por período, calculado na hora a partir do valor, do prazo e da frequência. */
function savingHint(v) {
  if (!v.amount || !v.deadline) return 'Informe o valor e o prazo: o app calcula quanto guardar em cada período.';
  const pig = v.piggyId ? S().piggies.get(v.piggyId) : null;
  const plan = C.F.savingPlan({ ...v, kind: 'saving', freq: v.freq || 'month' }, { piggy: pig, data: S().data, today: C.today() });
  const u = C.F.freqUnit({ ...v, freq: v.freq || 'month' });
  return `<b>Guardar ${C.money(plan.perPeriod)} por ${u}</b> · ${plan.periods} ${u === 'mês' ? (plan.periods === 1 ? 'mês' : 'meses') : u === 'dia' ? 'dias' : u + (plan.periods === 1 ? '' : 's')} até ${C.dmy(v.deadline)}${plan.saved ? ` · já guardado ${C.money(plan.saved)}` : ''} (sem rendimento).`;
}
function metaForm(m = null) {
  const value = m ? { ...m, tagIds: [...(m.tagIds || [])], accountIds: [...(m.accountIds || [])], originsTxt: (m.origins || []).join(', '), completed: !!m.completedAt }
    : { name: '', kind: 'expense', period: 'month', amount: 0, tagIds: [], onlyAssigned: true, accountIds: newMetaAccounts(), originsTxt: '', rollover: 'none', carryExcess: false, showOnCalendar: false, color: C.PALETTE[(S().metas.size * 5 + 8) % C.PALETTE.length], colorGood: '#45cf7f', colorBad: '#ff5f57', tintTags: true, alertPct: 80, freq: 'month', deadline: '', piggyId: '' };
  const daily = v => C.F.DAY_PERIODS.has(v.period);
  return formView({
    title: m ? 'Editar meta' : 'Nova meta', value,
    fields: [
      { k: 'name', label: 'Nome', required: true, placeholder: 'Ex.: Alimentação' },
      { k: 'kind', label: 'Tipo', type: 'select', options: [['expense', 'Limite de gastos'], ['income', 'Meta de receita'], ['saving', 'Acumulação (juntar até uma data)']] },
      // ---- acumulação: quanto juntar, até quando e com que frequência; o app calcula quanto guardar por período
      { k: 'amount', label: 'Quanto quer juntar', type: 'money', show: v => v.kind === 'saving' },
      { k: 'deadline', label: 'Até quando', type: 'date', show: v => v.kind === 'saving' },
      { k: 'freq', label: 'Como vai guardar', type: 'select', options: Object.entries(C.F.SAVING_FREQ), show: v => v.kind === 'saving' },
      { k: 'freqDays', label: 'A cada quantos dias', type: 'number', min: 1, show: v => v.kind === 'saving' && v.freq === 'days' },
      { hint: v => savingHint(v), show: v => v.kind === 'saving' },
      { k: 'piggyId', label: 'Cofrinho onde o dinheiro fica', type: 'select', options: () => [['', 'Criar um cofrinho com o mesmo nome'], ...[...S().piggies.values()].filter(p => !p.archived).map(p => [p.id, p.name])], show: v => v.kind === 'saving' },
      { hint: 'Os depósitos reais nesse cofrinho atualizam a meta. Nada é guardado sozinho.', show: v => v.kind === 'saving' },
      { k: 'period', label: 'Período', type: 'select', options: Object.entries(C.F.PERIODS), show: v => v.kind !== 'saving' },
      { k: 'from', label: 'De', type: 'date', show: v => v.period === 'custom' && v.kind !== 'saving' },
      { k: 'to', label: 'Até', type: 'date', show: v => v.period === 'custom' && v.kind !== 'saving' },
      { k: 'amount', label: 'Limite / valor', type: 'money', show: v => v.kind !== 'saving' },
      { hint: 'Pode deixar em branco e definir depois: a meta já acompanha o que foi gasto.', show: v => !v.amount && v.kind !== 'saving' },
      { k: 'color', label: 'Cor', type: 'color' },
      { k: 'tintTags', label: 'Tags usam tons da cor da meta', type: 'switch', show: v => v.kind !== 'saving' },
      { section: 'O que entra na meta', show: v => v.kind !== 'saving' },
      { k: 'tagIds', label: 'Tags desta meta (cada tag fica em uma meta só)', type: 'multi', options: () => tagOptions(null)(), show: v => v.kind !== 'saving' },
      { hint: 'Os lançamentos entram na meta pela tag ou quando são lançados direto na meta, sem tag.', show: v => v.kind !== 'saving' },
      { k: 'accountIds', label: 'Conta desta meta (nenhuma = todas). Ex.: uma meta só para a conta de trabalho', type: 'multi', options: accOptions, show: v => C.accountsList().length > 1 && v.kind !== 'saving' },
      { k: 'originsTxt', label: 'Origens', placeholder: 'Ex.: iFood, Salário CLT', show: v => v.kind === 'income' },
      { section: 'Sobras e excedentes', show: v => daily(v) && v.kind === 'expense' },
      { k: 'rollover', label: 'Valor não usado', type: 'select', options: Object.entries(ROLLOVER), show: v => daily(v) && v.kind === 'expense' },
      { k: 'carryExcess', label: 'Excedente desconta dos próximos dias', type: 'switch', show: v => daily(v) && v.kind === 'expense' && (v.rollover === 'week' || v.rollover === 'month') },
      { k: 'showOnCalendar', label: 'Colorir os dias no calendário', type: 'switch', show: v => daily(v) && v.kind === 'expense' },
      { k: 'colorGood', label: 'Cor do dia dentro do orçamento', type: 'color', show: v => daily(v) && v.showOnCalendar },
      { k: 'colorBad', label: 'Cor do dia acima do orçamento', type: 'color', show: v => daily(v) && v.showOnCalendar },
      { hint: 'A cor do orçamento aparece como uma pequena barra sob o número do dia, separada do saldo.', show: v => daily(v) && v.showOnCalendar },
      { section: 'Alerta', show: v => v.kind === 'expense' },
      { k: 'alertPct', label: 'Avisar ao atingir (%)', type: 'number', min: 1, show: v => v.kind === 'expense' },
      { k: 'completed', label: 'Meta concluída (o dinheiro continua no cofrinho)', type: 'switch', show: v => !!m && v.kind === 'saving' },
      { k: 'hideInPanel', label: 'Esconder da área de Metas abaixo do calendário', type: 'switch' },
      { section: '' },
      { k: 'archived', label: 'Arquivar', type: 'switch', show: () => !!m },
    ],
    onSave: async v => {
      const { originsTxt, ...rest } = v;
      const obj = { ...(m || { id: C.uid(), createdAt: C.nowISO() }), ...rest, onlyAssigned: true, origins: originsTxt.split(',').map(s => s.trim()).filter(Boolean) };
      if (obj.kind === 'saving') {
        if (!obj.amount || !obj.deadline) { C.toast('Informe quanto quer juntar e até quando'); return false; }
        obj.freq = obj.freq || 'month'; obj.start = obj.start || C.today(); obj.tagIds = []; obj.period = 'custom';
        obj.completedAt = obj.completed ? (m && m.completedAt) || C.nowISO() : null; delete obj.completed;
        if (!obj.piggyId || !S().piggies.get(obj.piggyId)) {
          // cofrinho com o mesmo nome da meta (virtual, na conta principal)
          const pig = { id: C.uid(), name: obj.name, type: 'virtual', accountId: S().settings.defaultAccount, goal: obj.amount, deadline: obj.deadline, color: obj.color, createdAt: C.nowISO() };
          await saveStore('piggies', 'piggies', pig, `Cofrinho criado para a meta ${obj.name}`);
          obj.piggyId = pig.id;
        }
      }
      // cada tag pertence a uma meta só: as tags marcadas aqui saem das outras metas
      for (const o of S().metas.values()) {
        if (o.id === obj.id || !(o.tagIds || []).some(id => obj.tagIds.includes(id))) continue;
        await saveStore('metas', 'metas', { ...o, tagIds: o.tagIds.filter(id => !obj.tagIds.includes(id)) });
      }
      if (!daily(obj) || obj.kind !== 'expense' || !obj.amount) obj.showOnCalendar = false;
      if (obj.showOnCalendar) for (const o of S().metas.values()) if (o.id !== obj.id && o.showOnCalendar) await saveStore('metas', 'metas', { ...o, showOnCalendar: false });
      await saveStore('metas', 'metas', obj);
      C.toast(m ? 'Meta atualizada' : 'Meta criada');
    },
    onDelete: m && (async () => {
      if (!(await C.confirmDlg('Excluir meta?', 'Os lançamentos não são afetados.', 'Excluir', 'danger'))) return false;
      await deleteStore('metas', 'metas', m);
      return true;
    }),
  });
}

// ------------------------------------------------------------------ RELATÓRIOS
function reportsView() {
  let mode = 'month';
  let ref = C.today();
  const view = {
    title: 'Relatórios',
    body: () => {
      const { money, signed, sgnCls, esc } = C;
      const set = S().set;
      const { y, m } = parse(ref);
      const range = mode === 'month' ? { from: iso(y, m, 1), to: iso(y, m, daysInMonth(y, m)) } : { from: iso(y, 1, 1), to: iso(y, 12, 31) };
      const prevRef = mode === 'month' ? addMonths(y, m, -1) : { y: y - 1, m };
      const prev = mode === 'month' ? { from: iso(prevRef.y, prevRef.m, 1), to: iso(prevRef.y, prevRef.m, daysInMonth(prevRef.y, prevRef.m)) } : { from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31) };
      const r = C.F.periodReport(range.from, range.to, S().data, set);
      const rp = C.F.periodReport(prev.from, prev.to, S().data, set);
      const saving = r.incReal - r.expReal;
      const diffExp = r.expReal - r.exp;
      const delta = rp.expReal ? Math.round((r.expReal - rp.expReal) / rp.expReal * 100) : null;
      // barras: 6 meses (ou 12 no ano) — previsto x realizado das despesas
      const cols = [];
      if (mode === 'month') for (let i = 5; i >= 0; i--) { const mm = addMonths(y, m, -i); cols.push({ label: MONTHS[mm.m - 1].slice(0, 3), cur: i === 0, ...C.F.periodReport(iso(mm.y, mm.m, 1), iso(mm.y, mm.m, daysInMonth(mm.y, mm.m)), S().data, set) }); }
      else for (let i = 1; i <= 12; i++) cols.push({ label: MONTHS[i - 1].slice(0, 1), cur: i === m, ...C.F.periodReport(iso(y, i, 1), iso(y, i, daysInMonth(y, i)), S().data, set) });
      const max = Math.max(1, ...cols.map(c => Math.max(c.exp, c.expReal)));
      const byTag = [...r.byTag].sort((a, b) => b[1] - a[1]);
      const tagMax = Math.max(1, ...byTag.map(x => x[1]));
      return `<div class="btn-row"><button class="primary-btn ghost" data-a="closing">Fechamento do mês</button></div>
        <div class="segmented seg-sm"><button class="${mode === 'month' ? 'on' : ''}" data-a="mode" data-id="month">Mês</button><button class="${mode === 'year' ? 'on' : ''}" data-a="mode" data-id="year">Ano</button></div>
        <div class="period-nav"><button class="icon-btn" data-a="prev">${C.icon('left')}</button><span>${mode === 'month' ? `${MONTHS[m - 1]} ${y}` : y}</span><button class="icon-btn" data-a="next">${C.icon('right')}</button></div>
        <div class="stats">
          ${stat('Economia realizada', signed(saving), sgnCls(saving), true)}
          ${stat('Receitas recebidas', money(r.incReal), 'pos')}${stat('Receitas previstas', money(r.inc))}
          ${stat('Despesas pagas', money(r.expReal), 'neg')}${stat('Despesas previstas', money(r.exp))}
          ${stat('Realizado x previsto', `${diffExp > 0 ? '+' : diffExp < 0 ? '−' : ''}${money(Math.abs(diffExp))}`, diffExp > 0 ? 'neg' : 'pos')}
          ${stat(mode === 'month' ? 'Gastos x mês anterior' : 'Gastos x ano anterior', delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta}%`, delta > 0 ? 'neg' : delta < 0 ? 'pos' : '')}
        </div>
        <div class="section-label"><span>DESPESAS: PREVISTO X REALIZADO</span></div>
        <div class="bars">${cols.map(c => `<div class="col${c.cur ? ' cur' : ''}"><div class="pair"><i style="height:${c.exp / max * 100}%;background:var(--s3)"></i><i style="height:${c.expReal / max * 100}%;background:var(--accent)"></i></div><span>${c.label}</span></div>`).join('')}</div>
        <div class="legend-mini"><span><i style="background:var(--s3)"></i>Previsto</span><span><i style="background:var(--accent)"></i>Realizado</span></div>
        <div class="section-label"><span>GASTOS REALIZADOS POR META</span><span>com as tags de cada uma</span></div>
        ${(() => {
          // a meta é o agrupamento principal; as tags detalham o que compõe cada meta
          const groups = new Map();
          for (const [tid, v] of byTag) {
            const metaId = tid.startsWith('meta:') ? tid.slice(5) : ([...S().metas.values()].find(m => (m.tagIds || []).includes(tid)) || {}).id || '';
            const g = groups.get(metaId) || { total: 0, tags: [] };
            g.total += v; if (!tid.startsWith('meta:')) g.tags.push([tid, v]); else g.direct = (g.direct || 0) + v;
            groups.set(metaId, g);
          }
          const list = [...groups].sort((a, b) => b[1].total - a[1].total);
          const max = Math.max(1, ...list.map(x => x[1].total));
          return list.map(([mid, g]) => {
            const mt = S().metas.get(mid), col = mt ? mt.color : 'var(--text-3)';
            const tags = [...g.tags].sort((a, b) => b[1] - a[1]).map(([tid, v]) => { const t = C.tag(tid); return `<div class="rep-tag"><span>${esc(t ? t.name : 'Sem tag')}</span><span>${money(v)}</span></div>`; }).join('')
              + (g.direct ? `<div class="rep-tag"><span>${esc(mt ? mt.name : '')} · geral</span><span>${money(g.direct)}</span></div>` : '');
            return `<div class="tagbar rep-meta"><span class="grow"><b>${esc(mt ? mt.name : 'Sem meta')}</b></span><span>${money(g.total)}</span>${progress(g.total / max, col)}</div>${tags}`;
          }).join('') || '<p class="hint">Nenhum gasto pago neste período.</p>';
        })()}`;
    },
    actions: {
      mode: id => { mode = id; render(); },
      closing: () => push(closingView()),
      prev: () => { const { y, m } = parse(ref); const n = mode === 'month' ? addMonths(y, m, -1) : { y: y - 1, m }; ref = iso(n.y, n.m, 1); render(); },
      next: () => { const { y, m } = parse(ref); const n = mode === 'month' ? addMonths(y, m, 1) : { y: y + 1, m }; ref = iso(n.y, n.m, 1); render(); },
      open: id => push(metaDetail(id)),
    },
  };
  return view;
}

// ------------------------------------------------------------------ HISTÓRICO
function historyView() {
  let list = null;
  const view = {
    title: 'Histórico',
    sub: 'Todas as alterações feitas neste aparelho',
    body: () => {
      if (!list) { db.getAll('history').then(h => { list = h.sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 300); render(); }); return '<div class="empty">Carregando…</div>'; }
      if (!list.length) return '<div class="empty">Nenhuma alteração registrada.</div>';
      const { esc } = C;
      const NAMES = { pay: 'Pagamento', unpay: 'Pagamento desfeito', 'entry:create': 'Lançamento criado', 'entry:update': 'Lançamento alterado', 'entry:delete': 'Lançamento excluído' };
      let html = '', day = '';
      for (const h of list) {
        const d = (h.at || '').slice(0, 10);
        const local = h.at ? new Date(h.at) : null;
        const dLocal = local ? iso(local.getFullYear(), local.getMonth() + 1, local.getDate()) : d;
        if (dLocal !== day) { day = dLocal; html += `<div class="hist-day">${C.dmy(dLocal)}</div>`; }
        const label = h.action === 'undo' ? `Desfeito: ${(h.payload && h.payload.label) || ''}` : NAMES[h.action] || h.action;
        const n = h.payload && h.payload.overrides ? h.payload.overrides.length + (h.payload.entries || []).length : 0;
        const det = (h.payload && h.payload.details) || [];
        html += `<div class="hist"><span>${esc(label)}${n > 1 && !det.length ? ` <span class="muted small">(${n} registros)</span>` : ''}${det.length ? `<span class="hist-det">${det.map(esc).join('<br>')}</span>` : ''}</span><span>${local ? local.toTimeString().slice(0, 5) : ''}</span></div>`;
      }
      return html;
    },
  };
  return view;
}

// ------------------------------------------------------------------ ALERTAS
function alertsView() {
  return {
    title: 'Alertas',
    body: () => {
      const list = S().alerts || [];
      return (list.map((a, i) => `<button class="alert-row" data-a="go" data-id="${i}"><span class="lv ${a.level}"></span><span class="grow">${C.esc(a.text)}</span>${C.icon('right')}</button>`).join('')
        || '<div class="empty">Nenhum alerta no momento.</div>') + '<p class="hint">Os alertas nunca bloqueiam lançamentos. Escolha quais aparecem em Menu › Alertas.</p>';
    },
    actions: {
      go: async i => {
        const a = (S().alerts || [])[+i]; if (!a) return;
        if (a.type === 'backup') { exportBackup(); return; }
        if (a.metaId) { push(metaDetail(a.metaId)); return; }
        if (a.date) goDay(a.date);
      },
    },
  };
}

const VIEWS = { closing: closingView, accounts: accountsView, piggies: piggiesView, treasury: treasuryView, budget: budgetConfigView, metas: metasView, reports: reportsView, history: historyView, alerts: alertsView };

// ------------------------------------------------------------------ PAINÉIS DA TELA INICIAL
const openPanels = new Set(['metas']);
const panelDist = { sel: null, only: null }; // seleção da bolacha embaixo do calendário
export function renderPanels(box) {
  if (!C) return;
  const on = S().settings.panels || {};
  const keys = ['accounts', 'metas', 'pending', 'upcoming', 'piggies'].filter(k => on[k] || (k === 'metas' && on[k] === undefined)); // metas: ligado por padrão
  if (!keys.length) { box.innerHTML = ''; return; }
  const b = S().bal || bal();
  const { money, signed, sgnCls, esc, dm } = C;
  const t = C.today();
  const P = {
    accounts: () => {
      const list = C.accountsList().filter(a => a.includeInTotal !== false);
      return { label: 'Contas', value: signed(b.totals.total), cls: sgnCls(b.totals.total),
        body: list.map(a => row({ a: 'page', id: 'accounts', dot: a.color, t: esc(a.name), v: signed((b.accounts.get(a.id) || {}).real || 0) })).join('') + `<span class="kv"><span>Disponível</span><span>${money(b.totals.available)}</span></span>` };
    },
    metas: () => {
      // acompanha a visualização do calendário: dia, semana, mês (e agenda) ou ano
      const view = C.calView ? C.calView() : 'month';
      const v = view === 'agenda' ? 'month' : view;
      const sel = S().selected || t, sv = S().view || parse(t);
      const inView = (sv.y === parse(t).y && sv.m === parse(t).m) ? t : iso(sv.y, sv.m, 1);
      const date = v === 'day' || v === 'week' ? sel : v === 'year' ? (sv.y === parse(t).y ? t : iso(sv.y, 1, 1)) : inView;
      const ms = [...S().metas.values()].filter(C.metaVisible).filter(m => !m.hideInPanel).map(C.scopedMeta);
      const P = C.F.metaPanel({ metas: ms, view: v, date, data: S().data, isHoliday: S().isHoliday, mondayFirst: S().settings.mondayFirst, piggies: [...S().piggies.values()], today: t });
      const rows = P.groups.flatMap(g => g.rows);
      const over = rows.filter(r => r.status === 'over').length;
      const fmtSaving = r => {
        const tgt = r.target, done = r.done$ || 0, pctP = tgt ? Math.min(1, done / tgt) : r.pct;
        const head = tgt == null ? `<b>${money(r.saved)} de ${money(r.goal)}</b>` : done >= tgt ? '<b class="pos">contribuição feita</b>' : `<b>faltam ${money(tgt - done)}</b>`;
        const sub = tgt == null ? `${Math.round(r.pct * 100)}% do objetivo · guardar ${money(r.perPeriod)} por ${r.unit} · ${done ? `guardado no período ${money(done)}` : 'nada guardado no período'}`
          : `Guardado ${money(done)} de ${money(tgt)} planejados · total ${money(r.saved)} de ${money(r.goal)} (${Math.round(r.pct * 100)}%)`;
        const parts = r.parts ? `<div class="mp-parts">${r.parts.map(x => `<span class="mp-part ${x.target != null && x.done$ >= x.target ? 'met' : x.target == null ? 'none' : 'ok'}" title="${esc(`${x.label}: ${money(x.done$)}${x.target != null ? ` de ${money(x.target)}` : ''}`)}"><small>${esc(x.label)}</small><i style="--p:${x.target ? Math.min(100, Math.round(x.done$ / x.target * 100)) : x.done$ > 0 ? 100 : 0}%"></i></span>`).join('')}</div>` : '';
        return `<button class="mp-row" data-a="meta" data-id="${r.meta.id}">
          <span class="line"><span class="dot" style="background:${r.meta.color || 'var(--accent)'}"></span><span class="grow t">${esc(r.meta.name)} <small>${esc(r.label)}</small></span>${head}</span>
          <span class="mp-bar"><i style="width:${(pctP * 100).toFixed(1)}%;background:${r.meta.color || 'var(--accent)'}"></i></span>
          <span class="s">${sub}</span>${parts}</button>`;
      };
      const fmtRow = r => {
        if (r.kind === 'saving') return fmtSaving(r);
        const inc = (r.meta.kind || 'expense') === 'income';
        const pct = r.limit ? Math.min(1, r.real / r.limit) : 0, pctP = r.limit ? Math.min(1, r.planned / r.limit) : 0;
        const head = inc ? (r.status === 'met' ? `<b class="pos">${r.over ? `+${money(r.over)} além` : 'meta atingida'}</b>` : `<b>faltam ${money(r.remaining)}</b>`)
          : r.status === 'over' ? `<b class="neg">excedeu ${money(r.over)}</b>`
          : r.status === 'risk' ? `<b class="warn">previsto passa ${money(r.planned - r.limit)}</b>` : `<b>restam ${money(r.remaining)}</b>`;
        const sub = inc ? `Recebido ${money(r.real)} de ${money(r.limit)} · previsto ${money(r.planned)}` : `Gasto ${money(r.real)} de ${money(r.limit)} · previsto ${money(r.planned)}`;
        const parts = r.parts ? `<div class="mp-parts">${r.parts.map(x => `<span class="mp-part ${x.status}" title="${esc(`${x.label}: ${money(x.real)} de ${money(x.limit)} (previsto ${money(x.planned)})`)}"><small>${esc(x.label)}</small><i style="--p:${x.limit ? Math.min(100, Math.round(x.real / x.limit * 100)) : 0}%"></i></span>`).join('')}</div>` : '';
        return `<button class="mp-row" data-a="meta" data-id="${r.meta.id}">
          <span class="line"><span class="dot" style="background:${r.meta.color || 'var(--accent)'}"></span><span class="grow t">${esc(r.meta.name)} <small>${esc(r.label)}</small></span>${head}</span>
          <span class="mp-bar${r.status === 'over' ? ' over' : ''}"><i class="p" style="width:${(pctP * 100).toFixed(1)}%;background:${r.meta.color || 'var(--accent)'}"></i><i style="width:${(pct * 100).toFixed(1)}%;background:${r.meta.color || 'var(--accent)'}"></i></span>
          <span class="s">${sub}${r.overDays ? ` · ${r.overDays} dia(s) acima` : ''}</span>${parts}
        </button>`;
      };
      // bolacha da divisão da renda no mesmo período (pode ser desligada na engrenagem)
      const { cfg: bcfg, d: dist } = budgetDist(P.from, P.to, panelDist.only);
      const pie = bcfg.showOnCalendar ? `<div class="donut-card mp-dist"><div class="donut-head"><b>Divisão da renda · ${esc(P.title)}</b><button class="icon-btn sm" data-a="pcfg" aria-label="Configurar a divisão da renda">${C.icon('gear')}</button></div>${rendaBolacha(bcfg, dist, panelDist.sel, panelDist.only, 'p')}</div>` : '';
      const body = pie + P.groups.map(g => `<div class="mp-group">${esc(g.title)}</div>${g.rows.map(fmtRow).join('')}`).join('')
        || `<p class="hint">Nenhuma meta ${v === 'day' ? 'diária para este dia' : v === 'week' ? 'diária ou semanal para esta semana' : v === 'year' ? 'para este ano' : 'para este mês'} nesta conta.</p>`;
      const risk = rows.filter(r => r.status === 'risk').length;
      return { label: `Metas · ${P.title}`, value: rows.length ? (over ? `${over} acima do limite` : risk ? `${risk} com previsto acima` : 'Dentro do limite') : 'Nenhuma', cls: over ? 'neg' : risk ? 'warn' : '',
        body: body + '<p class="hint mp-hint">Barra clara = previsto · barra forte = realizado. Cada lançamento conta uma vez, mesmo aparecendo no dia, na semana e no mês.</p>' };
    },
    pending: () => {
      const items = [...(S().alerts || [])].filter(a => a.items).flatMap(a => a.items);
      return { label: 'Pendências', value: items.length ? String(items.length) : 'Nenhuma', cls: items.length ? 'warn' : '',
        body: items.slice(0, 12).map(it => movementRow(it)).join('') };
    },
    upcoming: () => {
      const items = itemsFor(it => counts(it) && it.status !== 'paid' && (it.kind === 'income' || it.kind === 'expense') && S().set.has(it.accountId), t, addDays(t, 7)).reverse();
      const out = items.filter(i => i.kind === 'expense').reduce((s, i) => s + i.amount - realizedOf(i), 0);
      const inc = items.filter(i => i.kind === 'income').reduce((s, i) => s + i.amount - realizedOf(i), 0);
      return { label: 'Próximos 7 dias', value: `+${money(inc)} · −${money(out)}`, cls: '',
        body: items.slice(0, 20).map(it => movementRow(it)).join('') || '<p class="hint">Nada previsto.</p>' };
    },
    piggies: () => {
      const list = [...S().piggies.values()].filter(p => !p.archived && (p.type === 'real' || !S().set || S().set.has(p.accountId)));
      const total = list.reduce((s, p) => s + ((b.piggies.get(p.id) || {}).saved || 0), 0);
      return { label: 'Cofrinhos', value: money(total), cls: '',
        body: list.map(p => { const sv = (b.piggies.get(p.id) || {}).saved || 0; return `<button class="card-row col" data-a="page" data-id="piggies"><span class="line"><span class="dot" style="background:${p.color}"></span><span class="grow t">${esc(p.name)}</span><span class="v">${money(sv)}</span></span>${p.goal ? progress(sv / p.goal, p.color) : ''}</button>`; }).join('') };
    },
  };
  box.innerHTML = keys.map(k => {
    const p = P[k]();
    return `<div class="panel${openPanels.has(k) ? ' open' : ''}"><button class="summary-line" data-panel-toggle="${k}"><span>${p.label}</span><b class="${p.cls}">${p.value}</b></button>
      <div class="panel-body"${openPanels.has(k) ? '' : ' hidden'}>${p.body}</div></div>`;
  }).join('');
  if (!box.dataset.bound) {
    box.dataset.bound = '1';
    box.addEventListener('click', e => {
      const tg = e.target.closest('[data-panel-toggle]');
      if (tg) { const k = tg.dataset.panelToggle; openPanels.has(k) ? openPanels.delete(k) : openPanels.add(k); renderPanels(box); return; }
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'page') open(a.dataset.id);
      if (a.dataset.a === 'meta') { open('metas'); push(metaDetail(a.dataset.id)); }
      if (a.dataset.a === 'goDay') C.openDay(a.dataset.id);
      if (a.dataset.a === 'psel') { const id = a.dataset.id; panelDist.sel = String(panelDist.sel) === String(id) ? null : id; renderPanels(box); }
      if (a.dataset.a === 'pacc') { panelDist.only = a.dataset.id || null; panelDist.sel = null; renderPanels(box); }
      if (a.dataset.a === 'pcfg') { open('budget'); }
    });
  }
}

// ------------------------------------------------------------------ BACKUP
async function snapshot() {
  const stores = {};
  for (const st of db.STORES) stores[st] = await db.getAll(st);
  return { app: 'calendario-financeiro', format: 1, exportedAt: C.nowISO(), stores };
}
function download(data, name) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return blob;
}

export async function exportBackup() {
  const data = await snapshot();
  const name = `financas-backup-${C.today()}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
  let shared = false;
  try {
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      await navigator.share({ files: [file], title: 'Backup do Calendário Financeiro' });
      shared = true;
    }
  } catch (err) { if (err && err.name === 'AbortError') return; }
  if (!shared) download(data, name);
  S().settings.lastBackup = data.exportedAt;
  C.saveSettings();
  db.log('Backup exportado', {});
  C.refresh();
  C.toast('Backup exportado');
}

/**
 * Valida um backup antes de restaurar: estrutura, campos obrigatórios, datas, valores,
 * duplicidades (mesma chave) e referências quebradas. Devolve os dados limpos e um relatório.
 */
export function validateBackup(data) {
  const errors = [], notes = [];
  if (!data || typeof data !== 'object' || data.app !== 'calendario-financeiro' || !data.stores || typeof data.stores !== 'object') {
    return { ok: false, errors: ['Este arquivo não é um backup do Calendário Financeiro.'] };
  }
  const KEY = { entries: 'id', overrides: 'key', tags: 'id', settings: 'key', history: 'id', checks: 'date', accounts: 'id', piggies: 'id', metas: 'id' };
  const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const KINDS = new Set(['income', 'expense', 'transfer', 'reserve', 'release']);
  const clean = {};
  for (const st of db.STORES) {
    const list = data.stores[st];
    if (list === undefined) { clean[st] = []; continue; }
    if (!Array.isArray(list)) { errors.push(`“${st}” está em formato inválido.`); continue; }
    const seen = new Set(); let dup = 0, bad = 0;
    clean[st] = [];
    for (const rec of list) {
      const k = rec && rec[KEY[st]];
      if (st !== 'history' && (k === undefined || k === null || k === '')) { bad++; continue; }
      if (st === 'entries' && (!KINDS.has(rec.kind) || !rec.rule || !isDate(rec.rule.start) || !Number.isFinite(rec.amount) || rec.amount < 0)) { bad++; continue; }
      if (st === 'checks' && !isDate(rec.date)) { bad++; continue; }
      if (st !== 'history' && seen.has(k)) { dup++; continue; }
      if (st !== 'history') seen.add(k);
      clean[st].push(rec);
    }
    if (dup) notes.push(`${dup} registro(s) duplicado(s) em ${st} foram ignorados.`);
    if (bad) notes.push(`${bad} registro(s) inválido(s) em ${st} foram ignorados.`);
  }
  if (errors.length) return { ok: false, errors };
  // referências: ajustes de ocorrência precisam de um lançamento existente
  const ids = new Set(clean.entries.map(e => e.id));
  const orphan = clean.overrides.filter(o => !ids.has(o.entryId)).length;
  if (orphan) { clean.overrides = clean.overrides.filter(o => ids.has(o.entryId)); notes.push(`${orphan} ajuste(s) sem lançamento foram ignorados.`); }
  // referências entre registros: contas, tags, cofrinhos, metas, regras de distribuição e transferências
  const accIds = new Set(clean.accounts.map(a => a.id));
  const tagIds = new Set(clean.tags.map(t => t.id));
  const pigIds = new Set(clean.piggies.map(p => p.id));
  const warn = (n, txt) => { if (n) notes.push(`${n} ${txt}`); };
  let n = 0;
  if (clean.accounts.length) {
    n = clean.entries.filter(e => e.accountId && !accIds.has(e.accountId)).length;
    warn(n, 'lançamento(s) com conta inexistente: irão para a conta principal.');
    const badTr = clean.entries.filter(e => e.kind === 'transfer' && (!e.toAccountId || !accIds.has(e.toAccountId) || e.toAccountId === e.accountId));
    warn(badTr.length, 'transferência(s) com conta de destino inválida foram ignoradas.');
    if (badTr.length) { const bad = new Set(badTr.map(e => e.id)); clean.entries = clean.entries.filter(e => !bad.has(e.id)); clean.overrides = clean.overrides.filter(o => !bad.has(o.entryId)); }
  }
  n = 0; for (const e of clean.entries) if (e.tagId && !tagIds.has(e.tagId)) { e.tagId = null; n++; }
  warn(n, 'lançamento(s) com tag inexistente ficaram sem tag.');
  n = 0; for (const e of clean.entries) if (e.piggyId && !pigIds.has(e.piggyId) && (e.kind === 'reserve' || e.kind === 'release')) n++;
  warn(n, 'movimento(s) de cofrinho apontam para cofrinho inexistente.');
  n = clean.piggies.filter(p => p.accountId && clean.accounts.length && !accIds.has(p.accountId)).length;
  warn(n, 'cofrinho(s) ligados a conta inexistente.');
  n = 0;
  for (const m of clean.metas) {
    const t0 = (m.tagIds || []).length, a0 = (m.accountIds || []).length;
    m.tagIds = (m.tagIds || []).filter(id => tagIds.has(id));
    if (clean.accounts.length) m.accountIds = (m.accountIds || []).filter(id => accIds.has(id));
    if (m.tagIds.length !== t0 || (m.accountIds || []).length !== a0) n++;
  }
  warn(n, 'meta(s) tinham tags ou contas inexistentes (vínculos removidos).');
  n = 0;
  for (const a of clean.accounts) for (const r of a.rules || []) {
    const before = (r.steps || []).length;
    r.steps = (r.steps || []).filter(st => { const [k, id] = String(st.target || '').split(':'); return k === 'piggy' ? pigIds.has(id) : k === 'account' ? accIds.has(id) : false; });
    n += before - r.steps.length;
  }
  warn(n, 'passo(s) de regras de distribuição apontavam para destino inexistente e foram removidos.');
  if (!clean.entries.length && !clean.accounts.length && !clean.metas.length) return { ok: false, errors: ['O arquivo não contém dados.'] };
  return { ok: true, stores: clean, notes, demo: !!data.demo, exportedAt: data.exportedAt };
}

export async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { C.toast('Arquivo inválido ou corrompido'); return; }
  const v = validateBackup(data);
  if (!v.ok) { await C.dialog({ title: 'Backup não pode ser usado', html: `<p>${v.errors.map(C.esc).join('<br>')}</p><p class="small">Nada foi alterado.</p>`, actions: [{ label: 'Ok', value: null, cls: 'primary' }] }); return; }
  const n = k => v.stores[k].length;
  const hasMine = S().entries.size > 0 || [...S().accounts.values()].some(a => a.initialBalance) || S().metas.size > 0;
  const ok = await C.confirmDlg(v.demo ? 'Importar dados de demonstração?' : 'Restaurar backup?',
    `${v.demo ? '<b>Arquivo de DEMONSTRAÇÃO.</b><br>' : `Backup de ${C.dmy(String(v.exportedAt || '').slice(0, 10) || C.today())}.<br>`}
     ${n('entries')} lançamentos · ${n('accounts')} contas · ${n('metas')} metas · ${n('piggies')} cofrinhos · ${n('tags')} tags
     ${v.notes.length ? `<br><br><b>Atenção — problemas encontrados e corrigidos na importação:</b><br><span class="small">${v.notes.map(C.esc).join('<br>')}</span>` : '<br><span class="small">Arquivo verificado: nenhuma referência inválida.</span>'}
     <br><br>Os dados atuais deste aparelho serão <b>substituídos</b>.${hasMine ? ' Antes disso, uma cópia de segurança deles será baixada automaticamente.' : ''}`,
    'Substituir', 'danger');
  if (!ok) return;
  if (hasMine) {
    // cópia de segurança automática: os dados pessoais nunca são perdidos sem uma cópia
    download(await snapshot(), `financas-antes-de-restaurar-${C.today()}.json`);
  }
  const conn = await db.openDB();
  try {
    await new Promise((resolve, reject) => {
      const t = conn.transaction(db.STORES, 'readwrite');
      for (const st of db.STORES) {
        const os = t.objectStore(st);
        os.clear();
        for (const rec of v.stores[st]) os.put(rec);
      }
      os_log(t);
      t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
    });
  } catch (err) {
    C.toast('Falha ao restaurar: nada foi alterado');
    return;
  }
  C.toast(v.demo ? 'Demonstração importada' : 'Backup restaurado');
  setTimeout(() => location.reload(), 900);
}
function os_log(t) {
  t.objectStore('history').put({ at: new Date().toISOString(), action: 'Backup restaurado', payload: {} });
}
