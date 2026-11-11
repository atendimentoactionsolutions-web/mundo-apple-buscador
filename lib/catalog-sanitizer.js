/**
 * CATALOG SANITIZER & INTEGRITY GUARDIAN
 * Módulo de Auto-Correção e Validação Implacável de Dados
 * 
 * Executa checagem de integridade contra:
 * 1. Preços inválidos, nulos, negativos ou anômalos.
 * 2. Vazamento de produtos ativados, CPO, AS-IS ou seminovos.
 * 3. Vazamento de Android ou marcas concorrentes.
 * 4. Produtos com datas antigas/expiradas (staleness).
 * 5. IDs duplicados ou dados corrompidos.
 * 6. Higienização de strings de modelos, capacidades e cores.
 */

const PricingCore = require('../public/js/pricing-core.js');

const ANDROID_CATEGORIES = new Set([
  'MI', 'NOTE', 'PAD', 'POCO', 'RDM', 'REAL', 'HOTWAV', 'ANDROID', 'SAMSUNG', 'MOTOROLA', 'XIAOMI', 'REDMI', 'REALME'
]);

const APPLE_CATEGORIES = new Set([
  'IPH', 'MCB', 'IPAD', 'IPD', 'RLG', 'PODS', 'ACSS', 'IMAC', 'MNTR',
  'IPHONE', 'MACBOOK', 'WATCH', 'AIRPODS', 'IMAC', 'APPLE TV', 'ACESSORIOS', 'ACCESSORIES'
]);

// Normaliza capacidades (ex: '256 gb' -> '256GB')
function sanitizeStorage(storage) {
  if (!storage) return '';
  return String(storage)
    .toUpperCase()
    .replace(/\s+/g, '')
    .trim();
}

// Normaliza cor do produto
function sanitizeColor(color) {
  if (!color) return 'PADRÃO';
  return String(color)
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

// Valida preço contra anomalias (deve ser número positivo e razoável)
function isValidPrice(price) {
  const num = Number(price);
  if (!Number.isFinite(num)) return false;
  if (num <= 0) return false;
  // Preço mínimo razoável para produtos Apple / Acessórios (R$ 10)
  if (num < 10) return false;
  // Preço máximo razoável (R$ 100.000)
  if (num > 100000) return false;
  return true;
}

// Verifica se o produto tem data de hoje (evita que dados velhos de ontem entrem no catálogo)
function isCurrentDate(priceDate, todayDateStr) {
  if (!priceDate || !todayDateStr) return true; // Se não especificado na oferta, aceita
  return priceDate.trim() === todayDateStr.trim();
}

/**
 * Sanitiza e audita uma lista completa de produtos.
 * @param {Array} rawList - Lista bruta de produtos vinda da PXT ou do disco.
 * @param {Object} options - Opções de auditoria (ex: todayDateStr).
 * @returns {Object} { cleanProducts, auditReport }
 */
function sanitizeCatalog(rawList, options = {}) {
  const startTime = Date.now();
  const todayDateStr = options.todayDateStr || `${String(new Date().getDate()).padStart(2, '0')}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  
  if (!Array.isArray(rawList)) {
    return {
      cleanProducts: [],
      auditReport: {
        totalReceived: 0,
        totalAccepted: 0,
        errorsFound: 1,
        criticalError: 'Entrada inválida: não é uma lista de produtos.',
        passed: false
      }
    };
  }

  const cleanMap = new Map();
  const anomalies = {
    invalidPrice: 0,
    androidBlocked: 0,
    ativadoBlocked: 0,
    cpoBlocked: 0,
    asIsBlocked: 0,
    seminovoBlocked: 0,
    staleDateBlocked: 0,
    duplicateFixed: 0,
    missingIdFixed: 0
  };

  for (const raw of rawList) {
    if (!raw) continue;

    // 1. Validação de ID
    const rawId = raw.id || raw._id;
    if (!rawId) {
      anomalies.missingIdFixed++;
      continue;
    }
    const id = String(rawId);

    // 2. Validação e Auto-Correção de Preço
    if (!isValidPrice(raw.price)) {
      anomalies.invalidPrice++;
      continue;
    }
    const cleanPrice = Math.round(Number(raw.price) * 100) / 100; // Arredonda centavos exatos

    // 3. Bloqueio Inviolável Anti-Ativado
    if (PricingCore.isAtivadoProduct(raw)) {
      anomalies.ativadoBlocked++;
      continue;
    }

    // 4. Bloqueio Anti-CPO e Anti-AS-IS
    if (PricingCore.isCpoProduct(raw)) {
      anomalies.cpoBlocked++;
      continue;
    }
    if (PricingCore.isAsIsProduct(raw)) {
      anomalies.asIsBlocked++;
      continue;
    }

    // 5. Bloqueio Anti-Seminovo
    if (PricingCore.isSeminovoProduct(raw)) {
      anomalies.seminovoBlocked++;
      continue;
    }

    // 6. Bloqueio Anti-Android / Marcas Concorrentes
    const cat = (raw.category || '').toUpperCase().trim();
    const name = (raw.name || '').toLowerCase();
    const desc = (raw.description || '').toLowerCase();

    if (ANDROID_CATEGORIES.has(cat) ||
        name.includes('samsung') || name.includes('xiaomi') || name.includes('redmi') ||
        name.includes('poco') || name.includes('motorola') || name.includes('realme') || name.includes('infinix') ||
        name.includes('hotwav') || desc.includes('hotwav')) {
      anomalies.androidBlocked++;
      continue;
    }

    // 7. Checagem de Seminovo textual adicional
    const isSeminovoText = (
      cat === 'SEMI' || name.includes('semi novo') || name.includes('semi-novo') || name.includes('seminovo') ||
      name.includes('usado') || name.includes('vitrine') || name.includes('grade a') || name.includes('grade b') ||
      name.includes('recondicionado') || name.includes('swp') || name.includes('swap') ||
      desc.includes('semi novo') || desc.includes('seminovo') || desc.includes('vitrine') || desc.includes('usado')
    );
    if (isSeminovoText) {
      anomalies.seminovoBlocked++;
      continue;
    }

    // 8. Deve pertencer a categoria Apple ou termo Apple
    const isAppleCategory = APPLE_CATEGORIES.has(cat);
    const isAppleName = (
      name.includes('iphone') || name.includes('macbook') || name.includes('ipad') ||
      name.includes('apple watch') || name.includes('airpods') || name.includes('imac') ||
      name.includes('apple tv') || name.includes('airtag') || name.includes('pencil') ||
      name.includes('magic keyboard') || name.includes('magic mouse') || name.includes('magic trackpad') ||
      name.includes('magic') || name.includes('magsafe') || name.includes('cabo') ||
      name.includes('fonte') || name.includes('carregador') || name.includes('adaptador') ||
      name.includes('folio') || name.includes('capa') || name.includes('case') ||
      name.includes('trackpad') || name.includes('teclado') || name.includes('mouse') ||
      name.includes('mac mini') || name.includes('mac studio') || name.includes('homepod') ||
      name.includes('pulseira') || name.includes('apple') || name.includes('earpods') ||
      name.includes('beats') || name.includes('strap') || name.includes('pelicula') ||
      name.includes('smart cover') || name.includes('power adapter')
    );

    if (!isAppleCategory && !isAppleName) {
      continue;
    }

    // 9. Bloqueio Anti-Stale (Data Antiga) se hoje foi informado
    if (options.strictTodayOnly && raw.priceDate && !isCurrentDate(raw.priceDate, todayDateStr)) {
      anomalies.staleDateBlocked++;
      continue;
    }

    // 10. Deduplicação e Construção do Objeto Limpo
    if (cleanMap.has(id)) {
      anomalies.duplicateFixed++;
    }

    cleanMap.set(id, {
      ...raw,
      id,
      price: cleanPrice,
      storage: sanitizeStorage(raw.storage),
      color: sanitizeColor(raw.color),
      isSeminovo: false,
      condition: 'NOVO'
    });
  }

  const cleanProducts = Array.from(cleanMap.values());
  const durationMs = Date.now() - startTime;
  const totalAnomaliesFixed = Object.values(anomalies).reduce((a, b) => a + b, 0);

  const auditReport = {
    timestamp: new Date().toISOString(),
    todayDateStr,
    durationMs,
    totalReceived: rawList.length,
    totalAccepted: cleanProducts.length,
    totalAnomaliesFixed,
    anomalies,
    passed: cleanProducts.length > 0 && anomalies.ativadoBlocked >= 0,
    healthStatus: cleanProducts.length > 0 ? 'HEALTHY' : 'WARNING_EMPTY'
  };

  return { cleanProducts, auditReport };
}

module.exports = {
  sanitizeCatalog,
  isValidPrice,
  sanitizeStorage,
  sanitizeColor
};
