// Calendário Financeiro — interface (Etapa 2)
import * as db from './db.js';
import { createCalculator, RULES, attrsAt, occKey } from './engine.js';
import { makeHolidayLookup, LOCALES } from './holidays.js';
import * as ops from './ops.js';
import * as F from './finance.js';
import * as pages from './pages.js';
import { icon, hydrateIcons } from './icons.js';
import { iso, parse, addMonths, todayISO, weekday, addDays, daysInMonth, MONTHS, WEEKDAYS_SHORT, WEEKDAYS_LONG } from './dates.js';

export const APP_VERSION = '1.0.0';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const nowISO = () => new Date().toISOString();
const dm = d => `${d.slice(8)}/${d.slice(5, 7)}`;
const dmy = d => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const cap = s => s[0].toUpperCase() + s.slice(1);

// ---------- Dinheiro (centavos inteiros) ----------
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const DEC1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const money = c => BRL.format(c / 100);
const signed = c => (c > 0 ? '+' : c < 0 ? '−' : '') + BRL.format(Math.abs(c) / 100);
function compact(c) {
  const v = Math.abs(c) / 100, s = c > 0 ? '+' : c < 0 ? '−' : '';
  if (v >= 1e6) return s + DEC1.format(v / 1e6) + 'M';
  if (v >= 1e5) return s + DEC1.format(v / 1e3) + 'k';
  return s + INT.format(v);
}
export function parseMoney(str) {
  let s = String(str || '').replace(/[R$\s]/g, '').replace('−', '-');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
const moneyInput = c => (c ? (c / 100).toFixed(2).replace('.', ',') : '');
const sgnCls = v => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted');

// ---------- Estado ----------
const DEFAULTS = {
  showIncome: true, showExpense: true, showTags: true, hiddenTags: [], showMovement: false,
  showTransfers: true, hiddenAccounts: [], defaultAccount: null, panels: {}, alerts: {}, lastBackup: null,
  basis: 'planned', carry: false, initialBalance: 0, startDate: null,
  mondayFirst: false, holState: '', holCity: '', holOptional: false, customHolidays: [],
  summaryOpen: false,
};
const S = {
  entries: new Map(), overrides: new Map(), checks: new Map(), tags: new Map(),
  accounts: new Map(), piggies: new Map(), metas: new Map(), bal: null, alerts: [], set: null,
  settings: { ...DEFAULTS }, view: null, selected: null, calc: null, isHoliday: null, month: null, data: null,
  selecting: false, picked: new Set(), lastPicked: null, checking: null,
};
const today = () => todayISO();
const tag = id => (id ? S.tags.get(id) : null);
const accountsList = (all = false) => [...S.accounts.values()].filter(a => all || !a.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const accName = id => (S.accounts.get(id) || {}).name || 'Conta';
const multiAcc = () => accountsList().length > 1;
/** Contas que entram no calendário: incluídas no consolidado, não arquivadas e não ocultas no filtro. */
function visibleAccounts() {
  const hidden = new Set(S.settings.hiddenAccounts);
  return new Set(accountsList().filter(a => a.includeInTotal !== false && !hidden.has(a.id)).map(a => a.id));
}
/** Cor de exibição da tag: variação da cor da meta, quando a meta pede isso. */
function tagColor(t) {
  if (!t) return null;
  for (const m of S.metas.values()) {
    if (m.archived || !m.tintTags || !(m.tagIds || []).includes(t.id)) continue;
    const i = m.tagIds.indexOf(t.id);
    return shade(m.color || '#0a84ff', [0, 0.28, -0.22, 0.45, -0.38, 0.6][i % 6]);
  }
  return t.color;
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map(c => Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f)));
  return '#' + ch.map(c => c.toString(16).padStart(2, '0')).join('');
}
const tagsSorted = () => [...S.tags.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

function rebuild() {
  const s = S.settings;
  S.isHoliday = makeHolidayLookup({ state: s.holState, city: s.holCity, optional: s.holOptional, custom: s.customHolidays });
  S.data = { entries: [...S.entries.values()], overrides: S.overrides, isHoliday: S.isHoliday, defaultAccount: s.defaultAccount };
  S.set = visibleAccounts();
  const initial = [...S.set].reduce((t, id) => t + ((S.accounts.get(id) || {}).initialBalance || 0), 0);
  S.calc = createCalculator(S.data, { carry: s.carry, initialBalance: initial, startDate: s.startDate || iso(S.view.y, S.view.m, 1), accounts: S.set });
}

let saveTimer;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => db.put('settings', { key: 'app', value: S.settings }), 150);
}

// ---------- Gravação com desfazer ----------
const undoStack = [];
const STORE_OF = { entries: 'entries', overrides: 'overrides', checks: 'checks' };

async function commit(label, ch, { silent = false } = {}) {
  if (!ops.changeCount(ch)) return false;
  const inverse = ops.newChanges();
  for (const k of Object.keys(STORE_OF)) for (const [id] of ch[k]) inverse[k].set(id, S[k].get(id) ?? null);
  await applyChanges(ch);
  undoStack.push({ label, inverse });
  if (undoStack.length > 30) undoStack.shift();
  db.log(label, { entries: [...ch.entries], overrides: [...ch.overrides], checks: [...ch.checks] });
  refresh();
  if (!silent) toast(label, undoLast);
  return true;
}
async function applyChanges(ch) {
  await db.applyBatch(ch);
  for (const k of Object.keys(STORE_OF)) for (const [id, v] of ch[k]) v ? S[k].set(id, v) : S[k].delete(id);
}
async function undoLast() {
  const u = undoStack.pop();
  if (!u) return;
  await applyChanges(u.inverse);
  db.log('undo', { label: u.label });
  refresh();
  toast('Alteração desfeita');
}

// ---------- Camadas + botão Voltar ----------
const layers = [];
let popResolvers = [];
function openLayer(el, onClose) {
  if (el.classList.contains('sheet')) {
    el.style.zIndex = 40 + layers.length * 2;
    el.classList.toggle('stack', layers.some(l => l.el.classList.contains('sheet')));
  }
  layers.push({ el, onClose });
  el.classList.add('on');
  el.setAttribute('aria-hidden', 'false');
  history.pushState({ l: layers.length }, '');
  updateScrim();
}
function closeTop() {
  if (!layers.length) return Promise.resolve();
  return new Promise(r => { popResolvers.push(r); history.back(); });
}
async function closeAll() { while (layers.length) await closeTop(); }
window.addEventListener('popstate', () => {
  const l = layers.pop();
  if (l) {
    l.el.classList.remove('on');
    l.el.setAttribute('aria-hidden', 'true');
    l.onClose && l.onClose();
    updateScrim();
  } else if (S.selecting) {
    exitSelect(true);
  }
  const rs = popResolvers; popResolvers = [];
  rs.forEach(r => r());
});
function updateScrim() { $('#scrim').classList.toggle('on', layers.some(l => l.el.id !== 'dialog')); }
const isOpen = el => layers.some(l => l.el === el);

function toast(msg, undo, label = 'Desfazer') {
  $('#toastMsg').textContent = msg;
  $('#toastUndo').hidden = !undo;
  $('#toastUndo').textContent = label;
  $('#toastUndo').onclick = () => { $('#toast').classList.remove('on'); undo && undo(); };
  $('#toast').classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $('#toast').classList.remove('on'), undo ? 5000 : 1800);
}

function dialog({ title, html = '', actions, onOpen }) {
  return new Promise(resolve => {
    $('#dlgTitle').textContent = title;
    $('#dlgBody').innerHTML = html;
    const box = $('#dlgActions');
    box.innerHTML = '';
    let result = null;
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = a.label;
      if (a.cls) b.className = a.cls;
      b.onclick = () => {
        if (a.validate && !a.validate()) return;
        result = typeof a.value === 'function' ? a.value() : a.value;
        closeTop();
      };
      box.appendChild(b);
    }
    openLayer($('#dialog'), () => resolve(result));
    onOpen && onOpen($('#dlgBody'));
  });
}
const confirmDlg = (title, text, label = 'Confirmar', cls = 'primary') =>
  dialog({ title, html: text ? `<p>${text}</p>` : '', actions: [{ label: 'Cancelar', value: false }, { label, value: true, cls }] });

// ---------- Calendário ----------
function renderHeader() {
  const { y, m } = S.view;
  $('#monthName').textContent = MONTHS[m - 1];
  $('#yearName').textContent = y;
  const order = S.settings.mondayFirst ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  $('#weekdays').innerHTML = order.map(w => `<div>${WEEKDAYS_SHORT[w]}</div>`).join('');
}

const countsPlanned = it => it.status === 'planned' || it.status === 'paid' || it.status === 'pending' || it.status === 'partial';
const budgetCtx = () => ({ data: S.data, checks: S.checks, today: today(), isHoliday: S.isHoliday, mondayFirst: S.settings.mondayFirst });
const calendarMeta = () => [...S.metas.values()].find(m => !m.archived && m.showOnCalendar && F.DAY_PERIODS.has(m.period)) || null;
function cellValue(day) {
  const s = S.settings, real = s.basis === 'realized';
  if (s.showIncome && s.showExpense) return real ? day.cumNetReal : day.cumNet;
  if (s.showExpense) return -(real ? day.cumExpReal : day.cumExp);
  if (s.showIncome) return real ? day.cumIncReal : day.cumInc;
  return null;
}
function dayMovement(day) {
  const s = S.settings, real = s.basis === 'realized';
  let net = 0, any = false;
  for (const it of day.items) {
    if (real ? it.status !== 'paid' && it.status !== 'partial' : !countsPlanned(it)) continue;
    const amt = real ? (it.status === 'paid' ? it.amount : it.paidAmount || 0) : it.amount;
    if (it.kind === 'income' && s.showIncome && S.set.has(it.accountId)) { net += amt; any = true; }
    if (it.kind === 'expense' && s.showExpense && S.set.has(it.accountId)) { net -= amt; any = true; }
    if (it.kind === 'transfer' && s.showIncome && s.showExpense) {
      const d = (S.set.has(it.toAccountId) ? amt : 0) - (S.set.has(it.accountId) ? amt : 0);
      if (d) { net += d; any = true; }
    }
  }
  return any ? net : null;
}

function renderGrid(anim) {
  const { y, m } = S.view;
  const month = S.calc.computeMonth(y, m);
  S.month = month;
  const s = S.settings, t = today();
  const first = iso(y, m, 1);
  const lead = (weekday(first) - (s.mondayFirst ? 1 : 0) + 7) % 7;
  const total = Math.ceil((lead + month.days.length) / 7) * 7;
  const hidden = new Set(s.hiddenTags);
  const start = addDays(first, -lead);
  const cm = calendarMeta();
  const bud = cm ? F.dailyBudget(cm, first, iso(y, m, month.days.length), budgetCtx()) : null;
  let html = '';
  for (let i = 0; i < total; i++) {
    const date = addDays(start, i);
    const w = weekday(date);
    const inMonth = date.slice(0, 7) === first.slice(0, 7);
    let cls = 'cell';
    if (!inMonth) cls += ' out';
    if (w === 0 || w === 6) cls += ' wkend';
    if (S.isHoliday(date)) cls += ' hol';
    if (date === t) cls += ' today';
    if (S.selecting ? S.picked.has(date) : date === S.selected && isOpen($('#daySheet'))) cls += S.selecting ? ' picked' : ' sel';
    const n = +date.slice(8);
    if (!inMonth) { html += `<button class="${cls}" data-date="${date}"><span class="num">${n}</span></button>`; continue; }
    const day = month.days[n - 1];
    let inner = `<span class="num">${n}</span>`;
    if (day.items.some(it => it.status === 'pending')) inner += '<span class="flag"></span>';
    if (s.showTags) {
      const colors = new Map();
      for (const it of day.items) {
        if (!it.tagId || hidden.has(it.tagId) || !countsPlanned(it)) continue;
        if ((it.kind === 'income' && !s.showIncome) || (it.kind === 'expense' && !s.showExpense)) continue;
        for (const tid of it.splits ? it.splits.map(p => p.tagId) : [it.tagId]) {
          const tg = tag(tid);
          if (tg && !hidden.has(tg.id)) colors.set(tg.id, tagColor(tg));
        }
      }
      inner += `<span class="tags">${[...colors.values()].slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span>`;
    }
    const b = bud && bud.get(date);
    if (b) inner += `<span class="bud s-${b.status}" style="background:${b.status === 'over' ? cm.colorBad || 'var(--red)' : cm.colorGood || 'var(--green)'};--good:${cm.colorGood || 'var(--green)'}"></span>`;
    const mv = dayMovement(day);
    if (s.showMovement && mv !== null) inner += `<span class="mv">${compact(mv)}</span>`;
    const v = cellValue(day);
    if (v !== null) inner += `<span class="val ${v ? sgnCls(v) : 'zero'}${mv === null ? ' still' : ''}">${compact(v)}</span>`;
    html += `<button class="${cls}" data-date="${date}">${inner}</button>`;
  }
  const grid = $('#grid');
  grid.innerHTML = html;
  if (anim) { grid.classList.remove('anim-l', 'anim-r'); void grid.offsetWidth; grid.classList.add(anim); }
  renderSummary();
}

function renderSummary() {
  const mo = S.month, t = mo.totals, last = mo.days[mo.days.length - 1], s = S.settings;
  const real = s.basis === 'realized';
  const base = real ? 'realizado' : 'previsto';
  let label = 'Resumo do mês', val = null;
  if (s.showIncome && s.showExpense) { label = `Saldo ${base} no fim do mês`; val = real ? last.cumNetReal : last.cumNet; }
  else if (s.showExpense) { label = `Despesas ${real ? 'pagas' : 'previstas'} no mês`; val = -(real ? t.expPaid : t.exp); }
  else if (s.showIncome) { label = `Receitas ${real ? 'recebidas' : 'previstas'} no mês`; val = real ? t.incPaid : t.inc; }
  $('#summaryLabel').textContent = label;
  $('#summaryValue').textContent = val === null ? '' : signed(val);
  $('#summaryValue').className = val === null ? '' : sgnCls(val);
  const kv = (k, v, c = '') => `<span class="kv"><span>${k}</span><span class="${c}">${v}</span></span>`;
  $('#summaryBody').innerHTML = `<span>
    ${s.carry ? kv('Saldo inicial', signed(mo.opening.planned), sgnCls(mo.opening.planned)) : ''}
    ${kv('Receitas', `${money(t.incPaid)} de ${money(t.inc)}`, 'pos')}
    ${kv('Despesas', `${money(t.expPaid)} de ${money(t.exp)}`, 'neg')}
    ${kv('Saldo previsto', signed(t.inc - t.exp), sgnCls(t.inc - t.exp))}
    ${kv('Saldo realizado', signed(t.incPaid - t.expPaid), sgnCls(t.incPaid - t.expPaid))}
  </span>`;
  $('#summary').setAttribute('aria-expanded', String(!!s.summaryOpen));
}

function goMonth(delta) {
  S.view = addMonths(S.view.y, S.view.m, delta);
  renderHeader();
  renderGrid(delta > 0 ? 'anim-l' : 'anim-r');
  if (S.selecting) updateSelUI();
}
function goToday() {
  const t = parse(today());
  const delta = (t.y * 12 + t.m) - (S.view.y * 12 + S.view.m);
  if (delta) goMonth(delta);
}

function refresh() {
  rebuild();
  renderGrid();
  if (isOpen($('#daySheet')) && S.selected) renderDay(S.selected);
  if (isOpen($('#groupSheet'))) renderGroup();
  renderTagList();
  refreshDerived();
  pages.onChange();
}

/** Saldos, alertas e painéis (calculados após cada alteração). */
let derivedTimer;
function refreshDerived() {
  clearTimeout(derivedTimer);
  derivedTimer = setTimeout(() => {
    const t = today();
    const { y, m } = parse(t);
    S.bal = F.balances({ data: S.data, accounts: accountsList(true), piggies: [...S.piggies.values()], today: t, planUpto: iso(y, m, daysInMonth(y, m)) });
    S.alerts = F.computeAlerts({
      data: S.data, metas: [...S.metas.values()], checks: S.checks, today: t, isHoliday: S.isHoliday, mondayFirst: S.settings.mondayFirst,
      enabled: S.settings.alerts, set: S.set, startBalance: [...S.set].reduce((a, id) => a + ((S.bal.accounts.get(id) || {}).real || 0), 0),
      lastBackup: S.settings.lastBackup, hasData: S.entries.size > 0,
    });
    const bell = $('#btnAlerts');
    bell.hidden = !S.alerts.length;
    bell.classList.toggle('bad', S.alerts.some(a => a.level === 'bad'));
    $('#navBalance').textContent = S.accounts.size ? signed(S.bal.totals.total) : '';
    pages.renderPanels($('#panels'));
  }, 30);
}

function dayData(date) {
  const { y, m } = parse(date);
  const mo = S.month && S.month.y === y && S.month.m === m ? S.month : S.calc.computeMonth(y, m);
  return mo.days[+date.slice(8) - 1];
}
const findItem = (key, date) => dayData(date).items.find(i => i.key === key && i.status !== 'moved') || dayData(date).items.find(i => i.key === key);

// ---------- Detalhes do dia ----------
const STATUS = { planned: 'Previsto', paid: 'Pago', pending: 'Pendente', moved: 'Adiado', cancelled: 'Cancelado', partial: 'Parcial' };
function statusLabel(it) {
  if (it.kind === 'reserve') return { paid: 'Guardado', planned: 'A guardar' }[it.status] || STATUS[it.status];
  if (it.kind === 'release') return { paid: 'Retirado', planned: 'A retirar' }[it.status] || STATUS[it.status];
  if (it.kind === 'transfer') return { paid: 'Concluída', planned: 'Agendada', pending: 'Pendente', partial: 'Parcial' }[it.status] || STATUS[it.status];
  if (it.status === 'paid' && it.kind === 'income') return 'Recebido';
  if (it.status === 'partial') return `${it.kind === 'income' ? 'Recebido' : 'Pago'} ${money(it.paidAmount || 0)}`;
  return STATUS[it.status];
}
const KIND_NAME = { income: 'Receita', expense: 'Despesa', transfer: 'Transferência', reserve: 'Guardado no cofrinho', release: 'Retirado do cofrinho' };
function itemTitle(it) {
  if (it.title) return it.title;
  if (tag(it.tagId)) return tag(it.tagId).name;
  if (it.kind === 'reserve') return 'Guardado';
  if (it.kind === 'release') return 'Retirado';
  return KIND_NAME[it.kind];
}
function itemColor(it) {
  if (it.kind === 'transfer' || it.kind === 'reserve' || it.kind === 'release') return 'var(--accent)';
  const t = tag(it.tagId);
  return t ? tagColor(t) : it.kind === 'income' ? 'var(--green)' : 'var(--red)';
}
const isInternal = it => it.kind === 'transfer' || it.kind === 'reserve' || it.kind === 'release';
function itemSign(it) {
  if (it.kind === 'income') return '+';
  if (it.kind === 'expense') return '−';
  if (it.kind === 'transfer') { const i = S.set.has(it.toAccountId), o = S.set.has(it.accountId); return i && !o ? '+' : o && !i ? '−' : ''; }
  return '';
}
const amtCls = it => { const sg = itemSign(it); return sg === '+' ? 'pos' : sg === '−' ? 'neg' : 'muted'; };

function itemRow(it, { quick = false } = {}) {
  const dim = it.status === 'cancelled' || it.status === 'moved';
  const tg = tag(it.tagId);
  const parts = [];
  if (it.kind === 'transfer') parts.push(`${esc(accName(it.accountId))} → ${esc(accName(it.toAccountId))}`);
  else if (it.kind === 'reserve' || it.kind === 'release') parts.push(`${it.kind === 'reserve' ? 'para' : 'de'} ${esc((S.piggies.get(it.piggyId) || {}).name || 'cofrinho')}`);
  else if (multiAcc()) parts.push(esc(accName(it.accountId)));
  if (it.splits) parts.push(`dividido em ${it.splits.length}`);
  else if (tg && tg.name !== it.title) parts.push(esc(tg.name));
  if (it.status === 'moved') parts.push(`para ${dm(it.movedTo)}`);
  else if (it.moved) parts.push(`de ${dm(it.baseDate)}`);
  if (it.status !== 'planned') parts.push(`<span class="st st-${it.status}">${statusLabel(it)}</span>`);
  else if (it.recurring) parts.push('Recorrente');
  const edited = it.amount !== it.plannedAmount && !dim ? `<small>${money(it.plannedAmount)}</small>` : '';
  const right = quick && (it.status === 'planned' || it.status === 'pending')
    ? `<span class="quick"><button type="button" data-q="cancelled" aria-label="Não aconteceu">${icon('close')}</button><button type="button" class="ok" data-q="paid" aria-label="Confirmar">${icon('check')}</button></span>`
    : `<span class="amt ${amtCls(it)}">${edited}${itemSign(it)}${money(it.amount)}</span>`;
  return `<div class="item${dim ? ' dim' : ''}" role="button" data-key="${esc(it.key)}" data-date="${it.date}">
    <span class="bar" style="background:${itemColor(it)}"></span>
    <span class="main"><span class="t">${esc(itemTitle(it))}</span><span class="s">${right.includes('quick') ? `${money(it.amount)}${parts.length ? ' · ' : ''}` : ''}${parts.join(' · ')}</span></span>
    ${right}
  </div>`;
}

function renderDay(date) {
  const d = dayData(date);
  const w = weekday(date);
  const t = today();
  const hol = S.isHoliday(date);
  const check = S.checks.get(date);
  $('#dayTitle').textContent = `${cap(WEEKDAYS_LONG[w])}, ${+date.slice(8)} de ${MONTHS[+date.slice(5, 7) - 1].toLowerCase()}`;
  const sub = hol || (w === 0 || w === 6 ? 'Fim de semana' : 'Dia útil');
  $('#daySub').innerHTML = esc(sub) + (check ? ` · <span class="checked-note">${icon('check')}Conferido${check.noExpenses ? ' sem gastos' : ''}</span>` : '');

  const checking = S.checking === date;
  const inc = d.items.filter(i => i.kind === 'income');
  const exp = d.items.filter(i => i.kind === 'expense');
  const internal = S.settings.showTransfers ? d.items.filter(isInternal) : [];
  let html = `<div class="balance">
    <div><small>Acumulado previsto</small><b class="${sgnCls(d.cumNet)}">${signed(d.cumNet)}</b></div>
    <div><small>Realizado</small><b class="${sgnCls(d.cumNetReal)}">${signed(d.cumNetReal)}</b></div>
  </div>`;
  if (!d.items.filter(i => !isInternal(i) || S.settings.showTransfers).length) html += `<div class="empty">${checking ? 'Nenhum lançamento previsto. Adicione um gasto ou conclua como dia sem gastos.' : 'Nenhum lançamento.'}</div>`;
  if (inc.length) html += `<div class="section-label"><span>RECEITAS</span><span>${money(d.inc)}</span></div>${inc.map(i => itemRow(i, { quick: checking })).join('')}`;
  if (exp.length) html += `<div class="section-label"><span>DESPESAS</span><span>${money(d.exp)}</span></div>${exp.map(i => itemRow(i, { quick: checking })).join('')}`;
  if (internal.length) html += `<div class="section-label"><span>ENTRE CONTAS E COFRINHOS</span></div>${internal.map(i => itemRow(i)).join('')}`;
  const cm = calendarMeta();
  const b = cm && F.dailyBudget(cm, date, date, budgetCtx()).get(date);
  if (b) {
    const txt = { saved: `economia de ${money(b.avail - b.spent)}`, ok: 'no limite', over: `excedeu ${money(b.spent - b.avail)}`, zero: 'conferido sem gastos', pending: 'aguardando conferência', open: `disponível ${money(Math.max(0, b.avail - b.spent))}`, future: `disponível ${money(b.avail)}` }[b.status];
    const col = b.status === 'over' ? cm.colorBad || 'var(--red)' : ['saved', 'ok', 'zero'].includes(b.status) ? cm.colorGood || 'var(--green)' : 'var(--text-3)';
    html = `<div class="budget-line"><span class="pill" style="background:${col}"></span><span>${esc(cm.name)}: ${money(b.spent)} de ${money(b.avail)} · ${txt}</span></div>` + html;
  }
  $('#dayBody').innerHTML = html;

  const foot = $('#dayFoot');
  if (checking) {
    foot.innerHTML = '<button class="primary-btn ghost" id="btnCheckAdd">Gasto não previsto</button><button class="primary-btn" id="btnCheckDone">Concluir</button>';
  } else if (date <= t && !check) {
    foot.innerHTML = '<button class="primary-btn ghost" id="btnCheck">Conferir dia</button>';
  } else foot.innerHTML = '';
}

function openDay(date) {
  S.selected = date;
  if (S.checking && S.checking !== date) S.checking = null;
  renderDay(date);
  if (!isOpen($('#daySheet'))) openLayer($('#daySheet'), () => { S.checking = null; renderGrid(); });
  renderGrid();
}

// ---------- Ações de um lançamento ----------
const ACT = (id, label, ic, cls = '') => `<button class="act ${cls}" data-act="${id}"><span class="ic">${icon(ic)}</span>${label}</button>`;

function openActions(key, date) {
  const it = findItem(key, date);
  if (!it) return;
  const e = S.entries.get(it.entryId);
  const isInc = it.kind === 'income';
  const tg = tag(it.tagId);
  const where = it.kind === 'transfer' ? `${esc(accName(it.accountId))} → ${esc(accName(it.toAccountId))}`
    : it.kind === 'income' ? `Entra em ${esc(accName(it.accountId))}${it.origin ? ` · origem ${esc(it.origin)}` : ''}`
    : it.kind === 'expense' ? `Sai de ${esc(accName(it.accountId))}` : esc(accName(it.accountId));
  const splits = it.splits ? it.splits.map(p => `${esc((tag(p.tagId) || {}).name || 'Sem tag')} ${money(p.amount)}`).join(' + ') : null;
  const sub = [where, splits || (tg && tg.name !== it.title ? esc(tg.name) : null), it.recurring ? RULES[e.rule.type] : null, statusLabel(it)].filter(Boolean).join(' · ');
  let acts = '';
  if (it.status === 'moved') {
    acts = ACT('unmove', 'Desfazer adiamento', 'undo') + ACT('goto', `Ver ${dm(it.movedTo)}`, 'calendar');
  } else if (it.status === 'cancelled') {
    acts = ACT('restore', 'Restaurar', 'restore', 'primary') + ACT('edit', 'Editar', 'edit');
  } else if (it.status === 'paid') {
    acts = ACT('unpay', 'Desfazer', 'undo') + ACT('edit', 'Editar', 'edit');
  } else if (it.kind === 'reserve' || it.kind === 'release') {
    acts = ACT('edit', 'Editar', 'edit');
  } else {
    const payLabel = it.kind === 'transfer' ? 'Concluir' : isInc ? 'Receber' : 'Pagar';
    acts = ACT('pay', payLabel, 'check', 'primary') + ACT('partial', 'Parte', 'money') + ACT('edit', 'Editar', 'edit') + ACT('move', 'Adiar', 'later');
    if (it.status === 'planned' && it.date <= today()) acts += ACT('pending', isInc ? 'Não recebi' : 'Não paguei', 'notpaid');
    acts += ACT('cancel', 'Cancelar', 'cancel', 'danger');
  }
  $('#actionBody').innerHTML = `<div class="act-head"><span class="bar" style="background:${itemColor(it)}"></span>
      <div class="grow"><div class="t">${esc(itemTitle(it))}</div><div class="s">${sub}</div></div>
      <div class="amt ${amtCls(it)}">${money(it.amount)}</div></div>
    <div class="actions-row">${acts}</div>`;
  $('#actionBody').onclick = async ev => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    await closeTop();
    runAction(b.dataset.act, it);
  };
  openLayer($('#actionSheet'));
}

async function runAction(act, it) {
  const isInc = it.kind === 'income';
  switch (act) {
    case 'pay': {
      if (!(await guardSpend(it, it.amount - (it.paidAmount || 0)))) return;
      await commit(isInc ? 'Marcado como recebido' : it.kind === 'transfer' ? 'Transferência concluída' : 'Marcado como pago', ops.planStatus([it], 'paid', S.data));
      return afterPaid([it]);
    }
    case 'partial': {
      const v = await dialog({
        title: isInc ? 'Quanto foi recebido?' : 'Quanto foi pago?',
        html: `<p>de ${money(it.amount)}</p><input type="text" inputmode="decimal" id="ptAmount" value="${moneyInput(it.paidAmount || 0)}" placeholder="0,00">`,
        actions: [{ label: 'Cancelar', value: null }, { label: 'Salvar', cls: 'primary', validate: () => parseMoney($('#ptAmount').value) > 0 || (toast('Valor inválido'), false), value: () => parseMoney($('#ptAmount').value) }],
        onOpen: b => setTimeout(() => b.querySelector('input').select(), 150),
      });
      if (!v) return;
      if (!(await guardSpend(it, v - (it.paidAmount || 0)))) return;
      const full = v >= it.amount;
      await commit(full ? 'Valor integral registrado' : `Parcial de ${money(v)} registrado`, ops.setOv(ops.newChanges(), S.data, it, full ? { status: 'paid', paidAt: nowISO(), paidAmount: undefined, ...(v > it.amount ? { amount: v } : {}) } : { status: 'partial', paidAmount: v }));
      if (full) afterPaid([it]);
      return;
    }
    case 'unpay': {
      const ch = ops.planStatus([it], null, S.data);
      ops.setOv(ch, S.data, it, { paidAmount: undefined });
      if (isInc) ops.planUndistribute(it.key, S.data, ch);
      return commit(isInc ? 'Recebimento desfeito' : 'Pagamento desfeito', ch);
    }
    case 'pending': return commit('Marcado como pendente', ops.planStatus([it], 'pending', S.data));
    case 'cancel': return commit('Ocorrência cancelada', ops.planStatus([it], 'cancelled', S.data));
    case 'restore': return commit('Ocorrência restaurada', ops.planStatus([it], null, S.data));
    case 'unmove': return commit('Adiamento desfeito', ops.planMove([it], it.baseDate, S.data));
    case 'goto': { const d = it.movedTo; S.view = parse(d); renderHeader(); S.selected = d; return openDay(d); }
    case 'move': return moveFlow([it]);
    case 'edit': {
      if (it.kind === 'reserve' || it.kind === 'release') {
        const v = await dialog({
          title: itemTitle(it), html: `<input type="text" inputmode="decimal" id="rvAmount" value="${moneyInput(it.amount)}">`,
          actions: [{ label: 'Excluir', cls: 'danger', value: 'del' }, { label: 'Cancelar', value: null }, { label: 'Salvar', cls: 'primary', value: () => parseMoney($('#rvAmount').value) }],
        });
        if (v === 'del') return commit('Movimento excluído', ops.planDelete(S.entries.get(it.entryId), S.data));
        if (v > 0) return commit('Movimento atualizado', (() => { const ch = ops.newChanges(); ch.entries.set(it.entryId, { ...S.entries.get(it.entryId), amount: v, updatedAt: nowISO() }); return ch; })());
        return;
      }
      return openForm({ item: it });
    }
  }
}

/**
 * Verificações antes de um pagamento: conta autorizada para a tag e saldo suficiente.
 * Nunca bloqueia: mostra o problema e deixa o usuário decidir.
 */
async function guardSpend(it, amount) {
  if (!(it.kind === 'expense' || it.kind === 'transfer') || !(amount > 0)) return true;
  const acc = S.accounts.get(it.accountId);
  if (!acc) return true;
  const allowed = acc.allowedTags || [];
  const tags = it.splits ? it.splits.map(p => p.tagId) : [it.tagId];
  if (it.kind === 'expense' && allowed.length && tags.some(t => !allowed.includes(t))) {
    const names = tags.filter(t => !allowed.includes(t)).map(t => (tag(t) || {}).name || 'sem tag').join(', ');
    if (!(await confirmDlg('Uso não autorizado', `A conta ${esc(acc.name)} não está liberada para ${esc(names)}. Liberar só desta vez?`, 'Liberar'))) return false;
  }
  const b = F.balances({ data: S.data, accounts: accountsList(true), piggies: [...S.piggies.values()], today: today(), planUpto: today() });
  const x = b.accounts.get(acc.id);
  const free = x.real - x.reserved;
  if (free >= amount) return true;
  const others = accountsList().filter(a => a.id !== acc.id).map(a => ({ a, v: b.accounts.get(a.id).real - b.accounts.get(a.id).reserved })).filter(o => o.v > 0);
  const res = await dialog({
    title: 'Saldo insuficiente',
    html: `<p>${esc(acc.name)} tem ${money(Math.max(0, free))} livres. Faltam <b>${money(amount - Math.max(0, free))}</b>.</p>
      ${others.length ? `<p class="small">Com saldo: ${others.map(o => `${esc(o.a.name)} ${money(o.v)}`).join(' · ')}</p>` : ''}`,
    actions: [{ label: 'Cancelar', value: null }, ...(others.length ? [{ label: 'Transferir', value: 'tr' }] : []), { label: 'Continuar', cls: 'primary', value: 'go' }],
  });
  if (res === 'tr') {
    openForm({ kind: 'transfer', date: it.date, from: others[0].a.id, to: acc.id, amount: amount - Math.max(0, free) });
    return false;
  }
  return res === 'go';
}

/** Após receber: aplica as regras de distribuição da conta (automático ou com confirmação). */
async function afterPaid(items) {
  for (const it0 of items) {
    if (it0.kind !== 'income') continue;
    const it = findItem(it0.key, it0.date) || it0;
    if (it.status !== 'paid' || S.data.entries.some(e => e.distOf === it.key)) continue;
    const rule = F.ruleFor(S.accounts.get(it.accountId), it.origin);
    if (!rule || !(rule.steps || []).length) continue;
    const b = F.balances({ data: S.data, accounts: accountsList(true), piggies: [...S.piggies.values()], today: today(), planUpto: today() });
    const outs = F.distribute(it.amount, rule, { piggies: [...S.piggies.values()], piggySaved: id => (b.piggies.get(id) || {}).saved || 0 });
    if (!outs.length) continue;
    const name = t => { const [k, id] = t.split(':'); return k === 'piggy' ? (S.piggies.get(id) || {}).name : accName(id); };
    if (!rule.auto) {
      const ok = await confirmDlg(`Distribuir ${money(it.amount)}?`, outs.map(o => `${esc(name(o.target))}: ${money(o.amount)}`).join('<br>'), 'Distribuir');
      if (!ok) continue;
    }
    await commit(rule.auto ? 'Distribuição automática aplicada' : 'Receita distribuída', ops.planDistribution(it, outs, { piggies: [...S.piggies.values()], uid, title: `Distribuição de ${itemTitle(it)}` }));
  }
}

/** Adiar (com opção de alterar o valor): um ou vários lançamentos. */
async function moveFlow(items) {
  const single = items.length === 1 ? items[0] : null;
  const ref = single ? single.date : items[0].date;
  const nextBiz = d => { let x = addDays(d, 1); for (let i = 0; i < 15 && (weekday(x) === 0 || weekday(x) === 6 || S.isHoliday(x)); i++) x = addDays(x, 1); return x; };
  const chips = single
    ? [['Amanhã', addDays(ref, 1)], ['Próx. dia útil', nextBiz(ref)], ['Em 7 dias', addDays(ref, 7)]].concat(single.moved ? [['Data original', single.baseDate]] : [])
    : [['+1 dia', '+1'], ['+7 dias', '+7']];
  let target = null;
  const res = await dialog({
    title: single ? 'Adiar para' : `Adiar ${items.length} lançamentos`,
    html: `<div class="chips" id="mvChips">${chips.map(([l, v]) => `<button type="button" class="chip" data-v="${v}">${l}</button>`).join('')}</div>
      <input type="date" id="mvDate" value="${single ? addDays(ref, 1) : ''}" ${single ? '' : 'placeholder="Ou escolha uma data"'}>
      ${single ? `<input type="text" inputmode="decimal" id="mvAmount" placeholder="Valor (opcional)" value="">` : ''}`,
    actions: [{ label: 'Cancelar', value: null }, {
      label: 'Adiar', cls: 'primary',
      validate: () => !!(target || $('#mvDate').value) || (toast('Escolha a nova data'), false),
      value: () => ({ to: target && target[0] === '+' ? target : ($('#mvDate').value || target), amount: single ? parseMoney($('#mvAmount').value) : NaN }),
    }],
    onOpen: body => {
      body.querySelector('#mvChips').onclick = e => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        target = b.dataset.v;
        body.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
        if (target[0] !== '+') body.querySelector('#mvDate').value = target; else body.querySelector('#mvDate').value = '';
      };
      body.querySelector('#mvDate').onchange = () => { target = null; body.querySelectorAll('.chip').forEach(c => c.classList.remove('on')); };
    },
  });
  if (!res) return;
  const to = res.to[0] === '+' ? it => addDays(it.date, +res.to.slice(1)) : res.to;
  let ch = ops.newChanges();
  if (single && res.amount > 0) ch = ops.planAmount(items, res.amount, S.data);
  ch = ops.planMove(items, to, S.data, undefined, ch);
  const n = [...ch.overrides.values()].length;
  if (!single) {
    const ok = await confirmDlg(`Adiar ${n} lançamentos?`, res.to[0] === '+' ? `Cada um será transferido ${res.to.slice(1)} dia(s) depois.` : `Todos serão transferidos para ${dmy(res.to)}.`, 'Adiar');
    if (!ok) return;
  }
  await commit(single ? `Adiado para ${dm(typeof to === 'string' ? to : to(single))}` : `${n} lançamentos adiados`, ch);
  if (!single) exitSelect();
}

// ---------- Alcance da alteração ----------
function chooseScope({ title, sub, options }) {
  return new Promise(resolve => {
    $('#scopeTitle').textContent = title;
    $('#scopeSub').textContent = sub || '';
    $('#scopeBody').innerHTML = options.map(o => `<button class="scope${o.danger ? ' danger' : ''}" data-s="${o.id}"><span class="grow"><div class="t">${o.label}</div>${o.sub ? `<div class="s">${o.sub}</div>` : ''}</span></button>`).join('');
    let picked = null;
    $('#scopeBody').onclick = e => { const b = e.target.closest('[data-s]'); if (b) { picked = b.dataset.s; closeTop(); } };
    openLayer($('#scopeSheet'), () => resolve(picked));
  });
}
function scopeSub(scope, ctx) {
  const p = ops.scopePreview(scope, ctx);
  if (scope === 'one') return `${dmy(ctx.item.date)}`;
  if (p.count !== Infinity) return `${p.count} ${p.count === 1 ? 'lançamento' : 'lançamentos'}${p.from !== p.to ? ` · ${dm(p.from)} a ${dm(p.to)}` : ''}`;
  return `De ${dmy(p.from)} em diante${p.to ? ` (até ${dmy(p.to)})` : ''} · datas anteriores não mudam`;
}

// ---------- Formulário ----------
const Fm = { mode: 'new', item: null, entry: null, kind: 'expense', weekdays: new Set(), dates: [], ruleOpen: false, splits: [] };
const POLICY_RULES = new Set(['once', 'daily', 'weekly', 'monthlyDay', 'interval', 'dates']);

function fillTagSelect(selected) {
  const opts = tagsSorted().filter(t => t.kind === 'both' || t.kind === Fm.kind);
  $('#fTag').innerHTML = `<option value="">Nenhuma</option>${opts.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}<option value="__new">Nova tag…</option>`;
  $('#fTag').value = opts.some(t => t.id === selected) ? selected : '';
}
function setKind(k) {
  Fm.kind = k;
  $$('#kindSeg button').forEach(b => b.classList.toggle('on', b.dataset.kind === k));
  $('#fPaidLabel').textContent = k === 'income' ? 'Recebido' : k === 'transfer' ? 'Concluída' : 'Pago';
  $('#fAccountLabel').textContent = k === 'transfer' ? 'De' : 'Conta';
  $('#fAccountRow').hidden = k !== 'transfer' && !multiAcc();
  $('#fToRow').hidden = k !== 'transfer';
  $('#fOriginRow').hidden = k !== 'income';
  $('#fTagRow').hidden = k === 'transfer' || (k === 'expense' && $('#fSplit').checked);
  $('#fFeeRow').hidden = k !== 'transfer' || Fm.mode !== 'new';
  fillTagSelect($('#fTag').value);
  updateSplitUI();
}
function fillAccountSelects(from, to) {
  const opts = accountsList().map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  $('#fAccount').innerHTML = opts; $('#fTo').innerHTML = opts;
  $('#fAccount').value = from || S.settings.defaultAccount;
  $('#fTo').value = to || (accountsList().find(a => a.id !== $('#fAccount').value) || {}).id || '';
  const origins = new Set([...S.entries.values()].map(e => e.origin).filter(Boolean));
  $('#originList').innerHTML = [...origins].map(o => `<option value="${esc(o)}">`).join('');
}
function updateSplitUI() {
  const can = Fm.kind === 'expense' && $('#fRule').value === 'once' && !(Fm.mode === 'edit' && Fm.entry.rule.type !== 'once');
  $('#fSplitBox').hidden = !can;
  const on = can && $('#fSplit').checked;
  $('#fTagRow').hidden = Fm.kind === 'transfer' || on;
  if (!on) { $('#fSplits').innerHTML = ''; return; }
  if (!Fm.splits.length) Fm.splits = [{ tagId: $('#fTag').value && $('#fTag').value !== '__new' ? $('#fTag').value : '', amount: parseMoney($('#fAmount').value) || 0 }, { tagId: '', amount: 0 }];
  const tags = tagsSorted().filter(t => t.kind !== 'income');
  const total = parseMoney($('#fAmount').value) || 0;
  const sum = Fm.splits.reduce((a, p) => a + (p.amount || 0), 0);
  $('#fSplits').innerHTML = Fm.splits.map((p, i) => `<div class="split-row">
      <select data-si="${i}"><option value="">Sem tag</option>${tags.map(t => `<option value="${t.id}" ${t.id === p.tagId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <input data-sa="${i}" inputmode="decimal" value="${moneyInput(p.amount)}" placeholder="0,00">
      <button type="button" class="icon-btn soft" data-sx="${i}" aria-label="Remover">${icon('close')}</button></div>`).join('') +
    `<div class="split-foot"><button type="button" class="link-btn" id="fSplitAdd">Adicionar parte</button><span class="${sum === total ? '' : 'neg'}">${money(sum)} de ${money(total)}</span></div>`;
}
function readRule(start) {
  const type = $('#fRule').value;
  const rule = { type, start };
  if (type === 'monthlyDay') rule.day = Math.min(31, Math.max(1, +$('#fDay').value || 1));
  if (type === 'nthBusinessDay') { rule.n = +$('#fNth').value; rule.saturday = $('#fSat').checked; }
  if (type === 'weekly') { rule.weekdays = [...Fm.weekdays].sort(); rule.every = +$('#fEvery').value; }
  if (type === 'interval') rule.every = Math.max(1, +$('#fInterval').value || 1);
  if (type === 'dates') rule.dates = [...new Set([start, ...Fm.dates])].sort();
  if (type !== 'once' && type !== 'dates' && !$('#fNoEnd').checked && $('#fEnd').value) rule.end = $('#fEnd').value;
  if (POLICY_RULES.has(type) && $('#fPolicy').value !== 'keep') { rule.holidayPolicy = $('#fPolicy').value; if ($('#fPolicyWk').checked) rule.policyWeekends = true; }
  return rule;
}
const ruleSig = r => { const { start, ...rest } = r; return JSON.stringify(Object.keys(rest).sort().map(k => [k, rest[k]])); };

function updateRuleUI() {
  const r = $('#fRule').value;
  $$('.rule-opt').forEach(el => {
    const f = el.dataset.for;
    el.classList.toggle('on', f === r || (f === 'recurring' && r !== 'once' && r !== 'dates') || (f === 'policy' && POLICY_RULES.has(r)));
  });
  $('#fEndRow').hidden = $('#fNoEnd').checked;
  if (r === 'weekly' && !Fm.weekdays.size && $('#fDate').value) Fm.weekdays.add(weekday($('#fDate').value));
  $('#fRuleSummary').textContent = RULES[r];
  $('#fRuleBox').classList.toggle('open', Fm.ruleOpen);
  $('#fRuleToggle').classList.toggle('open', Fm.ruleOpen);
  const recurringEdit = Fm.mode === 'edit' && Fm.entry.rule.type !== 'once';
  $('#fDateLabel').textContent = Fm.mode === 'new' && r !== 'once' ? 'Início' : 'Data';
  $('#fPaidRow').hidden = Fm.mode === 'new' && r !== 'once';
  const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const order = S.settings.mondayFirst ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  $('#fWeekdays').innerHTML = order.map(w => `<button type="button" class="chip${Fm.weekdays.has(w) ? ' on' : ''}" data-w="${w}">${days[w]}</button>`).join('');
  $('#fDates').innerHTML = Fm.dates.map(d => `<button type="button" class="chip on" data-d="${d}">${dmy(d)} ✕</button>`).join('');
  $('#kindSeg').querySelectorAll('button').forEach(b => { b.disabled = recurringEdit; });
}

/** Abre o formulário: novo lançamento ({ date, paid }) ou edição de uma ocorrência ({ item }). */
function openForm({ item = null, date = null, paid, kind, from, to, amount } = {}) {
  Fm.mode = item ? 'edit' : 'new';
  Fm.item = item;
  Fm.entry = item ? S.entries.get(item.entryId) : null;
  const e = Fm.entry;
  const r = e ? e.rule : { type: 'once', start: date || S.selected || today() };
  Fm.weekdays = new Set(r.weekdays || []);
  Fm.dates = r.dates ? r.dates.filter(d => d !== r.start) : [];
  Fm.ruleOpen = false;
  $('#formTitle').textContent = item ? (item.recurring ? 'Editar lançamento' : 'Editar') : 'Novo lançamento';
  $('#fAmount').value = item ? moneyInput(item.amount) : amount ? moneyInput(amount) : '';
  $('#fTitle').value = item ? item.title || '' : '';
  fillAccountSelects(e ? e.accountId : from, e ? e.toAccountId : to);
  $('#fOrigin').value = e ? e.origin || '' : '';
  $('#fFee').value = '';
  Fm.splits = e && e.splits ? e.splits.map(p => ({ ...p })) : [];
  $('#fSplit').checked = !!(e && e.splits);
  $('#fRule').value = r.type;
  setKind(e ? e.kind : kind || 'expense');
  fillTagSelect(item ? item.tagId : '');
  $('#fDate').value = item ? item.date : r.start;
  $('#fPaid').checked = item ? item.status === 'paid' : (paid ?? (r.start <= today()));
  $('#fRule').value = r.type;
  $('#fDay').value = r.day || +r.start.slice(8);
  $('#fNth').value = String(r.n || 5);
  $('#fSat').checked = !!r.saturday;
  $('#fEvery').value = String(r.type === 'weekly' ? r.every || 1 : 1);
  $('#fInterval').value = r.type === 'interval' ? r.every || 7 : 7;
  $('#fNoEnd').checked = !r.end;
  $('#fEnd').value = r.end || '';
  $('#fPolicy').value = r.holidayPolicy || 'keep';
  $('#fPolicyWk').checked = !!r.policyWeekends;
  $('#btnDelete').hidden = !item;
  $('#fMeta').textContent = e ? `Registrado em ${dmy(e.createdAt.slice(0, 10))}${e.updatedAt && e.updatedAt !== e.createdAt ? ` · alterado em ${dmy(e.updatedAt.slice(0, 10))}` : ''}` : '';
  updateRuleUI();
  openLayer($('#formSheet'));
  if (!item) setTimeout(() => $('#fAmount').focus(), 260);
}

async function saveForm(ev) {
  ev.preventDefault();
  const amount = parseMoney($('#fAmount').value);
  if (!(amount > 0)) { toast('Informe um valor'); $('#fAmount').focus(); return; }
  const date = $('#fDate').value;
  if (!date) { toast('Informe a data'); return; }
  const kind = Fm.kind;
  const tagId = kind !== 'transfer' && $('#fTag').value && $('#fTag').value !== '__new' ? $('#fTag').value : null;
  const title = $('#fTitle').value.trim();
  const pay = $('#fPaid').checked;
  const accountId = $('#fAccount').value || S.settings.defaultAccount;
  const toAccountId = kind === 'transfer' ? $('#fTo').value : null;
  const origin = kind === 'income' ? $('#fOrigin').value.trim() : '';
  if (kind === 'transfer' && (!toAccountId || toAccountId === accountId)) { toast('Escolha contas diferentes'); return; }
  let splits = null;
  if (!$('#fSplitBox').hidden && $('#fSplit').checked) {
    splits = Fm.splits.filter(p => p.amount > 0).map(p => ({ tagId: p.tagId || null, amount: p.amount }));
    if (splits.reduce((a, p) => a + p.amount, 0) !== amount) { toast('As partes precisam somar o valor total'); return; }
    if (splits.length < 2) splits = null;
  }
  const extra = { accountId, toAccountId, origin, splits };
  if ($('#fRule').value === 'weekly' && !Fm.weekdays.size) { toast('Escolha os dias da semana'); return; }
  if (!$('#fNoEnd').checked && $('#fEnd').value && $('#fEnd').value < date) { toast('O término é anterior ao início'); return; }

  if (Fm.mode === 'new') {
    const rule = readRule(date);
    const entry = { id: uid(), kind, title, amount, tagId: splits ? null : tagId, ...extra, rule, segments: [], createdAt: nowISO(), updatedAt: nowISO() };
    if (rule.type === 'once' && pay && !(await guardSpend({ ...entry, tagId: entry.tagId }, amount))) return;
    const sig = x => JSON.stringify([x.kind, x.title, x.amount, x.tagId, x.rule]);
    if ([...S.entries.values()].some(x => sig(x) === sig(entry))) {
      if (!(await confirmDlg('Lançamento repetido', 'Já existe um lançamento idêntico. Criar mesmo assim?', 'Criar'))) return;
    }
    const ch = ops.newChanges();
    ch.entries.set(entry.id, entry);
    const paidOv = id => { const k = occKey(id, date); ch.overrides.set(k, { key: k, entryId: id, orig: date, status: 'paid', paidAt: nowISO() }); };
    if (rule.type === 'once' && pay) paidOv(entry.id);
    const fee = kind === 'transfer' ? parseMoney($('#fFee').value) : 0;
    if (fee > 0) {
      const fe = { id: uid(), kind: 'expense', title: 'Taxa bancária', amount: fee, accountId, tagId: null, rule: { type: 'once', start: date }, segments: [], createdAt: nowISO(), updatedAt: nowISO(), feeOf: entry.id };
      ch.entries.set(fe.id, fe);
      if (pay) paidOv(fe.id);
    }
    await closeTop();
    await commit(kind === 'transfer' ? 'Transferência salva' : 'Lançamento salvo', ch);
    if (kind === 'income' && rule.type === 'once' && pay) afterPaid([{ key: occKey(entry.id, date), date, kind: 'income' }]);
    return;
  }

  const it = Fm.item, e = Fm.entry;
  if (e.rule.type === 'once') {
    // lançamento avulso: altera direto
    const ne = { ...e, kind, title, amount, tagId: splits ? null : tagId, ...extra, rule: { ...readRule(date), type: 'once', start: date }, updatedAt: nowISO() };
    if (pay && !(it.status === 'paid') && !(await guardSpend({ ...ne, splits }, amount))) return;
    const ch = ops.newChanges();
    let rule = readRule(date);
    if (rule.type !== 'once') { ne.rule = rule; }
    ch.entries.set(e.id, ne);
    const oldK = occKey(e.id, e.rule.start), newK = occKey(e.id, date);
    const prev = S.overrides.get(oldK);
    if (oldK !== newK) ch.overrides.set(oldK, null);
    const st = ne.rule.type === 'once' && pay ? { status: 'paid', paidAt: prev && prev.paidAt || nowISO() } : null;
    ch.overrides.set(newK, st ? { key: newK, entryId: e.id, orig: date, ...st } : null);
    if (!st && !prev && oldK === newK) ch.overrides.delete(newK);
    await closeTop();
    return commit('Lançamento atualizado', ch);
  }

  // ocorrência de uma recorrência
  const newRule = readRule(e.rule.start);
  const ruleChanged = (Fm.ruleOpen && (ruleSig(newRule) !== ruleSig(e.rule))) || (e.accountId || S.settings.defaultAccount) !== accountId || (e.toAccountId || null) !== toAccountId || (e.origin || '') !== origin;
  const patch = {};
  if (amount !== it.amount) patch.amount = amount;
  if (title !== (it.title || '')) patch.title = title;
  if (tagId !== (it.tagId || null)) patch.tagId = tagId;
  const dateChanged = date !== it.date;
  const payChanged = pay !== (it.status === 'paid');
  const ctx = { entry: e, item: it, today: today(), data: S.data, mondayFirst: S.settings.mondayFirst };

  if (ruleChanged) {
    const sc = await chooseScope({
      title: 'Aplicar a alteração', sub: `${RULES[newRule.type]} · ${esc(accName(accountId))}`,
      options: [{ id: 'future', label: ops.SCOPES.future, sub: scopeSub('future', ctx) }, { id: 'all', label: ops.SCOPES.all, sub: scopeSub('all', ctx) }],
    });
    if (!sc) return;
    const from = sc === 'future' ? it.orig : ops.allFrom(e, today());
    const fields = { kind: e.kind, title: title || e.title, amount, tagId, accountId, toAccountId, origin, rule: newRule };
    await closeTop();
    return commit('Recorrência alterada', ops.planRuleChange({ entry: e, fields, from, data: S.data, uid }));
  }
  if (dateChanged) {
    const ch = ops.setOv(ops.newChanges(), S.data, it, { ...patch, movedTo: date, ...(payChanged ? { status: pay ? 'paid' : undefined, paidAt: pay ? nowISO() : undefined } : {}) });
    await closeTop();
    return commit(`Movido para ${dm(date)}`, ch);
  }
  if (Object.keys(patch).length) {
    const opts = Object.keys(ops.SCOPES).map(id => ({ id, label: ops.SCOPES[id], sub: scopeSub(id, ctx) }));
    const sc = await chooseScope({ title: 'Onde deseja aplicar esta alteração?', sub: describePatch(patch, it), options: opts });
    if (!sc) return;
    const ch = ops.planEdit({ ...ctx, patch, pay: pay && payChanged, scope: sc });
    if (payChanged && !pay) ops.setOv(ch, S.data, it, { status: undefined });
    await closeTop();
    return commit('Alteração aplicada', ch);
  }
  if (payChanged) {
    await closeTop();
    return commit(pay ? 'Marcado como pago' : 'Pagamento desfeito', ops.planStatus([it], pay ? 'paid' : null, S.data));
  }
  return closeTop();
}
function describePatch(p, it) {
  const out = [];
  if ('amount' in p) out.push(`${money(it.amount)} → ${money(p.amount)}`);
  if ('title' in p) out.push(`“${p.title || 'sem descrição'}”`);
  if ('tagId' in p) out.push(`tag ${p.tagId ? tag(p.tagId).name : 'removida'}`);
  return out.join(' · ');
}

async function deleteFlow() {
  const it = Fm.item, e = Fm.entry;
  if (e.rule.type === 'once') {
    if (!(await confirmDlg('Excluir lançamento?', '', 'Excluir', 'danger'))) return;
    await closeTop();
    return commit('Lançamento excluído', ops.planDelete(e, S.data));
  }
  const sc = await chooseScope({
    title: 'Excluir', sub: esc(itemTitle(it)),
    options: [
      { id: 'one', label: 'Somente este lançamento', sub: `Cancela ${dmy(it.date)}, a recorrência continua` },
      { id: 'future', label: 'Este e os próximos', sub: `Encerra a recorrência em ${dmy(addDays(it.orig, -1))}. Pagos são mantidos.` },
      { id: 'all', label: 'A recorrência inteira', sub: 'Apaga todas as ocorrências, inclusive o histórico', danger: true },
    ],
  });
  if (!sc) return;
  if (sc === 'all' && !(await confirmDlg('Apagar a recorrência inteira?', 'Todas as ocorrências, inclusive as pagas, serão removidas.', 'Apagar', 'danger'))) return;
  await closeTop();
  if (sc === 'one') return commit('Ocorrência cancelada', ops.planStatus([it], 'cancelled', S.data));
  if (sc === 'future') return commit('Recorrência encerrada', ops.planEndSeries({ entry: e, from: it.orig, data: S.data, uid }));
  return commit('Recorrência excluída', ops.planDelete(e, S.data));
}

// ---------- Conferência de dia ----------
async function finishCheck(dates) {
  const pendingCount = dates.reduce((n, d) => n + dayData(d).items.filter(i => i.status === 'planned').length, 0);
  if (pendingCount && !(await confirmDlg('Concluir conferência?', `${pendingCount} ${pendingCount === 1 ? 'lançamento não confirmado ficará' : 'lançamentos não confirmados ficarão'} como pendente.`, 'Concluir'))) return false;
  const ch = ops.planCheckDays(dates, d => dayData(d).items, S.data);
  S.checking = null;
  await commit(dates.length === 1 ? 'Dia conferido' : `${dates.length} dias conferidos`, ch);
  return true;
}

// ---------- Seleção múltipla e edição em grupo ----------
function enterSelect(date) {
  S.selecting = true;
  S.picked = new Set(date ? [date] : []);
  S.lastPicked = date || null;
  document.body.classList.add('selecting');
  history.pushState({ sel: 1 }, '');
  updateSelUI();
}
function exitSelect(fromPop = false) {
  if (!S.selecting) return;
  S.selecting = false;
  S.picked.clear();
  document.body.classList.remove('selecting');
  renderGrid();
  if (!fromPop) history.back();
}
function selectedItems() {
  const out = [];
  for (const d of [...S.picked].sort()) for (const it of dayData(d).items) if (it.status !== 'moved') out.push(it);
  return out;
}
function updateSelUI() {
  const n = S.picked.size;
  $('#selTitle').textContent = n ? `${n} ${n === 1 ? 'dia' : 'dias'}` : 'Selecione os dias';
  const count = n ? selectedItems().length : 0;
  $('#btnSelGo').disabled = !count;
  $('#btnSelGo').textContent = count ? `Continuar · ${count} ${count === 1 ? 'lançamento' : 'lançamentos'}` : 'Continuar';
  renderGrid();
}
function togglePick(date, force) {
  if (date.slice(0, 7) !== iso(S.view.y, S.view.m, 1).slice(0, 7)) return;
  const on = force ?? !S.picked.has(date);
  if (on) S.picked.add(date); else S.picked.delete(date);
  S.lastPicked = date;
  updateSelUI();
}

const G = { filter: 'all', off: new Set() };
const G_FILTERS = { all: 'Todos', planned: 'Previstos', pending: 'Pendentes', paid: 'Pagos', cancelled: 'Cancelados' };
function groupPool() {
  const all = selectedItems();
  return G.filter === 'all' ? all : all.filter(i => i.status === G.filter);
}
const groupChosen = () => groupPool().filter(i => !G.off.has(i.entryId));

function renderGroup() {
  const all = selectedItems();
  const pool = groupPool();
  const chosen = groupChosen();
  const days = [...S.picked].sort();
  $('#groupTitle').textContent = `${chosen.length} ${chosen.length === 1 ? 'lançamento selecionado' : 'lançamentos selecionados'}`;
  $('#groupSub').textContent = `${days.length > 1 ? `${dm(days[0])} a ${dm(days[days.length - 1])} · ` : `${dmy(days[0])} · `}${days.length} ${days.length === 1 ? 'dia' : 'dias'}`;
  const counts = s => (s === 'all' ? all.length : all.filter(i => i.status === s).length);
  const series = new Map();
  for (const it of pool) {
    const g = series.get(it.entryId) || { it, n: 0, total: 0 };
    g.n++; g.total += it.amount; series.set(it.entryId, g);
  }
  $('#groupBody').innerHTML = `<div class="chips">${Object.entries(G_FILTERS).filter(([k]) => k === 'all' || counts(k)).map(([k, l]) => `<button class="chip${G.filter === k ? ' on' : ''}" data-f="${k}">${l} ${counts(k)}</button>`).join('')}</div>
    <div style="margin-top:8px">${[...series.values()].map(({ it, n, total }) => `
      <button class="pick${G.off.has(it.entryId) ? '' : ' on'}" data-e="${it.entryId}">
        <span class="box">${icon('check')}</span><span class="bar" style="width:3px;height:28px;border-radius:2px;background:${itemColor(it)}"></span>
        <span class="grow"><div class="t">${esc(itemTitle(it))}</div><div class="s">${n}× · ${it.kind === 'income' ? 'receita' : 'despesa'}</div></span>
        <span class="${it.kind === 'income' ? 'pos' : 'neg'}">${money(total)}</span>
      </button>`).join('') || '<div class="empty">Nada com esse filtro.</div>'}</div>`;
  const allPast = days.every(d => d <= today());
  $('#groupActions').innerHTML = ACT('pay', 'Pagar', 'check', 'primary') + ACT('amount', 'Valor', 'money') + ACT('move', 'Adiar', 'later') +
    ACT('cancel', 'Cancelar', 'cancel', 'danger') + ACT('restore', 'Restaurar', 'restore') + (allPast ? ACT('check', 'Conferir', 'select') : '');
  $$('#groupActions .act').forEach(b => { b.disabled = !chosen.length && b.dataset.act !== 'check'; });
}

async function groupAction(act) {
  const items = groupChosen();
  const days = [...S.picked].sort();
  const range = days.length > 1 ? `${dm(days[0])} a ${dm(days[days.length - 1])}` : dmy(days[0]);
  const run = async (label, ch, verb) => {
    const n = ch.overrides.size;
    if (!n) { toast('Nenhum lançamento seria alterado'); return; }
    const total = items.filter(i => ch.overrides.has(i.key)).reduce((s, i) => s + i.amount, 0);
    if (!(await confirmDlg(`${verb} ${n} ${n === 1 ? 'lançamento' : 'lançamentos'}?`, `${range} · total ${money(total)}`, verb))) return;
    await closeAll();
    await commit(label.replace('#', n), ch);
    exitSelect();
  };
  switch (act) {
    case 'pay': { const sel = items.filter(i => i.status !== 'paid' && i.status !== 'cancelled'); await run('# lançamentos pagos', ops.planStatus(sel, 'paid', S.data), 'Pagar'); return afterPaid(sel); }
    case 'cancel': return run('# lançamentos cancelados', ops.planStatus(items.filter(i => i.status !== 'cancelled' && i.status !== 'paid'), 'cancelled', S.data), 'Cancelar');
    case 'restore': return run('# lançamentos restaurados', ops.planStatus(items.filter(i => i.status !== 'planned'), null, S.data), 'Restaurar');
    case 'move': await closeAll(); return moveFlow(items);
    case 'amount': {
      const v = await dialog({
        title: 'Novo valor', html: '<input type="text" inputmode="decimal" id="gAmount" placeholder="0,00"><p class="hint">Lançamentos já pagos mantêm o valor efetivo.</p>',
        actions: [{ label: 'Cancelar', value: null }, { label: 'Aplicar', cls: 'primary', validate: () => parseMoney($('#gAmount').value) > 0 || (toast('Valor inválido'), false), value: () => parseMoney($('#gAmount').value) }],
        onOpen: b => setTimeout(() => b.querySelector('#gAmount').focus(), 150),
      });
      if (!v) return;
      return run(`# lançamentos agora em ${money(v)}`, ops.planAmount(items, v, S.data), 'Alterar');
    }
    case 'check': {
      await closeAll();
      if (await finishCheck(days)) exitSelect();
    }
  }
}

// ---------- Tags ----------
const PALETTE = ['#ff453a', '#ff9f0a', '#ffd60a', '#32d74b', '#63e6e2', '#40c8e0', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ac8e68', '#8e8e93'];

async function tagDialog(t = null, kindHint = 'expense') {
  let color = t ? t.color : PALETTE[(S.tags.size * 5) % PALETTE.length];
  const actions = [{ label: 'Cancelar', value: null }];
  if (t) actions.push({ label: 'Excluir', value: 'delete', cls: 'danger' });
  actions.push({ label: 'Salvar', cls: 'primary', validate: () => !!$('#tgName').value.trim() || (toast('Dê um nome à tag'), false), value: () => ({ name: $('#tgName').value.trim(), kind: $('#tgKind').value, color }) });
  const res = await dialog({
    title: t ? 'Editar tag' : 'Nova tag',
    html: `<input type="text" id="tgName" placeholder="Nome" maxlength="30" value="${esc(t ? t.name : '')}">
      <select id="tgKind"><option value="expense">Despesa</option><option value="income">Receita</option><option value="both">Receita e despesa</option></select>
      <div class="swatches" id="tgColors">${PALETTE.map(c => `<button type="button" style="background:${c}" data-c="${c}" class="${c === color ? 'on' : ''}"></button>`).join('')}</div>`,
    actions,
    onOpen: body => {
      body.querySelector('#tgKind').value = t ? t.kind : kindHint;
      body.querySelector('#tgColors').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        color = b.dataset.c;
        body.querySelectorAll('#tgColors button').forEach(x => x.classList.toggle('on', x === b));
      };
    },
  });
  if (!res) return null;
  if (res === 'delete') {
    if (!(await confirmDlg('Excluir tag?', 'Os lançamentos continuam, apenas sem esta tag.', 'Excluir', 'danger'))) return null;
    await db.del('tags', t.id);
    S.tags.delete(t.id);
    const ch = ops.newChanges();
    for (const e of S.entries.values()) if (e.tagId === t.id) ch.entries.set(e.id, { ...e, tagId: null });
    S.settings.hiddenTags = S.settings.hiddenTags.filter(id => id !== t.id);
    saveSettings();
    if (ops.changeCount(ch)) await commit('Tag excluída', ch, { silent: true }); else refresh();
    return null;
  }
  const nt = t ? { ...t, ...res } : { id: uid(), ...res, order: S.tags.size };
  await db.put('tags', nt);
  S.tags.set(nt.id, nt);
  refresh();
  return nt;
}

function renderTagList() {
  const hidden = new Set(S.settings.hiddenTags);
  const list = tagsSorted();
  $('#tagList').innerHTML = list.length ? list.map(t => `
    <div class="row tag-row${hidden.has(t.id) ? ' off' : ''}">
      <span class="dot" style="background:${t.color}"></span>
      <button class="tag-name" data-edit-tag="${t.id}">${esc(t.name)}</button>
      <input type="checkbox" class="switch" data-tag="${t.id}" ${hidden.has(t.id) ? '' : 'checked'} aria-label="Exibir ${esc(t.name)}">
    </div>`).join('') : '<div class="row"><span class="muted">Nenhuma tag</span></div>';
}

// ---------- Menu lateral ----------
function syncDrawer() {
  const s = S.settings;
  $$('[data-setting]').forEach(el => { el.checked = !!s[el.dataset.setting]; });
  $$('#basisSeg button').forEach(b => b.classList.toggle('on', b.dataset.basis === s.basis));
  $('#startDate').value = s.startDate || '';
  $$('.carry-only').forEach(el => { el.hidden = !s.carry; });
  $('#holState').value = s.holState;
  $('#holCity').value = s.holCity;
  $('#accFilterBox').hidden = !multiAcc();
  const hiddenAcc = new Set(s.hiddenAccounts);
  $('#accFilter').innerHTML = accountsList().filter(a => a.includeInTotal !== false).map(a => `<label class="row"><span class="dot" style="background:${a.color || 'var(--accent)'}"></span><span>${esc(a.name)}</span><input type="checkbox" class="switch" data-acc="${a.id}" ${hiddenAcc.has(a.id) ? '' : 'checked'}></label>`).join('');
  const P = { accounts: 'Contas', metas: 'Metas e orçamentos', pending: 'Pendências', upcoming: 'Próximos 7 dias', piggies: 'Cofrinhos' };
  $('#panelCfg').innerHTML = Object.entries(P).map(([k, l]) => `<label class="row"><span>${l}</span><input type="checkbox" class="switch" data-panel="${k}" ${s.panels[k] ? 'checked' : ''}></label>`).join('');
  $('#alertCfg').innerHTML = Object.entries(F.ALERT_TYPES).map(([k, l]) => `<label class="row"><span>${l}</span><input type="checkbox" class="switch" data-alert="${k}" ${s.alerts[k] === false ? '' : 'checked'}></label>`).join('');
  $('#btnInstall').hidden = !installPrompt;
  $('#customHolList').innerHTML = s.customHolidays.map((h, i) => `<div class="row"><span>${esc(h.name)} <span class="muted">${dmy(h.date)}</span></span><button class="link-btn" data-del-hol="${i}">Remover</button></div>`).join('');
  renderTagList();
}
async function storageInfo() {
  let txt = 'Os dados ficam somente neste aparelho.';
  try { if (navigator.storage && await navigator.storage.persisted()) txt += ' Armazenamento protegido.'; } catch { /* */ }
  $('#storageInfo').textContent = txt;
}

async function loadSample() {
  const { y, m } = S.view;
  const start = iso(y, m, 1), now = nowISO();
  const mkTag = (name, kind, color) => ({ id: uid(), name, kind, color, order: S.tags.size });
  const T = {
    sal: mkTag('Salário', 'income', '#32d74b'), ifood: mkTag('Entregas', 'income', '#63e6e2'), alm: mkTag('Almoço', 'expense', '#ff9f0a'),
    jan: mkTag('Jantar', 'expense', '#ffd60a'), tr: mkTag('Transporte', 'expense', '#40c8e0'), net: mkTag('Internet', 'expense', '#5e5ce6'),
    lz: mkTag('Lazer', 'expense', '#bf5af2'), bike: mkTag('Energia da bicicleta', 'expense', '#ff375f'),
  };
  Object.values(T).forEach((t, i) => { t.order = S.tags.size + i; });
  const main = S.settings.defaultAccount;
  const ifood = { id: uid(), name: 'Conta iFood', type: 'digital', institution: '', initialBalance: 0, color: '#ff375f', purpose: 'Ganhos com entregas', includeInTotal: true, archived: false, allowedTags: [T.bike.id], rules: [], order: 1, createdAt: now };
  const pEmerg = { id: uid(), name: 'Emergência', type: 'virtual', accountId: ifood.id, goal: 100000, deadline: '', color: '#ff9f0a', createdAt: now };
  const pIfood = { id: uid(), name: 'Cofrinho iFood', type: 'virtual', accountId: ifood.id, goal: 300000, deadline: '', color: '#63e6e2', createdAt: now };
  ifood.rules = [{ id: uid(), origin: '', auto: false, steps: [{ type: 'fixed', value: 2000, target: 'account:' + main }, { type: 'percent', value: 10, target: 'piggy:' + pEmerg.id }, { type: 'remainder', target: 'piggy:' + pIfood.id }] }];
  const metas = [
    { id: uid(), name: 'Alimentação', kind: 'expense', period: 'month', amount: 40000, tagIds: [T.alm.id, T.jan.id], color: '#ff9f0a', tintTags: true, alertPct: 80, createdAt: now },
    { id: uid(), name: 'Gastos do dia útil', kind: 'expense', period: 'businessDay', amount: 4000, tagIds: [T.alm.id, T.tr.id, T.jan.id], color: '#64d2ff', rollover: 'week', showOnCalendar: true, colorGood: '#32d74b', colorBad: '#ff453a', alertPct: 100, createdAt: now },
    { id: uid(), name: 'Entregas no mês', kind: 'income', period: 'month', amount: 120000, tagIds: [], origins: ['iFood'], color: '#63e6e2', createdAt: now },
  ];
  const E = (title, kind, amount, tagId, rule, extra = {}) => ({ id: uid(), kind, title, amount, tagId, accountId: main, rule: { start, ...rule }, segments: [], createdAt: now, updatedAt: now, ...extra });
  const ch = ops.newChanges();
  [E('Salário', 'income', 165000, T.sal.id, { type: 'nthBusinessDay', n: 5 }, { origin: 'Salário CLT' }),
    E('Entregas', 'income', 30000, T.ifood.id, { type: 'weekly', weekdays: [5], every: 1 }, { origin: 'iFood', accountId: ifood.id }),
    E('Almoço', 'expense', 2100, T.alm.id, { type: 'businessDays' }),
    E('Transporte', 'expense', 1100, T.tr.id, { type: 'businessDays' }),
    E('Internet', 'expense', 10000, T.net.id, { type: 'monthlyDay', day: 5 }),
    E('Lazer', 'expense', 7500, T.lz.id, { type: 'weekendsHolidays' })].forEach(e => ch.entries.set(e.id, e));
  for (const t of Object.values(T)) { await db.put('tags', t); S.tags.set(t.id, t); }
  await db.put('accounts', ifood); S.accounts.set(ifood.id, ifood);
  for (const p of [pEmerg, pIfood]) { await db.put('piggies', p); S.piggies.set(p.id, p); }
  for (const x of metas) { await db.put('metas', x); S.metas.set(x.id, x); }
  await closeTop();
  await commit('Exemplo carregado', ch);
}

async function wipeAll() {
  if (!(await confirmDlg('Apagar todos os dados?', 'Lançamentos, contas, cofrinhos, metas, tags e configurações deste aparelho serão apagados. Não é possível desfazer.', 'Apagar tudo', 'danger'))) return;
  await Promise.all(db.STORES.map(db.clear));
  for (const k of ['entries', 'overrides', 'tags', 'checks', 'accounts', 'piggies', 'metas']) S[k].clear();
  S.settings = { ...DEFAULTS };
  undoStack.length = 0;
  await ensureDefaultAccount();
  await closeTop();
  renderHeader(); refresh();
  toast('Dados apagados');
}

// ---------- Eventos ----------
function bind() {
  $('#btnMenu').onclick = () => { syncDrawer(); storageInfo(); openLayer($('#drawer')); };
  $('#btnPrev').onclick = () => goMonth(-1);
  $('#btnNext').onclick = () => goMonth(1);
  $('#btnToday').onclick = goToday;
  $('#scrim').onclick = () => closeTop();
  $$('[data-close]').forEach(b => { b.onclick = () => closeTop(); });
  $('#fab').onclick = () => openForm({ date: today() });
  $('#summary').onclick = () => { S.settings.summaryOpen = !S.settings.summaryOpen; saveSettings(); renderSummary(); };

  // Grade: toque abre o dia; deslizar troca o mês; toque longo inicia a seleção; arrastar seleciona vários
  const wrap = $('#gridWrap');
  let sx = 0, sy = 0, swiped = false, lp = null, dragMode = null, lastDrag = null;
  const cellAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest('.cell:not(.out)'); };
  wrap.addEventListener('touchstart', e => {
    const t = e.touches[0]; sx = t.clientX; sy = t.clientY; swiped = false;
    const c = cellAt(sx, sy);
    if (S.selecting) {
      if (c) { dragMode = !S.picked.has(c.dataset.date); lastDrag = c.dataset.date; togglePick(lastDrag, dragMode); swiped = true; }
      return;
    }
    clearTimeout(lp);
    if (c) lp = setTimeout(() => { swiped = true; navigator.vibrate && navigator.vibrate(12); enterSelect(c.dataset.date); }, 480);
  }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (Math.abs(t.clientX - sx) > 8 || Math.abs(t.clientY - sy) > 8) clearTimeout(lp);
    if (S.selecting && dragMode !== null) {
      const c = cellAt(t.clientX, t.clientY);
      if (c && c.dataset.date !== lastDrag) { lastDrag = c.dataset.date; togglePick(lastDrag, dragMode); }
    }
  }, { passive: true });
  wrap.addEventListener('touchend', e => {
    clearTimeout(lp);
    if (S.selecting) { dragMode = null; return; }
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiped = true; goMonth(dx < 0 ? 1 : -1); }
  }, { passive: true });
  $('#grid').addEventListener('contextmenu', e => e.preventDefault());
  $('#grid').addEventListener('click', e => {
    if (swiped) { swiped = false; return; }
    const c = e.target.closest('.cell'); if (!c) return;
    const date = c.dataset.date;
    if (S.selecting) { togglePick(date); return; }
    if (c.classList.contains('out')) { goMonth(date < iso(S.view.y, S.view.m, 1) ? -1 : 1); }
    openDay(date);
  });
  document.addEventListener('keydown', e => {
    if (layers.length) return;
    if (e.key === 'ArrowLeft') goMonth(-1);
    if (e.key === 'ArrowRight') goMonth(1);
  });

  // Seleção
  $('#btnSelClose').onclick = () => exitSelect();
  $('#btnSelWeek').onclick = () => {
    const base = S.lastPicked || today();
    const r = ops.scopeRange('week', base, S.settings.mondayFirst);
    const dates = []; for (let d = r.from; d <= r.to; d = addDays(d, 1)) dates.push(d);
    const on = !dates.filter(d => d.slice(0, 7) === base.slice(0, 7)).every(d => S.picked.has(d));
    dates.forEach(d => { if (d.slice(0, 7) === iso(S.view.y, S.view.m, 1).slice(0, 7)) on ? S.picked.add(d) : S.picked.delete(d); });
    updateSelUI();
  };
  $('#btnSelMonth').onclick = () => {
    const { y, m } = S.view;
    const all = []; for (let d = 1; d <= daysInMonth(y, m); d++) all.push(iso(y, m, d));
    const on = !all.every(d => S.picked.has(d));
    all.forEach(d => (on ? S.picked.add(d) : S.picked.delete(d)));
    updateSelUI();
  };
  $('#btnSelGo').onclick = () => { G.filter = 'all'; G.off = new Set(); renderGroup(); openLayer($('#groupSheet')); };
  $('#groupBody').onclick = e => {
    const f = e.target.closest('[data-f]');
    if (f) { G.filter = f.dataset.f; renderGroup(); return; }
    const p = e.target.closest('[data-e]');
    if (p) { const id = p.dataset.e; G.off.has(id) ? G.off.delete(id) : G.off.add(id); renderGroup(); }
  };
  $('#groupActions').onclick = e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) groupAction(b.dataset.act); };

  // Dia
  $('#btnDayAdd').onclick = () => openForm({ date: S.selected, paid: S.checking ? true : undefined });
  $('#btnDaySelect').onclick = async () => { const d = S.selected; await closeTop(); enterSelect(d); };
  $('#dayBody').addEventListener('click', e => {
    const row = e.target.closest('.item'); if (!row) return;
    const q = e.target.closest('[data-q]');
    const it = findItem(row.dataset.key, row.dataset.date);
    if (q && it) { commit(q.dataset.q === 'paid' ? 'Confirmado' : 'Marcado como não ocorrido', ops.planStatus([it], q.dataset.q, S.data)); return; }
    openActions(row.dataset.key, row.dataset.date);
  });
  $('#dayFoot').addEventListener('click', e => {
    const id = e.target.id;
    if (id === 'btnCheck') { S.checking = S.selected; renderDay(S.selected); }
    if (id === 'btnCheckAdd') openForm({ date: S.selected, paid: true });
    if (id === 'btnCheckDone') finishCheck([S.selected]);
  });
  $('#daySub').addEventListener('click', async e => {
    if (!e.target.closest('.checked-note')) return;
    if (!(await confirmDlg('Reabrir conferência?', 'O dia volta a ficar como não conferido.', 'Reabrir'))) return;
    const ch = ops.newChanges(); ch.checks.set(S.selected, null);
    commit('Conferência reaberta', ch);
  });

  // Menu
  $$('[data-setting]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.setting;
    S.settings[k] = el.checked;
    if (k === 'carry') { $$('.carry-only').forEach(x => { x.hidden = !el.checked; }); if (el.checked && !S.settings.startDate) { S.settings.startDate = iso(S.view.y, S.view.m, 1); $('#startDate').value = S.settings.startDate; } }
    saveSettings();
    if (k === 'carry' || k === 'holOptional') rebuild();
    if (k === 'mondayFirst') renderHeader();
    renderGrid();
    if (k === 'showTransfers' && S.selected && isOpen($('#daySheet'))) renderDay(S.selected);
  }));
  $('#basisSeg').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    S.settings.basis = b.dataset.basis; saveSettings();
    $$('#basisSeg button').forEach(x => x.classList.toggle('on', x === b));
    renderGrid();
  };
  $('#startDate').addEventListener('change', e => { S.settings.startDate = e.target.value || null; saveSettings(); rebuild(); renderGrid(); });
  $('#holState').addEventListener('change', e => { S.settings.holState = e.target.value; saveSettings(); rebuild(); renderGrid(); });
  $('#holCity').addEventListener('change', e => { S.settings.holCity = e.target.value; saveSettings(); rebuild(); renderGrid(); });
  $('#btnAddHoliday').onclick = async () => {
    const res = await dialog({
      title: 'Novo feriado',
      html: `<input type="date" id="chDate" value="${S.selected || today()}"><input type="text" id="chName" placeholder="Nome" maxlength="40">`,
      actions: [{ label: 'Cancelar', value: null }, { label: 'Adicionar', cls: 'primary', validate: () => !!$('#chDate').value, value: () => ({ date: $('#chDate').value, name: $('#chName').value.trim() || 'Feriado' }) }],
    });
    if (!res) return;
    S.settings.customHolidays = [...S.settings.customHolidays.filter(h => h.date !== res.date), res].sort((a, b) => a.date.localeCompare(b.date));
    saveSettings(); syncDrawer(); rebuild(); renderGrid();
  };
  $('#customHolList').onclick = e => { const b = e.target.closest('[data-del-hol]'); if (!b) return; S.settings.customHolidays.splice(+b.dataset.delHol, 1); saveSettings(); syncDrawer(); rebuild(); renderGrid(); };
  $('#btnNewTag').onclick = () => tagDialog();
  $('#tagList').addEventListener('click', e => { const b = e.target.closest('[data-edit-tag]'); if (b) tagDialog(tag(b.dataset.editTag)); });
  $('#tagList').addEventListener('change', e => {
    const id = e.target.dataset.tag; if (!id) return;
    const set = new Set(S.settings.hiddenTags);
    e.target.checked ? set.delete(id) : set.add(id);
    S.settings.hiddenTags = [...set];
    e.target.closest('.tag-row').classList.toggle('off', !e.target.checked);
    saveSettings(); renderGrid();
  });
  $('#btnSample').onclick = loadSample;
  $('#accFilter').addEventListener('change', e => {
    const id = e.target.dataset.acc; if (!id) return;
    const set = new Set(S.settings.hiddenAccounts);
    e.target.checked ? set.delete(id) : set.add(id);
    S.settings.hiddenAccounts = [...set]; saveSettings(); refresh();
  });
  $('#panelCfg').addEventListener('change', e => { const k = e.target.dataset.panel; if (!k) return; S.settings.panels = { ...S.settings.panels, [k]: e.target.checked }; saveSettings(); refreshDerived(); });
  $('#alertCfg').addEventListener('change', e => { const k = e.target.dataset.alert; if (!k) return; S.settings.alerts = { ...S.settings.alerts, [k]: e.target.checked }; saveSettings(); refreshDerived(); });
  $$('[data-page]').forEach(b => { b.onclick = async () => { await closeAll(); pages.open(b.dataset.page); }; });
  $('#btnAlerts').onclick = async () => { await closeAll(); pages.open('alerts'); };
  $('#btnExport').onclick = () => pages.exportBackup();
  $('#btnImport').onclick = () => $('#importFile').click();
  $('#importFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) pages.importBackup(f); });
  $('#btnInstall').onclick = async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('#btnInstall').hidden = true; };
  $('#btnWipe').onclick = wipeAll;

  // Formulário
  $('#entryForm').addEventListener('submit', saveForm);
  $('#kindSeg').onclick = e => { const b = e.target.closest('button'); if (b && !b.disabled) setKind(b.dataset.kind); };
  $('#fRule').addEventListener('change', updateRuleUI);
  $('#fNoEnd').addEventListener('change', updateRuleUI);
  $('#fRuleToggle').onclick = () => { Fm.ruleOpen = !Fm.ruleOpen; updateRuleUI(); };
  $('#fDate').addEventListener('change', () => { if (Fm.mode === 'new' && $('#fRule').value === 'monthlyDay') $('#fDay').value = +$('#fDate').value.slice(8); if (Fm.mode === 'new') $('#fPaid').checked = $('#fDate').value <= today(); });
  $('#fWeekdays').onclick = e => { const b = e.target.closest('[data-w]'); if (!b) return; const w = +b.dataset.w; Fm.weekdays.has(w) ? Fm.weekdays.delete(w) : Fm.weekdays.add(w); updateRuleUI(); };
  $('#fDateAdd').addEventListener('change', e => { if (e.target.value && !Fm.dates.includes(e.target.value)) { Fm.dates.push(e.target.value); Fm.dates.sort(); } e.target.value = ''; updateRuleUI(); });
  $('#fDates').onclick = e => { const b = e.target.closest('[data-d]'); if (b) { Fm.dates = Fm.dates.filter(d => d !== b.dataset.d); updateRuleUI(); } };
  $('#fTag').addEventListener('change', async e => {
    if (e.target.value !== '__new') return;
    e.target.value = '';
    const t = await tagDialog(null, Fm.kind);
    fillTagSelect(t ? t.id : '');
  });
  $('#btnDelete').onclick = deleteFlow;
  $('#fSplit').addEventListener('change', () => { Fm.splits = []; updateSplitUI(); });
  $('#fRule').addEventListener('change', updateSplitUI);
  $('#fAmount').addEventListener('change', () => { if (!$('#fSplitBox').hidden && $('#fSplit').checked) updateSplitUI(); });
  $('#fSplits').addEventListener('change', e => {
    const i = e.target.dataset.si ?? e.target.dataset.sa;
    if (i === undefined) return;
    if (e.target.dataset.si !== undefined) { Fm.splits[i].tagId = e.target.value; return; }
    Fm.splits[i].amount = parseMoney(e.target.value) || 0;
    const total = parseMoney($('#fAmount').value) || 0;
    // com duas partes, a outra recebe automaticamente o que falta
    if (Fm.splits.length === 2) {
      const o = 1 - +i;
      Fm.splits[o].amount = Math.max(0, total - Fm.splits[i].amount);
      const other = $(`#fSplits [data-sa="${o}"]`); if (other) other.value = moneyInput(Fm.splits[o].amount);
    }
    const sum = Fm.splits.reduce((a, p) => a + (p.amount || 0), 0);
    const foot = $('#fSplits .split-foot span');
    if (foot) { foot.textContent = `${money(sum)} de ${money(total)}`; foot.className = sum === total ? '' : 'neg'; }
  });
  $('#fSplits').addEventListener('click', e => {
    if (e.target.id === 'fSplitAdd') {
      const total = parseMoney($('#fAmount').value) || 0;
      const sum = Fm.splits.reduce((a, p) => a + (p.amount || 0), 0);
      Fm.splits.push({ tagId: '', amount: Math.max(0, total - sum) }); updateSplitUI(); return;
    }
    const x = e.target.closest('[data-sx]');
    if (x) { Fm.splits.splice(+x.dataset.sx, 1); updateSplitUI(); }
  });
}

function fillStaticSelects() {
  $('#fRule').innerHTML = Object.entries(RULES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  const nth = [];
  for (let i = 1; i <= 10; i++) nth.push(`<option value="${i}">${i}º dia útil</option>`);
  nth.push('<option value="-1">Último dia útil</option><option value="-2">Penúltimo dia útil</option>');
  $('#fNth').innerHTML = nth.join('');
  $('#holState').innerHTML = '<option value="">Nenhum</option>' + Object.entries(LOCALES.states).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  $('#holCity').innerHTML = '<option value="">Nenhum</option>' + Object.entries(LOCALES.cities).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  $('#appVersion').textContent = `Versão ${APP_VERSION}`;
}

/** Garante a conta principal (migração das versões anteriores: saldo inicial vira o da conta). */
async function ensureDefaultAccount() {
  let id = S.settings.defaultAccount;
  if (id && S.accounts.has(id)) return;
  const first = accountsList(true)[0];
  if (first) { id = first.id; }
  else {
    const a = { id: uid(), name: 'Principal', type: 'checking', institution: '', initialBalance: S.settings.initialBalance || 0, color: '#0a84ff', purpose: 'Despesas do dia a dia', includeInTotal: true, archived: false, allowedTags: [], rules: [], order: 0, createdAt: nowISO() };
    await db.put('accounts', a);
    S.accounts.set(a.id, a);
    id = a.id;
  }
  S.settings.defaultAccount = id;
  await db.put('settings', { key: 'app', value: S.settings });
}

/** Contexto compartilhado com as páginas (contas, cofrinhos, metas, relatórios...). */
function ctx() {
  return {
    S, $, $$, esc, money, signed, compact, moneyInput, parseMoney, sgnCls, dm, dmy, cap, uid, nowISO, icon, today,
    dialog, confirmDlg, closeTop, closeAll, openLayer, isOpen, toast, refresh, rebuild, saveSettings, commit, undoLast,
    ops, F, db, tag, tagColor, tagsSorted, accountsList, accName, itemTitle, itemColor, itemSign, amtCls, statusLabel,
    budgetCtx, openForm, openDay: d => { S.view = parse(d); renderHeader(); renderGrid(); openDay(d); }, renderHeader, renderGrid,
    syncDrawer, ensureDefaultAccount, DEFAULTS, PALETTE,
  };
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });

async function init() {
  hydrateIcons();
  fillStaticSelects();
  const t = parse(today());
  S.view = { y: t.y, m: t.m };
  S.selected = today();
  try {
    const [entries, overrides, tags, settings, checks, accounts, piggies, metas] = await Promise.all(['entries', 'overrides', 'tags', 'settings', 'checks', 'accounts', 'piggies', 'metas'].map(db.getAll));
    accounts.forEach(a => S.accounts.set(a.id, a));
    piggies.forEach(x => S.piggies.set(x.id, x));
    metas.forEach(x => S.metas.set(x.id, x));
    entries.forEach(e => S.entries.set(e.id, e));
    overrides.forEach(o => S.overrides.set(o.key, o));
    tags.forEach(x => S.tags.set(x.id, x));
    checks.forEach(c => S.checks.set(c.date, c));
    const app = settings.find(s => s.key === 'app');
    if (app) S.settings = { ...DEFAULTS, ...app.value };
    await ensureDefaultAccount();
  } catch (err) {
    console.error(err);
    toast('Não foi possível abrir o armazenamento local');
  }
  pages.init(ctx());
  rebuild();
  renderHeader();
  renderGrid();
  bind();
  refreshDerived();
  db.requestPersistence();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
