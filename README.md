# Calendário Financeiro

PWA em HTML, CSS e JavaScript puro (sem bibliotecas nem fontes externas), feita para o Galaxy Z Flip6 no Chrome.
Funciona offline, guarda tudo no aparelho (IndexedDB) e pode ser instalada como app.

## Como usar (Etapa 2)
- **Tocar num dia** abre os detalhes. **Tocar num lançamento** mostra as ações: Pagar, Editar, Adiar, Não paguei, Cancelar.
- **Editar** uma recorrência pergunta onde aplicar: só este lançamento, dia, semana, mês, ano, desta data em diante ou recorrência inteira — cada opção mostra quantos lançamentos e quais datas serão afetados.
- **Toque longo num dia** (ou o ícone de seleção no detalhe do dia) entra no modo de seleção: toque ou arraste sobre os dias, use "Semana"/"Mês", toque em Continuar e escolha quais lançamentos alterar (pagar, valor, adiar, cancelar, restaurar, conferir).
- **Conferir dia**: nos dias passados, confirme (✓) ou descarte (✕) o previsto, adicione gastos não previstos e conclua. O que ficar sem confirmação vira pendente.
- **Desfazer**: toda alteração mostra "Desfazer" por alguns segundos.
- Menu ⋮: filtros de receitas/despesas/tags, previsto x realizado, feriados, saldo acumulado entre meses.

## Publicar no GitHub Pages
1. Envie **todo o conteúdo desta pasta** para a raiz de um repositório.
2. Settings → Pages → *Deploy from a branch* → `main` / `(root)` → Save.
3. Abra `https://SEU-USUARIO.github.io/NOME-DO-REPO/` no Chrome do Flip6 → ⋮ → **Instalar app**.

## Atualizar sem perder dados
Os dados ficam no IndexedDB; o Service Worker só guarda os arquivos do app.
A cada versão, aumente `VERSION` em `sw.js` e envie ao GitHub. O banco é migrado automaticamente (v1 → v2) sem apagar nada.

## Testes
```
node tests/engine.test.mjs   # cálculo do saldo e recorrências
node tests/ops.test.mjs      # edição por alcance, adiamento, grupo, conferência (exemplos do adendo)
```

## Arquivos
- `js/engine.js` motor de recorrências e saldos · `js/ops.js` operações (alcance, grupo, adiamento) · `js/holidays.js` feriados
- `js/db.js` IndexedDB · `js/app.js` interface · `js/icons.js` ícones · `sw.js` offline
