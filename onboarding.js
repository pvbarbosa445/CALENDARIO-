// Configuração inicial (primeiro acesso): perguntas curtas, em etapas, que montam a estrutura do usuário.
// Ordem: Perfil → Contas → Metas → Tags (dentro das metas) → Receitas e despesas → Dias úteis e feriados → Revisão.
// Nada é criado antes da confirmação; tudo começa "previsto". O rascunho fica salvo para continuar depois.
// Genérico: as sugestões são só sugestões — nenhum nome, conta ou valor pessoal fica fixo no código.
import { UFS, LOCALES } from './holidays.js';

let C, el;
const STEPS = ['Perfil', 'Contas', 'Metas', 'Tags', 'Receitas e despesas', 'Dias úteis', 'Revisão'];
const SUG_EXP = ['Alimentação', 'Transporte', 'Moradia', 'Água e energia', 'Internet e telefone', 'Saúde', 'Higiene', 'Lazer', 'Assinaturas', 'Educação', 'Compras', 'Outros'];
const SUG_INC = ['Salário', 'Trabalho autônomo', 'Serviços', 'Renda extra', 'Comissões', 'Outras receitas'];
const SUG_TAGS = {
  'Alimentação': ['Almoço', 'Jantar', 'Café', 'Mercado', 'Lanches'], 'Transporte': ['Combustível', 'Ônibus', 'Aplicativos', 'Manutenção'],
  'Moradia': ['Aluguel', 'Condomínio', 'Manutenção da casa'], 'Água e energia': ['Água', 'Energia', 'Gás'], 'Internet e telefone': ['Internet', 'Celular'],
  'Saúde': ['Farmácia', 'Consultas', 'Plano de saúde'], 'Higiene': ['Produtos de higiene', 'Cabelo'], 'Lazer': ['Saídas', 'Cinema', 'Viagens'],
  'Assinaturas': ['Streaming', 'Música', 'Aplicativos'], 'Educação': ['Cursos', 'Livros', 'Material'], 'Compras': ['Roupas', 'Casa', 'Eletrônicos'],
  'Salário': ['Salário', 'Adiantamento', '13º salário'], 'Trabalho autônomo': ['Projetos', 'Clientes'], 'Serviços': ['Serviços prestados'],
  'Renda extra': ['Bicos', 'Vendas'], 'Comissões': ['Comissões'],
};
const PERIODS = { month: 'Por mês', week: 'Por semana', day: 'Por dia', businessDay: 'Por dia útil', weekend: 'Por fim de semana/feriado', year: 'Por ano' };
const ACC_TYPES = { checking: 'Conta corrente', savings: 'Poupança', digital: 'Carteira digital', cash: 'Dinheiro em espécie', payment: 'Conta de pagamento', investment: 'Investimento' };
const CURRENCIES = { BRL: 'Real (R$)', USD: 'Dólar (US$)', EUR: 'Euro (€)' };
/** Frequências simples → regras do calendário. */
const FREQS = {
  once: 'Uma vez', daily: 'Todos os dias', businessDays: 'Somente dias úteis', weekends: 'Somente fins de semana', weekendsHolidays: 'Fins de semana e feriados',
  holidays: 'Somente feriados', weekly: 'Toda semana', biweekly: 'A cada 15 dias', monthly: 'Todo mês (mesmo dia do início)', monthlyDay: 'Dia fixo do mês',
  nth: 'N-ésimo dia útil do mês', dates: 'Datas personalizadas',
};
const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const blank = () => ({
  step: 0,
  profile: { name: '', state: '', city: '', currency: 'BRL', optional: false },
  accounts: [{ id: 'a1', name: '', institution: '', type: 'checking', balance: 0, date: '' }],
  metas: [], // { id, name, kind, period, amount, accounts: [], alertPct, show, tags: [] }
  moves: [], // { id, kind, name, amount, meta: 'metaId|tag', account, start, freq, day, nth, weekdays: [], dates, policy }
  workdays: [1, 2, 3, 4, 5],
});
let D = null;
const uidL = () => 'w' + Math.random().toString(36).slice(2, 9);
const S = () => C.S;

export function init(ctx) {
  C = ctx;
  el = document.createElement('section');
  el.className = 'onb';
  el.id = 'onboarding';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('input', onInput);
}

/** O app está realmente zerado? (sem lançamentos, metas, tags, cofrinhos nem saldos). */
export function isEmpty() {
  const s = S();
  return !s.entries.size && !s.metas.size && !s.tags.size && !s.piggies.size && [...s.accounts.values()].every(a => !a.initialBalance) && s.accounts.size <= 1;
}
/** Mostra só no primeiro acesso de verdade; quem já usa o app nunca recebe o questionário depois de atualizar. */
export function maybeStart() {
  const st = S().settings;
  if (st.onboarded) return;
  if (!isEmpty()) { st.onboarded = true; C.saveSettings(); return; }
  if (navigator.webdriver && !/[?&]onboarding=1/.test(location.search)) return; // testes automáticos
  open(false);
}
let addMode = false;
export function open(redo = false) {
  addMode = redo;
  D = (!redo && S().settings.onboarding && S().settings.onboarding.draft) || blank();
  if (redo) D.accounts = [];
  el.classList.add('on'); el.setAttribute('aria-hidden', 'false');
  render();
}
function close(finished) {
  el.classList.remove('on'); el.setAttribute('aria-hidden', 'true');
  if (finished) { S().settings.onboarding = null; S().settings.onboarded = true; }
  C.saveSettings();
}
function saveDraft() { if (!addMode) { S().settings.onboarding = { draft: D }; C.saveSettings(); } }

// ---------------------------------------------------------------- telas
const esc = s => C.esc(String(s ?? ''));
const money = c => C.moneyInput(c || 0);
function head() {
  return `<div class="onb-top"><button class="text-btn" data-a="later">${addMode ? 'Fechar' : 'Continuar depois'}</button>
    <div class="onb-dots">${STEPS.map((s, i) => `<i class="${i === D.step ? 'on' : i < D.step ? 'done' : ''}" title="${s}"></i>`).join('')}</div>
    <span class="onb-count">${D.step + 1}/${STEPS.length}</span></div>`;
}
function foot(nextLabel = 'Continuar') {
  return `<div class="onb-foot">${D.step ? '<button class="primary-btn ghost" data-a="back">Voltar</button>' : '<span></span>'}
    ${D.step < STEPS.length - 1 ? '<button class="text-btn" data-a="skip">Pular</button>' : ''}
    <button class="primary-btn" data-a="next">${nextLabel}</button></div>`;
}
const opt = (obj, v) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${String(k) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('');
const allTags = () => D.metas.flatMap(m => m.tags.map(t => ({ meta: m, tag: t })));

const VIEWS = [
  // 0 — perfil
  () => `<h1>${addMode ? 'Refazer a configuração' : 'Boas-vindas ao Calendário Financeiro'}</h1>
    <p class="onb-lead">${addMode ? 'O que você criar aqui é somado ao que já existe. Nada é apagado.' : 'Algumas perguntas rápidas e o app já fica pronto para você. Dá para pular qualquer etapa e mudar tudo depois.'}</p>
    <label class="onb-f"><span>Como podemos te chamar?</span><input data-k="profile.name" value="${esc(D.profile.name)}" placeholder="Seu nome" maxlength="40"></label>
    <label class="onb-f"><span>Estado (para os feriados)</span><select data-k="profile.state"><option value="">Não informar</option>${opt(UFS, D.profile.state)}</select></label>
    <label class="onb-f"><span>Município</span><select data-k="profile.city"><option value="">Outro / não informar</option>${Object.entries(LOCALES.cities).filter(([, c]) => !D.profile.state || c.state === D.profile.state).map(([k, c]) => `<option value="${k}" ${k === D.profile.city ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <p class="onb-hint">Feriados nacionais sempre entram. Feriados municipais que não estiverem na lista podem ser adicionados depois em Configurações › Feriados.</p>
    <label class="onb-f"><span>Moeda</span><select data-k="profile.currency">${opt(CURRENCIES, D.profile.currency)}</select></label>`,
  // 1 — contas
  () => `<h1>Suas contas</h1><p class="onb-lead">Onde o seu dinheiro fica. Uma só já basta; dá para criar outras quando quiser.</p>
    ${D.accounts.map((a, i) => `<div class="onb-card">
      <div class="onb-row"><label class="onb-f grow"><span>Nome da conta</span><input data-k="accounts.${i}.name" value="${esc(a.name)}" placeholder="Ex.: Conta corrente" maxlength="40"></label>
        ${D.accounts.length > 1 || addMode ? `<button class="icon-btn" data-a="delAcc" data-i="${i}" aria-label="Remover">${C.icon('trash')}</button>` : ''}</div>
      <div class="onb-row"><label class="onb-f grow"><span>Instituição (opcional)</span><input data-k="accounts.${i}.institution" value="${esc(a.institution)}" maxlength="40"></label>
        <label class="onb-f grow"><span>Tipo</span><select data-k="accounts.${i}.type">${opt(ACC_TYPES, a.type)}</select></label></div>
      <div class="onb-row"><label class="onb-f grow"><span>Saldo inicial</span><input data-k="accounts.${i}.balance" data-money inputmode="decimal" value="${money(a.balance)}" placeholder="0,00"></label>
        <label class="onb-f grow"><span>Saldo em</span><input type="date" data-k="accounts.${i}.date" value="${esc(a.date)}"></label></div>
    </div>`).join('')}
    <button class="onb-add" data-a="addAcc">+ Adicionar conta</button>`,
  // 2 — metas
  () => {
    const chosen = new Set(D.metas.map(m => m.name));
    const chip = (n, kind) => `<button type="button" class="chip${chosen.has(n) ? ' on' : ''}" data-a="sugMeta" data-n="${esc(n)}" data-kind="${kind}">${esc(n)}</button>`;
    return `<h1>O que você quer controlar ou alcançar?</h1>
    <p class="onb-lead">As <b>Metas</b> são o centro da organização: cada gasto e cada receita alimenta uma meta. Toque nas sugestões ou crie as suas.</p>
    <div class="onb-sub">Metas de despesas <small>quanto pretende gastar em cada área</small></div><div class="chips">${SUG_EXP.map(n => chip(n, 'expense')).join('')}</div>
    <div class="onb-sub">Metas de receitas <small>quanto pretende receber de cada fonte</small></div><div class="chips">${SUG_INC.map(n => chip(n, 'income')).join('')}</div>
    ${D.metas.map((m, i) => `<div class="onb-card">
      <div class="onb-row"><label class="onb-f grow"><span>Nome da meta</span><input data-k="metas.${i}.name" value="${esc(m.name)}" maxlength="40"></label>
        <button class="icon-btn" data-a="delMeta" data-i="${i}" aria-label="Remover">${C.icon('trash')}</button></div>
      <div class="onb-row"><label class="onb-f grow"><span>Controla</span><select data-k="metas.${i}.kind"><option value="expense" ${m.kind === 'expense' ? 'selected' : ''}>Despesas</option><option value="income" ${m.kind === 'income' ? 'selected' : ''}>Receitas</option></select></label>
        <label class="onb-f grow"><span>Período</span><select data-k="metas.${i}.period">${opt(PERIODS, m.period)}</select></label></div>
      <div class="onb-row"><label class="onb-f grow"><span>${m.kind === 'income' ? 'Quanto quer receber' : 'Limite de gastos'} (opcional)</span><input data-k="metas.${i}.amount" data-money inputmode="decimal" value="${money(m.amount)}" placeholder="Em branco = só acompanhar"></label>
        ${m.kind === 'expense' ? `<label class="onb-f"><span>Avisar em (%)</span><input type="number" data-k="metas.${i}.alertPct" value="${m.alertPct ?? 80}" min="1" max="200"></label>` : ''}</div>
      ${D.accounts.filter(a => a.name).length > 1 ? `<div class="onb-f"><span>Contas desta meta (nenhuma = todas)</span><div class="chips">${D.accounts.filter(a => a.name).map(a => `<button type="button" class="chip${m.accounts.includes(a.id) ? ' on' : ''}" data-a="metaAcc" data-i="${i}" data-acc="${a.id}">${esc(a.name)}</button>`).join('')}</div></div>` : ''}
      <label class="onb-check"><input type="checkbox" data-k="metas.${i}.show" ${m.show !== false ? 'checked' : ''}> Mostrar na área de Metas abaixo do calendário</label>
    </div>`).join('')}
    <button class="onb-add" data-a="addMeta">+ Criar outra meta</button>`;
  },
  // 3 — tags dentro das metas
  () => D.metas.length ? `<h1>Detalhe cada meta com tags</h1>
    <p class="onb-lead">A <b>tag pertence a uma meta</b>: ela só detalha o tipo de movimentação. Ex.: na meta Alimentação, as tags Almoço e Mercado. Também dá para lançar direto na meta, sem tag.</p>
    ${D.metas.map((m, i) => `<div class="onb-card"><div class="onb-sub">${esc(m.name || 'Meta sem nome')} <small>${m.kind === 'income' ? 'receitas' : 'despesas'}</small></div>
      <div class="chips">${[...new Set([...(SUG_TAGS[m.name] || []), ...m.tags])].map(t => `<button type="button" class="chip${m.tags.includes(t) ? ' on' : ''}" data-a="tag" data-i="${i}" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="onb-row"><input class="grow" data-newtag="${i}" placeholder="Nova tag nesta meta" maxlength="30"><button class="primary-btn ghost sm" data-a="addTag" data-i="${i}">Adicionar</button></div>
    </div>`).join('')}` : `<h1>Tags</h1><p class="onb-lead">As tags ficam dentro das metas. Como nenhuma meta foi criada, volte uma etapa para criar metas, ou pule esta.</p>`,
  // 4 — receitas e despesas
  () => {
    const metaOpts = sel => D.metas.map(m => `<optgroup label="${esc(m.name)}"><option value="${m.id}|" ${sel === m.id + '|' ? 'selected' : ''}>${esc(m.name)} · geral</option>${m.tags.map(t => `<option value="${m.id}|${esc(t)}" ${sel === `${m.id}|${t}` ? 'selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>`).join('');
    const accs = D.accounts.filter(a => a.name);
    return `<h1>Receitas e despesas que se repetem</h1>
    <p class="onb-lead">Cadastre o que entra e sai com frequência. Tudo começa como <b>previsto</b>; você confirma no calendário quando pagar ou receber.</p>
    ${D.moves.map((x, i) => `<div class="onb-card">
      <div class="onb-row"><div class="segmented seg-sm grow"><button class="${x.kind === 'income' ? 'on' : ''}" data-a="mvKind" data-i="${i}" data-kind="income">Receita</button><button class="${x.kind === 'expense' ? 'on' : ''}" data-a="mvKind" data-i="${i}" data-kind="expense">Despesa</button></div>
        <button class="icon-btn" data-a="delMove" data-i="${i}" aria-label="Remover">${C.icon('trash')}</button></div>
      <div class="onb-row"><label class="onb-f grow"><span>Descrição</span><input data-k="moves.${i}.name" value="${esc(x.name)}" placeholder="${x.kind === 'income' ? 'Ex.: Salário' : 'Ex.: Aluguel'}" maxlength="40"></label>
        <label class="onb-f"><span>Valor</span><input data-k="moves.${i}.amount" data-money inputmode="decimal" value="${money(x.amount)}" placeholder="0,00"></label></div>
      <label class="onb-f"><span>Meta e tag</span><select data-k="moves.${i}.meta"><option value="">Sem meta</option>${metaOpts(x.meta)}</select></label>
      ${accs.length > 1 ? `<label class="onb-f"><span>Conta</span><select data-k="moves.${i}.account">${accs.map(a => `<option value="${a.id}" ${a.id === x.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : ''}
      <div class="onb-row"><label class="onb-f grow"><span>Começa em</span><input type="date" data-k="moves.${i}.start" value="${esc(x.start)}"></label>
        <label class="onb-f grow"><span>Repete</span><select data-k="moves.${i}.freq">${opt(FREQS, x.freq)}</select></label></div>
      ${x.freq === 'monthlyDay' ? `<label class="onb-f"><span>Dia do mês</span><input type="number" min="1" max="31" data-k="moves.${i}.day" value="${x.day || 1}"></label>` : ''}
      ${x.freq === 'nth' ? `<label class="onb-f"><span>Qual dia útil</span><select data-k="moves.${i}.nth">${opt({ 1: '1º dia útil', 2: '2º', 3: '3º', 4: '4º', 5: '5º', 10: '10º', 15: '15º', 20: '20º', '-1': 'Último dia útil' }, x.nth || 1)}</select></label>` : ''}
      ${x.freq === 'weekly' || x.freq === 'biweekly' ? `<div class="onb-f"><span>Dias da semana</span><div class="chips">${WD.map((w, d) => `<button type="button" class="chip${(x.weekdays || []).includes(d) ? ' on' : ''}" data-a="mvWd" data-i="${i}" data-d="${d}">${w}</button>`).join('')}</div></div>` : ''}
      ${x.freq === 'dates' ? `<label class="onb-f"><span>Datas (dd/mm/aaaa, separadas por vírgula)</span><input data-k="moves.${i}.dates" value="${esc(x.dates || '')}"></label>` : ''}
      ${['monthly', 'monthlyDay', 'weekly', 'biweekly', 'once', 'dates'].includes(x.freq) ? `<label class="onb-f"><span>Se cair em feriado${x.freq !== 'once' ? ' ou fim de semana' : ''}</span><select data-k="moves.${i}.policy">${opt({ keep: 'Manter a data', next: 'Passar para o próximo dia útil', prev: 'Antecipar para o dia útil anterior', skip: 'Não acontece' }, x.policy || 'keep')}</select></label>` : ''}
    </div>`).join('')}
    <div class="onb-row"><button class="onb-add grow" data-a="addMove" data-kind="income">+ Receita</button><button class="onb-add grow" data-a="addMove" data-kind="expense">+ Despesa</button></div>
    <p class="onb-hint">Ex.: salário no 5º dia útil, vale no dia 20, transporte só em dias úteis, lazer nos fins de semana e feriados.</p>`;
  },
  // 5 — dias úteis
  () => {
    const wd = D.workdays.join(','), mode = D.wdMode === 'custom' ? 'custom' : wd === '1,2,3,4,5' ? 'mf' : wd === '1,2,3,4,5,6' ? 'ms' : 'custom';
    return `<h1>Como você conta os dias úteis?</h1>
    <p class="onb-lead">Isso define datas como "5º dia útil" e as recorrências de dias úteis. Feriados nunca são dia útil. Dá para mudar depois.</p>
    <div class="onb-options">
      <button class="${mode === 'mf' ? 'on' : ''}" data-a="wd" data-v="1,2,3,4,5">Segunda a sexta-feira</button>
      <button class="${mode === 'ms' ? 'on' : ''}" data-a="wd" data-v="1,2,3,4,5,6">Segunda a sábado</button>
      <button class="${mode === 'custom' ? 'on' : ''}" data-a="wdCustom">Personalizado</button>
    </div>
    ${mode === 'custom' ? `<div class="chips">${WD.map((w, d) => `<button type="button" class="chip${D.workdays.includes(d) ? ' on' : ''}" data-a="wdDay" data-d="${d}">${w}</button>`).join('')}</div>` : ''}
    <label class="onb-check"><input type="checkbox" data-k="profile.optional" ${D.profile.optional ? 'checked' : ''}> Considerar pontos facultativos (Carnaval, Corpus Christi) como feriado</label>
    <p class="onb-hint">Feriados: nacionais${D.profile.state ? ` · ${esc(UFS[D.profile.state])}` : ''}${D.profile.city && LOCALES.cities[D.profile.city] ? ` · ${esc(LOCALES.cities[D.profile.city].name)}` : ''}. Cada recorrência pode ter regra própria (ex.: "contar sábado" ou "dias da semana").</p>`;
  },
  // 6 — revisão
  () => {
    const accs = D.accounts.filter(a => a.name);
    const sec = (title, step, body) => `<div class="onb-card"><div class="onb-row"><div class="onb-sub grow">${title}</div><button class="text-btn" data-a="go" data-s="${step}">Editar</button></div>${body}</div>`;
    const wdTxt = D.workdays.map(d => WD[d]).join(', ');
    return `<h1>Revise antes de criar</h1><p class="onb-lead">Nada foi criado ainda. Confira e toque em <b>Criar</b>.</p>
    ${sec('Perfil e feriados', 0, `<p>${esc(D.profile.name || 'Sem nome')} · ${esc(CURRENCIES[D.profile.currency])} · ${D.profile.state ? esc(UFS[D.profile.state]) : 'só feriados nacionais'}${D.profile.city && LOCALES.cities[D.profile.city] ? ` · ${esc(LOCALES.cities[D.profile.city].name)}` : ''}</p>`)}
    ${sec('Contas e saldo inicial', 1, accs.length ? accs.map(a => `<p>${esc(a.name)} · ${esc(ACC_TYPES[a.type])} · ${C.money(a.balance || 0)}${a.date ? ` em ${C.dmy(a.date)}` : ''}</p>`).join('') : `<p class="muted">${addMode ? 'Nenhuma conta nova.' : 'Nenhuma: será usada uma conta "Principal".'}</p>`)}
    ${sec('Metas e suas tags', 2, D.metas.length ? D.metas.map(m => `<p><b>${esc(m.name)}</b> · ${m.kind === 'income' ? 'receita' : 'despesa'} · ${esc(PERIODS[m.period])}${m.amount ? ` · ${C.money(m.amount)}` : ' · só acompanhar'}${m.tags.length ? `<br><small>Tags: ${m.tags.map(esc).join(', ')}</small>` : ''}</p>`).join('') : '<p class="muted">Nenhuma meta.</p>')}
    ${sec('Receitas e despesas previstas', 4, D.moves.filter(x => x.name && x.amount).length ? D.moves.filter(x => x.name && x.amount).map(x => `<p>${x.kind === 'income' ? '+' : '−'} ${esc(x.name)} · ${C.money(x.amount)} · ${esc(FREQS[x.freq])}${x.freq === 'nth' ? ` (${x.nth}º)` : x.freq === 'monthlyDay' ? ` (dia ${x.day})` : ''}${x.meta ? ` · ${esc((D.metas.find(m => m.id === x.meta.split('|')[0]) || {}).name || '')}${x.meta.split('|')[1] ? ' › ' + esc(x.meta.split('|')[1]) : ''}` : ''}</p>`).join('') : '<p class="muted">Nenhuma.</p>')}
    ${sec('Dias úteis', 5, `<p>${wdTxt}${D.profile.optional ? ' · com pontos facultativos' : ''}</p>`)}
    ${D.metas.some(m => !m.tags.length) ? '<p class="onb-hint">Metas sem tags funcionam normalmente: você lança direto na meta.</p>' : ''}`;
  },
];

let rendering = false;
function render() {
  if (rendering) return; // trocar o HTML tira o foco do campo e dispara "change" de novo: não redesenha dentro do redesenho
  rendering = true;
  try { renderNow(); } finally { rendering = false; }
}
function renderNow() {
  el.innerHTML = `<div class="onb-in">${head()}<div class="onb-body">${VIEWS[D.step]()}</div>${foot(D.step === STEPS.length - 1 ? 'Criar' : 'Continuar')}</div>`;
}

// ---------------------------------------------------------------- interação
function setPath(path, value) {
  const parts = path.split('.');
  let o = D;
  for (let i = 0; i < parts.length - 1; i++) o = o[isNaN(parts[i]) ? parts[i] : +parts[i]];
  o[parts[parts.length - 1]] = value;
}
function valueOf(t) {
  if (t.type === 'checkbox') return t.checked;
  if (t.dataset.money !== undefined) return Math.max(0, C.parseMoney(t.value) || 0);
  if (t.type === 'number') return t.value === '' ? null : +t.value;
  return t.value;
}
function onInput(e) { const t = e.target; if (t.dataset.k && t.tagName === 'INPUT' && t.type !== 'checkbox') setPath(t.dataset.k, valueOf(t)); }
function onChange(e) {
  const t = e.target; if (!t.dataset.k) return;
  setPath(t.dataset.k, valueOf(t));
  if (t.dataset.k === 'profile.state') D.profile.city = '';
  if (t.tagName === 'SELECT' || t.type === 'checkbox' || t.dataset.money !== undefined) { saveDraft(); render(); }
}
function newMeta(name, kind) { return { id: uidL(), name, kind, period: 'month', amount: 0, accounts: [], alertPct: 80, show: true, tags: [] }; }
function newMove(kind) { return { id: uidL(), kind, name: '', amount: 0, meta: '', account: (D.accounts.find(a => a.name) || {}).id || '', start: C.today(), freq: kind === 'income' ? 'nth' : 'monthly', nth: 5, day: 10, weekdays: [], dates: '', policy: kind === 'income' ? 'prev' : 'keep' }; }

async function onClick(e) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, i = +b.dataset.i;
  switch (a) {
    case 'later': if (addMode) { close(false); return; } saveDraft(); close(false); C.toast('Tudo salvo. Continue quando quiser em Configurações › Dados.'); return;
    case 'next':
      if (D.step === STEPS.length - 1) { await finish(); return; }
      D.step++; break;
    case 'skip': D.step = Math.min(STEPS.length - 1, D.step + 1); break;
    case 'back': D.step = Math.max(0, D.step - 1); break;
    case 'go': D.step = +b.dataset.s; break;
    case 'addAcc': D.accounts.push({ id: uidL(), name: '', institution: '', type: 'checking', balance: 0, date: '' }); break;
    case 'delAcc': D.accounts.splice(i, 1); break;
    case 'sugMeta': {
      const n = b.dataset.n, at = D.metas.findIndex(m => m.name === n);
      if (at >= 0) D.metas.splice(at, 1); else D.metas.push(newMeta(n, b.dataset.kind));
      break;
    }
    case 'addMeta': D.metas.push(newMeta('', 'expense')); break;
    case 'delMeta': { const id = D.metas[i].id; D.metas.splice(i, 1); D.moves.forEach(x => { if (x.meta.startsWith(id + '|')) x.meta = ''; }); break; }
    case 'metaAcc': { const m = D.metas[i], id = b.dataset.acc; m.accounts = m.accounts.includes(id) ? m.accounts.filter(x => x !== id) : [...m.accounts, id]; break; }
    case 'tag': { const m = D.metas[i], t = b.dataset.t; m.tags = m.tags.includes(t) ? m.tags.filter(x => x !== t) : [...m.tags, t]; break; }
    case 'addTag': {
      const inp = el.querySelector(`[data-newtag="${i}"]`), t = (inp.value || '').trim();
      if (!t) return;
      // uma tag pertence a uma meta só
      if (D.metas.some(m => m.tags.includes(t))) { C.toast('Essa tag já está em outra meta'); return; }
      D.metas[i].tags.push(t); break;
    }
    case 'addMove': D.moves.push(newMove(b.dataset.kind)); break;
    case 'delMove': D.moves.splice(i, 1); break;
    case 'mvKind': D.moves[i].kind = b.dataset.kind; break;
    case 'mvWd': { const x = D.moves[i], d = +b.dataset.d; x.weekdays = (x.weekdays || []).includes(d) ? x.weekdays.filter(q => q !== d) : [...(x.weekdays || []), d]; break; }
    case 'wd': D.workdays = b.dataset.v.split(',').map(Number); D.wdMode = null; break;
    case 'wdCustom': D.wdMode = 'custom'; break;
    case 'wdDay': { const d = +b.dataset.d; D.workdays = D.workdays.includes(d) ? D.workdays.filter(x => x !== d) : [...D.workdays, d].sort(); if (!D.workdays.length) D.workdays = [1]; break; }
    default: return;
  }
  saveDraft(); render();
  el.querySelector('.onb-body').scrollTop = a === 'next' || a === 'back' || a === 'go' || a === 'skip' ? 0 : el.querySelector('.onb-body').scrollTop;
}

/** Regra do calendário a partir da frequência simples escolhida. */
export function ruleOf(x) {
  const start = x.start || C.today(), day = +start.slice(8, 10);
  const pol = x.policy && x.policy !== 'keep' ? { holidayPolicy: x.policy, policyWeekends: true } : {};
  switch (x.freq) {
    case 'once': return { type: 'once', start, ...pol };
    case 'daily': return { type: 'daily', start };
    case 'businessDays': return { type: 'businessDays', start };
    case 'weekends': return { type: 'weekends', start };
    case 'weekendsHolidays': return { type: 'weekendsHolidays', start };
    case 'holidays': return { type: 'holidays', start };
    case 'weekly': return { type: 'weekly', start, weekdays: (x.weekdays || []).length ? x.weekdays : [new Date(start + 'T12:00').getDay()], every: 1, ...pol };
    case 'biweekly': return { type: 'weekly', start, weekdays: (x.weekdays || []).length ? x.weekdays : [new Date(start + 'T12:00').getDay()], every: 2, ...pol };
    case 'monthly': return { type: 'monthlyDay', start, day, ...pol };
    case 'monthlyDay': return { type: 'monthlyDay', start, day: Math.min(31, Math.max(1, +x.day || 1)), ...pol };
    case 'nth': return { type: 'nthBusinessDay', start, n: +x.nth || 1 };
    case 'dates': {
      const dates = String(x.dates || '').split(/[,;\s]+/).map(s => s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)).filter(Boolean)
        .map(m => `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`).sort();
      return { type: 'dates', start: dates[0] || start, dates: dates.length ? dates : [start], ...pol };
    }
    default: return { type: 'once', start };
  }
}

/** Cria tudo depois da confirmação. Nada vem marcado como pago ou recebido. */
async function finish() {
  const s = S(), now = C.nowISO(), db = C.db;
  const st = s.settings;
  st.profile = { ...(st.profile || {}), name: D.profile.name.trim(), currency: D.profile.currency || 'BRL' };
  if (D.profile.state || !addMode) st.holState = D.profile.state || '';
  if (D.profile.city || !addMode) st.holCity = D.profile.city || '';
  st.holOptional = !!D.profile.optional;
  st.workdays = [...D.workdays].sort();
  // contas: no primeiro acesso a primeira resposta vira a conta principal (que já existe vazia)
  const accId = new Map();
  const accs = D.accounts.filter(a => a.name.trim());
  let firstDate = null;
  for (const [k, a] of accs.entries()) {
    let obj;
    const def = s.accounts.get(st.defaultAccount);
    if (!addMode && k === 0 && def) obj = { ...def, name: a.name.trim(), institution: a.institution || '', type: a.type, initialBalance: a.balance || 0, balanceDate: a.date || null };
    else obj = { id: C.uid(), name: a.name.trim(), institution: a.institution || '', type: a.type, initialBalance: a.balance || 0, balanceDate: a.date || null, color: C.PALETTE[(s.accounts.size * 5 + 6) % C.PALETTE.length], purpose: '', includeInTotal: true, archived: false, allowedTags: [], rules: [], order: s.accounts.size, createdAt: now };
    await db.put('accounts', obj); s.accounts.set(obj.id, obj); accId.set(a.id, obj.id);
    if (a.balance && (!firstDate || (a.date || C.today()) < firstDate)) firstDate = a.date || C.today();
  }
  if (firstDate && !addMode) { st.carry = true; st.startDate = firstDate.slice(0, 8) + '01'; } // saldo inicial acompanha os meses seguintes
  // metas → tags (dentro das metas)
  const metaId = new Map(), tagId = new Map();
  for (const [k, m] of D.metas.entries()) {
    if (!m.name.trim()) continue;
    const color = C.PALETTE[(s.metas.size * 5 + k * 3 + 8) % C.PALETTE.length];
    const tags = [];
    for (const [j, t] of m.tags.entries()) {
      const exists = [...s.tags.values()].find(x => x.name.toLowerCase() === t.toLowerCase());
      const tag = exists || { id: C.uid(), name: t, kind: m.kind, color: C.PALETTE[(k * 5 + j * 2) % C.PALETTE.length], order: s.tags.size };
      if (!exists) { await db.put('tags', tag); s.tags.set(tag.id, tag); }
      tags.push(tag.id); tagId.set(`${m.id}|${t}`, tag.id);
    }
    const obj = { id: C.uid(), name: m.name.trim(), kind: m.kind, period: m.period, amount: m.amount || 0, tagIds: tags, onlyAssigned: true, accountIds: m.accounts.map(a => accId.get(a)).filter(Boolean), origins: [], rollover: 'none', carryExcess: false, showOnCalendar: false, hideInPanel: m.show === false, color, tintTags: true, alertPct: m.alertPct || 80, createdAt: now };
    // uma tag pertence a uma meta só
    for (const o of s.metas.values()) if ((o.tagIds || []).some(id => tags.includes(id))) { const u = { ...o, tagIds: o.tagIds.filter(id => !tags.includes(id)) }; await db.put('metas', u); s.metas.set(u.id, u); }
    await db.put('metas', obj); s.metas.set(obj.id, obj); metaId.set(m.id, obj.id);
  }
  // receitas e despesas previstas
  const fallbackAcc = accId.get((accs[0] || {}).id) || st.defaultAccount;
  for (const x of D.moves) {
    if (!x.name.trim() || !x.amount) continue;
    const [mid, tg] = (x.meta || '').split('|');
    const e = { id: C.uid(), kind: x.kind, title: x.name.trim(), amount: x.amount, tagId: tg ? tagId.get(`${mid}|${tg}`) || null : null, metaId: !tg && mid ? metaId.get(mid) || null : null,
      accountId: accId.get(x.account) || fallbackAcc, origin: x.kind === 'income' ? x.name.trim() : '', rule: ruleOf(x), segments: [], createdAt: now, updatedAt: now };
    await db.put('entries', e); s.entries.set(e.id, e);
  }
  db.log(addMode ? 'Configuração refeita (itens acrescentados)' : 'Configuração inicial concluída', { details: [`${accs.length} conta(s)`, `${D.metas.filter(m => m.name).length} meta(s)`, `${D.moves.filter(x => x.name && x.amount).length} lançamento(s) previsto(s)`] });
  close(true);
  C.rebuild(); C.refresh(); C.renderHeader(); C.syncDrawer();
  C.toast(addMode ? 'Itens acrescentados' : `Pronto${st.profile.name ? ', ' + st.profile.name : ''}! Seu calendário já está montado.`);
}
