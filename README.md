# Calendário Financeiro — versão 1.0

PWA em HTML, CSS e JavaScript puro (sem bibliotecas nem fontes externas), feita para o Galaxy Z Flip6 no Chrome.
Funciona offline, guarda tudo no aparelho (IndexedDB) e pode ser instalada como app.

## Onde fica cada coisa
- **Tela inicial**: só o calendário e a linha de saldo do mês. Toque no saldo para ver o resumo.
- **Tocar num dia**: detalhes, conferência do dia e adição rápida.
- **Tocar num lançamento**: Pagar/Receber, Parte (pagamento parcial), Editar, Adiar, Não paguei, Cancelar.
- **Toque longo num dia**: seleção de vários dias para editar em grupo (pagar, valor, adiar, cancelar, restaurar, conferir).
- **Sino** (só aparece quando há algo): alertas.
- **Menu ⋮**: Contas, Cofrinhos, Metas e orçamentos, Relatórios, Histórico, filtros, painéis da tela inicial, alertas, feriados e backup.

## Funcionalidades
- Recorrências inteligentes com edição por alcance (lançamento, dia, semana, mês, ano, daqui em diante, recorrência inteira), sem apagar o histórico.
- Previsto x realizado, conferência de dias, registro retroativo, desfazer.
- **Contas**: várias contas, saldo inicial, saldo atual, disponível, reservado, comprometido; despesas permitidas por conta (avisa e deixa liberar); aviso de saldo insuficiente com opção de transferir.
- **Transferências** entre contas próprias: não contam como receita nem despesa; podem ser agendadas, concluídas ou canceladas.
- **Origem das receitas** (ex.: Salário CLT, iFood) separada da conta e da tag.
- **Distribuição automática**: regras por conta e origem (valor fixo, percentual, restante, máximo, parar ao atingir a meta do cofrinho), automática ou com confirmação. Desfazer o recebimento desfaz a distribuição.
- **Cofrinhos** virtuais (reserva dentro da conta) e reais (conta separada), com meta, prazo e quanto guardar por mês.
- **Metas e orçamentos** por dia, dia útil, fim de semana, semana, mês, ano ou período personalizado, agrupando tags, contas ou origens. Sobras podem acumular na semana, no mês ou ir para um cofrinho; o excedente pode descontar dos próximos dias. Um orçamento diário pode colorir os dias do calendário (barra sob o número, separada do saldo).
- **Divisão de compras** entre tags (ex.: R$ 120 = 80 alimentação + 40 higiene), sem duplicar o total.
- **Relatórios**: mês/ano, previsto x realizado, comparação com o período anterior, metas cumpridas e gastos por tag.
- **Alertas** configuráveis (nunca bloqueiam): orçamento ultrapassado, meta perto do limite, despesas vencidas, receitas não recebidas, saldo futuro negativo, dias não conferidos, backup antigo.
- **Backup**: exporta um arquivo .json (no celular abre o compartilhamento para salvar no Drive, por exemplo) e restaura em outro aparelho.

## Publicar no GitHub Pages
1. Envie **todo o conteúdo desta pasta** para a raiz de um repositório público.
2. Settings → Pages → *Deploy from a branch* → `main` / `(root)` → Save.
3. Abra `https://SEU-USUARIO.github.io/NOME-DO-REPO/` no Chrome do Flip6 → ⋮ → **Instalar app**.

## Atualizar sem perder dados
Os dados ficam no IndexedDB do aparelho; o Service Worker só guarda os arquivos do app.
A cada versão, aumente `VERSION` em `sw.js` e envie ao GitHub. O app avisa "Nova versão instalada · Recarregar".
O banco é migrado automaticamente entre versões sem apagar nada. Faça um backup de vez em quando (Menu › Dados).

## Testes
```
node tests/engine.test.mjs    # saldo acumulado e recorrências
node tests/ops.test.mjs       # edição por alcance, adiamento, grupo, conferência
node tests/finance.test.mjs   # contas, transferências, cofrinhos, metas, orçamento diário, distribuição, alertas
```

## Arquivos
- `js/engine.js` recorrências e saldos · `js/ops.js` operações · `js/finance.js` contas, metas, distribuição, alertas, relatórios
- `js/app.js` calendário e lançamentos · `js/pages.js` telas de gestão, painéis e backup
- `js/db.js` IndexedDB · `js/holidays.js` feriados · `js/icons.js` ícones · `sw.js` offline
