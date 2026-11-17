const fs = require('node:fs');
const path = require('node:path');
const { processDailyPricesText } = require('../lib/daily-prices-importer');
const { sanitizeCatalog } = require('../lib/catalog-sanitizer');

// Importação explícita em disco. Após importar na VPS, reinicie o serviço buscador.
function importCatalog(rawText, { root = path.resolve(__dirname, '..'), date } = {}) {
  const isoDate = date || new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !Number.isFinite(Date.parse(isoDate)) ||
      new Date(isoDate).toISOString().slice(0, 10) !== isoDate) throw new Error('Data inválida. Use AAAA-MM-DD.');
  const [, month, day] = isoDate.split('-');
  const dateStr = `${day}-${month}`;
  const parsed = processDailyPricesText(rawText, { dateStr });
  if (!parsed.success || parsed.stats.failedLines) throw new Error('A lista contém linhas inválidas. O catálogo anterior foi preservado.');
  const { cleanProducts } = sanitizeCatalog(parsed.products, { todayDateStr: dateStr });
  if (!cleanProducts.length) throw new Error('Nenhum produto permitido. O catálogo anterior foi preservado.');
  const products = cleanProducts.map(product => ({ ...product, supplier: null }));
  const data = path.join(root, 'data');
  fs.mkdirSync(data, { recursive: true });
  const temporary = path.join(data, `catalog_${process.pid}_${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(products), { mode: 0o600 });
    fs.copyFileSync(temporary, path.join(data, `snapshot_${isoDate}.json`));
    fs.renameSync(temporary, path.join(data, 'snapshot_latest.json'));
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { date: dateStr, total: products.length, blocked: parsed.stats };
}

if (require.main === module) {
  try {
    const [file, date] = process.argv.slice(2);
    if (!file) throw new Error('Uso: node scripts/import-catalog.js lista.txt [AAAA-MM-DD]');
    console.log(JSON.stringify(importCatalog(fs.readFileSync(file, 'utf8'), { date }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { importCatalog };
