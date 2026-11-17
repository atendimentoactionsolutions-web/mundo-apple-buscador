# Catálogo Mundo Apple

O catálogo é atualizado por listas manuais (via script `scripts/import-catalog.js` ou pelo painel administrativo). Não há coleta automática de produtos.

Para importar uma lista na VPS via linha de comando:

```sh
node scripts/import-catalog.js /caminho/lista.txt AAAA-MM-DD
pm2 restart buscador
```

A importação bloqueia HOTWAV, Android, ativados e seminovos. Produtos CPO são permitidos e identificados no nome e na condição. Listas vazias ou inválidas preservam o catálogo anterior.

A página principal pública mostra apenas o preço de venda com DFU e margem, com calculadora e exportações disponíveis sem login. O ícone da maçã no topo leva ao login administrativo (`/login.html`) e, quando autenticado como administrador, dá acesso ao painel administrativo (`/admin.html`). As páginas e APIs de custo (`/preco-de-custo`, `/api/cost-products` e o botão `R$ Custo` nos cards) ficam visíveis e acessíveis somente para administradores autenticados.

As margens e as taxas permanecem em `data/margins.json` e `data/card_rates.json`. A cotação do dólar continua independente do catálogo; use `DISABLE_LIVE_DOLLAR=true` para desativá-la.
