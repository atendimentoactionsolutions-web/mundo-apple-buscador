/**
 * Sincronizador Local de Catálogo PXT -> Mundo Apple
 * 
 * Funcionalidades:
 * 1. Autentica localmente via IP residencial/escritório do Mac (autorizado pela PXT).
 * 2. Conecta ao WebSocket PXT, solicita o snapshot de produtos e DESCONECTA imediatamente.
 * 3. Processa e filtra rigorosamente:
 *    - Bloqueia Ativados (novos lacrados apenas)
 *    - Bloqueia Android / Marcas não-Apple
 *    - Seminovos apenas iPhone 13+ (sem 13 mini, sem 512GB/1TB no 15/16)
 *    - Bloqueia AS IS e CPO
 * 4. Salva snapshot localmente em data/snapshot_latest.json
 * 5. Atualiza o servidor local (em localhost:3333) via push-catalog
 * 6. Executa em ciclos voláteis entre 08:00 e 17:00 exclusivamente no Mac local.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const io = require('socket.io-client');
// Carregar variáveis de ambiente locais
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

// Proteção Anti-Queda Global: Impede que qualquer erro não tratado derrube o processo
process.on('uncaughtException', (err) => {
  console.error('[Proteção Anti-Queda] 🛡️ Erro não capturado interceptado:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Proteção Anti-Queda] 🛡️ Rejeição de Promise interceptada:', reason?.message || reason);
});

const PricingCore = require(path.join(__dirname, '..', 'public', 'js', 'pricing-core.js'));
const { sanitizeCatalog } = require(path.join(__dirname, '..', 'lib', 'catalog-sanitizer.js'));

const PXT_BASE_URL = process.env.PXT_BASE_URL || 'https://backend-api.buscadorpxt.com.br';
const USER_EMAIL = process.env.PXT_EMAIL || '';
const USER_PASS = process.env.PXT_PASSWORD || '';
const LOCAL_SERVER_URL = `http://127.0.0.1:${process.env.PORT || 3333}`;
const SYNC_SECRET = process.env.SYNC_SECRET || 'apple_mundo_pxt_secret_sync_2026';
const INTERVAL_MS = 30 * 60 * 1000; // 30 minutos (de meia em meia hora)

const ANDROID_CATEGORIES = new Set([
  'MI', 'NOTE', 'PAD', 'POCO', 'RDM', 'REAL', 'HOTWAV', 'ANDROID', 'SAMSUNG', 'MOTOROLA', 'XIAOMI', 'REDMI', 'REALME'
]);
const APPLE_CATEGORIES = new Set([
  'IPH', 'MCB', 'IPAD', 'IPD', 'RLG', 'PODS', 'ACSS', 'IMAC', 'MNTR',
  'IPHONE', 'MACBOOK', 'WATCH', 'AIRPODS', 'IMAC', 'APPLE TV', 'ACESSORIOS', 'ACCESSORIES'
]);

function isAppleNovo(p) {
  if (!p) return false;
  if (PricingCore.isDisallowedProduct(p)) return false;
  if (PricingCore.isSeminovoProduct(p)) return false;

  const cat = (p.category || '').toUpperCase().trim();
  const name = (p.name || '').toLowerCase();
  const desc = (p.description || '').toLowerCase();

  if (ANDROID_CATEGORIES.has(cat)) return false;
  if (
    name.includes('samsung') || name.includes('xiaomi') || name.includes('redmi') ||
    name.includes('poco') || name.includes('motorola') || name.includes('realme') || name.includes('infinix') ||
    name.includes('hotwav') || desc.includes('hotwav')
  ) {
    return false;
  }

  const isSeminovoText = (
    cat === 'SEMI' || name.includes('semi novo') || name.includes('semi-novo') || name.includes('seminovo') ||
    name.includes('usado') || name.includes('vitrine') || name.includes('grade a') || name.includes('grade b') ||
    name.includes('recondicionado') || name.includes('swp') || name.includes('swap') ||
    desc.includes('semi novo') || desc.includes('seminovo') || desc.includes('vitrine') || desc.includes('usado')
  );
  if (isSeminovoText) return false;

  if (APPLE_CATEGORIES.has(cat)) return true;
  if (
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
  ) {
    return true;
  }
  return false;
}

function processAppleProduct(p) {
  if (!p) return null;
  const numPrice = Number(p.price);
  if (!Number.isFinite(numPrice) || numPrice <= 0) return null;
  if (PricingCore.isDisallowedProduct(p)) return null;
  if (PricingCore.isSeminovoProduct(p)) return null;
  if (isAppleNovo(p)) {
    return {
      ...p,
      price: numPrice,
      isSeminovo: false,
      condition: 'NOVO'
    };
  }
  return null;
}

async function performSync() {
  if (process.env.PAUSE_PXT_UPSTREAM === 'true') {
    console.log('[PXT] ⏸️ Sincronização upstream pausada no .env (PAUSE_PXT_UPSTREAM=true). Operando com catálogo local.');
    return { count: 0, paused: true };
  }
  const startTime = Date.now();
  const nowStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`\n======================================================`);
  console.log(`🔄 [${nowStr}] INICIANDO CICLO DE SINCRONIZAÇÃO PXT`);
  console.log(`======================================================`);

  // 1. Autenticação na PXT via IP Local
  console.log(`[PXT] 🔑 Autenticando com credenciais da conta (${USER_EMAIL})...`);
  const authResp = await axios.post(`${PXT_BASE_URL}/auth/login`, {
    email: USER_EMAIL,
    password: USER_PASS,
    forceLogin: true
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000
  });

  const authToken = authResp.data?.access_token;
  if (!authToken) throw new Error('Falha na autenticação: token não retornado.');
  console.log(`[PXT] ✅ Autenticação bem-sucedida! Conectando socket...`);

  // 2. Conectar WebSocket com Permanência Variada na Tela (45s a 120s / máx 2 minutos)
  const todayDateStr = `${String(new Date().getDate()).padStart(2, '0')}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  
  // Sorteia permanência na tela entre 45s e 120s (máximo 2 minutos)
  const dwellSeconds = isOnce ? 3 : (45 + Math.floor(Math.random() * 76)); // 45s a 120s
  const dwellM = Math.floor(dwellSeconds / 60);
  const dwellS = dwellSeconds % 60;
  const dwellStr = dwellM > 0 ? `${dwellM}m ${dwellS}s` : `${dwellS}s`;

  console.log(`👀 [Permanência na Tela] Simulação ativa: conexão permanecerá aberta por ${dwellStr} (máximo 2 min)...`);

  const rawProductsMap = new Map();
  const snapshotMeta = {
    date: todayDateStr,
    dollarRate: undefined,
    dollarVariation: undefined
  };

  await new Promise((resolve, reject) => {
    let receivedInitial = false;
    const socket = io(PXT_BASE_URL, {
      auth: { token: authToken, theme: 'dark' },
      transports: ['websocket', 'polling'],
      timeout: 15000,
      path: '/socket.io'
    });

    const timeoutTimer = setTimeout(() => {
      try { socket.disconnect(); } catch (e) {}
      if (receivedInitial) {
        resolve();
      } else {
        reject(new Error('Timeout aguardando dados da PXT.'));
      }
    }, (dwellSeconds + 15) * 1000);

    function ingest(item) {
      if (!item || (!item.id && !item._id)) return;
      const id = String(item.id || item._id);
      const existing = rawProductsMap.get(id);
      if (existing) {
        rawProductsMap.set(id, { ...existing, ...item });
      } else {
        rawProductsMap.set(id, item);
      }
    }

    socket.on('connect', () => {
      console.log(`[PXT] 🔌 Socket conectado. Solicitando snapshot (data: ${todayDateStr})...`);
      socket.emit('products_sync_request', { date: todayDateStr });
    });

    socket.on('products_delta', (delta) => {
      receivedInitial = true;
      if (delta.date) snapshotMeta.date = delta.date;
      if (delta.dollarRate !== undefined) snapshotMeta.dollarRate = delta.dollarRate;
      if (delta.dollarVariation !== undefined) snapshotMeta.dollarVariation = delta.dollarVariation;

      const created = delta.created || delta.inserted || [];
      const updated = delta.updated || [];
      created.forEach(ingest);
      updated.forEach(ingest);
      console.log(`[PXT] 📦 Snapshot recebido com sucesso! (${rawProductsMap.size} itens acumulados).`);
    });

    // Captura alterações de preço ao vivo que chegarem durante a permanência
    socket.on('price_changed', (data) => {
      if (!data || !data.id) return;
      const id = String(data.id);
      const existing = rawProductsMap.get(id);
      const newPrice = Number(data.changes?.price !== undefined ? data.changes.price : data.price);
      if (existing && newPrice) {
        existing.price = newPrice;
        if (data.updatedAt) existing.updatedAt = data.updatedAt;
        rawProductsMap.set(id, existing);
        console.log(`[PXT Preço ao Vivo] ${existing.name} (${existing.storage || ''}) alterado para R$ ${newPrice}`);
      }
    });

    socket.on('product_created', (item) => {
      ingest(item);
    });

    socket.on('product_updated', (item) => {
      ingest(item);
    });

    socket.on('connect_error', (err) => {
      clearTimeout(timeoutTimer);
      try { socket.disconnect(); } catch (e) {}
      reject(new Error(`Erro de conexão com socket PXT: ${err.message}`));
    });

    // Encerra após o tempo de permanência na tela sorteado (garante recebimento do snapshot inicial)
    let closeInterval = null;
    const dwellTimer = setTimeout(() => {
      const finishAndClose = () => {
        if (closeInterval) clearInterval(closeInterval);
        clearTimeout(timeoutTimer);
        try { socket.disconnect(); } catch (e) {}
        console.log(`[PXT] 🚪 Tempo de permanência na tela concluído (${dwellStr}). Desconectando socket de forma limpa.`);
        resolve();
      };

      if (receivedInitial) {
        finishAndClose();
      } else {
        closeInterval = setInterval(() => {
          if (receivedInitial) {
            finishAndClose();
          }
        }, 300);
      }
    }, dwellSeconds * 1000);
  });

  // 3. Processar, Filtrar e Auto-Corrigir com o Guardião Anti-Erros (CatalogSanitizer)
  const allRawItems = Array.from(rawProductsMap.values());
  console.log(`[Guardião Anti-Erros] 🛡️ Auditando ${allRawItems.length} itens brutos da PXT...`);

  const { cleanProducts: processedProducts, auditReport } = sanitizeCatalog(allRawItems, {
    todayDateStr
  });

  console.log(`[Guardião Anti-Erros] 📊 Relatório de Auditoria:`);
  console.log(`   • Itens Válidos Aprovados (Novos + Acessórios): ${processedProducts.length}`);
  console.log(`   • Anomalias Auto-Corrigidas/Bloqueadas: ${auditReport.totalAnomaliesFixed}`);
  console.log(`   • Ativados Bloqueados: ${auditReport.anomalies.ativadoBlocked}`);
  console.log(`   • CPO/AS-IS Bloqueados: ${auditReport.anomalies.cpoBlocked + auditReport.anomalies.asIsBlocked}`);
  console.log(`   • Android Bloqueados: ${auditReport.anomalies.androidBlocked}`);
  console.log(`   • Preços Inválidos/Zerados Corrigidos: ${auditReport.anomalies.invalidPrice}`);

  const snapshotDate = snapshotMeta.date || todayDateStr;
  const dollarRate = snapshotMeta.dollarRate;
  const dollarVariation = snapshotMeta.dollarVariation;

  // 4. Salvar snapshot local em disco (100% PURO E EXATO DO DIA - SEM FUSÃO COM ONTEM)
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const isoDate = new Date().toISOString().slice(0, 10);
  const latestSnapshotPath = path.join(dataDir, 'snapshot_latest.json');
  const todaySnapshotPath = path.join(dataDir, `snapshot_${isoDate}.json`);
  const auditPath = path.join(dataDir, 'audit_latest.json');

  let finalProducts = [];
  if (processedProducts.length > 0) {
    finalProducts = processedProducts;
  } else {
    // Fallback de emergência extremo: apenas se a PXT não retornar nenhum produto
    console.warn(`[Snapshot] ⚠️ Nenhum produto retornado da PXT hoje. Preservando snapshot atual.`);
    if (fs.existsSync(latestSnapshotPath)) {
      try {
        finalProducts = JSON.parse(fs.readFileSync(latestSnapshotPath, 'utf8'));
      } catch (e) {}
    }
  }

  console.log(`[Catálogo] 📊 Total Ativo de Hoje: ${finalProducts.length} itens Apple oficiais`);

  fs.writeFileSync(latestSnapshotPath, JSON.stringify(finalProducts, null, 2), 'utf8');
  fs.writeFileSync(todaySnapshotPath, JSON.stringify(finalProducts, null, 2), 'utf8');
  fs.writeFileSync(auditPath, JSON.stringify(auditReport, null, 2), 'utf8');
  console.log(`[Disco] 💾 Snapshots e Relatório de Auditoria gravados com sucesso.`);

  // 5. Atualizar servidor local
  try {
    await axios.post(`${LOCAL_SERVER_URL}/api/admin/push-catalog`, {
      products: finalProducts,
      date: snapshotDate,
      dollarRate,
      dollarVariation
    }, {
      headers: { 'x-sync-secret': SYNC_SECRET },
      timeout: 5000
    });
    console.log(`[Local] 💻 Servidor local (localhost:${process.env.PORT || 3333}) atualizado.`);
  } catch (localErr) {
    console.warn('[Local] Falha ao enviar para servidor local:', localErr.message);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`✨ Sincronização concluída com sucesso em ${durationSec}s!`);
  console.log(`======================================================\n`);

  return { count: finalProducts.length, novos: finalProducts.length, durationSec };
}

// =========================================================================
// AGENDADOR VOLÁTIL INTELIGENTE (Humanizado: entre 4 e 15 minutos)
// =========================================================================
let lastIntervalMinutes = 6;

function getRandomIntervalMs() {
  let nextMin;
  if (lastIntervalMinutes <= 6) {
    // Se a última foi rápida (4 a 6 min), a próxima pula para média/alta (8 a 14 min)
    nextMin = 8 + Math.floor(Math.random() * 7);
  } else if (lastIntervalMinutes >= 11) {
    // Se a última foi mais longa (11 a 15 min), a próxima desce para baixa/média (4 a 8 min)
    nextMin = 4 + Math.floor(Math.random() * 5);
  } else {
    // Variação orgânica entre 4 e 15 min
    const candidates = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].filter(m => Math.abs(m - lastIntervalMinutes) >= 2);
    nextMin = candidates.length > 0 
      ? candidates[Math.floor(Math.random() * candidates.length)]
      : (lastIntervalMinutes > 9 ? 5 : 12);
  }
  lastIntervalMinutes = nextMin;

  // Segundos orgânicos não-redondos (0 a 49s) para evitar qualquer padrão matemático fixo
  const extraSeconds = Math.floor(Math.random() * 50);
  return (nextMin * 60 + extraSeconds) * 1000;
}

// Cálculo do Próximo Horário Agendado
// Janela de operação: 08:00 às 17:00 (intercalando de 4 a 15 minutos)
// Fora da janela: aguarda até às 08:00 do dia seguinte
function getNextScheduledTime(now = new Date(), forceStopRestOfToday = false) {
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(now).forEach(p => { parts[p.type] = p.value; });

  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const currentMinutes = hour * 60 + minute;

  // Janela operacional: 08:00 (480 min) às 17:00 (1020 min)
  if (forceStopRestOfToday || currentMinutes >= 1020 || currentMinutes < 480) {
    let targetDayOffset = (currentMinutes >= 1020 || forceStopRestOfToday) ? 1 : 0;
    const targetDateObj = new Date(now.getTime() + targetDayOffset * 24 * 60 * 60 * 1000);
    const tParts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour12: false
    }).formatToParts(targetDateObj).forEach(p => { tParts[p.type] = p.value; });

    // SP é UTC-3: 08:00 SP = 11:00 UTC
    const targetDateUtc = new Date(`${tParts.year}-${tParts.month}-${tParts.day}T11:00:00.000Z`);
    const diffMs = Math.max(1000, targetDateUtc.getTime() - now.getTime());
    return {
      ms: diffMs,
      targetDate: targetDateUtc,
      reason: 'pausa_noturna',
      intervalMin: 0
    };
  }

  // Dentro do horário comercial (08:00 às 17:00): intervalo volátil inteligente (4 a 15 min)
  let nextMs = getRandomIntervalMs();
  const minutesToAdd = Math.floor(nextMs / 60000);

  // Se ultrapassar 17:00, ajusta para encerrar exatamente às 17:00
  if (currentMinutes + minutesToAdd > 1020) {
    nextMs = Math.max(60000, (1020 - currentMinutes) * 60 * 1000);
  }

  const nextRunDate = new Date(now.getTime() + nextMs);
  return {
    ms: nextMs,
    targetDate: nextRunDate,
    reason: 'intervalo_volatil',
    intervalMin: (nextMs / 60000).toFixed(1)
  };
}

// Execução
const isOnce = process.argv.includes('--once');

async function main() {
  if (isOnce) {
    try {
      await performSync();
    } catch (err) {
      console.error(`❌ [Erro na sincronização]:`, err.message);
    }
    process.exit(0);
  }

  console.log(`\n======================================================`);
  console.log(`⏱️ SINCRONIZADOR LOCAL PXT - MUNDO APPLE BUSCADOR`);
  console.log(`📋 Janela de Operação: 08:00 às 17:00`);
  console.log(`🎲 Intervalos Voláteis Inteligentes: entre 4 e 15 minutos`);
  console.log(`🛑 Pausa Noturna: 17:00 às 08:00`);
  console.log(`======================================================\n`);

  async function scheduleNext() {
    if (process.env.PAUSE_PXT_UPSTREAM === 'true') {
      console.log('⏸️ [Modo Local] Sincronização upstream pausada no .env. Catálogo preservado localmente.');
      setTimeout(scheduleNext, 60 * 60 * 1000);
      return;
    }
    const next = getNextScheduledTime(new Date(), false);
    const targetStr = next.targetDate.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    if (next.reason === 'pausa_noturna') {
      const diffHours = (next.ms / (1000 * 60 * 60)).toFixed(2);
      const fullDateStr = next.targetDate.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      console.log(`🌙 [Pausa Noturna] Fora da janela de operação (08h às 17h).`);
      console.log(`⏰ Próxima execução programada para: ${fullDateStr} (em ~${diffHours} horas).`);
      console.log(`💤 Aguardando até amanhã sem conexões ou tráfego de rede...\n`);
    } else {
      console.log(`🎲 [Tempo Volátil] Próxima puxada agendada em ~${next.intervalMin} minutos (às ${targetStr}).\n`);
    }

    setTimeout(async () => {
      try {
        await performSync();
      } catch (err) {
        console.error(`❌ [Erro no ciclo periódico]:`, err.message);
      }
      scheduleNext();
    }, next.ms);
  }

  // Inicia o agendador contínuo
  scheduleNext();
}

main();
