# Catálogo Mundo Apple

O catálogo é atualizado por listas manuais. Não há coleta automática de produtos, contas ou painel administrativo.

Para importar uma lista na VPS:

```sh
node scripts/import-catalog.js /caminho/lista.txt AAAA-MM-DD
pm2 restart buscador
```

A importação bloqueia HOTWAV, Android, ativados e seminovos. Produtos CPO são permitidos e identificados no nome e na condição. Listas vazias ou inválidas preservam o catálogo anterior.

A página principal mostra o preço de venda com DFU e margem uma única vez. A página `/preco-de-custo`, acessível pelo botão ao lado de “Ao vivo”, mostra apenas custo + DFU, sem margem; usa uma lista e um cache separados da página de venda. As margens e as taxas permanecem em `data/margins.json` e `data/card_rates.json`. A calculadora e as exportações funcionam sem login.

A cotação do dólar continua independente do catálogo. Use `DISABLE_LIVE_DOLLAR=true` para desativá-la.
