/**
 * sync_pxt.js — Sincronizador Automático PXT -> Servidor Render
 * 
 * Este script roda localmente no seu Mac. Ele lê os dados mais recentes recebidos
 * pelo seu navegador Opera GX (onde você já está autenticado no PXT) e envia 
 * diretamente para o seu servidor na nuvem (Render) via endpoint seguro.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const axios = require('axios');

// Configurações
const RENDER_SERVER_URL = process.env.RENDER_URL || 'https://mundo-apple-buscador.onrender.com';
const SYNC_SECRET = process.env.SYNC_SECRET || 'apple_mundo_pxt_secret_sync_2026';
const OPERA_CACHE_DIR = path.join(
  process.env.HOME || '/Users/imac27',
  'Library/Caches/com.operasoftware.OperaGX/Default/Cache/Cache_Data'
);

function isDisallowedSeminovo(name) {
  if (!name) return false;
  const n = name.toUpperCase();
  if (n.includes('13 MINI') || n.includes('13-MINI') || n.includes('13MINI')) return true;
  if (/\b(IPHONE|IPH)\s+(11|12|X|XR|XS|SE|8|7|6)\b/i.test(n)) {
    return true;
  }
  return false;
}

function isAppleProduct(p) {
  if (!p || !p.name) return false;
  const name = p.name.toUpperCase();
  const cat = (p.category || '').toUpperCase();
  const desc = (p.description || '').toUpperCase();

  if (name.includes('AS IS') || name.includes('AS-IS') || name.includes('ASIS') || desc.includes('AS IS')) return false;
  if (name.includes('SAMSUNG') || name.includes('XIAOMI') || name.includes('REDMI') || name.includes('POCO') || name.includes('MOTOROLA') || name.includes('REALME')) return false;

  const isSemi = cat === 'SEMI' || name.includes('SEMINOVO') || name.includes('SEMI NOVO') || name.includes('SEMI-NOVO') || name.includes('USADO') || name.includes('VITRINE');
  if (isSemi && isDisallowedSeminovo(name)) return false;

  return (
    cat === 'IPH' || cat === 'MCB' || cat === 'IPAD' || cat === 'IPD' || cat === 'RLG' || cat === 'IMAC' || cat === 'PODS' || cat === 'ACSS' || cat === 'SEMI' ||
    name.includes('IPHONE') || name.includes('MACBOOK') || name.includes('IPAD') || name.includes('APPLE WATCH') || name.includes('AIRPOD') || name.includes('IMAC') || name.includes('APPLE TV') || name.includes('AIRTAG') || name.includes('PENCIL') || name.includes('MAGIC KEYBOARD') || name.includes('MAGIC MOUSE')
  );
}

async function runSync() {
  console.log('🔄 Iniciando busca por dados recentes no cache do navegador...');

  let latestProducts = null;
  let metadata = {};

  if (fs.existsSync(OPERA_CACHE_DIR)) {
    const files = fs.readdirSync(OPERA_CACHE_DIR)
      .filter(f => f.endsWith('_0'))
      .map(f => path.join(OPERA_CACHE_DIR, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    for (const file of files.slice(0, 150)) {
      try {
        const buf = fs.readFileSync(file);
        if (!buf.includes('backend-api.buscadorpxt.com.br/products')) continue;

        const httpIdx = buf.indexOf('HTTP/1.1');
        if (httpIdx === -1) continue;

        // Localizar o GZIP do body (1f 8b)
        for (let i = 24; i < 400; i++) {
          if (buf[i] === 0x1f && buf[i+1] === 0x8b) {
            for (let end = httpIdx; end > httpIdx - 100; end--) {
              try {
                const d = zlib.gunzipSync(buf.slice(i, end));
                const rawJson = JSON.parse(d.toString('utf8'));
                let innerB64 = rawJson.data;
                if (innerB64 && typeof innerB64 === 'string') {
                  if (innerB64.startsWith('"') && innerB64.endsWith('"')) {
                    innerB64 = JSON.parse(innerB64);
                  }
                  const unzipped = zlib.gunzipSync(Buffer.from(innerB64, 'base64'));
                  const payload = JSON.parse(unzipped.toString('utf8'));
                  if (payload && Array.isArray(payload.data) && payload.data.length > 500) {
                    latestProducts = payload.data;
                    metadata = {
                      dollarRate: payload.dollarRate,
                      dollarVariation: payload.dollarVariation,
                      date: payload.data[0]?.priceDate || payload.data[0]?.sheetDate || ''
                    };
                    console.log(`✅ Catálogo encontrado em ${path.basename(file)}! Total de ofertas: ${latestProducts.length}`);
                    break;
                  }
                }
              } catch (e) {}
            }
            if (latestProducts) break;
          }
        }
        if (latestProducts) break;
      } catch (e) {}
    }
  }

  // Fallback para o snapshot_latest se o cache não tiver arquivo novo
  if (!latestProducts || latestProducts.length === 0) {
    const snapPath = path.join(__dirname, 'data', 'snapshot_latest.json');
    if (fs.existsSync(snapPath)) {
      console.log('📦 Usando produtos do snapshot local mais recente como base...');
      latestProducts = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
      metadata = {
        date: latestProducts[0]?.priceDate || latestProducts[0]?.sheetDate || '28-09'
      };
    }
  }

  if (!latestProducts || latestProducts.length === 0) {
    console.log('⚠️ Nenhum produto disponível para sincronização.');
    return;
  }

  // Filtrar produtos Apple
  const appleList = latestProducts.filter(isAppleProduct).map(p => {
    const isSemi = (p.category === 'SEMI' || (p.name || '').toUpperCase().includes('SEMINOVO') || (p.name || '').toUpperCase().includes('SEMI NOVO'));
    return {
      ...p,
      condition: isSemi ? 'SEMINOVO' : 'NOVO',
      isSeminovo: isSemi
    };
  });

  console.log(`🍏 Produtos Apple filtrados: ${appleList.length}`);
  console.log(`📡 Enviando para o servidor Render (${RENDER_SERVER_URL})...`);

  try {
    const resp = await axios.post(`${RENDER_SERVER_URL}/api/admin/push-catalog`, {
      products: appleList,
      date: metadata.date,
      dollarRate: metadata.dollarRate,
      dollarVariation: metadata.dollarVariation
    }, {
      headers: {
        'x-sync-secret': SYNC_SECRET,
        'Content-Type': 'application/json'
      },
      maxBodyLength: 50 * 1024 * 1024,
      timeout: 30000
    });

    if (resp.data && resp.data.success) {
      console.log(`🚀 SUCESSO TOTAL! ${resp.data.count} produtos sincronizados ao vivo no servidor Render.`);
      console.log(`📅 Data do catálogo: ${resp.data.date}`);
    } else {
      console.error('Resposta inesperada do servidor:', resp.data);
    }
  } catch (err) {
    console.error('❌ Erro ao enviar para o Render:', err.response?.data || err.message);
  }
}

runSync();
