import re, io, sys
p = "index.html"
s = io.open(p, encoding="utf-8").read()
orig = s

# ---- 1) Conta 2: verde -> azul ----
s = s.replace("body.acc2{--ac:#34D399}", "body.acc2{--ac:#A9D4F5}")
s = s.replace(".ad.a2{background:var(--gr)}", ".ad.a2{background:var(--ac)}")
s = s.replace("#drw .dseg button.on.a2{background:var(--gr)}", "#drw .dseg button.on.a2{background:var(--ac)}")
s = s.replace("body.acc2 #drw .dinst{background:var(--gr)}", "body.acc2 #drw .dinst{background:var(--ac)}")

# ---- 2) Anotações: confirm() -> ask() ----
s = s.replace(
  "if(!confirm('Excluir '+label+'?'))return;",
  "return ask('Excluir '+label+'?','Excluir',()=>{try{_memoDeleteDo(type,id)}finally{save()}},true);"
)

# ---- 3) Cancelar editor remove rascunho ----
s = s.replace(
  "function memoCancelEditor(){memoEnsure();S.memo.editor=null;R()}",
  "function memoCancelEditor(){memoEnsure();var e=S.memo.editor;if(e){var k=e.type==='plan'?'plans':e.type==='note'?'notes':e.type==='event'?'events':'routine';var arr=S.memo[k]||[];var it=arr.find(function(x){return x.id===e.id});if(it&&it._new){S.memo[k]=arr.filter(function(x){return x.id!==e.id})}}S.memo.editor=null;save()}"
)

# ---- 4) memoNew marca _new e salva ----
s = s.replace(
  "S.memo.editor={type,id};S.memo.tab=type==='plan'?'plans':type==='note'?'notes':'routine';R()\n}",
  "S.memo.editor={type,id};S.memo.tab=type==='plan'?'plans':type==='note'?'notes':'routine';save()\n}"
)

# ---- 5) Editor: adiciona botão Excluir ----
s = s.replace(
  '<div class="mf"><button class="btn" onclick="memoCancelEditor()">Cancelar</button><button class="btn p" onclick="memoSaveEditor()">Salvar horário</button></div></div>',
  '<div class="mf">${it._new?"":`<button class="btn" style="color:var(--rd)" onclick="memoDeleteFromEditor()">Excluir</button>`}<button class="btn" onclick="memoCancelEditor()">Cancelar</button><button class="btn p" onclick="memoSaveEditor()">Salvar horário</button></div></div>'
)
s = s.replace(
  '<div class="mf"><button class="btn" onclick="memoCancelEditor()">Cancelar</button><button class="btn p" onclick="memoSaveEditor()">Salvar compromisso</button></div></div>',
  '<div class="mf">${it._new?"":`<button class="btn" style="color:var(--rd)" onclick="memoDeleteFromEditor()">Excluir</button>`}<button class="btn" onclick="memoCancelEditor()">Cancelar</button><button class="btn p" onclick="memoSaveEditor()">Salvar compromisso</button></div></div>'
)
s = s.replace(
  '<div class="mf"><button class="btn" onclick="memoCancelEditor()">Cancelar</button><button class="btn p" onclick="memoSaveEditor()">Salvar ${isPlan?\'plano\':\'anotação\'}</button></div></div>',
  '<div class="mf">${it._new?"":`<button class="btn" style="color:var(--rd)" onclick="memoDeleteFromEditor()">Excluir</button>`}<button class="btn" onclick="memoCancelEditor()">Cancelar</button><button class="btn p" onclick="memoSaveEditor()">Salvar ${isPlan?\'plano\':\'anotação\'}</button></div></div>'
)

# ---- 6) Rotina: botão Excluir no card ----
s = s.replace(
  '<button class="btn s" onclick="memoEdit(\'${isEvent?\'event\':\'routine\'}\',\'${x.id}\')">Editar</button></div>`});',
  '<button class="btn s" onclick="memoEdit(\'${isEvent?\'event\':\'routine\'}\',\'${x.id}\')">Editar</button><button class="btn s" onclick="memoDelete(\'${isEvent?\'event\':\'routine\'}\',\'${x.id}\')">Excluir</button></div>`});'
)

# ---- 7) Agenda: botão Excluir ----
s = s.replace(
  '<button class="btn s" onclick="agendaEdit(\'${typ===\'routine\'?\'routine\':\'event\'}\',\'${x.id}\')">Editar</button></div>',
  '<button class="btn s" onclick="agendaEdit(\'${typ===\'routine\'?\'routine\':\'event\'}\',\'${x.id}\')">Editar</button><button class="btn s" onclick="agendaDel(\'${typ===\'routine\'?\'routine\':\'event\'}\',\'${x.id}\')">Excluir</button></div>'
)

# ---- 8) Funções auxiliares (append antes de </script> principal) ----
helpers = """
function _memoDeleteDo(type,id){memoEnsure();if(type==='plan')S.memo.plans=S.memo.plans.filter(x=>x.id!==id);else if(type==='note')S.memo.notes=S.memo.notes.filter(x=>x.id!==id);else if(type==='event')S.memo.events=S.memo.events.filter(x=>x.id!==id);else{S.memo.routine=S.memo.routine.filter(x=>x.id!==id);Object.keys(S.memo.done||{}).forEach(d=>{if(S.memo.done[d])delete S.memo.done[d][id]})}if(S.memo.editor&&S.memo.editor.id===id)S.memo.editor=null;toast('Excluído.')}
function memoDeleteFromEditor(){var e=S.memo.editor;if(e)memoDelete(e.type,e.id)}
function agendaDel(type,id){ask('Excluir '+(type==='event'?'este compromisso':'este horário recorrente')+'?','Excluir',()=>{if(type==='event')S.memo.events=S.memo.events.filter(x=>x.id!==id);else{S.memo.routine=S.memo.routine.filter(x=>x.id!==id);Object.keys(S.memo.done||{}).forEach(d=>{if(S.memo.done[d])delete S.memo.done[d][id]})}if(S.memo.editor&&S.memo.editor.id===id)S.memo.editor=null;try{closeM2()}catch(e){}try{closeM()}catch(e){}save();toast('Excluído.')},true)}
"""
s = s.replace("addEventListener('hashchange',()=>{", helpers + "\naddEventListener('hashchange',()=>{")

# ---- 9) Cache do service worker ----
if orig == s:
    print("AVISO: nada mudou. O arquivo pode já estar corrigido ou o formato é diferente.")
else:
    io.open(p, "w", encoding="utf-8").write(s)
    print("OK. index.html corrigido.")
    print("Agora edite sw.js e mude a linha CACHE = '...' para uma versão nova.")