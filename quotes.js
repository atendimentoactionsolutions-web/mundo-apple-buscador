const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QuoteCore = require('./public/js/quote-core');
const STATUSES = new Set(['RASCUNHO', 'ENVIADO', 'APROVADO', 'RECUSADO', 'EXPIRADO']);
function canAccessQuote(quote, user) {
  return !user || user.role === 'admin' || (quote.createdBy?.id && quote.createdBy.id === user.id);
}
function validateQuote(quote, rates) {
  if (!STATUSES.has(quote.status)) throw new Error('Status de orçamento inválido.');
  if (!quote.customer?.name?.trim()) throw new Error('Informe o nome do cliente.');
  if (!Array.isArray(quote.items) || quote.items.length === 0) throw new Error('Adicione um produto ao orçamento.');
  quote.items = quote.items.map(item => ({ ...item,
    quantity: QuoteCore.quantity(item.quantity),
    unitPrice: QuoteCore.amount(item.unitPrice, 'Preço unitário'),
    discountValue: QuoteCore.amount(item.discountValue, 'Desconto'),
    subtotal: QuoteCore.itemSubtotal(item)
  }));
  const result = QuoteCore.totals(quote.items, quote.tradeIn, quote.discount, quote.paymentTerms);
  quote.totals = result.totals;
  quote.totalAmount = result.totals.netTotal;
  quote.tradeIn.tradeInAmount = result.totals.tradeInDeduction;
  quote.paymentTerms.cashDownPayment = result.cashDownPayment;
  quote.paymentTerms.financedAmount = result.financedAmount;
  const selected = Number(quote.paymentTerms.selectedInstallmentCount ?? 12);
  if (!Number.isInteger(selected) || selected < 1 || selected > 18) throw new Error('Parcelamento inválido.');
  quote.paymentTerms.selectedInstallmentCount = selected;
  quote.paymentTerms.installmentOptions = result.financedAmount > 0
    ? Array.from({ length: 18 }, (_, index) => QuoteCore.installment(result.financedAmount, 0, index + 1, rates)) : [];
  return quote;
}

const DATA_DIR = path.join(__dirname, 'data');
const QUOTES_FILE = path.join(DATA_DIR, 'quotes.json');

function ensureQuotesFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(QUOTES_FILE)) {
    fs.writeFileSync(QUOTES_FILE, JSON.stringify({ nextNumber: 1, quotes: [] }, null, 2), 'utf-8');
  }
}

function readQuotesData() {
  ensureQuotesFile();
  try {
    const raw = fs.readFileSync(QUOTES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.quotes)) throw new Error('Formato inválido de quotes.json.');
    if (!parsed.nextNumber || typeof parsed.nextNumber !== 'number') {
      parsed.nextNumber = Math.max(0, ...parsed.quotes.map(quote => Number(String(quote.code || '').split('-').pop()) || 0)) + 1;
    }
    return parsed;
  } catch (err) {
    console.error('[Quotes] Erro ao ler arquivo quotes.json:', err.message);
    throw new Error('Não foi possível ler os orçamentos. Os dados existentes foram preservados.', { cause: err });
  }
}

function saveQuotesData(data) {
  ensureQuotesFile();
  const tempPath = path.join(DATA_DIR, `quotes_temp_${Date.now()}.json`);
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, QUOTES_FILE);
}

function generateQuoteNumber(year, seq) {
  const y = year || new Date().getFullYear();
  return `ORC-${y}-${String(seq).padStart(4, '0')}`;
}

// Lista orçamentos com suporte a busca, status e paginação/ordenação
function listQuotes(filters = {}, user = null) {
  const data = readQuotesData();
  const accessible = data.quotes.filter(quote => canAccessQuote(quote, user));
  let list = [...accessible];

  if (filters.search) {
    const s = filters.search.trim().toLowerCase();
    list = list.filter(q => 
      (q.code && q.code.toLowerCase().includes(s)) ||
      (q.customer && q.customer.name && q.customer.name.toLowerCase().includes(s)) ||
      (q.customer && q.customer.whatsapp && q.customer.whatsapp.includes(s))
    );
  }

  if (filters.status && filters.status !== 'ALL') {
    list = list.filter(q => q.status === filters.status);
  }

  // Ordenação decrescente por data de criação
  list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  // Estatísticas para o Dashboard
  const stats = {
    totalQuotes: accessible.length,
    approvedCount: accessible.filter(q => q.status === 'APROVADO').length,
    pendingCount: accessible.filter(q => q.status === 'ENVIADO' || q.status === 'RASCUNHO').length,
    totalApprovedAmount: accessible
      .filter(q => q.status === 'APROVADO')
      .reduce((acc, q) => acc + (Number(q.totalAmount) || 0), 0),
    totalPipelineAmount: accessible
      .filter(q => q.status !== 'RECUSADO' && q.status !== 'EXPIRADO')
      .reduce((acc, q) => acc + (Number(q.totalAmount) || 0), 0)
  };

  return {
    quotes: list,
    stats
  };
}

function getQuoteById(id, user = null) {
  const data = readQuotesData();
  return data.quotes.find(q => (q.id === id || q.code === id) && canAccessQuote(q, user)) || null;
}

function createQuote(payload, user, rates) {
  const data = readQuotesData();
  const now = new Date();
  const year = now.getFullYear();
  const seq = data.nextNumber || (data.quotes.length + 1);
  data.nextNumber = seq + 1;

  const code = generateQuoteNumber(year, seq);
  const id = crypto.randomUUID ? crypto.randomUUID() : `quote_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  const quote = {
    id,
    code,
    status: payload.status || 'RASCUNHO', // RASCUNHO, ENVIADO, APROVADO, RECUSADO, EXPIRADO
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    createdBy: user ? { id: user.id, username: user.username, storeName: user.store_name } : null,
    customer: {
      name: (payload.customer?.name || '').trim(),
      whatsapp: (payload.customer?.whatsapp || '').trim(),
      doc: (payload.customer?.doc || '').trim(), // CPF/CNPJ opcional
      notes: (payload.customer?.notes || '').trim()
    },
    dates: {
      issueDate: payload.dates?.issueDate || now.toISOString().split('T')[0],
      validityDays: Number(payload.dates?.validityDays) || 3,
      validUntil: payload.dates?.validUntil || null
    },
    items: Array.isArray(payload.items) ? payload.items.map(item => ({
      productId: item.productId || null,
      name: item.name || 'Produto Apple',
      category: item.category || 'IPH',
      storage: item.storage || '',
      ram: item.ram || '',
      color: item.color || '',
      condition: item.condition || 'NOVO',
      quantity: item.quantity ?? 1,
      unitPrice: item.unitPrice ?? 0,
      discountType: item.discountType || 'FIXED', // 'FIXED' (R$) ou 'PERCENT' (%)
      discountValue: item.discountValue ?? 0,
      subtotal: Number(item.subtotal) || 0
    })) : [],
    tradeIn: {
      hasTradeIn: Boolean(payload.tradeIn?.hasTradeIn),
      modelName: (payload.tradeIn?.modelName || '').trim(),
      description: (payload.tradeIn?.description || '').trim(),
      tradeInAmount: Math.max(0, Number(payload.tradeIn?.tradeInAmount) || 0)
    },
    discount: {
      type: payload.discount?.type || 'FIXED', // 'FIXED' ou 'PERCENT'
      value: Math.max(0, Number(payload.discount?.value) || 0)
    },
    paymentTerms: {
      pixDiscount: Number(payload.paymentTerms?.pixDiscount) || 0,
      cashDownPayment: Number(payload.paymentTerms?.cashDownPayment) || 0, // Entrada PIX
      financedAmount: Number(payload.paymentTerms?.financedAmount) || 0, // Saldo a parcelar
      selectedInstallmentCount: Number(payload.paymentTerms?.selectedInstallmentCount) || 12,
      installmentOptions: Array.isArray(payload.paymentTerms?.installmentOptions) ? payload.paymentTerms.installmentOptions : [],
      commercialConditions: (payload.paymentTerms?.commercialConditions || 'À vista no PIX com entrega imediata ou em até 18x no cartão.').trim()
    },
    warrantyNotes: (payload.warrantyNotes || '1 ano de garantia oficial Apple (lacrados) ou 90 dias de garantia da loja (seminovos).').trim(),
    generalNotes: (payload.generalNotes || '').trim(),
    totals: {
      grossTotal: Number(payload.totals?.grossTotal) || 0,
      itemsDiscountTotal: Number(payload.totals?.itemsDiscountTotal) || 0,
      generalDiscount: Number(payload.totals?.generalDiscount) || 0,
      tradeInDeduction: Number(payload.totals?.tradeInDeduction) || 0,
      netTotal: Number(payload.totals?.netTotal) || 0
    },
    totalAmount: Number(payload.totals?.netTotal || payload.totalAmount) || 0
  };

  validateQuote(quote, rates);
  data.quotes.unshift(quote);
  saveQuotesData(data);
  return quote;
}

function updateQuote(id, payload, user, rates) {
  const data = readQuotesData();
  const idx = data.quotes.findIndex(q => q.id === id);
  if (idx === -1) return null;

  const current = data.quotes[idx];
  if (!canAccessQuote(current, user)) return null;
  const now = new Date();

  const updated = {
    ...current,
    ...payload,
    id: current.id,
    code: current.code, // Mantém o número original intacto!
    createdAt: current.createdAt,
    createdBy: current.createdBy,
    updatedAt: now.toISOString(),
    customer: {
      ...current.customer,
      ...(payload.customer || {})
    },
    dates: {
      ...current.dates,
      ...(payload.dates || {})
    },
    items: Array.isArray(payload.items) ? payload.items : current.items,
    tradeIn: {
      ...current.tradeIn,
      ...(payload.tradeIn || {})
    },
    discount: {
      ...current.discount,
      ...(payload.discount || {})
    },
    paymentTerms: {
      ...current.paymentTerms,
      ...(payload.paymentTerms || {})
    },
    totals: {
      ...current.totals,
      ...(payload.totals || {})
    },
    totalAmount: Number(payload.totals?.netTotal ?? payload.totalAmount ?? current.totalAmount) || 0
  };

  validateQuote(updated, rates);
  data.quotes[idx] = updated;
  saveQuotesData(data);
  return updated;
}

function updateQuoteStatus(id, newStatus, user = null) {
  if (!STATUSES.has(newStatus)) throw new Error('Status de orçamento inválido.');
  const data = readQuotesData();
  const quote = data.quotes.find(q => q.id === id);
  if (!quote || !canAccessQuote(quote, user)) return null;
  quote.status = newStatus;
  quote.updatedAt = new Date().toISOString();
  saveQuotesData(data);
  return quote;
}

function duplicateQuote(id, user, rates) {
  const data = readQuotesData();
  const source = data.quotes.find(q => q.id === id);
  if (!source || !canAccessQuote(source, user)) return null;

  // Clona o payload e cria um novo orçamento com nova numeração
  const clonePayload = JSON.parse(JSON.stringify(source));
  delete clonePayload.id;
  delete clonePayload.code;
  delete clonePayload.createdAt;
  delete clonePayload.updatedAt;
  clonePayload.status = 'RASCUNHO';
  clonePayload.customer.name = `${source.customer.name || 'Cliente'} (Cópia)`;

  return createQuote(clonePayload, user, rates);
}

function deleteQuote(id, user = null) {
  const data = readQuotesData();
  const initialLen = data.quotes.length;
  data.quotes = data.quotes.filter(q => q.id !== id || !canAccessQuote(q, user));
  if (data.quotes.length !== initialLen) {
    saveQuotesData(data);
    return true;
  }
  return false;
}

module.exports = {
  listQuotes,
  getQuoteById,
  createQuote,
  updateQuote,
  updateQuoteStatus,
  duplicateQuote,
  deleteQuote
};
