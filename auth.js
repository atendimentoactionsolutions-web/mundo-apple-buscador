/**
 * auth.js — Módulo de Autenticação e Gestão de Lojistas
 * Integração Oficial com Supabase (PostgreSQL na Nuvem) + Proteção Anti-Pirataria (Sessão Única)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Carregar variáveis do .env local se existir
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [k, ...v] = trimmed.split('=');
        if (k && !process.env[k.trim()]) {
          process.env[k.trim()] = v.join('=').trim();
        }
      }
    });
  }
} catch (e) {}

// Configurações do Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fcdtamolcniahnkqfoko.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

// Cliente HTTP para a API REST do Supabase
const supabase = axios.create({
  baseURL: `${SUPABASE_URL}/rest/v1`,
  headers: {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  },
  timeout: 8000
});

// Arquivo de fallback local caso o banco esteja indisponível
const LOCAL_DATA_DIR = path.join(__dirname, 'data');
const LOCAL_USERS_FILE = path.join(LOCAL_DATA_DIR, 'users.json');

// Helper para hashing de senhas com Scrypt (padrão NIST - nativo do Node.js)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = parts[1];
  const originalHash = parts[2];
  try {
    const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(originalHash, 'hex'), Buffer.from(testHash, 'hex'));
  } catch (err) {
    return false;
  }
}

// Fallback local: lê e salva em data/users.json
function getLocalUsers() {
  try {
    if (!fs.existsSync(LOCAL_DATA_DIR)) {
      fs.mkdirSync(LOCAL_DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(LOCAL_USERS_FILE)) {
      const defaultAdmin = [{
        id: 'admin-001',
        store_name: 'Administração Fornecedor',
        owner_name: 'Admin',
        whatsapp: '',
        username: 'admin',
        password_hash: hashPassword('fornecedor2026!'),
        role: 'admin',
        status: 'active',
        expires_at: null,
        current_session_token: null,
        created_at: new Date().toISOString()
      }];
      fs.writeFileSync(LOCAL_USERS_FILE, JSON.stringify(defaultAdmin, null, 2));
      return defaultAdmin;
    }
    const raw = fs.readFileSync(LOCAL_USERS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[Auth] Erro ao ler users.json local:', err.message);
    return [];
  }
}

function saveLocalUsers(users) {
  try {
    if (!fs.existsSync(LOCAL_DATA_DIR)) {
      fs.mkdirSync(LOCAL_DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(LOCAL_USERS_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error('[Auth] Erro ao salvar users.json local:', err.message);
  }
}

// Inicializa a tabela e o admin padrão no Supabase (se necessário)
async function initAuth() {
  console.log('[Auth] Conectando ao Supabase para verificar usuários...');
  try {
    const resp = await supabase.get('/lojistas?username=eq.admin');
    if (resp.data && resp.data.length === 0) {
      // Cria o administrador padrão no Supabase
      console.log('[Auth] Criando usuário admin padrão no Supabase...');
      await supabase.post('/lojistas', {
        store_name: 'Administração Fornecedor',
        owner_name: 'Admin',
        username: 'admin',
        password_hash: hashPassword('fornecedor2026!'),
        role: 'admin',
        status: 'active',
        expires_at: null
      });
      console.log('[Auth] ✅ Admin padrão criado com sucesso no Supabase (admin / fornecedor2026!)');
    } else {
      console.log('[Auth] ✅ Supabase conectado com sucesso! Tabela de lojistas pronta.');
    }
  } catch (err) {
    console.warn('[Auth] ⚠️ Aviso: Supabase ainda não possui a tabela "lojistas" criada ou houve falha de conexão.');
    console.warn('[Auth] Detalhes do erro:', err.response?.data?.message || err.message);
    console.log('[Auth] 🔄 Ativando armazenamento local de segurança em data/users.json...');
    getLocalUsers();
  }
}

// Busca usuário por username (Supabase com fallback local)
async function findUserByUsername(username) {
  const cleanUser = (username || '').trim().toLowerCase();
  try {
    const resp = await supabase.get(`/lojistas?username=eq.${encodeURIComponent(cleanUser)}`);
    if (resp.data && resp.data.length > 0) {
      return resp.data[0];
    }
  } catch (err) {
    // Fallback local
    const users = getLocalUsers();
    return users.find(u => u.username.toLowerCase() === cleanUser);
  }
  return null;
}

// Busca usuário por token de sessão única
async function findUserBySessionToken(token) {
  if (!token) return null;
  try {
    const resp = await supabase.get(`/lojistas?current_session_token=eq.${encodeURIComponent(token)}`);
    if (resp.data && resp.data.length > 0) {
      return resp.data[0];
    }
  } catch (err) {
    const users = getLocalUsers();
    return users.find(u => u.current_session_token === token);
  }
  return null;
}

// Login com verificação de senha, expiração e geração de sessão única anti-pirataria
async function loginUser(username, password, clientIp, ioInstance) {
  const user = await findUserByUsername(username);
  if (!user) {
    return { success: false, error: 'Usuário ou senha incorretos.' };
  }

  // Validação da senha criptografada
  const isMatch = verifyPassword(password, user.password_hash);
  if (!isMatch) {
    return { success: false, error: 'Usuário ou senha incorretos.' };
  }

  // Validação de bloqueio manual
  if (user.status === 'blocked') {
    return { success: false, error: 'Sua conta está suspensa. Entre em contato com o suporte.' };
  }

  // Validação de data de validade / mensalidade
  if (user.role !== 'admin' && user.expires_at) {
    const expireDate = new Date(user.expires_at);
    const now = new Date();
    if (expireDate < now) {
      const formattedDate = expireDate.toLocaleDateString('pt-BR');
      return { 
        success: false, 
        error: `Sua assinatura venceu em ${formattedDate}. Fale com o suporte no WhatsApp para renovar seu plano.`,
        expired: true,
        expiresAt: user.expires_at
      };
    }
  }

  // =========================================================================
  // PROTEÇÃO ANTI-PIRATARIA: GERAÇÃO DE SESSÃO ÚNICA (1 TELA POR LOJA)
  // =========================================================================
  const newSessionToken = crypto.randomUUID();

  // Se já havia alguém conectado nesta mesma conta em outro aparelho, desconecta na hora!
  if (ioInstance && user.current_session_token) {
    ioInstance.to(`user_${user.id}`).emit('session_terminated', {
      reason: 'Sua conta foi acessada em outro dispositivo ou navegador. O sistema permite apenas 1 tela ativa por assinatura.'
    });
  }

  // Atualiza a sessão única e a data de último login no Supabase
  try {
    await supabase.patch(`/lojistas?id=eq.${user.id}`, {
      current_session_token: newSessionToken,
      last_login_at: new Date().toISOString()
    });
  } catch (err) {
    // Atualiza local se falhar Supabase
    const users = getLocalUsers();
    const idx = users.findIndex(u => u.id === user.id);
    if (idx !== -1) {
      users[idx].current_session_token = newSessionToken;
      users[idx].last_login_at = new Date().toISOString();
      saveLocalUsers(users);
    }
  }

  user.current_session_token = newSessionToken;

  return {
    success: true,
    sessionToken: newSessionToken,
    user: {
      id: user.id,
      username: user.username,
      storeName: user.store_name,
      ownerName: user.owner_name,
      role: user.role,
      expiresAt: user.expires_at
    }
  };
}

// Encerra a sessão
async function logoutUser(token) {
  if (!token) return;
  try {
    await supabase.patch(`/lojistas?current_session_token=eq.${encodeURIComponent(token)}`, {
      current_session_token: null
    });
  } catch (err) {
    const users = getLocalUsers();
    const u = users.find(x => x.current_session_token === token);
    if (u) {
      u.current_session_token = null;
      saveLocalUsers(users);
    }
  }
}

// ===========================================================================
// FUNÇÕES ADMINISTRATIVAS (CRUD DE LOJISTAS)
// ===========================================================================

// Lista todos os lojistas cadastrados
async function listLojistas() {
  try {
    const resp = await supabase.get('/lojistas?order=created_at.desc');
    if (resp.data) {
      return resp.data.map(formatLojistaResponse);
    }
  } catch (err) {
    const users = getLocalUsers();
    return users.map(formatLojistaResponse);
  }
  return [];
}

function formatLojistaResponse(u) {
  let daysRemaining = null;
  let isExpired = false;

  if (u.role !== 'admin' && u.expires_at) {
    const now = new Date();
    const exp = new Date(u.expires_at);
    const diffMs = exp - now;
    daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (daysRemaining < 0) {
      daysRemaining = 0;
      isExpired = true;
    }
  }

  return {
    id: u.id,
    storeName: u.store_name,
    ownerName: u.owner_name,
    whatsapp: u.whatsapp,
    username: u.username,
    role: u.role,
    status: isExpired ? 'expired' : u.status,
    expiresAt: u.expires_at,
    daysRemaining,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at
  };
}

// Cadastra um novo lojista
async function createLojista({ storeName, ownerName, whatsapp, username, password, days = 30 }) {
  const cleanUser = (username || '').trim().toLowerCase();
  if (!cleanUser || !password || !storeName) {
    throw new Error('Preencha os campos obrigatórios: Nome da Loja, Usuário e Senha.');
  }

  const existing = await findUserByUsername(cleanUser);
  if (existing) {
    throw new Error(`O usuário "${cleanUser}" já está cadastrado. Escolha outro.`);
  }

  // Calcula a data de expiração (dias de validade)
  let expiresAt = null;
  if (days && Number(days) > 0) {
    const exp = new Date();
    exp.setDate(exp.getDate() + Number(days));
    expiresAt = exp.toISOString();
  }

  const newLojista = {
    store_name: storeName.trim(),
    owner_name: (ownerName || '').trim(),
    whatsapp: (whatsapp || '').trim(),
    username: cleanUser,
    password_hash: hashPassword(password),
    role: 'lojista',
    status: 'active',
    expires_at: expiresAt,
    current_session_token: null
  };

  try {
    const resp = await supabase.post('/lojistas', newLojista);
    if (resp.data && resp.data.length > 0) {
      return formatLojistaResponse(resp.data[0]);
    }
  } catch (err) {
    const users = getLocalUsers();
    newLojista.id = 'lojista_' + Date.now();
    newLojista.created_at = new Date().toISOString();
    users.push(newLojista);
    saveLocalUsers(users);
    return formatLojistaResponse(newLojista);
  }

  return formatLojistaResponse(newLojista);
}

// Renova a assinatura (+30 dias ou período especificado)
async function renewLojista(id, daysToAdd = 30) {
  let user = null;
  try {
    const resp = await supabase.get(`/lojistas?id=eq.${id}`);
    if (resp.data && resp.data.length > 0) user = resp.data[0];
  } catch (err) {
    const users = getLocalUsers();
    user = users.find(u => u.id === id);
  }

  if (!user) throw new Error('Lojista não encontrado.');

  // Se já estava vencido, conta a partir de hoje; se ainda tinha dias, soma aos dias restantes!
  const now = new Date();
  let baseDate = now;
  if (user.expires_at) {
    const currentExp = new Date(user.expires_at);
    if (currentExp > now) {
      baseDate = currentExp;
    }
  }

  baseDate.setDate(baseDate.getDate() + Number(daysToAdd));
  const newExpiresAt = baseDate.toISOString();

  try {
    await supabase.patch(`/lojistas?id=eq.${id}`, {
      expires_at: newExpiresAt,
      status: 'active'
    });
  } catch (err) {
    const users = getLocalUsers();
    const idx = users.findIndex(u => u.id === id);
    if (idx !== -1) {
      users[idx].expires_at = newExpiresAt;
      users[idx].status = 'active';
      saveLocalUsers(users);
    }
  }

  return { success: true, expiresAt: newExpiresAt };
}

// Bloqueia ou Desbloqueia manualmente um lojista
async function toggleBlockLojista(id) {
  let user = null;
  try {
    const resp = await supabase.get(`/lojistas?id=eq.${id}`);
    if (resp.data && resp.data.length > 0) user = resp.data[0];
  } catch (err) {
    const users = getLocalUsers();
    user = users.find(u => u.id === id);
  }

  if (!user) throw new Error('Lojista não encontrado.');
  if (user.role === 'admin') throw new Error('Não é permitido bloquear a conta de Administrador.');

  const newStatus = user.status === 'blocked' ? 'active' : 'blocked';

  try {
    await supabase.patch(`/lojistas?id=eq.${id}`, { status: newStatus });
  } catch (err) {
    const users = getLocalUsers();
    const idx = users.findIndex(u => u.id === id);
    if (idx !== -1) {
      users[idx].status = newStatus;
      saveLocalUsers(users);
    }
  }

  return { success: true, status: newStatus };
}

// Altera a senha de um lojista
async function updateLojistaPassword(id, newPassword) {
  if (!newPassword || newPassword.length < 4) {
    throw new Error('A nova senha deve ter no mínimo 4 caracteres.');
  }

  const passwordHash = hashPassword(newPassword);

  try {
    await supabase.patch(`/lojistas?id=eq.${id}`, {
      password_hash: passwordHash,
      current_session_token: null // Obriga a reconectar
    });
  } catch (err) {
    const users = getLocalUsers();
    const idx = users.findIndex(u => u.id === id);
    if (idx !== -1) {
      users[idx].password_hash = passwordHash;
      users[idx].current_session_token = null;
      saveLocalUsers(users);
    }
  }

  return { success: true };
}

// Exclui um lojista
async function deleteLojista(id) {
  try {
    await supabase.delete(`/lojistas?id=eq.${id}`);
  } catch (err) {
    let users = getLocalUsers();
    users = users.filter(u => u.id !== id);
    saveLocalUsers(users);
  }
  return { success: true };
}

// Helper para extrair o token do cabeçalho Cookie
function getSessionTokenFromRequest(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/fornecedor_session=([^;]+)/);
  if (match) return match[1];
  return null;
}

module.exports = {
  initAuth,
  loginUser,
  logoutUser,
  findUserBySessionToken,
  listLojistas,
  createLojista,
  renewLojista,
  toggleBlockLojista,
  updateLojistaPassword,
  deleteLojista,
  getSessionTokenFromRequest
};
