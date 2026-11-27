const test = require('node:test');
const assert = require('node:assert/strict');
const { auditCatalog } = require('../lib/catalog-auditor.js');
const PricingCore = require('../public/js/pricing-core.js');

test('robô auditor aprova produtos Apple válidos com especificações, DFU e preços exatos', () => {
  const products = [
    {
      id: 'iph-17pm',
      name: 'iPhone 17 Pro Max',
      category: 'IPH',
      condition: 'Novo / Lacrado',
      isSeminovo: false,
      storage: '256GB',
      color: 'COSMIC ORANGE',
      priceSource: 'buscabusca',
      sourceBase: 7450,
      sourceAdjustment: 100,
      price: 7550,
      groupKey: 'iphone|iphone 17 pro max|256gb|novo / lacrado'
    },
    {
      id: 'mcb-air',
      name: 'MacBook Air M5 13"',
      category: 'MCB',
      condition: 'Novo / Lacrado',
      isSeminovo: false,
      storage: '16GB RAM · 512GB',
      color: 'MIDNIGHT',
      priceSource: 'buscabusca',
      sourceBase: 8000,
      sourceAdjustment: 200,
      price: 8200,
      groupKey: 'mac|macbook air m5 13|16gb ram · 512gb|novo / lacrado'
    },
    {
      id: 'watch-u3',
      name: 'Apple Watch Ultra 3 GPS + Cellular',
      category: 'RLG',
      condition: 'Novo / Lacrado',
      isSeminovo: false,
      storage: '49MM',
      color: 'BLACK TITANIUM',
      priceSource: 'buscabusca',
      sourceBase: 4400,
      sourceAdjustment: 100,
      price: 4500,
      groupKey: 'watch|apple watch ultra 3 gps + cellular|49mm|novo / lacrado'
    },
    {
      id: 'semi-16',
      name: 'iPhone 16 Pro',
      category: 'SEMI',
      condition: 'Seminovo',
      isSeminovo: true,
      storage: '256GB',
      color: 'DESERT TITANIUM',
      priceSource: 'buscabusca',
      sourceBase: 4300,
      sourceAdjustment: 0,
      price: 4300,
      groupKey: 'seminovos|iphone 16 pro|256gb|seminovo'
    }
  ];

  const report = auditCatalog(products, { margins: PricingCore.getDefaultMargins(), quarantine: true });
  assert.equal(report.passed, true);
  assert.equal(report.acceptedCount, 4);
  assert.equal(report.quarantinedCount, 0);
  assert.equal(report.warningsCount, 0);
});

test('robô auditor bloqueia em quarentena Ativados, DFU errado, preço anômalo e especificações faltando', () => {
  const dirty = [
    {
      id: 'valid-1',
      name: 'iPhone 17 Pro',
      category: 'IPH',
      condition: 'Novo / Lacrado',
      isSeminovo: false,
      storage: '256GB',
      color: 'SILVER',
      priceSource: 'buscabusca',
      sourceBase: 7200,
      sourceAdjustment: 100,
      price: 7300
    },
    {
      id: 'ativ-1',
      name: 'iPhone 17 Pro',
      category: 'SEMI',
      condition: 'Ativado',
      isSeminovo: true,
      storage: '256GB',
      color: 'COSMIC ORANGE',
      priceSource: 'buscabusca',
      sourceBase: 7300,
      sourceAdjustment: 0,
      price: 7300
    },
    {
      id: 'bad-dfu',
      name: 'iPhone 16',
      category: 'IPH',
      condition: 'Novo / Lacrado',
      isSeminovo: false,
      storage: '128GB',
      color: 'BLACK',
      priceSource: 'buscabusca',
      sourceBase: 4500,
      sourceAdjustment: 0, // Faltou DFU +100
      price: 4500
    },
    {
      id: 'bad-price',
      name: 'iPad 11 A16 11" Wi-Fi',
      category: 'IPAD',
      condition: 'Novo / Lacrado',
      isSeminovo: false,
      storage: '128GB',
      color: 'PINK',
      priceSource: 'buscabusca',
      sourceBase: 30, // Preço quebrado R$ 30
      sourceAdjustment: 50,
      price: 80
    },
    {
      id: 'bad-mac',
      name: 'MacBook Pro M5',
      category: 'MCB',
      condition: 'Novo / Lacrado',
      isSeminovo: false,
      storage: '512GB', // Faltou RAM e polegadas
      color: 'SPACE BLACK',
      priceSource: 'buscabusca',
      sourceBase: 14000,
      sourceAdjustment: 200,
      price: 14200
    },
    {
      id: 'bad-watch-band',
      name: 'Apple Watch Ultra 3 GPS + Cellular',
      category: 'RLG',
      condition: 'Novo / Lacrado',
      isSeminovo: false,
      storage: '49MM',
      color: 'BURGUNDY ALPINE LOOP', // Cor de pulseira vazada
      priceSource: 'buscabusca',
      sourceBase: 4500,
      sourceAdjustment: 100,
      price: 4600
    }
  ];

  const report = auditCatalog(dirty, { margins: PricingCore.getDefaultMargins(), quarantine: true });
  assert.equal(report.passed, false);
  assert.equal(report.acceptedCount, 1);
  assert.equal(report.acceptedProducts[0].id, 'valid-1');
  assert.equal(report.quarantinedCount, 5);
});
