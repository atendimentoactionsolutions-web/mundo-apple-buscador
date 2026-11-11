/**
 * DAILY PRICES IMPORTER (Importador e Sanitizador de Preços do Dia)
 * Módulo para processamento de listas de custos coladas no Painel Admin.
 * Bloqueia rigorosamente Hotwav (Android) e Seminovos.
 */
const crypto = require('crypto');
const path = require('path');
const PricingCore = require(path.join(__dirname, '..', 'public', 'js', 'pricing-core.js'));

function parsePrice(valStr) {
  if (!valStr) return null;
  const numDirect = Number(valStr);
  if (Number.isFinite(numDirect) && numDirect > 0) return numDirect;

  // Regex para 'Custo R$ 1.499,00' ou 'R$ 1.499,00' ou '1.499,00'
  const m = String(valStr).match(/(?:Custo\s+)?R\$\s*([\d\.,]+)/i) || String(valStr).match(/([\d\.]+,\d{2})/);
  if (!m) {
    const rawDigits = String(valStr).replace(/[^\d]/g, '');
    const num = Number(rawDigits);
    return Number.isFinite(num) && num > 0 ? num : null;
  }
  const cleanNumStr = m[1].replace(/\./g, '').replace(',', '.');
  const num = parseFloat(cleanNumStr);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function isStorageStr(s) {
  if (!s) return false;
  return /^(64GB|128GB|256GB|512GB|1TB|2TB|\d+\/\d+|40MM|41MM|42MM|44MM|45MM|46MM|49MM)$/i.test(s.trim());
}

function isRamStr(s) {
  if (!s) return false;
  return /^\d+GB$/i.test(s.trim());
}

function parseSupplierLine(line, options = {}) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('<') || trimmed.startsWith('#')) return null;

  const parts = trimmed.split('•').map(p => p.trim());
  if (parts.length < 2) return null;

  const name = parts[0];
  const upperName = name.toUpperCase();

  // 1. Bloqueio Imediato e Inviolável de Hotwav / Android
  if (upperName.includes('HOTWAV') || upperName.includes('ANDROID') || upperName.includes('SAMSUNG') ||
      upperName.includes('XIAOMI') || upperName.includes('REDMI') || upperName.includes('POCO') ||
      upperName.includes('MOTOROLA') || upperName.includes('REALME') || upperName.includes('INFINIX')) {
    return { isBlocked: true, reason: 'HOTWAV_ANDROID', rawLine: trimmed };
  }

  // 2. Bloqueio Imediato e Inviolável de Seminovos / Usados
  const isSeminovoLine = (
    upperName.includes('SEMI NOVO') || upperName.includes('SEMI-NOVO') || upperName.includes('SEMINOVO') ||
    upperName.includes('USADO') || upperName.includes('VITRINE') || upperName.includes('GRADE A') ||
    upperName.includes('GRADE B') || upperName.includes('RECONDICIONADO') || upperName.includes('SWP') ||
    upperName.includes('SWAP') || trimmed.toUpperCase().includes('SEMINOVO')
  );
  if (isSeminovoLine) {
    return { isBlocked: true, reason: 'SEMINOVO', rawLine: trimmed };
  }

  // 3. Bloqueio de CPO / Ativados / AS IS
  if (upperName.includes('CPO') || trimmed.toUpperCase().includes('CPO')) {
    return { isBlocked: true, reason: 'CPO', rawLine: trimmed };
  }
  if (upperName.includes('ATIVADO') || trimmed.toUpperCase().includes('ATIVADO')) {
    return { isBlocked: true, reason: 'ATIVADO', rawLine: trimmed };
  }
  if (upperName.includes('AS IS') || upperName.includes('AS-IS')) {
    return { isBlocked: true, reason: 'AS_IS', rawLine: trimmed };
  }

  // 4. Extração de Custo e Disponibilidade
  let cost = null;
  let costIdx = -1;
  let dispCount = 1;

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (/Custo\s+R\$/i.test(p) || (i >= 2 && /R\$/i.test(p))) {
      cost = parsePrice(p);
      costIdx = i;
    } else if (/disponibilidade/i.test(p)) {
      const matchDisp = p.match(/(\d+)\s+fornecedor/i);
      if (matchDisp) dispCount = parseInt(matchDisp[1], 10);
    }
  }

  if (cost === null || costIdx === -1) {
    return null;
  }

  // 5. Atributos do Meio (Armazenamento, RAM, Cor)
  const middle = parts.slice(1, costIdx);
  let storage = null;
  let ram = null;
  let color = 'SEM COR';

  if (middle.length === 1) {
    const val = middle[0];
    if (isStorageStr(val)) {
      storage = val.toUpperCase();
    } else {
      color = val.toUpperCase();
    }
  } else if (middle.length === 2) {
    const [val0, val1] = middle;
    if (isStorageStr(val0)) {
      storage = val0.toUpperCase();
      color = val1.toUpperCase();
    } else if (isStorageStr(val1)) {
      color = val0.toUpperCase();
      storage = val1.toUpperCase();
    } else {
      storage = val0.toUpperCase();
      color = val1.toUpperCase();
    }
  } else if (middle.length >= 3) {
    storage = middle[0].toUpperCase();
    ram = middle[1].toUpperCase();
    color = middle[2].toUpperCase();
  }

  // 6. Categoria Apple Oficial
  let cat = 'ACSS';
  if (upperName.includes('APPLE TV')) {
    cat = 'APPLE_TV';
  } else if (
    upperName.includes('PENCIL') || upperName.includes('MAGIC KEYBOARD') || upperName.includes('MAGIC MOUSE') ||
    upperName.includes('MAGIC TRACKPAD') || upperName.includes('SMART KEYBOARD') || upperName.includes('SMART FOLIO') ||
    upperName.includes('FOLIO') || upperName.includes('AIRTAG')
  ) {
    cat = 'ACSS';
  } else if (upperName.includes('AIRPODS')) {
    cat = 'PODS';
  } else if (upperName.includes('IPAD')) {
    cat = 'IPAD';
  } else if (upperName.includes('IPHONE') || upperName.includes('IPH ')) {
    cat = 'IPH';
  } else if (
    upperName.includes('MACBOOK') || upperName.includes('IMAC') || upperName.includes('MAC MINI') || upperName.includes('MAC STUDIO')
  ) {
    cat = 'MCB';
  } else if (upperName.includes('APPLE WATCH') || upperName.includes('WATCH')) {
    cat = 'RLG';
  }

  // 7. Normalizações
  let cleanColor = color.trim().toUpperCase();
  if (['SEM COR', 'SEM-COR', 'SEMCOR'].includes(cleanColor)) {
    cleanColor = 'SEM COR';
  }

  let cleanStorage = storage ? storage.trim().toUpperCase() : 'PADRÃO';
  if (ram) {
    cleanStorage = `${cleanStorage} / ${ram} RAM`;
  }

  const todayStr = options.dateStr || `${String(new Date().getDate()).padStart(2, '0')}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    description: `${cat} - ${cleanStorage} - ${cleanColor}`,
    price: cost,
    isActive: true,
    category: cat,
    storage: cleanStorage,
    color: cleanColor,
    ram: ram || null,
    region: cat === 'IPH' ? '(CHIP VIRTUAL) 🇺🇸' : null,
    imageUrl: null,
    priceDate: todayStr,
    sheetDate: todayStr,
    listTimestamp: timeStr,
    sheetTimestamp: timeStr,
    supplier: {
      id: 'fornecedor-oficial',
      name: 'FORNECEDOR OFICIAL',
      whatsappNumber: '+55 11 98254-2277',
      address: 'SHOPPING ORIENTAL',
      locationFilter: 'SHOPPING ORIENTAL',
      priority: 0,
      isVerified: true
    },
    isSeminovo: false,
    condition: 'NOVO',
    dispCount
  };
}

function processDailyPricesText(rawText, options = {}) {
  if (!rawText || typeof rawText !== 'string') {
    return {
      success: false,
      error: 'Texto de produtos vazio.',
      products: [],
      stats: { totalLines: 0, accepted: 0, blockedHotwav: 0, blockedSeminovos: 0, blockedOthers: 0, failedLines: 0 }
    };
  }

  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const products = [];
  const stats = {
    totalLines: lines.length,
    accepted: 0,
    blockedHotwav: 0,
    blockedSeminovos: 0,
    blockedOthers: 0,
    failedLines: 0
  };

  for (const line of lines) {
    const res = parseSupplierLine(line, options);
    if (!res) {
      stats.failedLines++;
      continue;
    }
    if (res.isBlocked) {
      if (res.reason === 'HOTWAV_ANDROID') stats.blockedHotwav++;
      else if (res.reason === 'SEMINOVO') stats.blockedSeminovos++;
      else stats.blockedOthers++;
      continue;
    }
    products.push(res);
    stats.accepted++;
  }

  return {
    success: true,
    products,
    stats
  };
}

module.exports = {
  parsePrice,
  parseSupplierLine,
  processDailyPricesText
};
