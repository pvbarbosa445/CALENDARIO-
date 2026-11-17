# FIN — Controle Financeiro

Aplicativo web instalável (PWA) construído a partir da estrutura da planilha `Fin.xlsx`.

## Publicar no GitHub Pages

1. Crie um repositório no GitHub (por exemplo, `fin-app`).
2. Envie **todos os arquivos desta pasta** para a raiz do repositório: `index.html`, `manifest.webmanifest`, `sw.js`, `icon-192.png` e `icon-512.png`.
3. No repositório, abra **Settings → Pages**.
4. Em **Build and deployment**, escolha **Deploy from a branch**.
5. Selecione a branch `main` e a pasta `/ (root)`, depois salve.
6. Abra o endereço publicado pelo GitHub Pages. A primeira abertura precisa de internet; depois o app shell pode funcionar offline.

## Instalar no celular e no PC

- **Android / Chrome:** abra o endereço do GitHub Pages e escolha “Instalar app” ou “Adicionar à tela inicial”.
- **iPhone / Safari:** abra o endereço, toque em Compartilhar e escolha “Adicionar à Tela de Início”.
- **PC / Chrome ou Edge:** abra o endereço e use o ícone de instalação na barra de endereço ou o menu do navegador → “Instalar FIN”.

## Recursos

- Calendário mensal com entradas, saídas e saldo acumulado por dia.
- Planejamento anual de despesas fixas e receitas mensais.
- Cadastro, edição e exclusão de movimentações.
- Resumo de entradas, despesas, saldo e sobra planejada.
- Saldo de abertura configurável; meses sem saldo cadastrado herdam o saldo final anterior.
- Exportação e importação de backup JSON.
- Interface sem rolagem da página inteira, navegação adaptada para celular e PC, tela cheia e opção de manter a tela ligada quando o navegador oferece suporte.
- Armazenamento local e suporte offline via Service Worker.

## Observação sobre os dados

Os dados são armazenados no navegador/dispositivo. O GitHub Pages publica os arquivos do app, mas **não sincroniza automaticamente** os lançamentos entre celular e PC. Use o backup para transferir dados entre aparelhos. Os valores iniciais de planejamento foram transcritos da planilha recebida; outubro começa com saldo de R$ 365,00, tem adiantamentos de R$ 220,00 e R$ 300,00 e os gastos diários somam R$ 445,00, conforme a planilha. Novembro começa com saldo de R$ 448,80 conforme o campo “SALDO” da planilha.
