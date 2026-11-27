// Usa os mesmos produtos e o mesmo agrupamento que a vitrine do BuscaBusca.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const PricingCore = require('../public/js/pricing-core.js');
const { auditCatalog } = require('./catalog-auditor.js');

const { pathToFileURL } = require('url');
const DEFAULT_FEED_URL = 'http://127.0.0.1:3050/api/products';
const catalogModule = process.env.BUSCABUSCA_CATALOG_MODULE || '/opt/disparador-fornecedores/web/catalog.js';
const categoryCodes = { iphone: 'IPH', seminovos: 'SEMI', mac: 'MCB', imac: 'IMAC', ipad: 'IPAD', watch: 'RLG', airpods: 'PODS', accessories: 'ACSS' };

async function storefrontOffers(products) {
  const version = (await fs.promises.stat(catalogModule)).mtimeMs;
  const { groupProducts, sortCatalogForDisplay, catalogSections, swatch, getDfuDelta } =
    await import(pathToFileURL(catalogModule).href + '?v=' + version);
  const rows = [];
  for (const section of catalogSections(sortCatalogForDisplay(groupProducts(products)))) {
    for (const group of section.items) {
      const category = categoryCodes[group.category];
      const isSeminovo = category === 'SEMI';
      if (!category || PricingCore.isDisallowedProduct({
        name: group.model,
        category,
        isSeminovo,
        condition: group.condition,
        description: group.condition
      })) continue;
      const sealed = group.offers.every(offer => /lacrad/i.test(offer.condicao || ''));
      const description = group.condition === 'Novo / Lacrado'
        ? (sealed ? 'Lacrado · declarado pelo fornecedor' : 'Novo / Lacrado · conferir obs. no fornecedor')
        : group.condition;
      const storage = group.capacity.includes('·') ? group.capacity : group.capacity.replace(/\s+/g, '');
      for (const variant of group.variants) {
        const best = variant.offers.find(offer => Number(offer.preco) === variant.minimum) || variant.offers[0] || {};
        const sourceAdjustment = getDfuDelta({ ...best, modelo: group.model, condicao: group.condition }, group.category);
        const supplier = best.fornecedor ? {
          name: String(best.fornecedor),
          whatsappNumber: String(best.telefone || '').replace(/\D/g, '') || null,
          address: null,
          isVerified: true,
          profileImageUrl: null
        } : null;
        const basePrice = Number(variant.minimum) || 0;
        const totalCost = Math.round((basePrice + sourceAdjustment) * 100) / 100;
        rows.push({
          supplier, offersCount: variant.offers.length,
          id: deterministicId([group.key, variant.key]), groupKey: group.key, family: section.family,
          name: group.model, storage, color: variant.color.toUpperCase(), colorHex: swatch(variant.key),
          description, category, condition: group.condition, isSeminovo, isActive: true,
          sourceBase: basePrice, sourceAdjustment, price: totalCost,
          priceSource: 'buscabusca', priceDate: toDayMonth(group.offers[0]?.data)
        });
      }
    }
  }
  return rows;
}

function toDayMonth(dateStr) {
  const m = String(dateStr || '').match(/^(\d{2})\/(\d{2})\/\d{4}$/);
  if (m) return `${m[1]}-${m[2]}`;
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function toIsoDate(dateStr) {
  const m = String(dateStr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return new Date().toISOString().slice(0, 10);
}

function deterministicId(parts) {
  const hash = crypto.createHash('sha1').update(parts.join('|')).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function computeFingerprint(products) {
  const summary = JSON.stringify(products);
  return crypto.createHash('sha256').update(summary).digest('hex');
}

function createBuscaBuscaSync({ onProductsSynced, getCurrentCount, getCurrentProducts, getMargins }) {
  const feedUrl = process.env.BUSCABUSCA_PRODUCTS_URL || DEFAULT_FEED_URL;
  const intervalMs = Math.max(5000, Number(process.env.BUSCABUSCA_SYNC_INTERVAL_MS) || 30000);
  const auditFile = path.join(__dirname, '..', 'data', 'audit_latest.json');
  let lastFingerprint = '';
  let running = false;
  let timer = null;
  const status = {
    enabled: true,
    feedUrl,
    intervalMs,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastChangedAt: null,
    lastError: null,
    lastOfferCount: 0,
    lastSupplierCount: 0,
    holdingPreviousCatalog: false,
    lastAudit: null,
  };

  async function syncOnce() {
    if (running) return { skipped: true };
    running = true;
    status.lastAttemptAt = new Date().toISOString();
    try {
      const { data } = await axios.get(feedUrl, { timeout: 12000 });
      if (!Array.isArray(data?.products) || data.demo) throw new Error('Catálogo da vitrine inválido');
      const rawProducts = await storefrontOffers(data.products);
      const margins = typeof getMargins === 'function' ? getMargins() : PricingCore.getDefaultMargins();
      const audit = auditCatalog(rawProducts, { margins, quarantine: true });
      const products = audit.acceptedProducts;
      status.lastAudit = {
        timestamp: audit.timestamp,
        passed: audit.passed,
        checkedCount: audit.checkedCount,
        acceptedCount: audit.acceptedCount,
        quarantinedCount: audit.quarantinedCount,
        warningsCount: audit.warningsCount,
        violations: audit.violations.slice(0, 25),
        specWarnings: audit.specWarnings.slice(0, 25)
      };
      if (audit.quarantinedCount > 0) {
        console.warn(`[Robô Auditor] ⚠️ ${audit.quarantinedCount} item(ns) bloqueado(s) na auditoria automática:`,
          audit.quarantined.slice(0, 5).map(v => `${v.name} (${v.reasons.join('; ')})`).join(' | '));
      }
      fs.promises.mkdir(path.dirname(auditFile), { recursive: true })
        .then(() => fs.promises.writeFile(auditFile, JSON.stringify(status.lastAudit, null, 2)))
        .catch(() => {});
      status.lastSuccessAt = new Date().toISOString();
      status.lastError = null;

      // OPÇÃO B: na virada da meia-noite (0 ofertas novas ainda), segura o último catálogo válido sem zerar a vitrine
      if (products.length === 0) {
        status.holdingPreviousCatalog = (typeof getCurrentCount === 'function' ? getCurrentCount() : 0) > 0;
        status.lastOfferCount = 0;
        return { ok: true, held: true, total: 0 };
      }

      status.holdingPreviousCatalog = false;
      status.lastOfferCount = products.length;
      status.lastSupplierCount = new Set(products.map(p => p.supplier?.name).filter(Boolean)).size;

      const fp = computeFingerprint(products);
      if (fp === lastFingerprint && fp === computeFingerprint(getCurrentProducts())) {
        return { ok: true, changed: false, total: products.length };
      }

      status.lastChangedAt = new Date().toISOString();
      const isoDate = toIsoDate(data.products[0]?.data);
      const dateStr = toDayMonth(data.products[0]?.data);
      await onProductsSynced(products, { isoDate, dateStr });
      lastFingerprint = fp;
      return { ok: true, changed: true, total: products.length, suppliers: status.lastSupplierCount };
    } catch (err) {
      status.lastError = err.message;
      return { ok: false, error: err.message };
    } finally {
      running = false;
    }
  }

  function start() {
    syncOnce().catch(() => {});
    timer = setInterval(() => { syncOnce().catch(() => {}); }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, syncOnce, getStatus: () => ({ ...status, active: Boolean(timer) }) };
}

module.exports = {
  storefrontOffers,
  createBuscaBuscaSync,
};
