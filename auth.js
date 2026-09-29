/**
 * auth.js — Módulo de Autenticação e Gestão de Lojistas
 * Armazenamento 100% Local (data/users.json) + Proteção Anti-Pirataria (Sessão Única via Socket.io)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Diretório e arquivo de dados locais
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

// Lê usuários de data/users.json
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

// Salva usuários em data/users.json
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

// Inicializa a autenticação local e garante o admin padrão
async function initAuth() {
  console.log('[Auth] Inicializando autenticação local (data/users.json)...');
  const users = getLocalUsers();
  const admin = users.find(u => u.username === 'admin');
  if (!admin) {
    console.log('[Auth] Criando usuário admin padrão local...');
    users.unshift({
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
    });
    saveLocalUsers(users);
    console.log('[Auth] ✅ Admin padrão criado com sucesso localmente (admin / fornecedor2026!)');
  } else {
    console.log(`[Auth] ✅ Armazenamento local pronto! ${users.length} usuário(s) carregado(s).`);
  }
}

// Busca usuário por username
async function findUserByUsername(username) {
  const cleanUser = (username || '').trim().toLowerCase();
  const users = getLocalUsers();
  return users.find(u => (u.username || '').toLowerCase() === cleanUser) || null;
}

// Busca usuário por token de sessão
async function findUserBySessionToken(token) {
  if (!token) return null;
  const users = getLocalUsers();
  return users.find(u => u.current_session_token === token) || null;
}

// Login de usuário
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

  // GERAÇÃO DE SESSÃO ÚNICA (1 TELA POR LOJA)
  const newSessionToken = crypto.randomUUID();

  // Desconecta sessão anterior se houver
  if (ioInstance && user.current_session_token) {
    ioInstance.to(`user_${user.id}`).emit('session_terminated', {
      reason: 'Sua conta foi acessada em outro dispositivo ou navegador. O sistema permite apenas 1 tela ativa por assinatura.'
    });
  }

  // Atualiza localmente
  const users = getLocalUsers();
  const idx = users.findIndex(u => u.id === user.id);
  if (idx !== -1) {
    users[idx].current_session_token = newSessionToken;
    users[idx].last_login_at = new Date().toISOString();
    saveLocalUsers(users);
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
  const users = getLocalUsers();
  const u = users.find(x => x.current_session_token === token);
  if (u) {
    u.current_session_token = null;
    saveLocalUsers(users);
  }
}

// Formata resposta do lojista para o painel admin
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
    customMargins: u.custom_margins || null,
    customCardRates: u.custom_card_rates || null,
    createdAt: u.created_at
  };
}

// Lista todos os lojistas cadastrados
async function listLojistas() {
  const users = getLocalUsers();
  return [...users].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).map(formatLojistaResponse);
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
    id: 'lojista_' + Date.now(),
    store_name: storeName.trim(),
    owner_name: (ownerName || '').trim(),
    whatsapp: (whatsapp || '').trim(),
    username: cleanUser,
    password_hash: hashPassword(password),
    role: 'lojista',
    status: 'active',
    expires_at: expiresAt,
    current_session_token: null,
    created_at: new Date().toISOString(),
    custom_margins: {
      categories: {
        SEMINOVOS: 0,
        IPH18: 0,
        IPH: 0,
        MCB_AIR: 0,
        MCB_PRO: 0,
        IPAD: 0,
        RLG: 0,
        IMAC: 0,
        PODS: 0,
        ACSS: 0
      },
      products: {}
    },
    custom_card_rates: {
      baseRate: 0,
      calculationMode: 'factor',
      installmentRates: {
        "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0,
        "7": 0, "8": 0, "9": 0, "10": 0, "11": 0, "12": 0,
        "13": 0, "14": 0, "15": 0, "16": 0, "17": 0, "18": 0
      }
    }
  };

  const users = getLocalUsers();
  users.push(newLojista);
  saveLocalUsers(users);

  return formatLojistaResponse(newLojista);
}

// Atualiza margens personalizadas do lojista
async function updateLojistaMargins(id, customMargins) {
  const users = getLocalUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx !== -1) {
    users[idx].custom_margins = customMargins;
    saveLocalUsers(users);
  }
  return { success: true, margins: customMargins };
}

// Atualiza taxas de maquininha personalizadas do lojista
async function updateLojistaCardRates(id, customCardRates) {
  const users = getLocalUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx !== -1) {
    users[idx].custom_card_rates = customCardRates;
    saveLocalUsers(users);
  }
  return { success: true, cardRates: customCardRates };
}

// Renova a assinatura (+30 dias ou período especificado)
async function renewLojista(id, daysToAdd = 30) {
  const users = getLocalUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) throw new Error('Lojista não encontrado.');

  const user = users[idx];
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

  users[idx].expires_at = newExpiresAt;
  users[idx].status = 'active';
  saveLocalUsers(users);

  return { success: true, expiresAt: newExpiresAt };
}

// Bloqueia ou Desbloqueia manualmente um lojista
async function toggleBlockLojista(id) {
  const users = getLocalUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) throw new Error('Lojista não encontrado.');

  if (users[idx].role === 'admin') throw new Error('Não é permitido bloquear a conta de Administrador.');

  const newStatus = users[idx].status === 'blocked' ? 'active' : 'blocked';
  users[idx].status = newStatus;
  saveLocalUsers(users);

  return { success: true, status: newStatus };
}

// Altera a senha de um lojista
async function updateLojistaPassword(id, newPassword) {
  if (!newPassword || newPassword.length < 4) {
    throw new Error('A nova senha deve ter no mínimo 4 caracteres.');
  }

  const users = getLocalUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) throw new Error('Lojista não encontrado.');

  users[idx].password_hash = hashPassword(newPassword);
  users[idx].current_session_token = null; // Obriga a reconectar
  saveLocalUsers(users);

  return { success: true };
}

// Exclui um lojista
async function deleteLojista(id) {
  let users = getLocalUsers();
  users = users.filter(u => u.id !== id);
  saveLocalUsers(users);
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
  updateLojistaMargins,
  updateLojistaCardRates,
  deleteLojista,
  getSessionTokenFromRequest
};
