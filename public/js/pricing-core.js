/**
 * PRICING CORE (Módulo Unificado de Preços, DFU e Margens)
 * Compatível com Node.js (CommonJS) e Navegador (Browser window.PricingCore)
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PricingCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const DFU_CONFIG = {
    active: true, // DFU ATIVO (iPhones: +100, MacBooks: +200, Apple Watch: +100)
    iphoneValue: 100,
    macValue: 200,
    watchValue: 100,
    value: 100
  };

  function setDfuActive(active) {
    DFU_CONFIG.active = !!active;
  }

  function applyDFU(cost, category, rawModel, options = {}) {
    if (!DFU_CONFIG.active || options.disableDfu === true) return Number(cost) || 0;
    const numCost = Number(cost) || 0;
    if (numCost <= 0) return 0;
    const cat = (category || '').toUpperCase().trim();
    const model = (rawModel || '').toUpperCase();
    const isIphone = cat === 'IPH' || model.includes('IPHONE');
    const isMac = cat === 'MCB' || model.includes('MAC') || model.includes('MACBOOK');
    const isWatch = cat === 'RLG' || model.includes('WATCH');
    if (isIphone) {
      return numCost + (DFU_CONFIG.iphoneValue || 100);
    }
    if (isMac) {
      return numCost + (DFU_CONFIG.macValue || 200);
    }
    if (isWatch) {
      return numCost + DFU_CONFIG.watchValue;
    }
    return numCost;
  }

  function isAsIsProduct(p) {
    if (!p) return false;
    const cat = (p.category || '').toUpperCase().trim();
    const name = (p.name || '').toUpperCase();
    const desc = (p.description || '').toUpperCase();
    const reg = (p.region || '').toUpperCase();
    return (
      name.includes('AS IS') ||
      name.includes('AS-IS') ||
      name.includes('ASIS') ||
      desc.includes('AS IS') ||
      desc.includes('AS-IS') ||
      desc.includes('ASIS') ||
      cat.includes('AS IS') ||
      cat.includes('AS-IS') ||
      reg.includes('AS IS') ||
      reg.includes('AS-IS')
    );
  }

  function cleanModelName(name) {
    if (!name) return 'Apple';
    let cleaned = name.replace(/\b(SEMI-NOVO|SEMI NOVO|SEMINOVO|USADO|VITRINE|GRADE A\+?|GRADE B|SWAP|SWP|RECONDICIONADO)\b/gi, '')
                      .replace(/\s+/g, ' ')
                      .trim();
    if (!cleaned) return 'Apple';
    return cleaned;
  }

  function isCpoProduct(p) {
    if (!p) return false;
    const n = (p.name || '').toUpperCase();
    const d = (p.description || '').toUpperCase();
    const r = (p.region || '').toUpperCase();
    return n.includes('CPO') || d.includes('CPO') || r.includes('CPO');
  }

  function isDisallowedSeminovo(nameOrProduct, storage) {
    if (!nameOrProduct) return false;
    let name = '';
    let stor = '';
    let desc = '';
    if (typeof nameOrProduct === 'object' && nameOrProduct !== null) {
      name = nameOrProduct.name || '';
      stor = nameOrProduct.storage || '';
      desc = nameOrProduct.description || '';
    } else {
      name = String(nameOrProduct || '');
      stor = storage ? String(storage) : '';
    }
    const n = name.toUpperCase();
    const s = stor.toUpperCase().trim();
    const d = desc.toUpperCase();

    // 1. Exclui iPhone 13 Mini e modelos anteriores ao iPhone 13
    if (n.includes('13 MINI') || n.includes('13-MINI') || n.includes('13MINI')) return true;
    if (/\b(IPHONE|IPH)\s+(11|12|X|XR|XS|SE|8|7|6)\b/i.test(n)) {
      return true;
    }

    // 2. Exclui Seminovos de alta capacidade (512GB, 1TB e superiores)
    const hasHighCap = s.includes('512') || s.includes('1TB') || s.includes('1 TB') || s.includes('2TB') || s.includes('2 TB') ||
                       d.includes('512GB') || d.includes('1TB') || d.includes('1 TB') || d.includes('2TB') || d.includes('2 TB') ||
                       /\b(512GB|1TB|2TB)\b/i.test(n);
    if (hasHighCap) {
      return true;
    }

    return false;
  }

  function isSeminovoProduct(p) {
    if (!p) return false;
    if (isAsIsProduct(p)) return false;
    if (isDisallowedSeminovo(p)) return false;
    if (p.isSeminovo === true || p.condition === 'SEMINOVO') return true;
    const cat = (p.category || '').toUpperCase().trim();
    const name = (p.name || '').toLowerCase();
    const desc = (p.description || '').toLowerCase();
    return (
      cat === 'SEMI' ||
      name.includes('semi novo') ||
      name.includes('semi-novo') ||
      name.includes('seminovo') ||
      name.includes('usado') ||
      name.includes('vitrine') ||
      name.includes('grade a') ||
      name.includes('grade b') ||
      name.includes('recondicionado') ||
      name.includes('swp') ||
      name.includes('swap') ||
      desc.includes('semi novo') ||
      desc.includes('seminovo') ||
      desc.includes('vitrine') ||
      desc.includes('usado')
    );
  }

  function isDisallowedProduct(p) {
    if (!p) return true;
    if (isCpoProduct(p)) return true;
    if (isAsIsProduct(p)) return true;
    const cat = (p.category || '').toUpperCase().trim();
    const name = (p.name || '').toUpperCase();
    const desc = (p.description || '').toUpperCase();
    const isSemi = p.isSeminovo === true || p.condition === 'SEMINOVO' || cat === 'SEMI' ||
                   name.includes('SEMI NOVO') || name.includes('SEMI-NOVO') || name.includes('SEMINOVO') ||
                   name.includes('USADO') || name.includes('VITRINE') || desc.includes('SEMI');
    if (isSemi && isDisallowedSeminovo(p)) return true;
    return false;
  }

  function calculateSupplierReferencePrice(offers, isSeminovo = false) {
    if (!offers || offers.length === 0) return 0;
    if (!isSeminovo) {
      const valid = offers.map(o => Number(o.price) || 0).filter(p => p > 0);
      return valid.length > 0 ? Math.min(...valid) : 0;
    }

    const validPrices = offers
      .map(o => Number(o.price) || 0)
      .filter(p => p > 0)
      .sort((a, b) => a - b);

    if (validPrices.length === 0) return 0;
    if (validPrices.length === 1) return validPrices[0];
    if (validPrices.length === 2) return Math.round((validPrices[0] + validPrices[1]) / 2);
    if (validPrices.length === 3) return validPrices[1];

    const trimmed = validPrices.slice(1, -1);
    const sum = trimmed.reduce((acc, val) => acc + val, 0);
    return Math.round(sum / trimmed.length);
  }

  function getDefaultMargins() {
    return {
      categories: {
        SEMINOVOS: 600,
        IPH_DUO: 2300,
        IPH18: 1300,
        IPH: 750,
        MCB_AIR: 1000,
        MCB_PRO: 1300,
        MCB_MAX: 2500,
        IPAD: 500,
        IPAD_PRO_AIR: 750,
        RLG: 500,
        RLG_ULTRA_S12: 800,
        IMAC: 1500,
        PODS: 400,
        ACSS: 100,
        FOLIO: 400,
        PENCIL: 200,
        AIRTAG_UNIT: 100,
        AIRTAG_PACK: 350,
        MAGIC_KEY: 400,
        MAGIC_MOUSE: 430,
        APPLE_TV: 500
      },
      products: {}
    };
  }

  function getProductMargin(rawModel, category, isSemi = false, marginsData = null) {
    const margins = marginsData || getDefaultMargins();
    const nameUpper = (rawModel || '').trim().toUpperCase();
    const cleanNameUpper = cleanModelName(rawModel).toUpperCase();
    const catUpper = (category || '').trim().toUpperCase();

    // 1. Exceção de modelo específico se cadastrada no painel admin (busca nome direto e nome limpo)
    if (margins.products) {
      if (margins.products[nameUpper] !== undefined) return Number(margins.products[nameUpper]) || 0;
      if (margins.products[cleanNameUpper] !== undefined) return Number(margins.products[cleanNameUpper]) || 0;
    }

    // 2. Se for Linha iPhone Duo, aplica a margem de R$ 2.300
    if (nameUpper.includes('IPHONE DUO') || nameUpper.includes('DUO')) {
      return (margins.categories && margins.categories.IPH_DUO !== undefined) ? Number(margins.categories.IPH_DUO) : 2300;
    }

    // 2.1. Se for Linha iPhone 18 (Lançamento Importante), aplica a margem de R$ 1.300
    if (nameUpper.includes('IPHONE 18') || nameUpper.includes('IPH 18')) {
      return (margins.categories && margins.categories.IPH18 !== undefined) ? Number(margins.categories.IPH18) : 1300;
    }

    // 3. Se for Seminovo, aplica a margem de Seminovos (padrão R$ 600)
    if (isSemi) {
      return (margins.categories && margins.categories.SEMINOVOS !== undefined) ? Number(margins.categories.SEMINOVOS) : 600;
    }

    // 4. Margem padrão por Categoria
    if (margins.categories) {
      if (nameUpper.includes('FOLIO') || nameUpper.includes('SMART FOLIO')) {
        return margins.categories.FOLIO ?? 400;
      } else if (nameUpper.includes('PENCIL')) {
        return margins.categories.PENCIL ?? 200;
      } else if (nameUpper.includes('AIRTAG') && (nameUpper.includes('4 PACK') || nameUpper.includes('4-PACK') || nameUpper.includes('4PACK') || nameUpper.includes('PACOTE') || nameUpper.includes('4PK') || nameUpper.includes('4 UN') || nameUpper.includes('4UN'))) {
        return margins.categories.AIRTAG_PACK ?? 350;
      } else if (nameUpper.includes('AIRTAG')) {
        return margins.categories.AIRTAG_UNIT ?? 100;
      } else if (nameUpper.includes('MAGIC KEY') || nameUpper.includes('MAGIC KEYBOARD') || nameUpper.includes('SMART KEYBOARD') || nameUpper.includes('SMART KEY')) {
        return margins.categories.MAGIC_KEY ?? 400;
      } else if (nameUpper.includes('MAGIC MOUSE') || (nameUpper.includes('MOUSE') && (catUpper === 'ACSS' || nameUpper.includes('APPLE')))) {
        return margins.categories.MAGIC_MOUSE ?? 430;
      } else if (nameUpper.includes('APPLE TV') || nameUpper.includes('APPLETV') || nameUpper.includes('TV 4K') || nameUpper.includes('TV HD')) {
        return margins.categories.APPLE_TV ?? 500;
      } else if (catUpper === 'IPH' || nameUpper.includes('IPHONE')) {
        return margins.categories.IPH ?? 750;
      } else if ((nameUpper.includes('MACBOOK') || catUpper === 'MCB') && nameUpper.includes('MAX')) {
        return (margins.categories && margins.categories.MCB_MAX !== undefined) ? margins.categories.MCB_MAX : 2500;
      } else if (nameUpper.includes('MACBOOK AIR') || nameUpper.includes('AIR M') || (catUpper === 'MCB' && nameUpper.includes('AIR'))) {
        return margins.categories.MCB_AIR ?? 1000;
      } else if (catUpper === 'MCB' || nameUpper.includes('MACBOOK') || nameUpper.includes('MAC MINI') || nameUpper.includes('MAC STUDIO') || nameUpper.includes('MAC PRO')) {
        return margins.categories.MCB_PRO ?? 1300;
      } else if (catUpper === 'IPAD' || catUpper === 'IPD' || nameUpper.includes('IPAD')) {
        if (nameUpper.includes('PRO') || nameUpper.includes('AIR')) {
          return margins.categories.IPAD_PRO_AIR ?? 750;
        } else {
          return margins.categories.IPAD ?? 500;
        }
      } else if (catUpper === 'RLG' || nameUpper.includes('WATCH') || nameUpper.includes('SERIES') || nameUpper.includes('ULTRA')) {
        if (nameUpper.includes('ULTRA') || nameUpper.includes('S12')) {
          return margins.categories.RLG_ULTRA_S12 ?? 800;
        } else {
          return margins.categories.RLG ?? 500;
        }
      } else if (catUpper === 'IMAC' || nameUpper.includes('IMAC')) {
        return margins.categories.IMAC ?? 1500;
      } else if (catUpper === 'PODS' || nameUpper.includes('AIRPOD')) {
        return margins.categories.PODS ?? 400;
      } else if (catUpper === 'ACSS' || nameUpper.includes('CABO') || nameUpper.includes('FONTE') || nameUpper.includes('CARREGADOR') || nameUpper.includes('MAGIC')) {
        return margins.categories.ACSS ?? 100;
      } else {
        return margins.categories.DEFAULT ?? 500;
      }
    }

    return 500;
  }

  function calculateRetailPrice(rawCost, category, rawModel, isSemi = false, marginsData = null) {
    const cost = Number(rawCost) || 0;
    if (cost <= 0) return 0;
    const dfuCost = applyDFU(cost, category, rawModel);
    const margin = getProductMargin(rawModel, category, isSemi, marginsData);
    return dfuCost + margin;
  }

  return {
    DFU_CONFIG,
    setDfuActive,
    applyDFU,
    isAsIsProduct,
    cleanModelName,
    isDisallowedSeminovo,
    isSeminovoProduct,
    isCpoProduct,
    isDisallowedProduct,
    calculateSupplierReferencePrice,
    getDefaultMargins,
    getProductMargin,
    calculateRetailPrice
  };
});
