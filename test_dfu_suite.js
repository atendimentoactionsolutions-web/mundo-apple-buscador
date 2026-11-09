const PricingCore = require('./public/js/pricing-core.js');

console.log('=== TESTES COM DFU ATIVO ===');
PricingCore.setDfuActive(true);

const cases = [
  { name: 'iPhone 16 128GB', cat: 'IPH', cost: 5000, expected: 5100, desc: 'iPhone (+100)' },
  { name: 'iPad Air 11 M2', cat: 'IPAD', cost: 4000, expected: 4050, desc: 'iPad (+50)' },
  { name: 'MacBook Air 13 M3', cat: 'MCB', cost: 7000, expected: 7200, desc: 'MacBook (+200)' },
  { name: 'Apple Watch Series 10', cat: 'RLG', cost: 2800, expected: 2900, desc: 'Watch (+100)' },
  { name: 'Cabo USB-C 1m Apple', cat: 'ACSS', cost: 120, expected: 120, desc: 'Cabo (Acessorio - R$ 0)' },
  { name: 'Capa Silicone iPhone 16', cat: 'ACSS', cost: 250, expected: 250, desc: 'Capa iPhone (Acessorio - R$ 0)' },
  { name: 'Magic Keyboard para iPad', cat: 'ACSS', cost: 1800, expected: 1800, desc: 'Teclado iPad (Acessorio - R$ 0)' },
  { name: 'Pulseira Loop Apple Watch', cat: 'ACSS', cost: 350, expected: 350, desc: 'Pulseira Watch (Acessorio - R$ 0)' },
  { name: 'AirPods Pro 2 USB-C', cat: 'PODS', cost: 1400, expected: 1400, desc: 'AirPods (R$ 0)' }
];

let failed = 0;
for (const c of cases) {
  const res = PricingCore.applyDFU(c.cost, c.cat, c.name);
  const ok = res === c.expected;
  if (!ok) failed++;
  console.log('[' + (ok ? 'OK' : 'FAIL') + '] ' + c.desc + ' -> Custo: ' + c.cost + ' | Calculado: ' + res + ' | Esperado: ' + c.expected);
}

console.log('\n=== TESTES COM DFU DESATIVADO ===');
PricingCore.setDfuActive(false);
for (const c of cases) {
  const res = PricingCore.applyDFU(c.cost, c.cat, c.name);
  const ok = res === c.cost;
  if (!ok) failed++;
  console.log('[' + (ok ? 'OK' : 'FAIL') + '] ' + c.name + ' DFU Desativado -> Custo: ' + c.cost + ' | Calculado: ' + res + ' | Esperado: ' + c.cost);
}

if (failed === 0) {
  console.log('\nTODOS OS TESTES PASSARAM COM SUCESSO (ZERO ERROS)!');
} else {
  console.error('\nERROS ENCONTRADOS:', failed);
  process.exit(1);
}
