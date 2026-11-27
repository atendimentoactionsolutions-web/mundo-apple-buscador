/**
 * ROBÔ AUDITOR DE CATÁLOGO, ESPECIFICAÇÕES E PREÇOS
 * Verifica continuamente se cada produto:
 * 1. Não é proibido (Ativado, CPO, Android/concorrente, seminovo inválido).
 * 2. Possui categoria compatível com o modelo e especificações obrigatórias completas.
 * 3. Possui custo, DFU, arredondamento e preço final de venda 100% corretos.
 * 4. Não gera colisões de condição (Seminovo vs Deslacrado vs Novo) na vitrine nem na exportação.
 */

const PricingCore = require('../public/js/pricing-core.js');

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const CATEGORY_PRICE_BOUNDS = {
  IPH: { min: 1200, max: 45000 },
  SEMI: { min: 700, max: 35000 },
  MCB: { min: 2500, max: 90000 },
  IMAC: { min: 4000, max: 60000 },
  IPAD: { min: 1200, max: 35000 },
  RLG: { min: 900, max: 20000 },
  PODS: { min: 350, max: 10000 },
  ACSS: { min: 50, max: 12000 },
  APPLE_TV: { min: 400, max: 6000 }
};

const STORAGE_RE = /\b(64GB|128GB|256GB|512GB|1TB|2TB|4TB|8TB)\b/i;
const RAM_RE = /\b(8|16|18|24|32|36|48|64|96|128)\s*GB(?:\s*RAM)?\b/i;
const WATCH_MM_RE = /\b(38|40|41|42|44|45|46|49)\s*MM\b/i;

function expectedDfuDelta(product) {
  if (!product) return 0;
  if (product.isSeminovo || PricingCore.isSeminovoProduct(product)) return 0;
  const cond = String(product.condition || '').toUpperCase();
  if (/DESLACRAD|ATIVAD|SEMI|USADO|VITRINE|CPO|AS\s*IS/.test(cond)) return 0;
  const wasActive = PricingCore.DFU_CONFIG.active;
  const wasFeedBase = PricingCore.DFU_CONFIG.feedBase;
  PricingCore.DFU_CONFIG.active = true;
  PricingCore.DFU_CONFIG.feedBase = false;
  try {
    const base = 1000;
    return round2(PricingCore.applyDFU(base, product.category, product.name) - base);
  } finally {
    PricingCore.DFU_CONFIG.active = wasActive;
    PricingCore.DFU_CONFIG.feedBase = wasFeedBase;
  }
}

function validateModelAndSpecs(product) {
  const issues = [];
  const cat = String(product.category || '').toUpperCase().trim();
  const name = String(product.name || '').trim();
  const upperName = name.toUpperCase();
  const storage = String(product.storage || '').trim();
  const color = String(product.color || '').trim().toUpperCase();

  if (!name) issues.push('Nome do modelo ausente');
  if (!color || ['COR NAO INFORMADA', 'COR NÃO INFORMADA', '-', 'N/A'].includes(color)) {
    issues.push('Cor inválida ou não informada');
  }

  if (cat === 'IPH') {
    if (!/\bIPHONE\b/i.test(upperName)) issues.push(`Categoria IPH incompatível com modelo "${name}"`);
    if (!STORAGE_RE.test(storage)) issues.push(`Capacidade inválida/ausente para iPhone (${storage || 'vazio'})`);
    if (product.isSeminovo) issues.push('Produto marcado como seminovo dentro da categoria IPH');
  } else if (cat === 'SEMI') {
    if (!/\bIPHONE\b/i.test(upperName)) issues.push(`Seminovo não-iPhone indevido (${name})`);
    if (!STORAGE_RE.test(storage)) issues.push(`Capacidade inválida/ausente para Seminovo (${storage || 'vazio'})`);
    if (!product.isSeminovo) issues.push('Produto em SEMI sem flag isSeminovo=true');
  } else if (cat === 'MCB') {
    if (!/\b(MACBOOK|MAC\s*MINI|MAC\s*STUDIO|MAC\s*PRO)\b/i.test(upperName)) {
      issues.push(`Categoria MCB incompatível com modelo "${name}"`);
    }
    if (!RAM_RE.test(storage) && !RAM_RE.test(String(product.ram || ''))) {
      issues.push(`RAM ausente para Mac (${storage || 'vazio'})`);
    }
    if (!STORAGE_RE.test(storage)) {
      issues.push(`SSD/Armazenamento ausente para Mac (${storage || 'vazio'})`);
    }
    if (/\bMACBOOK\b/i.test(upperName) && !/\b(13|14|15|16)"/.test(upperName)) {
      issues.push(`Polegadas ausentes no modelo MacBook "${name}"`);
    }
  } else if (cat === 'IMAC') {
    if (!/\bIMAC\b/i.test(upperName)) issues.push(`Categoria IMAC incompatível com modelo "${name}"`);
    if (!RAM_RE.test(storage) && !RAM_RE.test(String(product.ram || ''))) {
      issues.push(`RAM ausente para iMac (${storage || 'vazio'})`);
    }
    if (!STORAGE_RE.test(storage)) {
      issues.push(`SSD/Armazenamento ausente para iMac (${storage || 'vazio'})`);
    }
  } else if (cat === 'IPAD' || cat === 'IPD') {
    if (!/\bIPAD\b/i.test(upperName)) issues.push(`Categoria IPAD incompatível com modelo "${name}"`);
    if (!STORAGE_RE.test(storage)) issues.push(`Capacidade inválida/ausente para iPad (${storage || 'vazio'})`);
    if (!/\bWI-?FI\b/i.test(upperName)) issues.push(`Conectividade (Wi-Fi / Cellular) ausente em "${name}"`);
  } else if (cat === 'RLG') {
    if (!/\bWATCH\b/i.test(upperName)) issues.push(`Categoria RLG incompatível com modelo "${name}"`);
    if (!WATCH_MM_RE.test(storage)) issues.push(`Tamanho da caixa (MM) ausente em Watch (${storage || 'vazio'})`);
    if (/\bULTRA\b/i.test(upperName) && !['NATURAL TITANIUM', 'BLACK TITANIUM', 'NATURAL', 'BLACK'].includes(color)) {
      issues.push(`Cor de pulseira/inválida vazou para Watch Ultra (${color})`);
    }
  } else if (cat === 'PODS') {
    if (!/\bAIRPODS?\b/i.test(upperName)) issues.push(`Categoria PODS incompatível com modelo "${name}"`);
    if (STORAGE_RE.test(storage)) issues.push(`Capacidade indevida em AirPods (${storage})`);
  } else if (cat === 'ACSS' || cat === 'APPLE_TV') {
    const isAppleTv = /\bAPPLE\s*TV\b/i.test(upperName) || cat === 'APPLE_TV';
    if (!isAppleTv && STORAGE_RE.test(storage)) {
      issues.push(`Capacidade indevida em acessório (${storage})`);
    }
    if (!/\b(APPLE\s*TV|PENCIL|MAGIC|SMART\s*KEYBOARD|AIRTAG|EARPODS|CABO|FONTE|CARREGADOR|TRACKPAD|MAGSAFE|ADAPTADOR|FOLIO|CAPA|CASE)\b/i.test(upperName)) {
      issues.push(`Acessório desconhecido/suspeito "${name}"`);
    }
  } else {
    issues.push(`Categoria desconhecida "${cat}"`);
  }

  return issues;
}

function validatePriceAndMargin(product, options = {}) {
  const issues = [];
  const price = Number(product.price);
  const cat = String(product.category || '').toUpperCase().trim();
  const isSemi = Boolean(product.isSeminovo || PricingCore.isSeminovoProduct(product));

  if (!Number.isFinite(price) || price <= 0) {
    issues.push(`Preço inválido (${product.price})`);
    return { issues, expectedDfu: 0, expectedMargin: 0, expectedRetail: 0 };
  }
  if (round2(price) !== price) {
    issues.push(`Erro de arredondamento de ponto flutuante no preço (${price})`);
  }

  const bounds = CATEGORY_PRICE_BOUNDS[cat];
  if (bounds && (price < bounds.min || price > bounds.max)) {
    issues.push(`Preço fora da faixa esperada para ${cat}: R$ ${price} (esperado R$ ${bounds.min}..R$ ${bounds.max})`);
  }

  let expectedDfu = 0;
  // Custo/DFU só são verificáveis quando o dado de origem existe (sincronização e snapshot interno).
  // A API pública é blindada e não expõe sourceBase, então nesse caso só valida faixa e arredondamento.
  if (product.priceSource === 'buscabusca' && product.sourceBase !== undefined) {
    const base = Number(product.sourceBase);
    const adj = Number(product.sourceAdjustment || 0);
    expectedDfu = expectedDfuDelta(product);
    if (!Number.isFinite(base) || base <= 0) {
      issues.push(`sourceBase inválido (${product.sourceBase})`);
    } else {
      if (adj !== expectedDfu) {
        issues.push(`DFU divergente: aplicado ${adj}, esperado ${expectedDfu}`);
      }
      if (round2(base + adj) !== price) {
        issues.push(`Preço (${price}) != sourceBase (${base}) + DFU (${adj})`);
      }
    }
  }

  const margins = options.margins || PricingCore.getDefaultMargins();
  const expectedMargin = PricingCore.getProductMargin(product.name, cat, isSemi, margins);
  const costWithDfu = product.priceSource === 'buscabusca' || options.isCostInput
    ? price
    : round2(price + expectedDfuDelta(product));
  const expectedRetail = options.alreadyRetail
    ? price
    : round2(costWithDfu + expectedMargin);

  return { issues, expectedDfu, expectedMargin, expectedRetail };
}

/**
 * Audita uma lista completa de produtos do catálogo.
 * @param {Array} products
 * @param {Object} options - { margins, quarantine, alreadyRetail }
 * @returns {{ passed, checkedCount, acceptedProducts, quarantined, violations, specWarnings, summary }}
 */
function auditCatalog(products, options = {}) {
  const list = Array.isArray(products) ? products : [];
  const acceptedProducts = [];
  const quarantined = [];
  const violations = [];
  const specWarnings = [];
  const seenKeys = new Map();

  for (const product of list) {
    if (!product || typeof product !== 'object') continue;
    const reasons = [];

    if (PricingCore.isDisallowedProduct(product)) {
      reasons.push(`Produto proibido pelo filtro oficial (${product.condition || product.category || product.name})`);
    }

    const specIssues = validateModelAndSpecs(product);
    if (specIssues.length > 0) {
      reasons.push(...specIssues);
    }

    const priceCheck = validatePriceAndMargin(product, options);
    if (priceCheck.issues.length > 0) {
      reasons.push(...priceCheck.issues);
    }

    const dedupKey = [
      String(product.groupKey || product.name || '').toUpperCase().trim(),
      String(product.storage || '').toUpperCase().trim(),
      String(product.condition || (product.isSeminovo ? 'Seminovo' : 'Novo')).toUpperCase().trim(),
      String(product.color || '').toUpperCase().trim()
    ].join('|');

    if (seenKeys.has(dedupKey)) {
      specWarnings.push({
        id: product.id,
        name: product.name,
        storage: product.storage,
        color: product.color,
        condition: product.condition,
        reason: `Chave duplicada detectada no catálogo (${dedupKey})`
      });
    } else {
      seenKeys.set(dedupKey, product.id || true);
    }

    if (reasons.length > 0) {
      const entry = {
        id: product.id,
        name: product.name,
        category: product.category,
        condition: product.condition,
        storage: product.storage,
        color: product.color,
        price: product.price,
        reasons
      };
      violations.push(entry);
      quarantined.push(entry);
      if (!options.quarantine) {
        acceptedProducts.push(product);
      }
    } else {
      acceptedProducts.push(product);
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    passed: violations.length === 0,
    checkedCount: list.length,
    acceptedCount: acceptedProducts.length,
    quarantinedCount: quarantined.length,
    warningsCount: specWarnings.length,
    violations,
    specWarnings,
    summary: {
      total: list.length,
      valid: acceptedProducts.length,
      blockedOrInvalid: quarantined.length,
      duplicateCollisions: specWarnings.length
    }
  };

  return {
    ...report,
    acceptedProducts,
    quarantined
  };
}

module.exports = {
  auditCatalog,
  validateModelAndSpecs,
  validatePriceAndMargin,
  expectedDfuDelta,
  CATEGORY_PRICE_BOUNDS
};
