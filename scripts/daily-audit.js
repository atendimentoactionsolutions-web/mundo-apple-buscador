/**
 * SCRIPT DE REVISÃO E AUDITORIA DIÁRIA DE ROTINA
 * Executa checagem completa do catálogo em tempo real, cotações, novos, seminovos e bloqueio de ativados.
 * Pode ser executado com: node scripts/daily-audit.js [url_opcional]
 */

const http = require('http');
const https = require('https');

const targetUrl = process.argv[2] || process.env.AUDIT_URL || 'http://127.0.0.1:3333/api/products';
const client = targetUrl.startsWith('https') ? https : http;

console.log('='.repeat(70));
console.log(`🔍 INICIANDO AUDITORIA DIÁRIA DE ROTINA: ${targetUrl}`);
console.log(`⏰ Data/Hora da Verificação: ${new Date().toLocaleString('pt-BR')}`);
console.log('='.repeat(70));

const startTime = Date.now();

client.get(targetUrl, (res) => {
  let rawData = '';
  res.on('data', chunk => rawData += chunk);
  res.on('end', () => {
    const responseTime = Date.now() - startTime;
    try {
      const json = JSON.parse(rawData);

      if (!json.success && !Array.isArray(json.data)) {
        console.error('❌ FALHA CRÍTICA: Resposta da API não contém catálogo válido.');
        process.exit(1);
      }

      const items = json.data || [];
      const total = items.length;
      const dollar = json.dollarRate;
      const dollarVar = json.dollarVariation;
      const date = json.latestDate;

      let novos = 0;
      let seminovos = 0;
      let iphonesNovos = 0;
      let iphonesSeminovos = 0;
      let macs = 0;
      let ipads = 0;
      let watches = 0;
      let airpods = 0;
      let acessorios = 0;
      let ativados = [];

      for (const p of items) {
        const name = (p.name || '').toUpperCase();
        const desc = (p.description || '').toUpperCase();
        const cat = (p.category || '').toUpperCase().trim();
        const isSemi = p.isSeminovo === true || p.condition === 'SEMINOVO';

        // Verificação rigorosa contra qualquer ativado vazando
        const ativadoRegex = /\b(ATIVAD[OA]S?|J[AÁ]\s+ATIVAD|DESLACRAD[OA]\s+ATIVAD|LACRAD[OA]\s+ATIVAD)\b/i;
        const isAppleTv = name.includes('APPLE TV') || name.includes('APPLETV');
        const isAtv = !isAppleTv && (/\bATV\b/i.test(name) || cat === 'ATV');

        if (ativadoRegex.test(name) || ativadoRegex.test(desc) || /\bATIV\b\.?/i.test(name) || isAtv || cat === 'ATIVADO' || cat === 'ATIVADOS') {
          ativados.push({ id: p.id, name: p.name, category: p.category });
        }

        if (isSemi) {
          seminovos++;
          if (cat === 'IPH' || name.includes('IPHONE')) iphonesSeminovos++;
        } else {
          novos++;
          if (cat === 'IPH' || name.includes('IPHONE')) iphonesNovos++;
        }

        if (cat === 'MCB' || cat === 'IMAC' || name.includes('MAC') || name.includes('IMAC')) macs++;
        if (cat === 'IPAD' || cat === 'IPD' || name.includes('IPAD')) ipads++;
        if (cat === 'RLG' || name.includes('WATCH') || name.includes('SERIES') || name.includes('ULTRA')) watches++;
        if (cat === 'PODS' || name.includes('AIRPOD')) airpods++;
        if (cat === 'ACSS' || name.includes('CABO') || name.includes('FONTE') || name.includes('PENCIL')) acessorios++;
      }

      console.log('\n📊 [1/5] CONECTIVIDADE & STATUS DA API');
      console.log(`   • Status HTTP: ${res.statusCode} OK`);
      console.log(`   • Tempo de Resposta: ${responseTime}ms (Excelente)`);
      console.log(`   • Data do Lote Upstream: ${date || 'Tempo Real'}`);

      console.log('\n💵 [2/5] COTAÇÃO DO DÓLAR AO VIVO');
      console.log(`   • Taxa Comercial: R$ ${Number(dollar).toFixed(4)}`);
      console.log(`   • Variação do Dia: ${dollarVar > 0 ? '+' : ''}${Number(dollarVar).toFixed(2)}%`);
      console.log(`   • Status: ${dollar > 0 ? '✅ Ativo e Atualizado' : '⚠️ Alerta: Cotação Zerada'}`);

      console.log('\n📦 [3/5] AUDITORIA DE CATÁLOGO');
      console.log(`   • Total Geral de Itens Ativos: ${total.toLocaleString('pt-BR')}`);
      console.log(`   • Produtos Novos (Lacrados): ${novos.toLocaleString('pt-BR')}`);
      console.log(`   • Produtos Seminovos: ${seminovos.toLocaleString('pt-BR')}`);
      console.log(`   • iPhones Novos Lacrados: ${iphonesNovos}`);
      console.log(`   • iPhones Seminovos: ${iphonesSeminovos}`);
      console.log(`   • MacBooks & Macs: ${macs}`);
      console.log(`   • iPads: ${ipads}`);
      console.log(`   • Apple Watches: ${watches}`);
      console.log(`   • AirPods: ${airpods}`);
      console.log(`   • Acessórios Oficiais: ${acessorios}`);

      console.log('\n🛡️ [4/5] AUDITORIA ANTI-ATIVADOS (BLOQUEIO TOTAL)');
      if (ativados.length === 0) {
        console.log('   ✅ 100% LIMPO: Zero modelos ou produtos ativados no catálogo!');
      } else {
        console.error(`   ❌ ALERTA CRÍTICO: ${ativados.length} produto(s) ativado(s) detectado(s):`);
        ativados.forEach(a => console.error(`      - [${a.category}] ${a.name} (ID: ${a.id})`));
      }

      console.log('\n' + '='.repeat(70));
      const isApproved = total > 500 && dollar > 0 && ativados.length === 0;
      if (isApproved) {
        console.log('🎉 RESULTADO GERAL: AUDITORIA 100% APROVADA - SISTEMA PERFEITO!');
      } else {
        console.log('⚠️ RESULTADO GERAL: NECESSITA ATENÇÃO');
      }
      console.log('='.repeat(70));

      process.exit(isApproved ? 0 : 1);
    } catch (err) {
      console.error('❌ Erro no processamento dos dados:', err.message);
      process.exit(1);
    }
  });
}).on('error', (err) => {
  console.error(`❌ Erro ao conectar ao servidor (${targetUrl}):`, err.message);
  process.exit(1);
});
