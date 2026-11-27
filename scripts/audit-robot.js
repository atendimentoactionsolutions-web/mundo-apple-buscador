/**
 * ROBÔ DE VERIFICAÇÃO COMPLETA (END-TO-END)
 * Verifica automaticamente:
 * 1. Todos os produtos ao vivo (API pública + snapshot/feed BuscaBusca se disponível).
 * 2. Consistência de Modelo x Categoria x Especificações (RAM, SSD, polegadas, MM, conectividade, cor).
 * 3. Exatidão de Preço Base, DFU, Margens de Lucro e Arredondamento.
 * 4. Funções do Frontend (Vitrine, Preços do Dia, Exportação WhatsApp e Calculadora de Taxas).
 *
 * Uso:
 *   node scripts/audit-robot.js [--url=https://srv2058756.hstgr.cloud]
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const axios = require('axios');
const PricingCore = require('../public/js/pricing-core.js');
const QuoteCore = require('../public/js/quote-core.js');
const { auditCatalog } = require('../lib/catalog-auditor.js');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { url: process.env.BUSCADOR_URL || 'http://127.0.0.1:3333' };
  for (const arg of argv) {
    if (arg.startsWith('--url=')) args.url = arg.slice(6).replace(/\/$/, '');
  }
  return args;
}

function loadJson(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {}
  return fallback;
}

function createDomEl() {
  const classes = new Set();
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    dataset: {},
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c),
      toggle: (c, v = !classes.has(c)) => (v ? classes.add(c) : classes.delete(c), v)
    },
    setAttribute() {},
    querySelectorAll: () => [],
    addEventListener() {},
    appendChild() {},
    focus() {},
    blur() {},
    parentElement: { style: {} }
  };
}

async function verifyFrontendAndExport(publicProducts, margins, cardRates) {
  const ids = [
    'clientShowcaseModal', 'showcaseModelTitle', 'showcaseModelSubtitle', 'clientShowcaseBody',
    'priceCostLink', 'headerDollarBadge', 'adminHeaderBtn', 'userSessionInfo', 'tabStoreFront',
    'tabCostLink', 'tabPricesDay', 'btnOpenCalculator', 'btnExportTopHeader', 'btnExportSfWhatsapp',
    'btnExportAllSfWhatsapp', 'mobileDrawerCalcBtn', 'mobileDrawerExportBtn', 'mobileDrawerExportAllBtn',
    'mobileDrawerCostBtn', 'mobileDrawerAdminBtn', 'brandLogoLink', 'viewStoreFront', 'viewPricesDay',
    'viewQuotes', 'storefrontGrid', 'podMatrixGrid', 'sfShownCountText', 'catalogHeading',
    'catalogDescription', 'catalogModeLabel', 'btnClientMode', 'txtClientModeBtn', 'sfSearchInput',
    'sfSearchClearBtn', 'qbItemsList', 'qbCatalogDropdown', 'qbCatalogSearchInput', 'pdfSelectionModal',
    'pdfSelectionListBody', 'exportModalTitle', 'exportModalSubtitle', 'exportModalScopeLabel',
    'exportModalCategoryPills', 'pdfSelectedCountBadge'
  ];
  const elements = new Map(ids.map(id => [id, createDomEl()]));
  const errors = [];
  let copiedText = '';

  const context = vm.createContext({
    URLSearchParams,
    QuoteCore,
    PricingCore,
    document: {
      getElementById: id => elements.get(id) || null,
      querySelectorAll: () => [],
      querySelector: () => null,
      body: createDomEl(),
      cookie: '',
      addEventListener() {}
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    io: () => ({ on() {}, emit() {} }),
    location: { pathname: '/', search: '', origin: 'http://localhost' },
    navigator: {},
    innerWidth: 1440,
    addEventListener() {},
    setInterval() {},
    setTimeout: () => 1,
    requestAnimationFrame: fn => { queueMicrotask(fn); return 1; },
    console: { log() {}, warn() {}, error: (...args) => errors.push(args.join(' ')) },
    fetch: async (url) => {
      const data = url === '/api/auth/me' ? null
        : url === '/api/margins' ? { success: true, margins, isShielded: true }
        : url === '/api/card-rates' ? { success: true, rates: cardRates }
        : { success: true, data: publicProducts, isShielded: true };
      return { ok: Boolean(data), status: data ? 200 : 401, json: async () => data };
    }
  });
  context.window = context;

  for (const name of ['quotes-module.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js', name), 'utf8'), context, { filename: name });
  }
  await new Promise(resolve => setImmediate(resolve));
  context.robustCopyToClipboard = async text => { copiedText = text; return true; };

  const visibleIds = new Set();
  const categories = ['IPH', 'SEMI', 'MCB', 'IMAC', 'IPAD', 'RLG', 'PODS', 'ACSS'];
  for (const cat of categories) {
    vm.runInContext(`sfCurrentCategory = ${JSON.stringify(cat)}; renderStoreFront();`, context);
    for (const card of context.storefrontCardMap.values()) {
      for (const id of card.productIds) visibleIds.add(id);
    }
  }

  const missingInStorefront = publicProducts.filter(p => !visibleIds.has(String(p.id)));

  // Simula exportação completa via WhatsApp
  await context.exportAllStorefrontWhatsApp();
  const exportErrors = [];
  if (!copiedText || copiedText.length < 50) exportErrors.push('Exportação completa retornou texto vazio');
  if (/\bATIVAD[OA]\b|\bCPO\b|\bHOTWAV\b|\bANDROID\b/i.test(copiedText)) {
    exportErrors.push('Termo proibido (Ativado/CPO/Android) encontrado no texto exportado');
  }
  if (/PREÇO DE CUSTO|DFU|MARGEM/i.test(copiedText)) {
    exportErrors.push('Termo interno de custo/margem vazou na exportação');
  }

  // Testa cópia individual de card
  vm.runInContext("sfCurrentCategory = 'IPH'; renderStoreFront();", context);
  const firstKey = Array.from(context.storefrontCardMap.keys())[0];
  if (firstKey) {
    copiedText = '';
    await context.copyModelPrices(firstKey);
    if (!copiedText) exportErrors.push('copyModelPrices falhou ao copiar card individual');
  }

  // Testa calculadora de taxas em 1x, 12x e 18x com amostra real
  const samplePrice = publicProducts[0]?.price || 5000;
  for (const parcels of [1, 12, 18]) {
    const calc = QuoteCore.installment(samplePrice, 0, parcels, cardRates);
    if (!Number.isFinite(calc.totalAmount) || calc.totalAmount <= samplePrice) {
      exportErrors.push(`Cálculo de parcelamento ${parcels}x inválido: ${JSON.stringify(calc)}`);
    }
  }

  return {
    passed: errors.length === 0 && missingInStorefront.length === 0 && exportErrors.length === 0,
    jsErrors: errors,
    missingInStorefrontCount: missingInStorefront.length,
    missingInStorefront: missingInStorefront.slice(0, 10).map(p => `${p.name} ${p.storage} ${p.color}`),
    exportErrors,
    visibleCount: visibleIds.size
  };
}

async function runAuditRobot(options = {}) {
  const url = options.url || 'http://127.0.0.1:3333';
  const margins = loadJson(path.join(ROOT, 'data/margins.json'), PricingCore.getDefaultMargins());
  const cardRates = loadJson(path.join(ROOT, 'data/card_rates.json'), { baseRate: 2.69, installmentRates: {} });

  let publicProducts = [];
  let source = 'snapshot_latest.json';
  try {
    const resp = await axios.get(`${url}/api/products`, { timeout: 10000 });
    if (resp.data?.success && Array.isArray(resp.data.data)) {
      publicProducts = resp.data.data;
      source = `${url}/api/products`;
    }
  } catch {
    const snap = loadJson(path.join(ROOT, 'data/snapshot_latest.json'), []);
    publicProducts = snap.map(p => ({
      ...p,
      price: PricingCore.calculateRetailPrice(p.price, p.category, p.name, PricingCore.isSeminovoProduct(p), margins)
    }));
  }

  const catalogAudit = auditCatalog(publicProducts, {
    margins,
    alreadyRetail: source.includes('/api/products'),
    quarantine: false
  });

  // Se houver snapshot local com custo + feed BuscaBusca, valida exatamente Preço Público === Custo + DFU + Margem
  let crossCheck = null;
  const snapPath = path.join(ROOT, 'data/snapshot_latest.json');
  if (source.includes('/api/products') && fs.existsSync(snapPath)) {
    const costSnapshot = loadJson(snapPath, []);
    const costAudit = auditCatalog(costSnapshot, { margins, quarantine: false });
    const costById = new Map(costSnapshot.map(item => [String(item.id), item]));
    const priceMismatches = [];

    for (const pub of publicProducts) {
      const raw = costById.get(String(pub.id));
      if (!raw) continue;
      const isSemi = PricingCore.isSeminovoProduct(raw);
      const expectedMargin = PricingCore.getProductMargin(raw.name, raw.category, isSemi, margins);
      const expectedPublic = raw.priceSource === 'buscabusca'
        ? Math.round((Number(raw.price) + expectedMargin) * 100) / 100
        : PricingCore.calculateRetailPrice(raw.price, raw.category, raw.name, isSemi, margins);
      if (Math.abs(Number(pub.price) - expectedPublic) > 0.01) {
        priceMismatches.push({
          id: pub.id,
          name: pub.name,
          storage: pub.storage,
          color: pub.color,
          rawCost: raw.price,
          expectedPublic,
          actualPublic: pub.price
        });
      }
    }

    crossCheck = {
      costChecked: costAudit.checkedCount,
      costViolations: costAudit.violations,
      priceMismatches
    };
  }

  const frontendCheck = await verifyFrontendAndExport(publicProducts, margins, cardRates);

  const passed = catalogAudit.passed
    && frontendCheck.passed
    && (!crossCheck || (crossCheck.costViolations.length === 0 && crossCheck.priceMismatches.length === 0));

  return {
    timestamp: new Date().toISOString(),
    source,
    passed,
    totalProducts: publicProducts.length,
    catalogAudit: {
      passed: catalogAudit.passed,
      violationsCount: catalogAudit.violations.length,
      warningsCount: catalogAudit.warningsCount,
      violations: catalogAudit.violations.slice(0, 20),
      specWarnings: catalogAudit.specWarnings.slice(0, 20)
    },
    crossCheck,
    frontendCheck
  };
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  runAuditRobot(args)
    .then(report => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.passed) process.exitCode = 1;
    })
    .catch(err => {
      console.error('Erro no robô auditor:', err.message);
      process.exitCode = 1;
    });
}

module.exports = { runAuditRobot, verifyFrontendAndExport };
