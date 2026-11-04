// Calendário Financeiro — interface (Etapa 2)
import * as db from './db.js';
import { createCalculator, RULES, attrsAt, occKey, itemsInRange, flowOf } from './engine.js';
import { makeHolidayLookup, LOCALES, holidayNames } from './holidays.js';
import * as ops from './ops.js';
import * as F from './finance.js';
import * as pages from './pages.js';
import { icon, hydrateIcons } from './icons.js';
import { iso, parse, addMonths, todayISO, weekday, addDays, daysInMonth, MONTHS, WEEKDAYS_SHORT, WEEKDAYS_LONG } from './dates.js';

export const APP_VERSION = '2.0.2';

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
  showTransfers: true, hiddenAccounts: [], activeAccount: null, defaultAccount: null, panels: {}, alerts: {}, lastBackup: null,
  basis: 'planned', carry: false, initialBalance: 0, startDate: null,
  mondayFirst: false, holState: '', holCity: '', holOptional: false, customHolidays: [], disabledHolidays: [],
  summaryOpen: false, calExpanded: false, edgeY: null, calView: 'month',
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
/**
 * Conta exibida (o "mundo"): uma conta por vez, escolhida no topo do menu (Conta 1 | Conta 2).
 * Lançamentos, metas, cofrinhos, alertas e relatórios de uma conta não aparecem na outra.
 * Só a exibição muda — nada é apagado e os saldos de cada conta continuam corretos.
 */
function activeAccount() {
  const list = accountsList();
  if (!list.length) return null;
  const ids = new Set(list.map(a => a.id));
  if (ids.has(S.settings.activeAccount)) return S.settings.activeAccount;
  // vindo de versões anteriores: a conta principal (se estava visível) ou a primeira conta visível
  const hidden = new Set(S.settings.hiddenAccounts || []);
  if (ids.has(S.settings.defaultAccount) && !hidden.has(S.settings.defaultAccount)) return S.settings.defaultAccount;
  return (list.find(a => !hidden.has(a.id)) || list[0]).id;
}
function visibleAccounts() {
  const a = activeAccount();
  return new Set(a ? [a] : []);
}
const filtering = () => multiAcc();
/** Tag "pertence" às contas onde é usada (lançamentos e metas); tag nunca usada aparece em todas. */
function tagInWorld(t) {
  if (!multiAcc() || !S.set) return true;
  const where = new Set();
  for (const e of S.entries.values()) {
    const ids = e.splits ? e.splits.map(p => p.tagId) : [e.tagId, ...(e.segments || []).map(g => g.tagId)];
    if (ids.includes(t.id)) where.add(e.accountId || S.settings.defaultAccount);
  }
  for (const m of S.metas.values()) {
    if (m.archived || !(m.tagIds || []).includes(t.id)) continue;
    if (!(m.accountIds || []).length) return true;
    m.accountIds.forEach(id => where.add(id));
  }
  return !where.size || [...where].some(id => S.set.has(id));
}
function accVisible(it) {
  if (!S.set) return true;
  if (it.kind === 'transfer') return S.set.has(it.accountId) || S.set.has(it.toAccountId);
  return S.set.has(it.accountId);
}
/** Meta visível: ligada a alguma conta visível (ou a todas). */
function metaVisible(m) {
  if (m.archived) return false;
  const ids = m.accountIds || [];
  return !ids.length || ids.some(id => S.set.has(id));
}
/** Meta "para todas as contas" passa a contar só as contas visíveis quando há filtro. */
function scopedMeta(m) {
  const ids = m.accountIds || [];
  if (!filtering()) return m;
  return { ...m, accountIds: ids.length ? ids.filter(id => S.set.has(id)) : [...S.set] };
}
/** Cor de exibição da tag: variação da cor da meta, quando a meta pede isso. */
function tagColor(t) {
  if (!t) return null;
  for (const m of S.metas.values()) {
    if (m.archived || !m.tintTags || !(m.tagIds || []).includes(t.id)) continue;
    const i = m.tagIds.indexOf(t.id);
    return shade(m.color || '#8cb6e4', [0, 0.28, -0.22, 0.45, -0.38, 0.6][i % 6]);
  }
  return t.color;
}
/**
 * Cor da tag na etiqueta, no estilo dos eventos do Samsung Calendar: o mesmo matiz da tag, mas vivo e limpo
 * (como #52B7D3 e #EC514D). A barrinha usa essa cor; o fundo da etiqueta é a mesma cor bem escura (~17%),
 * como o quadrado tingido do Samsung (#0B1C23 / #250D0D); o texto é branco.
 */
const VAR_HEX = { 'var(--green)': '#55C98B', 'var(--red)': '#E47777', 'var(--accent)': '#A9D4F5' };
function chipColor(c) {
  const hex = VAR_HEX[c] || c;
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#52B7D3';
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.06) return '#9A9AA0'; // cinzas continuam cinzas
  let h = ((mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  const l0 = (mx + mn) / 2, s0 = d / (1 - Math.abs(2 * l0 - 1));
  const S2 = Math.min(0.85, Math.max(0.62, s0));
  const base = h >= 40 && h <= 170 ? 0.52 : 0.6; // amarelos e verdes vivos ficam um pouco mais escuros para não "brilhar"
  // tags da mesma meta (tons da cor da meta) continuam um pouco diferentes entre si
  const L2 = Math.min(0.68, Math.max(0.45, base + (l0 - 0.5) * 0.2));
  const k = (1 - Math.abs(2 * L2 - 1)) * S2, x = k * (1 - Math.abs(((h / 60) % 2) - 1)), m = L2 - k / 2;
  const [R, G, B] = h < 60 ? [k, x, 0] : h < 120 ? [x, k, 0] : h < 180 ? [0, k, x] : h < 240 ? [0, x, k] : h < 300 ? [x, 0, k] : [k, 0, x];
  return '#' + [R, G, B].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map(c => Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f)));
  return '#' + ch.map(c => c.toString(16).padStart(2, '0')).join('');
}
const tagsSorted = () => [...S.tags.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

function rebuild() {
  const s = S.settings;
  S.isHoliday = makeHolidayLookup({ state: s.holState, city: s.holCity, optional: s.holOptional, custom: s.customHolidays, disabled: s.disabledHolidays });
  S.data = { entries: [...S.entries.values()], overrides: S.overrides, isHoliday: S.isHoliday, defaultAccount: s.defaultAccount };
  S.set = visibleAccounts();
  const initial = [...S.set].reduce((t, id) => t + ((S.accounts.get(id) || {}).initialBalance || 0), 0);
  S.calc = createCalculator(S.data, { carry: s.carry, initialBalance: initial, startDate: s.startDate || iso(S.view.y, S.view.m, 1), accounts: S.set });
}

let saveTimer;
const SETTING_NAMES = {
  showIncome: 'Exibir receitas', showExpense: 'Exibir despesas', showTags: 'Exibir tags', hiddenTags: 'Tags visíveis', showMovement: 'Movimento do dia',
  showTransfers: 'Transferências e cofrinhos', hiddenAccounts: 'Contas no calendário', activeAccount: 'Conta exibida', basis: 'Previsto/realizado', carry: 'Acumular meses',
  startDate: 'Início do saldo', mondayFirst: 'Início da semana', holState: 'Feriados estaduais', holCity: 'Feriados municipais',
  holOptional: 'Pontos facultativos', customHolidays: 'Feriados próprios', disabledHolidays: 'Feriados ligados', panels: 'Painéis', alerts: 'Alertas', defaultAccount: 'Conta principal',
};
let lastSaved = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const now = JSON.parse(JSON.stringify(S.settings));
    if (lastSaved) {
      const changed = Object.keys(SETTING_NAMES).filter(k => JSON.stringify(now[k]) !== JSON.stringify(lastSaved[k]));
      if (changed.length) db.log(`Configuração alterada: ${changed.map(k => SETTING_NAMES[k]).join(', ')}`, { keys: changed });
    }
    lastSaved = now;
    db.put('settings', { key: 'app', value: S.settings });
  }, 400);
}

// ---------- Gravação com desfazer ----------
const undoStack = [];
const STORE_OF = { entries: 'entries', overrides: 'overrides', checks: 'checks' };

const ST_NAMES = { planned: 'previsto', paid: 'pago', pending: 'pendente', cancelled: 'cancelado', partial: 'parcial' };
/** Texto do histórico: o que mudou, com valores anteriores e posteriores. */
function describeChanges(ch) {
  const out = [];
  const m = c => (c == null ? '—' : money(c));
  for (const [key, after] of ch.overrides) {
    const before = S.overrides.get(key) || {};
    const e = S.entries.get((after || before).entryId) || ch.entries.get((after || before).entryId) || {};
    const who = `${e.title || (tag(e.tagId) || {}).name || KIND_NAME[e.kind] || 'Lançamento'} ${dm(key.split('|')[1] || '')}`;
    const a = after || {};
    const parts = [];
    if ((before.status || 'planned') !== (a.status || 'planned')) parts.push(`situação: ${ST_NAMES[before.status || 'planned']} → ${ST_NAMES[a.status || 'planned']}`);
    if (before.amount !== a.amount) parts.push(`valor: ${before.amount != null ? m(before.amount) : m(e.amount)} → ${a.amount != null ? m(a.amount) : m(e.amount)}`);
    if (before.paidAmount !== a.paidAmount && (before.paidAmount || a.paidAmount)) parts.push(`valor pago: ${m(before.paidAmount || 0)} → ${m(a.paidAmount || 0)}`);
    if (before.movedTo !== a.movedTo) parts.push(`data: ${before.movedTo ? dm(before.movedTo) : 'original'} → ${a.movedTo ? dm(a.movedTo) : 'original'}`);
    if ((before.title ?? null) !== (a.title ?? null)) parts.push(`descrição: “${before.title ?? e.title ?? ''}” → “${a.title ?? e.title ?? ''}”`);
    if (('tagId' in before ? before.tagId : null) !== ('tagId' in a ? a.tagId : null)) parts.push('tag alterada');
    if (parts.length) out.push(`${who}: ${parts.join('; ')}`);
  }
  for (const [id, after] of ch.entries) {
    const before = S.entries.get(id);
    const name = (after || before || {}).title || KIND_NAME[(after || before || {}).kind] || 'Lançamento';
    if (!before && after) { out.push(`Criado: ${name} ${money(after.amount)} (${RULES[after.rule.type].toLowerCase()}, a partir de ${dm(after.rule.start)})`); continue; }
    if (before && !after) { out.push(`Excluído: ${name} ${money(before.amount)}`); continue; }
    const parts = [];
    if (before.amount !== after.amount) parts.push(`valor ${money(before.amount)} → ${money(after.amount)}`);
    if (before.title !== after.title) parts.push(`descrição “${before.title || ''}” → “${after.title || ''}”`);
    if (before.rule.type !== after.rule.type) parts.push(`repetição ${RULES[before.rule.type]} → ${RULES[after.rule.type]}`);
    if ((before.rule.end || '') !== (after.rule.end || '')) parts.push(`término ${before.rule.end ? dm(before.rule.end) : 'sem fim'} → ${after.rule.end ? dmy(after.rule.end) : 'sem fim'}`);
    if (before.accountId !== after.accountId) parts.push(`conta ${accName(before.accountId)} → ${accName(after.accountId)}`);
    if (JSON.stringify(before.segments || []) !== JSON.stringify(after.segments || [])) { const sg = (after.segments || []).at(-1); if (sg && sg.amount != null) parts.push(`novo valor ${money(sg.amount)} a partir de ${dmy(sg.from)}`); }
    if (parts.length) out.push(`${name}: ${parts.join('; ')}`);
  }
  for (const [d, after] of ch.checks) out.push(after ? `Dia ${dm(d)} conferido${after.noExpenses ? ' sem gastos' : ''}` : `Conferência de ${dm(d)} reaberta`);
  return out.length > 25 ? [...out.slice(0, 25), `… e mais ${out.length - 25} alteração(ões)`] : out;
}

async function commit(label, ch, { silent = false } = {}) {
  if (!ops.changeCount(ch)) return false;
  const inverse = ops.newChanges();
  for (const k of Object.keys(STORE_OF)) for (const [id] of ch[k]) inverse[k].set(id, S[k].get(id) ?? null);
  const details = describeChanges(ch); // antes de aplicar: precisa do estado anterior
  await applyChanges(ch);
  undoStack.push({ label, inverse });
  if (undoStack.length > 30) undoStack.shift();
  db.log(label, { details, entries: [...ch.entries], overrides: [...ch.overrides], checks: [...ch.checks] });
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

// ---------- Tela larga (PC/tablet): detalhes do dia ficam fixos à direita ----------
const wideMQ = window.matchMedia('(min-width: 1100px)');
const isWide = () => wideMQ.matches;
const dayVisible = () => (isWide() ? !!S.dayOpen : isOpen($('#daySheet')));
function applyLayout() {
  document.body.classList.toggle('wide', isWide());
  if (isWide() && S.calc) { syncDrawer(); storageInfo(); }
  const ds = $('#daySheet');
  if (isWide()) {
    if (isOpen(ds)) { const i = layers.findIndex(l => l.el === ds); if (i >= 0) layers.splice(i, 1); updateScrim(); S.dayOpen = true; }
    ds.classList.add('docked');
    setDock(true); // no PC o painel do dia fica sempre ao lado do calendário
  } else {
    ds.classList.remove('docked');
    document.body.classList.remove('day-open');
    if (!isOpen(ds)) { ds.classList.remove('on'); ds.setAttribute('aria-hidden', 'true'); }
  }
  if (S.calc) renderGrid();
}
/** PC: painel do dia à direita, aberto só quando o usuário escolhe uma data. */
function setDock(open) {
  S.dayOpen = open;
  const ds = $('#daySheet');
  ds.classList.toggle('on', open);
  ds.setAttribute('aria-hidden', String(!open));
  document.body.classList.toggle('day-open', open);
  if (open && S.calc) renderDay(S.selected || today());
}
wideMQ.addEventListener('change', applyLayout);

// ---------- Altura das células: compacta x expandida (só visualização) ----------
const CAL = { rows: 6, compact: 64, expanded: 140, lines: 0 };
const isExpanded = () => isWide() || !!S.settings.calExpanded;
function measureCal() {
  const grid = $('#grid'); if (!grid) return;
  const vh = window.innerHeight;
  const top = grid.getBoundingClientRect().top + window.scrollY;
  // espaço abaixo da grade: alça + linha de saldo + margem; inclui as frestas entre os quadrados,
  // para o mês caber inteiro na tela sem rolar (e o cabeçalho dos dias da semana nunca ficar escondido)
  const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
  const reserve = isWide()
    ? 24 + (parseFloat(getComputedStyle($('main')).paddingBottom) || 0)
    : 84; // o resumo agora fica em cima; embaixo só o espaço do botão +
  const fill = Math.floor((vh - top - reserve - gap * (CAL.rows - 1)) / CAL.rows);
  CAL.compact = Math.max(46, Math.min(92, Math.floor((vh - 240) / 6)));
  // PC: dias com altura máxima confortável (e o mês inteiro cabendo na tela); celular: expandido preenche a tela
  CAL.expanded = isWide() ? Math.max(84, Math.min(fill, 200)) : Math.max(CAL.compact + 24, fill);
  // quantas linhas de lançamento cabem no dia expandido (o conteúdo é montado uma vez só)
  const lineH = isWide() ? 18 : window.innerWidth < 600 ? 27 : 18; // etiqueta + fresta (celular: etiqueta de 2 linhas)
  CAL.lines = Math.max(1, Math.floor((CAL.expanded - (isWide() ? 64 : 50)) / lineH));
  applyCellHeight(isExpanded() ? CAL.expanded : CAL.compact);
}
function applyCellHeight(h) {
  $('#grid').style.setProperty('--cell-h', h + 'px');
  // as linhas aparecem quando a célula já ganhou espaço suficiente
  document.body.classList.toggle('cal-exp', isWide() || h > CAL.compact + 14);
}
function setExpanded(open) {
  S.settings.calExpanded = !!open;
  saveSettings();
  applyCellHeight(isExpanded() ? CAL.expanded : CAL.compact);
  $('#calHandle').classList.toggle('up', isExpanded());
  $('#calHandle').setAttribute('aria-label', isExpanded() ? 'Recolher o calendário' : 'Expandir o calendário');
  syncViewBtn();
  if (S.calc) renderGrid();
}
/** Interruptor "Calendário ampliado" (menu › Exibição): mostra os lançamentos dentro dos dias. */
function syncViewBtn() {
  const sw = $('#swExpand'); if (sw) sw.checked = isExpanded();
}
window.addEventListener('resize', () => { clearTimeout(measureCal.t); measureCal.t = setTimeout(() => { measureCal(); if (S.calc) renderGrid(); }, 120); });

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
  const { y, m } = S.view, v = calView();
  if (v === 'day' || v === 'week') {
    const d = S.selected || today();
    $('#monthName').textContent = MONTHS[+d.slice(5, 7) - 1]; $('#yearName').textContent = d.slice(0, 4);
  } else if (v === 'year') { $('#monthName').textContent = String(y); $('#yearName').textContent = ''; }
  else {
  $('#monthName').textContent = MONTHS[m - 1];
  $('#yearName').textContent = y;
  }
  // com mais de uma conta, mostra qual conta ("mundo") está sendo exibida
  const shown = filtering() ? accountsList().filter(x => S.set && S.set.has(x.id)).map(x => x.name) : [];
  $('#accLabel').textContent = shown.length ? shown.join(' + ') : (filtering() ? 'Nenhuma conta' : '');
  const order = S.settings.mondayFirst ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  $('#weekdays').innerHTML = order.map(w => `<div${w === 0 || w === 6 ? ' class="sun"' : ''}>${WEEKDAYS_SHORT[w]}</div>`).join('');
}

const countsPlanned = it => it.status === 'planned' || it.status === 'paid' || it.status === 'pending' || it.status === 'partial';
const budgetCtx = () => ({ data: S.data, checks: S.checks, today: today(), isHoliday: S.isHoliday, mondayFirst: S.settings.mondayFirst });
const calendarMeta = () => { const m = [...S.metas.values()].find(x => metaVisible(x) && x.showOnCalendar && F.DAY_PERIODS.has(x.period)); return m ? scopedMeta(m) : null; };
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
  const alt = calView() !== 'month';
  document.body.classList.toggle('alt-on', alt);
  $('#altView').hidden = !alt;
  if (alt) { renderAlt(); renderSummary(); return; }
  const s = S.settings, t = today();
  const first = iso(y, m, 1);
  const lead = (weekday(first) - (s.mondayFirst ? 1 : 0) + 7) % 7;
  const total = Math.ceil((lead + month.days.length) / 7) * 7;
  if (CAL.rows !== total / 7) { CAL.rows = total / 7; measureCal(); }
  const hidden = new Set(s.hiddenTags);
  const maxLines = CAL.lines;
  const start = addDays(first, -lead);
  // Tags ligadas = modo detalhado; desligadas = modo limpo (só número do dia e saldo acumulado).
  const detail = detailed();
  const cm = detail ? calendarMeta() : null;
  const bud = cm ? F.dailyBudget(cm, first, iso(y, m, month.days.length), budgetCtx()) : null;
  $('#grid').classList.toggle('clean', !detail);
  let html = '';
  for (let i = 0; i < total; i++) {
    const date = addDays(start, i);
    const w = weekday(date);
    const inMonth = date.slice(0, 7) === first.slice(0, 7);
    let cls = 'cell';
    if (!inMonth) cls += ' out';
    if (w === 0 || w === 6) cls += ' wkend';
    if (w === 0) cls += ' sun';
    if (S.isHoliday(date)) cls += ' hol';
    if (date === t) cls += ' today';
    if (S.selecting ? S.picked.has(date) : date === S.selected && dayVisible() && (!isWide() || S.dayChosen)) cls += S.selecting ? ' picked' : ' sel';
    const n = +date.slice(8);
    if (!inMonth) { html += `<button class="${cls}" data-date="${date}"><span class="num">${n}</span></button>`; continue; }
    const day = month.days[n - 1];
    let inner = `<span class="num">${n}</span>`;
    const mv = dayMovement(day);
    if (detail) {
      // modo detalhado: lançamentos (tag, descrição e valor) com a identificação discreta de cada tag
      if (day.items.some(it => it.status === 'pending' && accVisible(it))) inner += '<span class="flag"></span>';
      if (maxLines) inner += dayLines(day, maxLines);
      const colors = new Map();
      for (const it of day.items) {
        if (!countsPlanned(it) || !accVisible(it) || !passesFilters(it)) continue;
        // lançamento direto na meta (sem tag, ex.: Lazer nos fins de semana e feriados) mostra a cor da meta
        if (!it.tagId && !it.splits) { if (it.metaId && S.metas.get(it.metaId)) colors.set(`meta:${it.metaId}`, chipColor(itemColor(it))); continue; }
        for (const tid of it.splits ? it.splits.map(p => p.tagId) : [it.tagId]) {
          const tg = tag(tid);
          if (tg && !hidden.has(tg.id)) colors.set(tg.id, chipColor(tagColor(tg)));
        }
      }
      inner += `<span class="tags">${[...colors.values()].slice(0, 4).map(c => `<i style="background:${c}"></i>`).join('')}</span>`;
      const b = bud && bud.get(date);
      if (b) inner += `<span class="bud s-${b.status}" style="background:${b.status === 'over' ? cm.colorBad || 'var(--red)' : cm.colorGood || 'var(--green)'};--good:${cm.colorGood || 'var(--green)'}"></span>`;
      if (s.showMovement && mv !== null) inner += `<span class="mv">${compact(mv)}</span>`;
    }
    // modo limpo e detalhado: o saldo acumulado do dia, no rodapé (mesmo cálculo nos dois modos)
    const v = cellValue(day);
    if (v !== null) inner += `<span class="val ${v ? sgnCls(v) : 'zero'}${mv === null ? ' still' : ''}">${compact(v)}</span>`;
    html += `<button class="${cls}" data-date="${date}">${inner}</button>`;
  }
  const grid = $('#grid');
  grid.innerHTML = html;
  if (anim) { grid.classList.remove('anim-l', 'anim-r'); void grid.offsetWidth; grid.classList.add(anim); }
  renderSummary();
}

/** Lançamentos escritos dentro do dia (modo detalhado, expandido/PC). Respeita os filtros; não altera nada. */
function dayLines(day, max) {
  const s = S.settings;
  // Receitas/Despesas e tags escondidas decidem QUAIS lançamentos aparecem. Nada disso mexe nos cálculos.
  const list = day.items.filter(it => countsPlanned(it) && accVisible(it) &&
    (it.kind === 'income' || it.kind === 'expense' || (it.kind === 'transfer' && s.showTransfers)) && passesFilters(it));
  // feriado: só o número do dia muda de cor (o calendário não é agenda; as etiquetas são só das tags)
  const room = max;
  if (!list.length) return '';
  const order = { income: 0, transfer: 1, expense: 2 };
  list.sort((a, b) => (order[a.kind] - order[b.kind]) || (b.amount - a.amount));
  // com espaço para uma linha só, mostra o primeiro lançamento (sem trocar por "+n")
  const show = list.length > room ? list.slice(0, room >= 2 ? room - 1 : room) : list;
  const rest = list.length - show.length;
  const line = it => {
    const tg = tag(it.tagId);
    const name = itemTitle(it);
    const sg = itemSign(it);
    // dica ao passar o mouse (PC): tag · descrição · valor
    const tip = [tg && tg.name !== name ? tg.name : null, name, `${sg}${money(it.amount)}`].filter(Boolean).join(' · ');
    // etiqueta no estilo dos eventos do Samsung: barrinha viva na cor da tag, fundo da mesma cor bem escuro, texto branco
    return `<span class="ln${it.status === 'paid' ? ' done' : ''}" style="--c:${chipColor(itemColor(it))}" title="${esc(tip)}"><i></i><b>${esc(name)}</b><em>${sg === '+' ? '+' : sg === '−' ? '−' : ''}${compact(it.amount).replace(/^[+−]/, '')}</em></span>`;
  };
  return `<span class="lns">${show.map(line).join('')}${rest ? `<span class="ln more">+${rest}</span>` : ''}</span>`;
}

/**
 * Resumo embaixo do calendário (como no app antigo):
 *  - Saldo na conta: o dinheiro de verdade hoje (só o que já foi pago/recebido), da conta exibida;
 *  - Até a próxima receita: quanto sobra (ou falta) até o próximo recebimento, pagando o previsto de cada dia,
 *    inclusive os gastos do dia em que ele cai;
 *  - Receitas e gastos previstos do mês exibido, e quanto vai sobrar no fim desse mês.
 */
/** PC: o painel do dia começa no topo do resumo e termina no fim do calendário. */
function placeDock() {
  if (!isWide()) return;
  requestAnimationFrame(() => {
    const top = $('#summary').getBoundingClientRect().top;
    const cal = document.body.classList.contains('alt-on') ? $('#altView') : $('#gridWrap');
    const bottom = Math.min(cal.getBoundingClientRect().bottom, window.innerHeight - 16);
    const st = document.documentElement.style;
    st.setProperty('--dockTop', Math.max(8, Math.round(top)) + 'px');
    st.setProperty('--dockH', Math.max(240, Math.round(bottom - Math.max(8, top))) + 'px');
  });
}
function renderSummary() {
  placeDock();
  const mo = S.month, t = mo.totals, last = mo.days[mo.days.length - 1], td = today();
  // saldo na conta (realizado), contas visíveis
  const bal = F.balances({ data: S.data, accounts: accountsList(true), today: td, planUpto: td });
  const now = [...S.set].reduce((a, id) => a + ((bal.accounts.get(id) || {}).real || 0), 0);
  $('#mbBal').textContent = signed(now).replace(/^\+/, '');
  $('#mbBal').className = now < 0 ? 'neg' : '';
  // próxima receita depois de hoje (até 3 meses)
  const nx = nextIncome(td);
  if (nx) {
    const left = untilNextIncome(td, nx.date, now);
    // como no app antigo: "FALTAM/SOBRA ATÉ RECEBER" (o nome da receita fica no título, ao segurar o dedo)
    $('#mbNextLabel').textContent = `${left < 0 ? 'Faltam' : 'Sobra'} até receber · ${dm(nx.date)}`;
    $('#summary .mb-next').title = `${nx.title} em ${dm(nx.date)}`;
    $('#mbNext').textContent = money(Math.abs(left));
    $('#mbNext').className = left < 0 ? 'neg' : 'pos';
  } else {
    $('#mbNextLabel').textContent = 'Até a próxima receita';
    $('#mbNext').textContent = '—'; $('#mbNext').className = '';
  }
  $('#mbInc').textContent = money(t.inc);
  $('#mbExp').textContent = money(t.exp);
  const end = last.cumNet;
  $('#summaryLabel').textContent = 'Vai sobrar';
  $('#summaryValue').textContent = signed(end);
  $('#summaryValue').className = sgnCls(end);
}
/** Próximo recebimento previsto (ainda não recebido) depois de hoje, nas contas exibidas. */
function nextIncome(td) {
  const to = addDays(td, 100);
  const byDate = itemsInRange(addDays(td, 1), to, S.data);
  for (const d of [...byDate.keys()].sort()) {
    if (d <= td) continue;
    const it = byDate.get(d).find(i => i.kind === 'income' && countsPlanned(i) && i.status !== 'paid' && accVisible(i));
    if (it) return { date: d, title: itemTitle(it) };
  }
  return null;
}
/** Dinheiro de hoje + o que ainda vai entrar/sair de hoje até a véspera da receita − os gastos do dia dela. */
function untilNextIncome(td, H, now) {
  let v = now;
  for (const [d, list] of itemsInRange(td, H, S.data)) {
    for (const it of list) {
      if (it.status === 'moved' || !countsPlanned(it)) continue;
      const f = flowOf(it, S.set); if (!f) continue;
      if (d < H) v += (f.inc - f.incR) - (f.exp - f.expR) + (f.tr - f.trR);
      else v -= (f.exp - f.expR); // no dia da receita, só os gastos
    }
  }
  return v;
}

function goMonth(delta) {
  const v = calView();
  if (v === 'day' || v === 'week') {
    S.selected = addDays(S.selected || today(), delta * (v === 'week' ? 7 : 1));
    S.view = { y: +S.selected.slice(0, 4), m: +S.selected.slice(5, 7) };
  } else if (v === 'year') S.view = { y: S.view.y + delta, m: S.view.m };
  else S.view = addMonths(S.view.y, S.view.m, delta); // mês e agenda
  renderHeader();
  renderGrid(delta > 0 ? 'anim-l' : 'anim-r');
  if (S.selecting) updateSelUI();
}
function goToday() {
  const t = parse(today());
  if (calView() !== 'month') {
    S.selected = today(); S.view = { y: t.y, m: t.m };
    renderHeader(); renderGrid(); return;
  }
  const delta = (t.y * 12 + t.m) - (S.view.y * 12 + S.view.m);
  if (delta) goMonth(delta);
}

// ---------- Visualizações: Dia, Semana, Mês, Ano (botão do topo) ----------
const calView = () => S.settings.calView || 'month';
function setView(v) {
  if (v === calView()) return;
  S.settings.calView = v; saveSettings();
  if (v === 'day' || v === 'week') {
    // começa pelo dia escolhido (ou hoje, se ele não estiver no mês exibido)
    const inView = S.selected && +S.selected.slice(0, 4) === S.view.y && +S.selected.slice(5, 7) === S.view.m;
    if (!inView) S.selected = (S.view.y === parse(today()).y && S.view.m === parse(today()).m) ? today() : iso(S.view.y, S.view.m, 1);
  }
  renderHeader();
  renderGrid();
}
// Como no app antigo: Semana = faixa com os 7 dias + o dia escolhido; Dia = o dia; Ano = 12 mini calendários;
// Agenda = os dias do mês que têm lançamentos. Nos previstos: Paguei/Recebi, Editar, Não ocorreu.
const DOW = ['DOM.', 'SEG.', 'TER.', 'QUA.', 'QUI.', 'SEX.', 'SÁB.'];
const DOW_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MONTH_SHORT = m => MONTHS[m - 1].slice(0, 3).toLowerCase();
const isOffDay = d => { const w = weekday(d); return w === 0 || w === 6 || !!S.isHoliday(d); };
/** Lançamentos de um dia na ordem do calendário (mesmos filtros da grade). */
function dayList(day) {
  const s = S.settings;
  const list = day.items.filter(it => countsPlanned(it) && accVisible(it) &&
    (it.kind === 'income' || it.kind === 'expense' || (it.kind === 'transfer' && s.showTransfers)) && passesFilters(it));
  const order = { income: 0, transfer: 1, expense: 2 };
  return list.sort((a, b) => (order[a.kind] - order[b.kind]) || (b.amount - a.amount));
}
/** Conteúdo de um dia (como o leanDayHtml do app antigo). lite = sem o cartão de saldo (Agenda). */
function dayContent(d, lite = false) {
  const day = dayData(d), val = cellValue(day), list = dayList(day);
  const show = detailed() || S.dayReveal === d;
  let html = lite ? '' : `<div class="ldsum"><span>Saldo no fim do dia</span><b class="${val ? sgnCls(val) : ''}">${val === null ? '—' : signed(val)}</b></div>`;
  if (!list.length) return html + (lite ? '' : '<div class="empty">Nada neste dia.</div>');
  if (!show) return html + `<button class="reveal" data-reveal-alt="${d}">Mostrar lançamentos (${list.length})</button>`;
  html += list.map(it => {
    const sg = itemSign(it), open = it.status === 'planned' || it.status === 'pending';
    const tg = tag(it.tagId), mt = itemMeta(it);
    const sub = [tg && tg.name !== itemTitle(it) ? tg.name : null, !tg && mt && mt.name !== itemTitle(it) ? mt.name : null,
      open ? (it.status === 'pending' ? 'pendente' : 'previsto') : statusLabel(it).toLowerCase()].filter(Boolean).join(' · ');
    const row = `<div class="ldr" data-key="${esc(it.key)}" data-date="${it.date}"><i class="dot${open ? ' dash' : ''}" style="--c:${chipColor(itemColor(it))}"></i>
      <span class="ldn"><b>${esc(itemTitle(it))}</b><small>${esc(sub)}</small></span>
      <b class="${sg === '+' ? 'pos' : sg === '−' ? 'neg' : ''}">${sg}${money(it.amount)}</b></div>`;
    if (!open) return `<div class="ldp done">${row}</div>`;
    const k = esc(it.key);
    return `<div class="ldp">${row}<div class="ldb">
      <button class="primary-btn sm" data-run="pay" data-key="${k}" data-date="${it.date}">${it.kind === 'income' ? 'Recebi' : 'Paguei'}</button>
      <button class="primary-btn ghost sm" data-run="edit" data-key="${k}" data-date="${it.date}">Editar</button>
      <button class="primary-btn ghost sm" data-run="cancel" data-key="${k}" data-date="${it.date}">Não ocorreu</button></div></div>`;
  }).join('');
  return html;
}
function dayHead(d) {
  const hol = S.isHoliday(d);
  return `<div class="dph2${isOffDay(d) ? ' off' : ''}"><b>${+d.slice(8)}</b><span>${DOW_LONG[weekday(d)]}${hol ? ` · ${esc(hol)}` : ''}</span></div>`;
}
function renderAlt() {
  const v = calView(), box = $('#altView');
  if (v === 'week') {
    const sel = S.selected || today();
    const start = addDays(sel, -((weekday(sel) - (S.settings.mondayFirst ? 1 : 0) + 7) % 7));
    let strip = '';
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      strip += `<button class="${[d === sel ? 'sl' : '', d === today() ? 'td' : '', isOffDay(d) ? 'off' : ''].join(' ')}" data-sel="${d}"><small>${DOW[weekday(d)]}</small><b>${+d.slice(8)}</b></button>`;
    }
    box.innerHTML = `<div class="wk7">${strip}</div>${dayHead(sel)}<div class="dpanel">${dayContent(sel)}</div>`;
  } else if (v === 'day') {
    const d = S.selected || today();
    box.innerHTML = `${dayHead(d)}<div class="dpanel">${dayContent(d)}</div>`;
  } else if (v === 'agenda') {
    const { y, m } = S.view, n = daysInMonth(y, m);
    let html = '';
    for (let i = 1; i <= n; i++) {
      const d = iso(y, m, i); if (!dayList(dayData(d)).length) continue;
      html += `<div class="agd">${d === today() ? '<span class="hj">Hoje</span>' : ''}<b class="${isOffDay(d) ? 'off' : ''}">${DOW[weekday(d)].toLowerCase()} ${i} ${MONTH_SHORT(m)}.</b></div><div class="dpanel">${dayContent(d, true)}</div>`;
    }
    box.innerHTML = html || '<div class="empty">Nenhum lançamento neste mês.</div>';
  } else if (v === 'year') {
    const y = S.view.y, t = today();
    let html = '';
    for (let m = 1; m <= 12; m++) {
      const mo = S.calc.computeMonth(y, m), lead = (weekday(iso(y, m, 1)) - (S.settings.mondayFirst ? 1 : 0) + 7) % 7;
      const order = S.settings.mondayFirst ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
      let g = order.map(w => `<i class="w">${WEEKDAYS_SHORT[w]}</i>`).join('') + '<i></i>'.repeat(lead);
      mo.days.forEach((day, k) => {
        const d = iso(y, m, k + 1), val = cellValue(day);
        g += `<i class="${[isOffDay(d) ? 'off' : '', d === t ? 'ut' : '', val !== null && val < 0 ? 'ng' : ''].join(' ')}">${k + 1}</i>`;
      });
      html += `<button class="ym${y === +t.slice(0, 4) && m === +t.slice(5, 7) ? ' cur' : ''}" data-month="${m}"><b>${MONTH_SHORT(m)}.</b><div class="yg">${g}</div></button>`;
    }
    box.innerHTML = `<div class="yr">${html}</div><p class="yr-note"><i></i>dias com saldo negativo</p>`;
  }
}
function onAltClick(e) {
  const run = e.target.closest('[data-run]');
  if (run) { const it = findItem(run.dataset.key, run.dataset.date); if (it) runAction(run.dataset.run, it); return; }
  const row = e.target.closest('.ldr[data-key]');
  if (row) { openActions(row.dataset.key, row.dataset.date); return; }
  const rv = e.target.closest('[data-reveal-alt]');
  if (rv) { S.dayReveal = rv.dataset.revealAlt; renderAlt(); return; }
  const sl = e.target.closest('[data-sel]');
  if (sl) { S.selected = sl.dataset.sel; S.view = { y: +S.selected.slice(0, 4), m: +S.selected.slice(5, 7) }; renderHeader(); renderGrid(); return; }
  const mb = e.target.closest('[data-month]');
  if (mb) { S.view = { y: S.view.y, m: +mb.dataset.month }; S.settings.calView = 'month'; saveSettings(); renderHeader(); renderGrid(); window.scrollTo(0, 0); }
}
/** Deslizar para os lados também troca o dia/semana/ano nessas visualizações. */
function bindAltSwipe() {
  const box = $('#altView'); let sx = 0, sy = 0;
  box.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  box.addEventListener('touchend', e => {
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) goMonth(dx < 0 ? 1 : -1);
  }, { passive: true });
}

function refresh() {
  rebuild();
  renderGrid();
  if (dayVisible() && S.selected) renderDay(S.selected);
  if (isOpen($('#groupSheet'))) renderGroup();
  renderTagList();
  if (isWide()) syncDrawer(); // PC: o menu fica sempre aberto, então acompanha as mudanças
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
      data: S.data, metas: [...S.metas.values()].filter(metaVisible).map(scopedMeta), checks: S.checks, today: t, isHoliday: S.isHoliday, mondayFirst: S.settings.mondayFirst,
      enabled: S.settings.alerts, set: S.set, startBalance: [...S.set].reduce((a, id) => a + ((S.bal.accounts.get(id) || {}).real || 0), 0),
      lastBackup: S.settings.lastBackup, hasData: S.entries.size > 0,
    });
    const bell = $('#btnAlerts');
    bell.hidden = !S.alerts.length;
    bell.classList.toggle('bad', S.alerts.some(a => a.level === 'bad'));
    // no menu, o saldo da conta exibida (com uma conta só, o total)
    const act = activeAccount(), ab = act && S.bal.accounts.get(act);
    $('#navBalance').textContent = !S.accounts.size ? '' : multiAcc() && ab ? signed(ab.real) : signed(S.bal.totals.total);
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
  if (it.status === 'moved' && it.movedTo && it.movedTo < it.date) return 'Antecipado';
  if (it.status === 'partial') return `${it.kind === 'income' ? 'Recebido' : 'Pago'} ${money(it.paidAmount || 0)}`;
  return STATUS[it.status];
}
const KIND_NAME = { income: 'Receita', expense: 'Despesa', transfer: 'Transferência', reserve: 'Guardado no cofrinho', release: 'Retirado do cofrinho' };
/** Nome real do lançamento (descrição; sem descrição, o nome da tag). Nunca depende dos filtros de exibição. */
function itemTitle(it) {
  if (it.title) return it.title;
  const t = tag(it.tagId);
  if (t) return t.name;
  if (it.kind === 'reserve') return 'Guardado';
  if (it.kind === 'release') return 'Retirado';
  const m = it.metaId && S.metas.get(it.metaId);
  if (m) return m.name;
  return KIND_NAME[it.kind];
}
/**
 * Modo de visualização do calendário (só exibição — saldos, metas e relatórios não mudam):
 *  - Tags ligadas  → modo detalhado: lançamentos dentro dos dias, com tag, descrição e valor;
 *  - Tags desligadas → modo limpo: cada dia mostra só o número e o saldo acumulado.
 */
const detailed = () => !!S.settings.showTags;
/** Tag escondida individualmente (Configurações › Tags): os lançamentos dela saem das listas do calendário. */
function tagShown(it) {
  const hidden = S.settings.hiddenTags || [];
  if (!hidden.length) return true;
  const ids = it.splits ? it.splits.map(p => p.tagId) : [it.tagId];
  return ids.some(id => !id || !hidden.includes(id));
}
/** Filtros de exibição Receitas / Despesas / tags escondidas: decidem só o que aparece nas listas. */
function passesFilters(it) {
  const s = S.settings;
  if (it.kind === 'income' && !s.showIncome) return false;
  if (it.kind === 'expense' && !s.showExpense) return false;
  return tagShown(it);
}
function itemColor(it) {
  if (it.kind === 'transfer' || it.kind === 'reserve' || it.kind === 'release') return 'var(--accent)';
  const t = tag(it.tagId);
  if (t) return tagColor(t);
  const m = it.metaId && S.metas.get(it.metaId);
  return m ? m.color || '#8cb6e4' : it.kind === 'income' ? 'var(--green)' : 'var(--red)';
}
/** Meta de uma tag (cada tag pertence a uma meta só). */
function metaOfTag(tagId) {
  if (!tagId) return null;
  for (const m of S.metas.values()) if (!m.archived && (m.tagIds || []).includes(tagId)) return m;
  return null;
}
/** Meta de um lançamento: a meta da tag ou, sem tag, a meta escolhida diretamente. */
const itemMeta = it => metaOfTag(it.tagId) || (it.metaId && S.metas.get(it.metaId)) || null;
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
  else if (tg && it.title && tg.name !== it.title) parts.push(esc(tg.name));
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
  // PC sem data escolhida: o painel lateral fica discreto, só com uma orientação
  if (isWide() && !S.dayChosen) {
    $('#dayTitle').textContent = '';
    $('#daySub').textContent = '';
    $('#dayBody').innerHTML = '<div class="day-hint"><b>Selecione uma data</b>Clique em um dia do calendário para ver o saldo e os lançamentos daquela data.</div>';
    $('#dayFoot').innerHTML = '';
    $('#btnDaySelect').hidden = true;
    return;
  }
  $('#btnDaySelect').hidden = false;
  const d = dayData(date);
  const w = weekday(date);
  const t = today();
  const hol = S.isHoliday(date);
  const check = S.checks.get(date);
  $('#dayTitle').textContent = `${cap(WEEKDAYS_LONG[w].replace('-feira', ''))}, ${+date.slice(8)} de ${MONTHS[+date.slice(5, 7) - 1].toLowerCase()}`;
  const sub = hol || (w === 0 || w === 6 ? 'Fim de semana' : 'Dia útil');
  $('#daySub').innerHTML = esc(sub) + (check ? ` · <span class="checked-note">${icon('check')}Conferido${check.noExpenses ? ' sem gastos' : ''}</span>` : '');

  const checking = S.checking === date;
  // Mesmo comportamento da grade: tags ligadas = lista detalhada; desligadas = só o saldo do dia.
  // Os lançamentos continuam a um toque ("Mostrar lançamentos") para pagar, editar ou conferir.
  const reveal = S.dayReveal === date;
  const detail = detailed() || checking || reveal;
  const all = d.items.filter(i => accVisible(i) && (!isInternal(i) || S.settings.showTransfers));
  const list = checking || reveal ? all : all.filter(passesFilters);
  const inc = list.filter(i => i.kind === 'income');
  const exp = list.filter(i => i.kind === 'expense');
  const internal = list.filter(isInternal);
  let html = `<div class="balance">
    <div class="cur"><small>Saldo do dia</small><b class="${sgnCls(d.cumNet)}">${signed(d.cumNet)}</b></div>
  </div>`;
  if (!all.length) html += `<div class="empty">${checking ? 'Nenhum lançamento previsto. Adicione um gasto ou conclua como dia sem gastos.' : 'Nenhum lançamento.'}</div>`;
  else if (!detail) {
    html += `<button type="button" class="reveal" data-reveal>Mostrar lançamentos (${all.length})</button>`;
  } else {
    if (inc.length) html += `<div class="section-label"><span>RECEITAS</span><span>${money(d.inc)}</span></div>${inc.map(i => itemRow(i, { quick: checking })).join('')}`;
    if (exp.length) html += `<div class="section-label"><span>DESPESAS</span><span>${money(d.exp)}</span></div>${exp.map(i => itemRow(i, { quick: checking })).join('')}`;
    if (internal.length) html += `<div class="section-label"><span>ENTRE CONTAS E COFRINHOS</span></div>${internal.map(i => itemRow(i)).join('')}`;
    const off = all.length - list.length;
    if (off) html += `<button type="button" class="reveal" data-reveal>${off === 1 ? '1 lançamento oculto' : `${off} lançamentos ocultos`} pelos filtros · Mostrar</button>`;
    else if (reveal && !checking) html += `<button type="button" class="reveal" data-hide>Ocultar lançamentos</button>`;
  }
  const cm = detail ? calendarMeta() : null;
  const b = cm && F.dailyBudget(cm, date, date, budgetCtx()).get(date);
  if (b) {
    // orçamento previsto, gasto realizado, gasto pendente e economia efetiva — separados
    const res = { saved: `economia efetiva ${money(b.limit - b.spent)}`, ok: 'no limite', over: `excedente ${money(b.spent - b.avail)}`, zero: `sem gastos · economia ${money(b.limit)}`,
      pending: b.pending ? 'conferência pendente' : 'aguardando conferência', open: `disponível ${money(Math.max(0, b.avail - b.spent))}`, future: `disponível ${money(b.avail)}` }[b.status];
    const col = b.status === 'over' ? cm.colorBad || 'var(--red)' : ['saved', 'ok', 'zero'].includes(b.status) ? cm.colorGood || 'var(--green)' : b.status === 'pending' ? 'var(--orange)' : 'var(--text-3)';
    html = `<div class="budget-line"><span class="pill" style="background:${col}"></span><span>${esc(cm.name)}: orçamento ${money(b.avail)}${b.avail !== b.limit ? ` (base ${money(b.limit)})` : ''} · gasto ${money(b.spent)}${b.pending ? ` · pendente ${money(b.pending)}` : ''} · ${res}</span></div>` + html;
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
  if (S.dayReveal && S.dayReveal !== date) S.dayReveal = null;
  S.selected = date;
  S.dayChosen = true;
  if (S.checking && S.checking !== date) S.checking = null;
  renderDay(date);
  if (isWide()) setDock(true);
  else if (!isOpen($('#daySheet'))) openLayer($('#daySheet'), () => { S.checking = null; S.dayReveal = null; renderGrid(); });
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
  const sub = [where, splits || (tg && it.title && tg.name !== it.title ? esc(tg.name) : null), it.recurring ? RULES[e.rule.type] : null, statusLabel(it)].filter(Boolean).join(' · ');
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
      if (isInc) {
        // o dinheiro (ou parte da distribuição) já foi usado? então não desfaz de forma simples
        const chk = F.undoReceiptCheck(it.key, { data: S.data, accounts: accountsList(true), piggies: [...S.piggies.values()], today: today() });
        if (!chk.ok) {
          const lines = chk.problems.map(p => p.kind === 'piggy'
            ? `Cofrinho ${esc((S.piggies.get(p.id) || {}).name || '')}: ${money(p.missing)} já foram retirados`
            : `${esc(accName(p.id))}: ${money(p.missing)} já foram usados`).join('<br>');
          const res = await dialog({
            title: 'Esse dinheiro já foi usado',
            html: `<p>Desfazer o recebimento deixaria saldos negativos artificialmente:</p><p>${lines}</p>
              <p class="small">Opção segura: lançar um <b>estorno</b> com a data de hoje. O recebimento, a distribuição e as retiradas continuam no histórico.</p>`,
            actions: [{ label: 'Cancelar', value: null }, { label: 'Lançar estorno', value: 'refund', cls: 'primary' }],
          });
          if (res !== 'refund') return;
          const id = uid(), d = today(), now = nowISO(), k = occKey(id, d);
          const ch = ops.newChanges();
          ch.entries.set(id, { id, kind: 'expense', title: `Estorno de ${itemTitle(it)}`, amount: it.amount, tagId: null, accountId: it.accountId, refundOf: it.key, rule: { type: 'once', start: d }, segments: [], createdAt: now, updatedAt: now });
          ch.overrides.set(k, { key: k, entryId: id, orig: d, status: 'paid', paidAt: now, updatedAt: now });
          return commit('Estorno lançado', ch);
        }
      }
      const ch = ops.planStatus([it], null, S.data);
      ops.setOv(ch, S.data, it, { paidAmount: undefined, distPending: undefined });
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
async function guardSpend(it, amount) { return guardSpendMany([{ it, amount }]); }

/**
 * Mesmas verificações para um ou vários pagamentos (pagamento em grupo):
 * contas autorizadas para as tags e saldo livre suficiente em cada conta. Nunca bloqueia.
 * list: [{ it, amount }]
 */
async function guardSpendMany(list) {
  const out = list.filter(x => (x.it.kind === 'expense' || x.it.kind === 'transfer') && x.amount > 0 && S.accounts.get(x.it.accountId));
  if (!out.length) return true;
  // 1) permissões por conta
  const bad = [];
  for (const { it } of out) {
    if (it.kind !== 'expense') continue;
    const acc = S.accounts.get(it.accountId), allowed = acc.allowedTags || [];
    const tags = it.splits ? it.splits.map(p => p.tagId) : [it.tagId];
    const nope = tags.filter(t => allowed.length && !allowed.includes(t));
    if (nope.length) bad.push(`${esc(itemTitle(it))} em ${esc(acc.name)}`);
  }
  if (bad.length) {
    const txt = bad.length === 1 ? `${bad[0]} não está liberado para esta conta.` : `${bad.length} pagamentos usam contas não liberadas para essa finalidade:<br>${bad.slice(0, 5).join('<br>')}`;
    if (!(await confirmDlg('Uso não autorizado', `${txt}<br>Liberar só desta vez?`, 'Liberar'))) return false;
  }
  // 2) saldo livre por conta (soma do grupo)
  const need = new Map();
  for (const { it, amount } of out) need.set(it.accountId, (need.get(it.accountId) || 0) + amount);
  const b = F.balances({ data: S.data, accounts: accountsList(true), piggies: [...S.piggies.values()], today: today(), planUpto: today() });
  const free = id => { const x = b.accounts.get(id); return x ? x.real - x.reserved : 0; };
  const short = [...need].filter(([id, v]) => free(id) < v).map(([id, v]) => ({ id, missing: v - Math.max(0, free(id)) }));
  if (!short.length) return true;
  const others = accountsList().filter(a => !need.has(a.id) && free(a.id) > 0);
  const res = await dialog({
    title: 'Saldo insuficiente',
    html: short.map(x => `<p>${esc(accName(x.id))} tem ${money(Math.max(0, free(x.id)))} livres. Faltam <b>${money(x.missing)}</b>.</p>`).join('') +
      (others.length ? `<p class="small">Com saldo: ${others.map(a => `${esc(a.name)} ${money(free(a.id))}`).join(' · ')}</p>` : ''),
    actions: [{ label: 'Cancelar', value: null }, ...(others.length ? [{ label: 'Transferir', value: 'tr' }] : []), { label: 'Continuar', cls: 'primary', value: 'go' }],
  });
  if (res === 'tr') {
    await closeAll();
    openForm({ kind: 'transfer', date: today(), from: others[0].id, to: short[0].id, amount: short[0].missing });
    return false;
  }
  return res === 'go';
}

/** Após receber: aplica as regras de distribuição da conta (automático ou com confirmação). */
async function afterPaid(items, { force = false } = {}) {
  for (const it0 of items) {
    if (it0.kind !== 'income') continue;
    const it = findItem(it0.key, it0.date) || it0;
    if (it.status !== 'paid' || S.data.entries.some(e => e.distOf === it.key)) continue;
    const rule = F.ruleFor(S.accounts.get(it.accountId), it.origin);
    if (!rule || !(rule.steps || []).length) continue;
    // só destinos que ainda existem (nunca envia para conta/cofrinho excluído ou arquivado)
    const exists = t => { const [k, id] = String(t).split(':'); return k === 'piggy' ? !!S.piggies.get(id) && !S.piggies.get(id).archived : !!S.accounts.get(id) && !S.accounts.get(id).archived; };
    const live = { ...rule, steps: rule.steps.filter(st => exists(st.target)) };
    const b = F.balances({ data: S.data, accounts: accountsList(true), piggies: [...S.piggies.values()], today: today(), planUpto: today() });
    const outs = F.distribute(it.amount, live, { piggies: [...S.piggies.values()], piggySaved: id => (b.piggies.get(id) || {}).saved || 0 });
    if (!outs.length) continue;
    const name = t => { const [k, id] = t.split(':'); return k === 'piggy' ? (S.piggies.get(id) || {}).name : accName(id); };
    if (!rule.auto || force) {
      const res = await dialog({
        title: `Distribuir ${money(it.amount)}?`,
        html: `<p>${outs.map(o => `${esc(name(o.target))}: ${money(o.amount)}`).join('<br>')}</p><p class="small">Se deixar para depois, fica em Contas › ${esc(accName(it.accountId))} › Distribuições pendentes.</p>`,
        actions: [{ label: 'Depois', value: 'later' }, { label: 'Distribuir', value: 'go', cls: 'primary' }],
      });
      if (res !== 'go') {
        if (!it.distPending) await commit('Distribuição deixada para depois', ops.setOv(ops.newChanges(), S.data, it, { distPending: true }), { silent: true });
        continue;
      }
    }
    const ch = ops.planDistribution(it, outs, { piggies: [...S.piggies.values()], uid, title: `Distribuição de ${itemTitle(it)}` });
    ops.setOv(ch, S.data, it, { distPending: undefined });
    await commit(rule.auto && !force ? 'Distribuição automática aplicada' : 'Receita distribuída', ch);
  }
}
/** Executa uma distribuição que ficou pendente (chamado pela tela da conta). */
async function distributeNow(key, date) { const it = findItem(key, date); if (it) await afterPaid([it], { force: true }); }

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

/**
 * Campo "Meta e tag" (como no app antigo, em versão enxuta): as tags aparecem agrupadas pela meta a que pertencem;
 * dá para lançar só na meta ("geral") ou numa tag dela. Só as metas e tags da conta exibida.
 */
function fillTagSelect(selected) {
  const kindOk = k => (k || 'expense') === 'both' || (k || 'expense') === Fm.kind;
  const metas = [...S.metas.values()].filter(m => !m.archived && kindOk(m.kind) && (metaVisible(m) || `meta:${m.id}` === selected))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'pt-BR'));
  const used = new Set();
  let html = '<option value="">Sem meta</option>';
  for (const m of metas) {
    const ts = (m.tagIds || []).map(tag).filter(t => t && kindOk(t.kind) && (t.id === selected || tagInWorld(t)));
    ts.forEach(t => used.add(t.id));
    html += `<optgroup label="${esc(m.name)}"><option value="meta:${m.id}">${esc(m.name)} · geral</option>${ts.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</optgroup>`;
  }
  const loose = tagsSorted().filter(t => !used.has(t.id) && !metaOfTag(t.id) && kindOk(t.kind) && (t.id === selected || tagInWorld(t)));
  if (loose.length) html += `<optgroup label="Tags sem meta">${loose.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</optgroup>`;
  html += '<option value="__new">Nova tag…</option>';
  $('#fTag').innerHTML = html;
  const ok = [...$('#fTag').options].some(o => o.value === selected);
  $('#fTag').value = ok ? selected : '';
}
/** Valor do campo "Meta e tag" → { tagId, metaId } (metaId só quando lançado direto na meta). */
function readTagField() {
  const v = $('#fTag').value;
  if (!v || v === '__new') return { tagId: null, metaId: null };
  if (v.startsWith('meta:')) return { tagId: null, metaId: v.slice(5) };
  return { tagId: v, metaId: null };
}
const tagFieldValue = it => it ? (it.tagId || (it.metaId ? `meta:${it.metaId}` : '')) : '';
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
  $('#fAccount').value = from || activeAccount() || S.settings.defaultAccount;
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
  if (!Fm.splits.length) Fm.splits = [{ tagId: readTagField().tagId || '', amount: parseMoney($('#fAmount').value) || 0 }, { tagId: '', amount: 0 }];
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
  fillTagSelect(tagFieldValue(item));
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
  const tf = kind !== 'transfer' ? readTagField() : { tagId: null, metaId: null };
  const tagId = tf.tagId, metaId = tf.metaId;
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
    const entry = { id: uid(), kind, title, amount, tagId: splits ? null : tagId, metaId: splits ? null : metaId, ...extra, rule, segments: [], createdAt: nowISO(), updatedAt: nowISO() };
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
    const ne = { ...e, kind, title, amount, tagId: splits ? null : tagId, metaId: splits ? null : metaId, ...extra, rule: { ...readRule(date), type: 'once', start: date }, updatedAt: nowISO() };
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
  if (metaId !== (it.metaId || null)) patch.metaId = metaId;
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
    const fields = { kind: e.kind, title: title || e.title, amount, tagId, metaId, accountId, toAccountId, origin, rule: newRule };
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
  if ('tagId' in p && p.tagId) out.push(`tag ${tag(p.tagId).name}`);
  else if ('metaId' in p && p.metaId) out.push(`meta ${(S.metas.get(p.metaId) || {}).name || ''}`);
  else if ('tagId' in p || 'metaId' in p) out.push('sem meta');
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
  for (const d of [...S.picked].sort()) for (const it of dayData(d).items) if (it.status !== 'moved' && accVisible(it)) out.push(it);
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
    case 'pay': {
      const sel = items.filter(i => i.status !== 'paid' && i.status !== 'cancelled');
      if (!(await guardSpendMany(sel.map(it => ({ it, amount: it.amount - (it.paidAmount || 0) }))))) return;
      await run('# lançamentos pagos', ops.planStatus(sel, 'paid', S.data), 'Pagar');
      return afterPaid(sel);
    }
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
const PALETTE = ['#ff5f57', '#ff9f0a', '#ffd60a', '#45cf7f', '#63e6e2', '#40c8e0', '#8cb6e4', '#5e5ce6', '#bf5af2', '#ff375f', '#ac8e68', '#8e8e93'];

async function tagDialog(t = null, kindHint = 'expense', metaHint = null) {
  let color = t ? t.color : PALETTE[(S.tags.size * 5) % PALETTE.length];
  const curMeta = t ? (metaOfTag(t.id) || {}).id || '' : metaHint || '';
  const metaOpts = [...S.metas.values()].filter(m => !m.archived && (metaVisible(m) || m.id === curMeta)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const actions = [{ label: 'Cancelar', value: null }];
  if (t) actions.push({ label: 'Excluir', value: 'delete', cls: 'danger' });
  actions.push({ label: 'Salvar', cls: 'primary', validate: () => !!$('#tgName').value.trim() || (toast('Dê um nome à tag'), false), value: () => ({ name: $('#tgName').value.trim(), kind: $('#tgKind').value, color, metaId: $('#tgMeta').value }) });
  const res = await dialog({
    title: t ? 'Editar tag' : 'Nova tag',
    html: `<input type="text" id="tgName" placeholder="Nome" maxlength="30" value="${esc(t ? t.name : '')}">
      <select id="tgMeta" aria-label="Meta"><option value="">Sem meta</option>${metaOpts.map(m => `<option value="${m.id}" ${m.id === curMeta ? 'selected' : ''}>Meta: ${esc(m.name)}</option>`).join('')}</select>
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
    db.log(`Tag excluída: ${t.name}`, { before: t });
    S.tags.delete(t.id);
    const ch = ops.newChanges();
    for (const e of S.entries.values()) if (e.tagId === t.id) ch.entries.set(e.id, { ...e, tagId: null });
    S.settings.hiddenTags = S.settings.hiddenTags.filter(id => id !== t.id);
    saveSettings();
    if (ops.changeCount(ch)) await commit('Tag excluída', ch, { silent: true }); else refresh();
    return null;
  }
  const { metaId: newMeta, ...fields } = res;
  const nt = t ? { ...t, ...fields } : { id: uid(), ...fields, order: S.tags.size };
  await db.put('tags', nt);
  // cada tag pertence a uma meta só: sai das outras e entra na escolhida
  for (const m of S.metas.values()) {
    const has = (m.tagIds || []).includes(nt.id), want = m.id === newMeta;
    if (has === want) continue;
    const nm = { ...m, tagIds: want ? [...(m.tagIds || []), nt.id] : m.tagIds.filter(x => x !== nt.id), onlyAssigned: true };
    await db.put('metas', nm); S.metas.set(nm.id, nm);
  }
  db.log(t ? `Tag alterada: ${nt.name}` : `Tag criada: ${nt.name}`, { before: t || null, after: nt });
  S.tags.set(nt.id, nt);
  refresh();
  return nt;
}

function renderTagList() {
  const hidden = new Set(S.settings.hiddenTags);
  const list = tagsSorted();
  const row = t => `
    <div class="row tag-row${hidden.has(t.id) ? ' off' : ''}">
      <span class="dot" style="background:${tagColor(t)}"></span>
      <button class="tag-name" data-edit-tag="${t.id}">${esc(t.name)}</button>
      <input type="checkbox" class="switch" data-tag="${t.id}" ${hidden.has(t.id) ? '' : 'checked'} aria-label="Exibir ${esc(t.name)}">
    </div>`;
  // agrupadas pela meta a que pertencem (a meta é a categoria; as tags ficam dentro dela)
  const groups = new Map();
  for (const t of list) { const m = metaOfTag(t.id); const k = m ? m.id : ''; if (!groups.has(k)) groups.set(k, { m, tags: [] }); groups.get(k).tags.push(t); }
  const ordered = [...groups.values()].sort((a, b) => !a.m ? 1 : !b.m ? -1 : a.m.name.localeCompare(b.m.name, 'pt-BR'));
  $('#tagList').innerHTML = list.length ? ordered.map(g => `<div class="row tag-meta"><span class="dot" style="background:${g.m ? g.m.color : 'transparent'}"></span><span>${g.m ? esc(g.m.name) : 'Sem meta'}</span></div>${g.tags.map(row).join('')}`).join('')
    : '<div class="row"><span class="muted">Nenhuma tag</span></div>';
}

// ---------- Alça do menu na borda direita (como o painel Edge do Samsung) ----------
/** Coloca a alça na altura guardada (padrão: um pouco acima do meio da tela). */
function placeEdge() {
  const h = $('#edgeHandle'); if (!h) return;
  const y = S.settings.edgeY ?? 0.42;
  const hh = h.offsetHeight || 88;
  h.style.top = Math.min(window.innerHeight - hh - 8, Math.max(8, y * window.innerHeight)) + 'px';
}
/**
 * Arrastar a alça para a esquerda puxa o menu da direita acompanhando o dedo (soltou depois de 1/4 → abre);
 * tocar abre; arrastar para cima/baixo muda a altura da alça.
 */
function bindEdge(open) {
  let h = $('#edgeHandle');
  if (!h) {
    h = document.createElement('div');
    h.className = 'edge-handle'; h.id = 'edgeHandle'; h.setAttribute('role', 'button'); h.setAttribute('aria-label', 'Abrir menu'); h.tabIndex = 0;
    h.innerHTML = '<i></i>';
    document.body.appendChild(h);
  }
  document.body.classList.add('edge-on');
  const drawer = $('#drawer');
  let st = null, skipClick = false; // o "click" que vem do mesmo gesto de um arraste é ignorado
  const reset = () => { drawer.style.transition = ''; drawer.style.transform = ''; drawer.classList.remove('peek'); };
  h.addEventListener('pointerdown', e => {
    skipClick = false;
    if (isOpen(drawer)) return;
    st = { x: e.clientX, y: e.clientY, top: h.offsetTop, mode: null, t: Date.now() };
    try { h.setPointerCapture(e.pointerId); } catch (_) { /* toque simulado */ }
  });
  h.addEventListener('pointermove', e => {
    if (!st) return;
    const dx = st.x - e.clientX, dy = e.clientY - st.y;
    if (!st.mode) {
      if (Math.hypot(dx, dy) < 8) return;
      st.mode = Math.abs(dx) >= Math.abs(dy) ? 'open' : 'move';
      if (st.mode === 'open') { syncDrawer(); drawer.classList.add('peek'); drawer.style.transition = 'none'; }
    }
    if (st.mode === 'open') {
      const w = drawer.offsetWidth;
      drawer.style.transform = `translateX(${Math.max(0, w - Math.max(0, dx))}px)`;
    } else {
      const hh = h.offsetHeight;
      h.style.top = Math.min(window.innerHeight - hh - 8, Math.max(8, st.top + dy)) + 'px';
    }
  });
  const end = e => {
    if (!st) return;
    const s0 = st; st = null;
    // toque: o menu abre no "click" (depois do toque terminar), senão o clique-fantasma do toque cai em cima do menu recém-aberto
    if (!s0.mode) return;
    skipClick = true;
    if (s0.mode === 'move') { S.settings.edgeY = h.offsetTop / window.innerHeight; saveSettings(); return; }
    const dx = s0.x - e.clientX, fast = dx > 30 && Date.now() - s0.t < 250;
    const go = e.type === 'pointerup' && (dx > drawer.offsetWidth * 0.25 || fast);
    drawer.style.transition = '';
    if (go) { reset(); open(); } else { drawer.style.transform = ''; setTimeout(reset, 260); }
  };
  h.addEventListener('pointerup', end);
  h.addEventListener('pointercancel', end);
  h.addEventListener('click', () => { if (skipClick) { skipClick = false; return; } open(); });
  h.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  window.addEventListener('resize', placeEdge);
  placeEdge();
}

// ---------- Menu lateral ----------
function syncDrawer() {
  const s = S.settings;
  $$('[data-setting]').forEach(el => { el.checked = !!s[el.dataset.setting]; });
  const act = activeAccount();
  $('#accSeg').hidden = !multiAcc();
  $('#accSeg').innerHTML = multiAcc() ? accountsList().map(a => `<button type="button" data-acc="${a.id}" class="${a.id === act ? 'on' : ''}">${esc(a.name)}</button>`).join('') : '';
  $('#rowTransfers').hidden = !multiAcc();
  $('#startDate').value = s.startDate || '';
  $$('.carry-only').forEach(el => { el.hidden = !s.carry; });
  $('#holState').value = s.holState;
  $('#holCity').value = s.holCity;
  const P = { accounts: 'Contas', metas: 'Metas', pending: 'Pendências', upcoming: 'Próximos 7 dias', piggies: 'Cofrinhos' };
  $('#panelCfg').innerHTML = Object.entries(P).map(([k, l]) => `<label class="row"><span>${l}</span><input type="checkbox" class="switch" data-panel="${k}" ${s.panels[k] ? 'checked' : ''}></label>`).join('');
  $('#alertCfg').innerHTML = Object.entries(F.ALERT_TYPES).map(([k, l]) => `<label class="row"><span>${l}</span><input type="checkbox" class="switch" data-alert="${k}" ${s.alerts[k] === false ? '' : 'checked'}></label>`).join('');
  $('#btnInstall').hidden = !installPrompt;
  // todos os feriados (nacionais, estaduais, municipais e próprios), cada um com liga/desliga
  const off = new Set(s.disabledHolidays || []);
  const all = holidayNames({ state: s.holState, city: s.holCity, optional: s.holOptional, custom: s.customHolidays });
  $('#customHolList').innerHTML = all.map(h => {
    const ci = h.custom ? s.customHolidays.findIndex(c => c.name === h.name) : -1;
    return `<label class="row hol-row"><span><span class="hol-name">${esc(h.name)}</span><span class="hol-sub">${dm(h.date)} · ${h.scope}</span></span>
      ${ci >= 0 ? `<button type="button" class="link-btn" data-del-hol="${ci}">Remover</button>` : ''}
      <input type="checkbox" class="switch" data-hol="${esc(h.name)}" ${off.has(h.name) ? '' : 'checked'}></label>`;
  }).join('');
  renderTagList();
}
async function storageInfo() {
  let txt = 'Os dados ficam somente neste aparelho.';
  try { if (navigator.storage && await navigator.storage.persisted()) txt += ' Armazenamento protegido.'; } catch { /* */ }
  $('#storageInfo').textContent = txt;
}

async function loadSample() {
  // impede duplicação: o exemplo só pode ser carregado uma vez (ou de novo depois de apagar os dados)
  if (S.settings.sampleLoaded || [...S.accounts.values()].some(a => a.sample) || [...S.entries.values()].some(e => e.sample)) {
    toast('O exemplo já foi carregado');
    return;
  }
  if (S.entries.size && !(await confirmDlg('Carregar exemplo?', 'Os dados de exemplo serão somados aos seus lançamentos atuais.', 'Carregar'))) return;
  S.settings.sampleLoaded = true;
  saveSettings();
  const { y, m } = S.view;
  const start = iso(y, m, 1), now = nowISO();
  const mkTag = (name, kind, color) => ({ id: uid(), name, kind, color, order: S.tags.size });
  const T = {
    sal: mkTag('Salário', 'income', '#45cf7f'), ifood: mkTag('Entregas', 'income', '#63e6e2'), alm: mkTag('Almoço', 'expense', '#ff9f0a'),
    jan: mkTag('Jantar', 'expense', '#ffd60a'), tr: mkTag('Transporte', 'expense', '#40c8e0'), net: mkTag('Internet', 'expense', '#5e5ce6'),
    lz: mkTag('Lazer', 'expense', '#bf5af2'), bike: mkTag('Energia da bicicleta', 'expense', '#ff375f'),
  };
  Object.values(T).forEach((t, i) => { t.order = S.tags.size + i; });
  const main = S.settings.defaultAccount;
  const ifood = { id: uid(), sample: true, name: 'Conta iFood', type: 'digital', institution: '', initialBalance: 0, color: '#ff375f', purpose: 'Ganhos com entregas', includeInTotal: true, archived: false, allowedTags: [T.bike.id], rules: [], order: 1, createdAt: now };
  const pEmerg = { id: uid(), name: 'Emergência', type: 'virtual', accountId: ifood.id, goal: 100000, deadline: '', color: '#ff9f0a', createdAt: now };
  const pIfood = { id: uid(), name: 'Cofrinho iFood', type: 'virtual', accountId: ifood.id, goal: 300000, deadline: '', color: '#63e6e2', createdAt: now };
  ifood.rules = [{ id: uid(), origin: '', auto: false, steps: [{ type: 'fixed', value: 2000, target: 'account:' + main }, { type: 'percent', value: 10, target: 'piggy:' + pEmerg.id }, { type: 'remainder', target: 'piggy:' + pIfood.id }] }];
  const metas = [
    { id: uid(), name: 'Alimentação', kind: 'expense', period: 'month', amount: 40000, tagIds: [T.alm.id, T.jan.id], color: '#ff9f0a', tintTags: true, alertPct: 80, createdAt: now },
    { id: uid(), name: 'Gastos do dia útil', kind: 'expense', period: 'businessDay', amount: 4000, tagIds: [T.alm.id, T.tr.id, T.jan.id], color: '#64d2ff', rollover: 'week', showOnCalendar: true, colorGood: '#45cf7f', colorBad: '#ff5f57', alertPct: 100, createdAt: now },
    { id: uid(), name: 'Entregas no mês', kind: 'income', period: 'month', amount: 120000, tagIds: [], origins: ['iFood'], color: '#63e6e2', createdAt: now },
  ];
  const E = (title, kind, amount, tagId, rule, extra = {}) => ({ id: uid(), sample: true, kind, title, amount, tagId, accountId: main, rule: { start, ...rule }, segments: [], createdAt: now, updatedAt: now, ...extra });
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
  // engrenagem do menu: abre as Configurações (tags, calendário, painéis, alertas, feriados, dados)
  $('#btnSettings').onclick = async () => { await closeAll(); syncDrawer(); storageInfo(); openLayer($('#settingsSheet')); };
  const openMenu = () => { syncDrawer(); storageInfo(); openLayer($('#drawer')); };
  $('#btnMenu').onclick = openMenu;
  bindEdge(() => { if (!isOpen($('#drawer'))) openMenu(); });
  $('#swExpand').addEventListener('change', e => setExpanded(e.target.checked));
  syncViewBtn();
  // botão do topo: escolher a visualização (Dia, Semana, Mês, Ano)
  $('#btnView').onclick = () => {
    $$('#viewPop [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === calView()));
    openLayer($('#viewPop'));
  };
  $('#viewPop').addEventListener('click', async e => {
    const b = e.target.closest('[data-view]'); if (!b) return;
    await closeTop();
    setView(b.dataset.view);
  });
  $('#altView').addEventListener('click', onAltClick);
  bindAltSwipe();
  $('#btnPrev').onclick = () => goMonth(-1);
  $('#btnNext').onclick = () => goMonth(1);
  $('#btnToday').onclick = goToday;
  $('#scrim').onclick = () => closeTop();
  $$('[data-close]').forEach(b => { b.onclick = () => closeTop(); });
  $('#btnNewTop').onclick = () => openForm({ date: S.selected || today() });
  $('#fab').onclick = () => openForm({ date: (calView() === 'day' || calView() === 'week') && S.selected ? S.selected : today() });
  // (resumo do dinheiro sempre aberto — v1.9.8)

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
  // Arrastar o calendário para baixo expande; para cima recolhe (como no Samsung Calendar).
  // Muda apenas a altura das células — nenhum filtro, lançamento ou cálculo é alterado.
  let vdrag = null;
  const startH = () => (S.settings.calExpanded ? CAL.expanded : CAL.compact);
  const dragTo = dy => {
    const h = Math.max(CAL.compact, Math.min(CAL.expanded, vdrag.h0 + dy / 1.0 / Math.max(1, CAL.rows) * 1.6));
    vdrag.h = h; applyCellHeight(h);
  };
  const finishDrag = (dy, dt) => {
    if (!vdrag) return;
    const speed = (dy || 0) / Math.max(1, dt);
    const mid = (CAL.compact + CAL.expanded) / 2;
    const open = Math.abs(speed) > 0.5 ? speed > 0 : vdrag.h > mid;
    document.body.classList.remove('cal-dragging');
    vdrag = null;
    setExpanded(open);
    setTimeout(() => { swiped = false; }, 400); // o próximo toque num dia volta a funcionar normalmente
  };
  wrap.addEventListener('touchmove', e => {
    const t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(lp);
    if (S.selecting && dragMode !== null) {
      const c = cellAt(t.clientX, t.clientY);
      if (c && c.dataset.date !== lastDrag) { lastDrag = c.dataset.date; togglePick(lastDrag, dragMode); }
      return;
    }
    if (S.selecting || isWide()) return;
    // (v1.9.7) arrastar para cima/baixo não expande mais o calendário: isso fica no botão do topo
    if (vdrag) { e.preventDefault(); dragTo(dy); }
  }, { passive: false });
  // fim do toque ouvido na janela: mesmo que o dedo saia da grade, o gesto termina corretamente
  window.addEventListener('touchend', e => { if (vdrag && !e.target.closest('#calHandle')) { swiped = true; const t = e.changedTouches[0]; finishDrag(t ? t.clientY - sy : 0, e.timeStamp - vdrag.t0); } }, { passive: true });
  wrap.addEventListener('touchend', e => {
    clearTimeout(lp);
    if (S.selecting) { dragMode = null; return; }
    if (vdrag || document.body.classList.contains('cal-dragging')) return;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiped = true; goMonth(dx < 0 ? 1 : -1); }
  }, { passive: true });
  // alça de baixo do calendário: retirada na v1.9.7 (o botão do topo faz isso); o elemento fica oculto
  const handle = $('#calHandle');
  handle.addEventListener('click', () => { if (!handle.dataset.dragged) setExpanded(!S.settings.calExpanded); delete handle.dataset.dragged; });
  handle.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!S.settings.calExpanded); } });
  let hy = 0, ht = 0;
  handle.addEventListener('touchstart', e => { hy = e.touches[0].clientY; ht = e.timeStamp; vdrag = { h0: startH(), h: startH(), t0: e.timeStamp, rendered: false }; }, { passive: true });
  handle.addEventListener('touchmove', e => {
    if (!vdrag) return;
    const dy = e.touches[0].clientY - hy;
    if (Math.abs(dy) > 6) { e.preventDefault(); document.body.classList.add('cal-dragging'); handle.dataset.dragged = '1'; dragTo(dy); }
  }, { passive: false });
  handle.addEventListener('touchend', e => {
    if (!vdrag) return;
    if (handle.dataset.dragged) finishDrag(e.changedTouches[0].clientY - hy, e.timeStamp - ht); else vdrag = null;
  });
  $('#grid').addEventListener('contextmenu', e => {
    e.preventDefault();
    const c = e.target.closest('.cell:not(.out)');
    if (c && !S.selecting && !('ontouchstart' in window && navigator.maxTouchPoints > 0)) enterSelect(c.dataset.date);
  });
  // PC: clicar e arrastar com o mouse seleciona vários dias no modo de seleção
  let mdrag = null;
  $('#grid').addEventListener('mousedown', e => {
    const c = e.target.closest('.cell:not(.out)');
    if (!S.selecting || !c || e.button !== 0) return;
    mdrag = { on: !S.picked.has(c.dataset.date), last: c.dataset.date, moved: false };
  });
  $('#grid').addEventListener('mouseover', e => {
    if (!mdrag) return;
    const c = e.target.closest('.cell:not(.out)');
    if (!c || c.dataset.date === mdrag.last) return;
    if (!mdrag.moved) { togglePick(mdrag.last, mdrag.on); mdrag.moved = true; }
    mdrag.last = c.dataset.date; togglePick(mdrag.last, mdrag.on);
  });
  window.addEventListener('mouseup', () => {
    if (mdrag && mdrag.moved) { swiped = true; setTimeout(() => { swiped = false; }, 0); }
    mdrag = null;
  });
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
  $('#btnDayClose').onclick = () => { if (!isWide()) closeTop(); };
  $('#btnDayAdd').onclick = () => openForm({ date: S.selected, paid: S.checking ? true : undefined });
  $('#btnDaySelect').onclick = async () => { const d = S.selected; if (!isWide()) await closeTop(); enterSelect(d); };
  $('#dayBody').addEventListener('click', e => {
    // mostrar/ocultar os lançamentos do dia (só exibição)
    if (e.target.closest('[data-reveal]')) { S.dayReveal = S.selected; renderDay(S.selected); return; }
    if (e.target.closest('[data-hide]')) { S.dayReveal = null; renderDay(S.selected); return; }
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
    if (k === 'carry' || k === 'holOptional') { rebuild(); if (k === 'holOptional') syncDrawer(); }
    if (k === 'mondayFirst') renderHeader();
    if (k === 'showTags') S.dayReveal = null;
    renderGrid();
    // a grade e o painel do dia seguem a mesma exibição
    if (S.selected && dayVisible()) renderDay(S.selected);
  }));
  if ($('#basisSeg')) $('#basisSeg').onclick = e => { // (opção retirada na v1.8)
    const b = e.target.closest('button'); if (!b) return;
    S.settings.basis = b.dataset.basis; saveSettings();
    $$('#basisSeg button').forEach(x => x.classList.toggle('on', x === b));
    renderGrid();
    if (S.selected && dayVisible()) renderDay(S.selected);
  };
  $('#startDate').addEventListener('change', e => { S.settings.startDate = e.target.value || null; saveSettings(); rebuild(); renderGrid(); });
  $('#holState').addEventListener('change', e => { S.settings.holState = e.target.value; saveSettings(); rebuild(); refresh(); syncDrawer(); });
  $('#holCity').addEventListener('change', e => { S.settings.holCity = e.target.value; saveSettings(); rebuild(); refresh(); syncDrawer(); });
  $('#btnAddHoliday').onclick = async () => {
    const res = await dialog({
      title: 'Novo feriado',
      html: `<input type="text" id="chName" placeholder="Nome (ex.: Aniversário da cidade)" maxlength="40"><input type="date" id="chDate" value="${S.selected || today()}">
        <select id="chScope"><option value="municipal">Municipal</option><option value="estadual">Estadual</option><option value="nacional">Nacional</option><option value="personalizado">Pessoal (ex.: folga)</option></select>
        <label class="inline"><span>Repetir todo ano</span><input type="checkbox" class="switch" id="chYearly" checked></label>`,
      actions: [{ label: 'Cancelar', value: null }, { label: 'Adicionar', cls: 'primary', validate: () => !!$('#chDate').value, value: () => ({ date: $('#chDate').value, name: $('#chName').value.trim() || 'Feriado', scope: $('#chScope').value, yearly: $('#chYearly').checked }) }],
    });
    if (!res) return;
    S.settings.customHolidays = [...S.settings.customHolidays.filter(h => h.name !== res.name), res].sort((a, b) => a.date.localeCompare(b.date));
    saveSettings(); syncDrawer(); rebuild(); refresh();
  };
  $('#customHolList').onclick = e => { const b = e.target.closest('[data-del-hol]'); if (!b) return; e.preventDefault(); S.settings.customHolidays.splice(+b.dataset.delHol, 1); saveSettings(); syncDrawer(); rebuild(); refresh(); };
  $('#customHolList').addEventListener('change', e => {
    const n = e.target.dataset.hol; if (!n) return;
    const set = new Set(S.settings.disabledHolidays || []);
    e.target.checked ? set.delete(n) : set.add(n);
    S.settings.disabledHolidays = [...set];
    saveSettings(); rebuild(); refresh();
  });
  $('#btnNewTag').onclick = () => tagDialog();
  $('#tagList').addEventListener('click', e => { const b = e.target.closest('[data-edit-tag]'); if (b) tagDialog(tag(b.dataset.editTag)); });
  $('#tagList').addEventListener('change', e => {
    const id = e.target.dataset.tag; if (!id) return;
    const set = new Set(S.settings.hiddenTags);
    e.target.checked ? set.delete(id) : set.add(id);
    S.settings.hiddenTags = [...set];
    e.target.closest('.tag-row').classList.toggle('off', !e.target.checked);
    saveSettings(); renderGrid();
    if (S.selected && dayVisible()) renderDay(S.selected);
  });
  $('#btnSample').onclick = loadSample;
  $('#accSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-acc]'); if (!b) return;
    const id = b.dataset.acc;
    if (id === activeAccount()) return;
    S.settings.activeAccount = id;
    S.settings.hiddenAccounts = accountsList().map(a => a.id).filter(x => x !== id); // compatibilidade
    $$('#accSeg button').forEach(x => x.classList.toggle('on', x === b));
    S.dayReveal = null;
    saveSettings(); refresh(); renderHeader();
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
    if (e.target.value !== '__new') { Fm.lastTagVal = e.target.value; return; }
    const prev = Fm.lastTagVal || '';
    const pm = prev.startsWith('meta:') ? prev.slice(5) : (metaOfTag(prev) || {}).id;
    e.target.value = '';
    const t = await tagDialog(null, Fm.kind, pm || null);
    fillTagSelect(t ? t.id : prev);
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
    const a = { id: uid(), name: 'Principal', type: 'checking', institution: '', initialBalance: S.settings.initialBalance || 0, color: '#8cb6e4', purpose: 'Despesas do dia a dia', includeInTotal: true, archived: false, allowedTags: [], rules: [], order: 0, createdAt: nowISO() };
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
    syncDrawer, ensureDefaultAccount, DEFAULTS, PALETTE, distributeNow, findItem, finishCheck, metaVisible, scopedMeta, accVisible, filtering,
  };
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });

async function init() {
  // app de verdade: sem zoom de pinça nem de toque duplo (o viewport já pede isso; aqui garantimos nos navegadores que ignoram)
  ['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', e => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
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
    S.settings.basis = 'planned'; // v1.8: a opção Previsto/Realizado foi retirada; o calendário mostra sempre o previsto
    lastSaved = JSON.parse(JSON.stringify(S.settings));
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
  applyLayout();
  measureCal();
  $('#calHandle').classList.toggle('up', isExpanded());
  renderGrid();
  refreshDerived();
  db.requestPersistence();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
