const path = require('path');
const PricingCore = require(path.join(__dirname, '../public/js/pricing-core.js'));
const margins = require(path.join(__dirname, '../data/margins.json'));

const testCases = [
  { name: 'APPLE TV 4K', cat: 'ACSS', cost: 1499 },
  { name: 'HOTWAV A17 PRO MAX', cat: 'ANDROID', cost: 650 },
  { name: 'APPLE PENCIL PRO', cat: 'ACSS', cost: 700 },
  { name: 'AIRPODS PRO 2', cat: 'PODS', cost: 1300 },
  { name: 'IPAD 11 WIFI', cat: 'IPAD', cost: 2740 },
  { name: 'IPAD PRO M5 13" WIFI', cat: 'IPAD', cost: 12000 },
  { name: 'IPHONE 16 PRO MAX', cat: 'IPH', cost: 6440 },
  { name: 'IPHONE 18 PRO MAX', cat: 'IPH', cost: 9500 },
  { name: 'IPHONE DUO', cat: 'IPH', cost: 14050 },
  { name: 'MACBOOK AIR M3 13"', cat: 'MCB', cost: 6500 },
  { name: 'MACBOOK PRO M5 MAX 14"', cat: 'MCB', cost: 18000 },
  { name: 'APPLE WATCH ULTRA 3 CAIXA PRETA', cat: 'RLG', cost: 4150 },
  { name: 'APPLE WATCH SE 3 GPS', cat: 'RLG', cost: 1990 }
];

testCases.forEach(tc => {
  const margin = PricingCore.getProductMargin(tc.cat, tc.name, margins);
  const retail = PricingCore.calculateRetailPrice(tc.cost, tc.cat, tc.name, margins);
  const dfuCost = PricingCore.applyDFU(tc.cost, tc.cat, tc.name);
  console.log(tc.name.padEnd(32), 'Custo: ' + String(tc.cost).padEnd(6), 'DFU+Custo: ' + String(dfuCost).padEnd(6), 'Margem: ' + String(margin).padEnd(6), 'Venda: ' + retail);
});
