// Telas de gestão abertas pelo menu: contas, cofrinhos, metas, relatórios, histórico e alertas,
// além dos painéis recolhíveis da tela inicial e do backup/restauração.
// Tudo fica numa única folha (#pageSheet) com navegação interna, para não multiplicar telas.
import { itemsInRange, occKey, counts, realizedOf } from './engine.js';
import { addDays, parse, iso, daysInMonth, addMonths, MONTHS } from './dates.js';
import * as db from './db.js';

let C;            // contexto compartilhado do app (estado, formatação, diálogos, gravação)
let el;           // a folha das páginas
const stack = []; // pilha de telas dentro da folha

const ACC_TYPES = {
  checking: 'Conta corrente', savings: 'Poupança', digital: 'Carteira digital', cash: 'Dinheiro em espécie',
  payment: 'Conta de pagamento', investment: 'Investimento', piggy: 'Cofrinho (conta separada)',
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
  if (e.type === 'change' && (type === 'select' || type === 'switch')) render();
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
    if (f.hint) { closeG(); html += `<p class="hint">${f.hint}</p>`; continue; }
    const v = vals[f.k];
    const L = esc(f.label);
    openG();
    switch (f.type) {
      case 'money': html += `<label class="row field"><span>${L}</span><input data-k="${f.k}" data-type="money" type="text" inputmode="decimal" placeholder="0,00" value="${v ? moneyInput(v) : ''}"></label>`; break;
      case 'number': html += `<label class="row field"><span>${L}</span><input data-k="${f.k}" data-type="number" type="number" inputmode="numeric" value="${v ?? ''}" ${f.min != null ? `min="${f.min}"` : ''}></label>`; break;
      case 'date': html += `<label class="row field"><span>${L}</span><input data-k="${f.k}" type="date" value="${v || ''}"></label>`; break;
      case 'select': html += `<label class="row field"><span>${L}</span><select data-k="${f.k}" data-type="select">${f.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v ?? '') ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select></label>`; break;
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

function formView({ title, fields, value, onSave, onDelete, deleteLabel = 'Excluir', extra }) {
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
    actions: { del: async () => { if (await onDelete(view.vals)) { stack.pop(); back(); } } },
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
async function saveStore(store, map, obj, what) {
  const before = S()[map].get(obj.id) || null;
  await db.put(store, obj); S()[map].set(obj.id, obj);
  db.log(what || `${STORE_LABEL[store]} ${before ? 'alterada' : 'criada'}: ${obj.name}`.replace('Cofrinho alterada', 'Cofrinho alterado').replace('Cofrinho criada', 'Cofrinho criado'), { before, after: obj });
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
        <div class="btn-row"><button class="primary-btn ghost" data-a="tr">Transferir</button><button class="primary-btn ghost" data-a="add">Lançamento</button></div>
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

// ------------------------------------------------------------------ COFRINHOS
function piggiesView() {
  return {
    title: 'Cofrinhos', right: { icon: 'plus', fn: () => push(piggyForm()) },
    body: () => {
      const b = bal(), { money, esc } = C;
      const list = [...S().piggies.values()].filter(p => !p.archived);
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

function piggyDetail(id) {
  return {
    get title() { return (S().piggies.get(id) || {}).name || 'Cofrinho'; },
    get sub() { const p = S().piggies.get(id); return p ? (p.type === 'real' ? 'Conta separada' : `Virtual · em ${C.esc(C.accName(p.accountId))}`) : ''; },
    right: { label: 'Editar', fn: () => push(piggyForm(S().piggies.get(id))) },
    body: () => {
      const p = S().piggies.get(id); if (!p) return '';
      const b = bal(), saved = (b.piggies.get(id) || {}).saved || 0, { money, dmy } = C;
      let plan = '';
      if (p.goal && p.deadline && saved < p.goal) {
        const months = Math.max(1, (parse(p.deadline).y - parse(C.today()).y) * 12 + parse(p.deadline).m - parse(C.today()).m);
        plan = stat('Para chegar no prazo', `${money(Math.ceil((p.goal - saved) / months))}/mês`);
      }
      const t = C.today();
      const moves = itemsFor(it => it.piggyId === id || (p.type === 'real' && (it.accountId === p.accountId || it.toAccountId === p.accountId)), addDays(t, -365), addDays(t, 60));
      return `<div class="stats">
          ${stat('Guardado', money(saved), '', true)}
          ${p.goal ? stat('Meta', money(p.goal)) + stat('Falta', money(Math.max(0, p.goal - saved))) : ''}
          ${p.deadline ? stat('Prazo', dmy(p.deadline)) : ''}${plan}
        </div>
        ${p.goal ? progress(saved / p.goal, p.color) : ''}
        <div class="btn-row"><button class="primary-btn" data-a="in">Guardar</button><button class="primary-btn ghost" data-a="out" ${saved > 0 ? '' : 'disabled'}>Retirar</button></div>
        <div class="section-label"><span>MOVIMENTAÇÕES</span></div>
        ${moves.map(it => movementRow(it, p.accountId)).join('') || '<p class="hint">Nada guardado ainda.</p>'}`;
    },
    actions: { in: () => piggyMove(id, 'in'), out: () => piggyMove(id, 'out'), goDay },
  };
}

async function piggyMove(id, dir) {
  const p = S().piggies.get(id);
  const b = bal(), saved = (b.piggies.get(id) || {}).saved || 0;
  const { money, esc, today } = C;
  const accs = C.accountsList().filter(a => a.id !== p.accountId);
  const real = p.type === 'real';
  const res = await C.dialog({
    title: dir === 'in' ? `Guardar em ${p.name}` : `Retirar de ${p.name}`,
    html: `<input type="text" inputmode="decimal" id="pmAmount" placeholder="0,00">
      ${real ? `<select id="pmAcc">${accs.map(a => `<option value="${a.id}">${dir === 'in' ? 'De' : 'Para'} ${esc(a.name)} (${money((b.accounts.get(a.id) || {}).real || 0)})</option>`).join('')}</select>` : `<p class="small">${dir === 'in' ? `Livre em ${esc(C.accName(p.accountId))}: ${money(((b.accounts.get(p.accountId) || {}).real || 0) - ((b.accounts.get(p.accountId) || {}).reserved || 0))}` : `Guardado: ${money(saved)}`}</p>`}
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
  const value = p ? { ...p } : { name: '', type: 'virtual', accountId: S().settings.defaultAccount, goal: 0, deadline: '', color: C.PALETTE[(S().piggies.size * 5 + 3) % C.PALETTE.length] };
  return formView({
    title: p ? 'Editar cofrinho' : 'Novo cofrinho', value,
    fields: [
      { k: 'name', label: 'Nome', required: true, placeholder: 'Ex.: Emergência' },
      { k: 'type', label: 'Tipo', type: 'select', options: [['virtual', 'Virtual (reserva dentro da conta)'], ['real', 'Real (conta separada)']], show: () => !p },
      { k: 'accountId', label: 'Conta onde fica reservado', type: 'select', options: accOptions(), show: v => v.type !== 'real' },
      { k: 'goal', label: 'Valor desejado', type: 'money' },
      { k: 'deadline', label: 'Prazo', type: 'date' },
      { k: 'color', label: 'Cor', type: 'color' },
      { k: 'archived', label: 'Arquivar', type: 'switch', show: () => !!p },
    ],
    onSave: async v => {
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
  return {
    title: 'Metas e orçamentos', right: { icon: 'plus', fn: () => push(metaForm()) },
    body: () => {
      const list = [...S().metas.values()].filter(m => !m.archived);
      const bctx = C.budgetCtx();
      return list.map(m => metaCard(m, C.F.metaProgress(m, C.today(), bctx))).join('')
        || '<div class="empty">Nenhuma meta. Crie limites por dia, semana ou mês, agrupando tags.</div>';
    },
    actions: { open: id => push(metaDetail(id)) },
  };
}
function metaCard(m, p) {
  const { money, esc } = C;
  const inc = m.kind === 'income';
  if (!p.limit) {
    return `<button class="card-row col" data-a="open" data-id="${m.id}">
      <span class="line"><span class="dot" style="background:${m.color}"></span><span class="grow t">${esc(m.name)}</span><span class="v">${money(p.real)}</span></span>
      <span class="s">${inc ? 'recebido' : 'pago'} · previsto ${money(p.planned)} · sem limite definido</span>
    </button>`;
  }
  const label = `${money(p.real)} de ${money(p.limit)}`;
  const sub = inc ? (p.real >= p.limit ? 'Meta atingida' : `Faltam ${money(p.limit - p.real)}`)
    : p.over ? `Excedeu ${money(p.over)}` : `Restam ${money(p.remaining)}`;
  return `<button class="card-row col" data-a="open" data-id="${m.id}">
    <span class="line"><span class="dot" style="background:${m.color}"></span><span class="grow t">${esc(m.name)}</span><span class="v">${Math.round(p.pct * 100)}%</span></span>
    ${progress(p.pct, m.color, !inc && p.over > 0)}
    <span class="s">${label} · ${sub} · ${C.F.PERIODS[m.period].toLowerCase()}</span>
  </button>`;
}

function metaDetail(id) {
  let ref = C.today();
  const view = {
    get title() { return (S().metas.get(id) || {}).name || 'Meta'; },
    right: { label: 'Editar', fn: () => push(metaForm(S().metas.get(id))) },
    body: () => {
      const m = S().metas.get(id); if (!m) return '';
      const { money, dm, dmy, esc } = C;
      const bctx = C.budgetCtx();
      const p = C.F.metaProgress(m, ref, bctx);
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

function metaForm(m = null) {
  const value = m ? { ...m, tagIds: [...(m.tagIds || [])], accountIds: [...(m.accountIds || [])], originsTxt: (m.origins || []).join(', ') }
    : { name: '', kind: 'expense', period: 'month', amount: 0, tagIds: [], accountIds: [], originsTxt: '', rollover: 'none', carryExcess: false, showOnCalendar: false, color: C.PALETTE[(S().metas.size * 5 + 8) % C.PALETTE.length], colorGood: '#45cf7f', colorBad: '#ff5f57', tintTags: true, alertPct: 80 };
  const daily = v => C.F.DAY_PERIODS.has(v.period);
  return formView({
    title: m ? 'Editar meta' : 'Nova meta', value,
    fields: [
      { k: 'name', label: 'Nome', required: true, placeholder: 'Ex.: Alimentação' },
      { k: 'kind', label: 'Tipo', type: 'select', options: [['expense', 'Limite de gastos'], ['income', 'Meta de receita']] },
      { k: 'period', label: 'Período', type: 'select', options: Object.entries(C.F.PERIODS) },
      { k: 'from', label: 'De', type: 'date', show: v => v.period === 'custom' },
      { k: 'to', label: 'Até', type: 'date', show: v => v.period === 'custom' },
      { k: 'amount', label: 'Limite / valor', type: 'money' },
      { hint: 'Pode deixar em branco e definir depois: a meta já acompanha o que foi gasto.', show: v => !v.amount },
      { k: 'color', label: 'Cor', type: 'color' },
      { k: 'tintTags', label: 'Tags usam tons da cor da meta', type: 'switch' },
      { section: 'O que entra na meta' },
      { k: 'tagIds', label: 'Tags (nenhuma = todas)', type: 'multi', options: () => tagOptions(null)() },
      { k: 'accountIds', label: 'Contas (nenhuma = todas)', type: 'multi', options: accOptions, show: () => C.accountsList().length > 1 },
      { k: 'originsTxt', label: 'Origens', placeholder: 'Ex.: iFood, Salário CLT', show: v => v.kind === 'income' },
      { section: 'Sobras e excedentes', show: v => daily(v) && v.kind !== 'income' },
      { k: 'rollover', label: 'Valor não usado', type: 'select', options: Object.entries(ROLLOVER), show: v => daily(v) && v.kind !== 'income' },
      { k: 'carryExcess', label: 'Excedente desconta dos próximos dias', type: 'switch', show: v => daily(v) && v.kind !== 'income' && (v.rollover === 'week' || v.rollover === 'month') },
      { k: 'showOnCalendar', label: 'Colorir os dias no calendário', type: 'switch', show: v => daily(v) && v.kind !== 'income' },
      { k: 'colorGood', label: 'Cor do dia dentro do orçamento', type: 'color', show: v => daily(v) && v.showOnCalendar },
      { k: 'colorBad', label: 'Cor do dia acima do orçamento', type: 'color', show: v => daily(v) && v.showOnCalendar },
      { hint: 'A cor do orçamento aparece como uma pequena barra sob o número do dia, separada do saldo.', show: v => daily(v) && v.showOnCalendar },
      { section: 'Alerta', show: v => v.kind !== 'income' },
      { k: 'alertPct', label: 'Avisar ao atingir (%)', type: 'number', min: 1, show: v => v.kind !== 'income' },
      { section: '' },
      { k: 'archived', label: 'Arquivar', type: 'switch', show: () => !!m },
    ],
    onSave: async v => {
      const { originsTxt, ...rest } = v;
      const obj = { ...(m || { id: C.uid(), createdAt: C.nowISO() }), ...rest, origins: originsTxt.split(',').map(s => s.trim()).filter(Boolean) };
      if (!daily(obj) || obj.kind === 'income' || !obj.amount) obj.showOnCalendar = false;
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
      // metas mensais cumpridas no período
      const metas = [...S().metas.values()].filter(x => !x.archived && x.kind !== 'income');
      const met = metas.map(x => C.F.metaProgress(x, mode === 'month' ? ref : iso(y, 12, 31), C.budgetCtx())).filter(p => p.limit);
      return `<div class="segmented seg-sm"><button class="${mode === 'month' ? 'on' : ''}" data-a="mode" data-id="month">Mês</button><button class="${mode === 'year' ? 'on' : ''}" data-a="mode" data-id="year">Ano</button></div>
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
        ${met.length ? `<div class="section-label"><span>METAS</span><span>${met.filter(p => p.real <= p.limit).length} de ${met.length} dentro do limite</span></div>${metas.map((x, i) => met[i] ? metaCard(x, met[i]) : '').join('')}` : ''}
        <div class="section-label"><span>GASTOS REALIZADOS POR TAG</span></div>
        ${byTag.map(([tid, v]) => { const t = C.tag(tid); return `<div class="tagbar"><span class="grow">${esc(t ? t.name : 'Sem tag')}</span><span>${money(v)}</span>${progress(v / tagMax, t ? C.tagColor(t) : 'var(--text-3)')}</div>`; }).join('') || '<p class="hint">Nenhum gasto pago neste período.</p>'}`;
    },
    actions: {
      mode: id => { mode = id; render(); },
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
        html += `<div class="hist"><span>${esc(label)}${n > 1 ? ` <span class="muted small">(${n} registros)</span>` : ''}</span><span>${local ? local.toTimeString().slice(0, 5) : ''}</span></div>`;
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

const VIEWS = { accounts: accountsView, piggies: piggiesView, metas: metasView, reports: reportsView, history: historyView, alerts: alertsView };

// ------------------------------------------------------------------ PAINÉIS DA TELA INICIAL
const openPanels = new Set();
export function renderPanels(box) {
  if (!C) return;
  const on = S().settings.panels || {};
  const keys = ['accounts', 'metas', 'pending', 'upcoming', 'piggies'].filter(k => on[k]);
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
      const ms = [...S().metas.values()].filter(m => !m.archived);
      const ps = ms.map(m => [m, C.F.metaProgress(m, t, C.budgetCtx())]);
      const over = ps.filter(([m, p]) => m.kind !== 'income' && p.over > 0).length;
      return { label: 'Metas', value: ms.length ? (over ? `${over} acima do limite` : 'Dentro do limite') : 'Nenhuma', cls: over ? 'neg' : '',
        body: ps.map(([m, p]) => metaCard(m, p).replace('data-a="open"', 'data-a="meta"')).join('') };
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
      const list = [...S().piggies.values()].filter(p => !p.archived);
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
  const accIds = new Set(clean.accounts.map(a => a.id));
  const noAcc = clean.entries.filter(e => (e.accountId && !accIds.has(e.accountId)) || (e.toAccountId && !accIds.has(e.toAccountId))).length;
  if (noAcc && clean.accounts.length) notes.push(`${noAcc} lançamento(s) apontam para contas que não estão no arquivo; irão para a conta principal.`);
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
     ${v.notes.length ? `<br><span class="small">${v.notes.map(C.esc).join('<br>')}</span>` : ''}
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
