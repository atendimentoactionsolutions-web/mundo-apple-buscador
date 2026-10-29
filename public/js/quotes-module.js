// =========================================================================
// MÓDULO DE ORÇAMENTOS E PROPOSTAS COMERCIAIS — MUNDO APPLE DELIVERY
// =========================================================================

let quotesList = [];
let quotesStats = { totalQuotes: 0, approvedCount: 0, pendingCount: 0, totalApprovedAmount: 0, totalPipelineAmount: 0 };
let currentQuoteEditing = null; // null = novo, object = editando

// Estado temporário do builder atual
let currentBuilderData = {
  id: null,
  code: '',
  status: 'RASCUNHO',
  customer: { name: '', whatsapp: '', doc: '', notes: '' },
  dates: { issueDate: new Date().toISOString().split('T')[0], validityDays: 3 },
  items: [],
  tradeIn: { hasTradeIn: false, modelName: '', description: '', tradeInAmount: 0 },
  discount: { type: 'FIXED', value: 0 },
  paymentTerms: {
    cashDownPayment: 0,
    selectedInstallmentCount: 12,
    commercialConditions: 'À vista no PIX com entrega imediata ou em até 18x no cartão.'
  },
  warrantyNotes: '1 ano de garantia oficial Apple (lacrados) ou 90 dias de garantia da loja (seminovos).',
  generalNotes: ''
};

// Formatação BRL elegante
function formatMoneyBR(num) {
  const val = Number(num) || 0;
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Inicializar Módulo de Orçamentos
async function loadQuotes(search = '', status = 'ALL') {
  try {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (status && status !== 'ALL') params.append('status', status);

    const res = await fetch(`/api/quotes?${params.toString()}`);
    if (res.status === 401) {
      console.warn('[Quotes] Usuário não autenticado para carregar orçamentos.');
      return;
    }
    const data = await res.json();
    if (data.success) {
      quotesList = data.quotes || [];
      quotesStats = data.stats || quotesStats;
      renderQuotesDashboard();
      renderQuotesTable();
    }
  } catch (err) {
    console.error('[Quotes] Falha ao carregar lista:', err);
  }
}

// Renderizar Dashboard de Métricas
function renderQuotesDashboard() {
  const elTotal = document.getElementById('statQuotesTotal');
  const elApproved = document.getElementById('statQuotesApproved');
  const elPending = document.getElementById('statQuotesPending');
  const elApprovedVol = document.getElementById('statQuotesApprovedVol');

  if (elTotal) elTotal.textContent = quotesStats.totalQuotes || 0;
  if (elApproved) elApproved.textContent = quotesStats.approvedCount || 0;
  if (elPending) elPending.textContent = quotesStats.pendingCount || 0;
  if (elApprovedVol) elApprovedVol.textContent = formatMoneyBR(quotesStats.totalApprovedAmount || 0);
}

// Renderizar Tabela / Cards de Orçamentos
function renderQuotesTable() {
  const tbody = document.getElementById('quotesTableBody');
  const cardsContainer = document.getElementById('quotesMobileCards');
  const emptyState = document.getElementById('quotesEmptyState');
  if (!tbody) return;

  if (quotesList.length === 0) {
    tbody.innerHTML = '';
    if (cardsContainer) cardsContainer.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  // Desktop Table Rows
  tbody.innerHTML = quotesList.map(q => {
    const statusBadges = {
      RASCUNHO: '<span class="quote-badge status-draft">Rascunho</span>',
      ENVIADO: '<span class="quote-badge status-sent">Enviado</span>',
      APROVADO: '<span class="quote-badge status-approved">Aprovado</span>',
      RECUSADO: '<span class="quote-badge status-rejected">Recusado</span>',
      EXPIRADO: '<span class="quote-badge status-expired">Expirado</span>'
    };
    const badge = statusBadges[q.status] || `<span class="quote-badge">${q.status}</span>`;
    const dateFormatted = q.dates?.issueDate ? q.dates.issueDate.split('-').reverse().join('/') : '-';
    const totalVal = formatMoneyBR(q.totalAmount || 0);
    const itemsCount = (q.items || []).reduce((acc, it) => acc + (it.quantity || 1), 0);

    return `
      <tr class="quote-row" data-quote-id="${q.id}">
        <td class="col-code">
          <strong class="quote-code-link" onclick="openQuoteDetail('${q.id}')">${q.code}</strong>
          <span class="quote-date-sub">${dateFormatted}</span>
        </td>
        <td class="col-customer">
          <div class="customer-info-cell">
            <span class="customer-name">${escapeHtml(q.customer?.name || 'Cliente Sem Nome')}</span>
            <span class="customer-phone">${escapeHtml(q.customer?.whatsapp || '')}</span>
          </div>
        </td>
        <td class="col-items text-center">
          <span class="quote-items-count">${itemsCount} item(s)</span>
        </td>
        <td class="col-total">
          <strong class="quote-total-price">${totalVal}</strong>
        </td>
        <td class="col-status text-center">
          ${badge}
        </td>
        <td class="col-actions text-right">
          <div class="quote-action-group">
            <button class="quote-btn-icon" title="Editar Orçamento" onclick="editQuote('${q.id}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="quote-btn-icon" title="Visualizar / Baixar PDF" onclick="generateAndOpenPDF('${q.id}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            </button>
            <button class="quote-btn-icon" title="Enviar WhatsApp" onclick="shareQuoteWhatsApp('${q.id}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.312.045-.694.062-2.12-.519-1.583-.644-2.6-2.261-2.679-2.366-.079-.105-.644-.858-.644-1.635 0-.777.408-1.161.552-1.32.144-.159.313-.198.417-.198.105 0 .209.002.301.006.098.004.227-.037.355.27.133.319.454 1.111.493 1.192.039.081.066.175.012.28-.054.106-.081.172-.162.266-.081.095-.17.212-.243.285-.082.081-.168.17-.072.335.096.164.426.703.914 1.138.628.56 1.157.733 1.322.815.165.081.261.072.359-.039.098-.112.417-.487.528-.654.111-.167.222-.139.373-.083.151.055.955.45 1.119.532.164.082.274.122.314.19.04.069.04.399-.104.804z"/></svg>
            </button>
            <button class="quote-btn-icon" title="Duplicar Proposta" onclick="duplicateQuoteAction('${q.id}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="quote-btn-icon danger" title="Excluir Orçamento" onclick="deleteQuoteAction('${q.id}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Mobile Cards
  if (cardsContainer) {
    cardsContainer.innerHTML = quotesList.map(q => {
      const statusBadges = {
        RASCUNHO: '<span class="quote-badge status-draft">Rascunho</span>',
        ENVIADO: '<span class="quote-badge status-sent">Enviado</span>',
        APROVADO: '<span class="quote-badge status-approved">Aprovado</span>',
        RECUSADO: '<span class="quote-badge status-rejected">Recusado</span>',
        EXPIRADO: '<span class="quote-badge status-expired">Expirado</span>'
      };
      const badge = statusBadges[q.status] || `<span class="quote-badge">${q.status}</span>`;
      const dateFormatted = q.dates?.issueDate ? q.dates.issueDate.split('-').reverse().join('/') : '-';
      const totalVal = formatMoneyBR(q.totalAmount || 0);

      return `
        <div class="quote-card-mobile">
          <div class="quote-card-mobile-header">
            <div>
              <strong class="quote-card-code" onclick="openQuoteDetail('${q.id}')">${q.code}</strong>
              <span class="quote-card-date">${dateFormatted}</span>
            </div>
            ${badge}
          </div>
          <div class="quote-card-mobile-body">
            <h4 class="quote-card-customer">${escapeHtml(q.customer?.name || 'Cliente Sem Nome')}</h4>
            <span class="quote-card-phone">${escapeHtml(q.customer?.whatsapp || '')}</span>
            <div class="quote-card-mobile-pricing">
              <span class="quote-card-items-badge">${(q.items || []).length} produto(s)</span>
              <strong class="quote-card-total">${totalVal}</strong>
            </div>
          </div>
          <div class="quote-card-mobile-actions">
            <button class="quote-m-btn" onclick="editQuote('${q.id}')">Editar</button>
            <button class="quote-m-btn primary" onclick="generateAndOpenPDF('${q.id}')">PDF</button>
            <button class="quote-m-btn whatsapp" onclick="shareQuoteWhatsApp('${q.id}')">WhatsApp</button>
            <button class="quote-m-btn danger" onclick="deleteQuoteAction('${q.id}')">✕</button>
          </div>
        </div>
      `;
    }).join('');
  }
}

// =========================================================================
// CONSTRUTOR DE ORÇAMENTO (BUILDER MODAL)
// =========================================================================

function openNewQuoteModal() {
  currentBuilderData = {
    id: null,
    code: '',
    status: 'RASCUNHO',
    customer: { name: '', whatsapp: '', doc: '', notes: '' },
    dates: { issueDate: new Date().toISOString().split('T')[0], validityDays: 3 },
    items: [],
    tradeIn: { hasTradeIn: false, modelName: '', description: '', tradeInAmount: 0 },
    discount: { type: 'FIXED', value: 0 },
    paymentTerms: {
      cashDownPayment: 0,
      selectedInstallmentCount: 12,
      commercialConditions: 'À vista no PIX com entrega imediata ou em até 18x no cartão.'
    },
    warrantyNotes: '1 ano de garantia oficial Apple (lacrados) ou 90 dias de garantia da loja (seminovos).',
    generalNotes: ''
  };

  populateBuilderModal();
  const modal = document.getElementById('quoteBuilderModal');
  if (modal) modal.classList.add('active');
}

function editQuote(quoteId) {
  const quote = quotesList.find(q => q.id === quoteId);
  if (!quote) return;

  // Deep clone
  currentBuilderData = JSON.parse(JSON.stringify(quote));
  populateBuilderModal();

  const modal = document.getElementById('quoteBuilderModal');
  if (modal) modal.classList.add('active');
}

function closeQuoteBuilderModal() {
  const modal = document.getElementById('quoteBuilderModal');
  if (modal) modal.classList.remove('active');
}

function populateBuilderModal() {
  const isEditing = Boolean(currentBuilderData.id);
  const titleEl = document.getElementById('quoteBuilderTitle');
  if (titleEl) {
    titleEl.textContent = isEditing ? `Editar Proposta — ${currentBuilderData.code}` : 'Novo Orçamento Comercial';
  }

  // Preencher campos de cliente
  const inputName = document.getElementById('qbCustomerName');
  const inputPhone = document.getElementById('qbCustomerPhone');
  const inputDoc = document.getElementById('qbCustomerDoc');
  const inputDate = document.getElementById('qbIssueDate');
  const inputValidity = document.getElementById('qbValidityDays');
  const inputStatus = document.getElementById('qbStatusSelect');

  if (inputName) inputName.value = currentBuilderData.customer.name || '';
  if (inputPhone) inputPhone.value = currentBuilderData.customer.whatsapp || '';
  if (inputDoc) inputDoc.value = currentBuilderData.customer.doc || '';
  if (inputDate) inputDate.value = currentBuilderData.dates.issueDate || new Date().toISOString().split('T')[0];
  if (inputValidity) inputValidity.value = currentBuilderData.dates.validityDays || 3;
  if (inputStatus) inputStatus.value = currentBuilderData.status || 'RASCUNHO';

  // Trade in
  const chkTradeIn = document.getElementById('qbHasTradeIn');
  const tradeInWrap = document.getElementById('qbTradeInWrap');
  const tradeInModel = document.getElementById('qbTradeInModel');
  const tradeInDesc = document.getElementById('qbTradeInDesc');
  const tradeInAmount = document.getElementById('qbTradeInAmount');

  if (chkTradeIn) chkTradeIn.checked = Boolean(currentBuilderData.tradeIn.hasTradeIn);
  if (tradeInWrap) tradeInWrap.style.display = currentBuilderData.tradeIn.hasTradeIn ? 'grid' : 'none';
  if (tradeInModel) tradeInModel.value = currentBuilderData.tradeIn.modelName || '';
  if (tradeInDesc) tradeInDesc.value = currentBuilderData.tradeIn.description || '';
  if (tradeInAmount) tradeInAmount.value = currentBuilderData.tradeIn.tradeInAmount ? formatCurrencyInput(currentBuilderData.tradeIn.tradeInAmount) : '';

  // Desconto Geral
  const discType = document.getElementById('qbGeneralDiscountType');
  const discVal = document.getElementById('qbGeneralDiscountVal');
  if (discType) discType.value = currentBuilderData.discount.type || 'FIXED';
  if (discVal) discVal.value = currentBuilderData.discount.value || '';

  // Entrada e Parcelas
  const downPay = document.getElementById('qbCashDownPayment');
  const installSel = document.getElementById('qbInstallmentCount');
  const condNotes = document.getElementById('qbCommercialConditions');
  const warNotes = document.getElementById('qbWarrantyNotes');

  if (downPay) downPay.value = currentBuilderData.paymentTerms.cashDownPayment ? formatCurrencyInput(currentBuilderData.paymentTerms.cashDownPayment) : '';
  if (installSel) installSel.value = currentBuilderData.paymentTerms.selectedInstallmentCount || 12;
  if (condNotes) condNotes.value = currentBuilderData.paymentTerms.commercialConditions || 'À vista no PIX com entrega imediata ou em até 18x no cartão.';
  if (warNotes) warNotes.value = currentBuilderData.warrantyNotes || '1 ano de garantia oficial Apple (lacrados) ou 90 dias de garantia da loja (seminovos).';

  renderBuilderItemsList();
  recalculateQuoteTotals();
}

// Renderiza a lista de itens dentro do Construtor
function renderBuilderItemsList() {
  const container = document.getElementById('qbItemsList');
  if (!container) return;

  if (!currentBuilderData.items || currentBuilderData.items.length === 0) {
    container.innerHTML = `
      <div class="qb-no-items-state">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="color: var(--text-muted);"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
        <span>Nenhum produto adicionado à proposta. Use a busca acima para adicionar itens do catálogo.</span>
      </div>
    `;
    return;
  }

  container.innerHTML = currentBuilderData.items.map((item, index) => {
    const unitPriceFmt = formatMoneyBR(item.unitPrice || 0);
    const subtotalFmt = formatMoneyBR(item.subtotal || 0);
    const specs = [item.storage, item.ram ? item.ram + ' RAM' : '', item.color, item.condition].filter(Boolean).join(' • ');

    return `
      <div class="qb-item-card" data-index="${index}">
        <div class="qb-item-main-info">
          <strong class="qb-item-title">${escapeHtml(item.name)}</strong>
          <span class="qb-item-specs">${specs}</span>
          ${canEditQuoteItemPrices() ? '' : `<span class="qb-item-unit-tag">Preço Unitário: <strong>${unitPriceFmt}</strong></span>`}
        </div>

        <div class="qb-item-controls">
          ${canEditQuoteItemPrices() ? `
            <div class="qb-control-field qb-unit-price-field">
              <label for="qbItemUnitPrice-${index}">Valor unitário</label>
              <div class="qb-unit-price-wrap">
                <span aria-hidden="true">R$</span>
                <input type="text" inputmode="decimal" autocomplete="off" id="qbItemUnitPrice-${index}" value="${formatCurrencyInput(item.unitPrice || 0)}" placeholder="0,00" aria-label="Valor unitário de ${escapeHtml(item.name)}" onfocus="this.select()" oninput="onItemUnitPriceInput(${index}, this)">
              </div>
            </div>
          ` : ''}
          <div class="qb-control-field qb-qty-field">
            <label>Qtd</label>
            <div class="qb-qty-stepper">
              <button type="button" class="qty-btn" onclick="updateItemQuantity(${index}, -1)">−</button>
              <input type="number" min="1" max="99" value="${item.quantity}" onchange="onItemQtyChange(${index}, this.value)" class="qty-input">
              <button type="button" class="qty-btn" onclick="updateItemQuantity(${index}, 1)">+</button>
            </div>
          </div>

          <div class="qb-control-field qb-discount-field">
            <label>Desconto Item</label>
            <div class="qb-disc-group">
              <select class="qb-disc-type-select" onchange="onItemDiscountTypeChange(${index}, this.value)">
                <option value="FIXED" ${item.discountType === 'FIXED' ? 'selected' : ''}>R$</option>
                <option value="PERCENT" ${item.discountType === 'PERCENT' ? 'selected' : ''}>%</option>
              </select>
              <input type="number" min="0" step="any" value="${item.discountValue || ''}" placeholder="0" oninput="onItemDiscountValChange(${index}, this.value)" class="qb-disc-val-input">
            </div>
          </div>

          <div class="qb-control-field qb-subtotal-field">
            <label>Subtotal</label>
            <strong class="qb-item-subtotal-val" id="qbItemSubtotal-${index}" aria-live="polite">${subtotalFmt}</strong>
          </div>

          <button type="button" class="qb-item-delete-btn" title="Remover item" onclick="removeItemFromBuilder(${index})">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Manipulação de Itens
function canEditQuoteItemPrices() {
  return typeof currentUser !== 'undefined' && currentUser?.role === 'admin';
}

function onItemUnitPriceInput(index, input) {
  const item = currentBuilderData.items[index];
  if (!canEditQuoteItemPrices() || !item) return;
  const price = parseCurrencyInput(input.value);
  if (!Number.isFinite(price) || price < 0 || price > 1e10 || /^\s*-/.test(input.value)) {
    input.value = formatCurrencyInput(item.unitPrice || 0);
    return;
  }

  item.unitPrice = price;
  input.value = formatCurrencyInput(price);
  calculateSingleItemSubtotal(item);
  // Atualiza o subtotal sem recriar o campo enquanto o administrador digita.
  const subtotal = document.getElementById(`qbItemSubtotal-${index}`);
  if (subtotal) subtotal.textContent = formatMoneyBR(item.subtotal);
  recalculateQuoteTotals();
}

function updateItemQuantity(index, delta) {
  if (!currentBuilderData.items[index]) return;
  const current = currentBuilderData.items[index].quantity || 1;
  const next = Math.min(99, Math.max(1, current + delta));
  currentBuilderData.items[index].quantity = next;
  calculateSingleItemSubtotal(currentBuilderData.items[index]);
  renderBuilderItemsList();
  recalculateQuoteTotals();
}

function onItemQtyChange(index, val) {
  if (!currentBuilderData.items[index]) return;
  currentBuilderData.items[index].quantity = Math.min(99, Math.max(1, parseInt(val) || 1));
  calculateSingleItemSubtotal(currentBuilderData.items[index]);
  renderBuilderItemsList();
  recalculateQuoteTotals();
}

function onItemDiscountTypeChange(index, type) {
  if (!currentBuilderData.items[index]) return;
  currentBuilderData.items[index].discountType = type;
  calculateSingleItemSubtotal(currentBuilderData.items[index]);
  renderBuilderItemsList();
  recalculateQuoteTotals();
}

function onItemDiscountValChange(index, val) {
  if (!currentBuilderData.items[index]) return;
  currentBuilderData.items[index].discountValue = Math.max(0, parseFloat(val) || 0);
  calculateSingleItemSubtotal(currentBuilderData.items[index]);
  const subtotal = document.getElementById(`qbItemSubtotal-${index}`);
  if (subtotal) subtotal.textContent = formatMoneyBR(currentBuilderData.items[index].subtotal);
  recalculateQuoteTotals();
}

function removeItemFromBuilder(index) {
  currentBuilderData.items.splice(index, 1);
  renderBuilderItemsList();
  recalculateQuoteTotals();
}

function calculateSingleItemSubtotal(item) {
  item.subtotal = QuoteCore.itemSubtotal(item);
  return item.subtotal;
}

// =========================================================================
// AUTOCOMPLETE E ADIÇÃO DIRETA DO CATÁLOGO DE PRODUTOS
// =========================================================================

function onQuoteCatalogSearch(input) {
  const q = (input.value || '').trim().toLowerCase();
  const dropdown = document.getElementById('qbCatalogDropdown');
  if (!dropdown) return;

  if (q.length < 2) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
    return;
  }

  const tokens = q.split(' ').filter(Boolean);
  
  // Buscar no catálogo de varejo (produtos com preços de venda da loja física)
  const matches = [];
  const seenKeys = new Set();

  for (const p of allProducts) {
    if (isDisallowedProduct(p)) continue;
    const retailPrice = getProductRetailPrice(p);
    if (!retailPrice || retailPrice <= 0) continue;

    const searchable = `${p.name || ''} ${p.storage || ''} ${p.color || ''} ${p.category || ''} ${p.condition || ''}`.toLowerCase();
    const allMatch = tokens.every(tok => searchable.includes(tok));

    if (allMatch) {
      const key = `${p.name}_${p.storage}_${p.ram || ''}_${p.color}_${p.condition}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        matches.push({ product: p, retailPrice });
        if (matches.length >= 15) break;
      }
    }
  }

  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="qb-dropdown-empty">Nenhum modelo encontrado no catálogo</div>';
    dropdown.style.display = 'block';
    return;
  }

  dropdown.innerHTML = matches.map(m => {
    const p = m.product;
    const priceFmt = formatMoneyBR(m.retailPrice);
    const specs = [p.storage, p.ram ? p.ram + ' RAM' : '', p.color, p.isSeminovo ? 'SEMINOVO' : 'NOVO'].filter(Boolean).join(' • ');

    return `
      <div class="qb-dropdown-item" onclick="addItemFromCatalog('${p.id}', ${m.retailPrice})">
        <div class="qb-dd-info">
          <strong class="qb-dd-name">${escapeHtml(p.name)}</strong>
          <span class="qb-dd-specs">${specs}</span>
        </div>
        <div class="qb-dd-price">${priceFmt}</div>
      </div>
    `;
  }).join('');

  dropdown.style.display = 'block';
}

function addItemFromCatalog(productId, retailPrice) {
  const prod = allProducts.find(p => p.id === productId);
  if (!prod) return;

  const price = retailPrice || getProductRetailPrice(prod);

  const newItem = {
    productId: prod.id,
    name: prod.name,
    category: prod.category || 'IPH',
    storage: prod.storage || '',
    ram: prod.ram || '',
    color: prod.color || '',
    condition: prod.isSeminovo ? 'SEMINOVO' : 'NOVO',
    quantity: 1,
    unitPrice: price,
    discountType: 'FIXED',
    discountValue: 0,
    subtotal: price
  };

  currentBuilderData.items.push(newItem);
  
  // Limpar busca
  const input = document.getElementById('qbCatalogSearchInput');
  const dropdown = document.getElementById('qbCatalogDropdown');
  if (input) input.value = '';
  if (dropdown) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
  }

  renderBuilderItemsList();
  recalculateQuoteTotals();
}

// Fechar dropdown ao clicar fora
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('qbCatalogDropdown');
  if (dropdown && !e.target.closest('#qbCatalogSearchWrap')) {
    dropdown.style.display = 'none';
  }
});

// =========================================================================
// CÁLCULOS E RESUMO FINANCEIRO INTEGRADO (COM CARTÃO E TRADE-IN)
// =========================================================================

function recalculateQuoteTotals() {
  const result = QuoteCore.totals(currentBuilderData.items || [], currentBuilderData.tradeIn, currentBuilderData.discount, currentBuilderData.paymentTerms);
  currentBuilderData.totals = result.totals;
  currentBuilderData.totalAmount = result.totals.netTotal;
  currentBuilderData.paymentTerms.cashDownPayment = result.cashDownPayment;
  currentBuilderData.paymentTerms.financedAmount = result.financedAmount;
  const summary = {
    qbSummaryGross: result.totals.grossTotal,
    qbSummaryItemsDisc: -result.totals.itemsDiscountTotal,
    qbSummaryTradeIn: -result.totals.tradeInDeduction,
    qbSummaryGenDisc: -result.totals.generalDiscount,
    qbSummaryNet: result.totals.netTotal,
    qbSummaryBalanceCard: result.financedAmount
  };
  Object.entries(summary).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = formatMoneyBR(value);
    if (element && (id === 'qbSummaryTradeIn' || id === 'qbSummaryGenDisc')) element.parentElement.style.display = value ? 'flex' : 'none';
  });
  renderQuoteCardInstallments(result.financedAmount);
}

// Simulação de Cartão no Orçamento
function renderQuoteCardInstallments(balanceToFinance) {
  const container = document.getElementById('qbInstallmentsList');
  if (!container) return;

  if (balanceToFinance <= 0) {
    container.innerHTML = '<span class="qb-no-installments-text">Nenhum saldo restante para parcelamento.</span>';
    currentBuilderData.paymentTerms.installmentOptions = [];
    return;
  }

  const options = [];
  const maxParcels = 18;

  let html = '<div class="qb-installments-grid">';
  for (let i = 1; i <= maxParcels; i++) {
    const sim = calculateInstallment(balanceToFinance, 0, i);
    options.push(sim);

    const isSelected = (currentBuilderData.paymentTerms.selectedInstallmentCount === i);
    html += `
      <div class="qb-installment-pill ${isSelected ? 'active' : ''}" onclick="selectQuoteInstallment(${i})">
        <span class="inst-count">${i}x</span>
        <strong class="inst-val">${formatMoneyBR(sim.monthlyAmount)}</strong>
        <span class="inst-total">Total: ${formatMoneyBR(sim.totalAmount)}</span>
      </div>
    `;
  }
  html += '</div>';

  container.innerHTML = html;
  currentBuilderData.paymentTerms.installmentOptions = options;
}

function selectQuoteInstallment(count) {
  currentBuilderData.paymentTerms.selectedInstallmentCount = count;
  renderQuoteCardInstallments(currentBuilderData.totals?.netTotal - (currentBuilderData.paymentTerms.cashDownPayment || 0));
}

// Handlers de formulário do Construtor
function onTradeInToggle(chk) {
  currentBuilderData.tradeIn.hasTradeIn = chk.checked;
  const wrap = document.getElementById('qbTradeInWrap');
  if (wrap) wrap.style.display = chk.checked ? 'grid' : 'none';
  recalculateQuoteTotals();
}

function onTradeInValInput(inp) {
  const num = parseCurrencyInput(inp.value);
  inp.value = formatCurrencyInput(num);
  currentBuilderData.tradeIn.tradeInAmount = num;
  recalculateQuoteTotals();
}

function onGeneralDiscountTypeChange(type) {
  currentBuilderData.discount.type = type;
  recalculateQuoteTotals();
}

function onGeneralDiscountValChange(val) {
  currentBuilderData.discount.value = Math.max(0, parseFloat(val) || 0);
  recalculateQuoteTotals();
}

function onCashDownPaymentInput(inp) {
  const num = parseCurrencyInput(inp.value);
  inp.value = formatCurrencyInput(num);
  currentBuilderData.paymentTerms.cashDownPayment = num;
  recalculateQuoteTotals();
}

// =========================================================================
// SALVAR E PERSISTIR ORÇAMENTO NO BACKEND
// =========================================================================

async function saveCurrentQuote() {
  // Coletar campos de texto
  const name = (document.getElementById('qbCustomerName')?.value || '').trim();
  const phone = (document.getElementById('qbCustomerPhone')?.value || '').trim();
  const doc = (document.getElementById('qbCustomerDoc')?.value || '').trim();
  const issueDate = document.getElementById('qbIssueDate')?.value || new Date().toISOString().split('T')[0];
  const validityDays = parseInt(document.getElementById('qbValidityDays')?.value) || 3;
  const status = document.getElementById('qbStatusSelect')?.value || 'RASCUNHO';
  const condNotes = (document.getElementById('qbCommercialConditions')?.value || '').trim();
  const warNotes = (document.getElementById('qbWarrantyNotes')?.value || '').trim();
  const tradeInModel = (document.getElementById('qbTradeInModel')?.value || '').trim();
  const tradeInDesc = (document.getElementById('qbTradeInDesc')?.value || '').trim();

  if (!name) {
    alert('Por favor, informe o Nome do Cliente para o orçamento.');
    document.getElementById('qbCustomerName')?.focus();
    return;
  }

  if (currentBuilderData.items.length === 0) {
    alert('Por favor, adicione pelo menos um produto à proposta.');
    return;
  }
  recalculateQuoteTotals();

  currentBuilderData.customer.name = name;
  currentBuilderData.customer.whatsapp = phone;
  currentBuilderData.customer.doc = doc;
  currentBuilderData.dates.issueDate = issueDate;
  currentBuilderData.dates.validityDays = validityDays;
  currentBuilderData.status = status;
  currentBuilderData.paymentTerms.commercialConditions = condNotes;
  currentBuilderData.warrantyNotes = warNotes;
  currentBuilderData.tradeIn.modelName = tradeInModel;
  currentBuilderData.tradeIn.description = tradeInDesc;

  try {
    const isEditing = Boolean(currentBuilderData.id);
    const url = isEditing ? `/api/quotes/${currentBuilderData.id}` : '/api/quotes';
    const method = isEditing ? 'PUT' : 'POST';

    const saveBtn = document.getElementById('qbSaveBtn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Salvando...';
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentBuilderData)
    });

    const data = await res.json();
    if (data.success && data.quote) {
      closeQuoteBuilderModal();
      await loadQuotes();
      alert(`Orçamento ${data.quote.code} salvo com sucesso!`);
    } else {
      alert('Erro ao salvar orçamento: ' + (data.error || 'Tente novamente.'));
    }
  } catch (err) {
    alert('Erro de conexão ao salvar orçamento.');
    console.error(err);
  } finally {
    const saveBtn = document.getElementById('qbSaveBtn');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Salvar Orçamento';
    }
  }
}

// Duplicar Orçamento
async function duplicateQuoteAction(id) {
  if (!confirm('Deseja duplicar este orçamento? Uma nova proposta será gerada.')) return;
  try {
    const res = await fetch(`/api/quotes/${id}/duplicate`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      await loadQuotes();
      alert(`Proposta duplicada com sucesso: ${data.quote.code}`);
    }
  } catch (err) {
    alert('Erro ao duplicar proposta.');
  }
}

// Excluir Orçamento
async function deleteQuoteAction(id) {
  if (!confirm('Tem certeza que deseja excluir permanentemente esta proposta?')) return;
  try {
    const res = await fetch(`/api/quotes/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      await loadQuotes();
    } else {
      alert(data.error || 'Erro ao excluir orçamento.');
    }
  } catch (err) {
    alert('Erro de conexão ao excluir proposta.');
  }
}

// =========================================================================
// EMISSÃO REAL DE PDF A4 PREMIUM (JSPDF + AUTOTABLE)
// =========================================================================

function generateQuotePDFDoc(quote) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Cores do Design System
  const brandBlack = [15, 23, 42]; // #0f172a
  const brandGreen = [5, 150, 105]; // #059669
  const textDark = [30, 41, 59];
  const textMuted = [100, 116, 139];
  const bgLight = [248, 250, 252];
  const borderLight = [226, 232, 240];

  // 1. Cabeçalho Superior Elegante
  doc.setFillColor(...brandBlack);
  doc.rect(0, 0, pageWidth, 28, 'F');

  // Ícone / Logo Mundo Apple Delivery
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('MUNDO APPLE DELIVERY', 14, 15);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text('Especialistas Apple • Vendas, Trade-In & Assistência Especializada', 14, 21);

  // Número da Proposta no Topo Direito
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(52, 211, 153); // Emerald claro
  doc.text(quote.code || 'PROPOSTA', pageWidth - 14, 15, { align: 'right' });

  const dateFormatted = quote.dates?.issueDate ? quote.dates.issueDate.split('-').reverse().join('/') : '-';
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text(`Emissão: ${dateFormatted} • Validade: ${quote.dates?.validityDays || 3} dias`, pageWidth - 14, 21, { align: 'right' });

  // 2. Caixa de Dados do Cliente & Loja
  let currentY = 34;

  doc.setFillColor(...bgLight);
  doc.setDrawColor(...borderLight);
  doc.roundedRect(14, currentY, pageWidth - 28, 24, 2, 2, 'FD');

  doc.setTextColor(...textMuted);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.text('DADOS DO CLIENTE', 18, currentY + 6);
  doc.text('ATENDIMENTO MUNDO APPLE', pageWidth / 2 + 6, currentY + 6);

  doc.setTextColor(...textDark);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.text(quote.customer?.name || 'Cliente Especial', 18, currentY + 12);
  doc.text('Mundo Apple Delivery SP', pageWidth / 2 + 6, currentY + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...textMuted);
  const docText = quote.customer?.doc ? ` • CPF/CNPJ: ${quote.customer.doc}` : '';
  doc.text(`WhatsApp: ${quote.customer?.whatsapp || 'Não informado'}${docText}`, 18, currentY + 18);
  doc.text('WhatsApp: (11) 94824-5263 • Instagram: @mundoapple.delivery', pageWidth / 2 + 6, currentY + 18);

  currentY += 30;

  // 3. Tabela de Produtos / Itens (AutoTable)
  const tableRows = (quote.items || []).map((it, idx) => {
    const specs = [it.storage, it.ram ? it.ram + ' RAM' : '', it.color, it.condition].filter(Boolean).join(' | ');
    const desc = `${it.name}\n${specs}`;
    const unitPrice = formatMoneyBR(it.unitPrice || 0);
    const disc = it.discountValue > 0 ? (it.discountType === 'PERCENT' ? `${it.discountValue}%` : formatMoneyBR(it.discountValue)) : '-';
    const subtotal = formatMoneyBR(it.subtotal || 0);
    return [idx + 1, desc, it.quantity || 1, unitPrice, disc, subtotal];
  });

  doc.autoTable({
    startY: currentY,
    head: [['#', 'Produto & Configurações', 'Qtd', 'Preço Unit.', 'Desconto', 'Subtotal']],
    body: tableRows,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      textColor: textDark,
      cellPadding: 3.5,
      lineColor: borderLight,
      lineWidth: 0.2
    },
    headStyles: {
      fillColor: brandBlack,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 15, halign: 'center' },
      3: { cellWidth: 28, halign: 'right' },
      4: { cellWidth: 22, halign: 'center' },
      5: { cellWidth: 30, halign: 'right', fontStyle: 'bold', textColor: brandGreen }
    },
    margin: { left: 14, right: 14 }
  });

  currentY = doc.lastAutoTable.finalY + 8;

  // 4. Se houver Aparelho na Troca (Trade-In)
  if (quote.tradeIn?.hasTradeIn && quote.tradeIn?.tradeInAmount > 0) {
    doc.setFillColor(236, 253, 245);
    doc.setDrawColor(16, 185, 129);
    doc.roundedRect(14, currentY, pageWidth - 28, 14, 1.5, 1.5, 'FD');

    doc.setTextColor(...brandGreen);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('ENTRADA / APARELHO NA TROCA (TRADE-IN):', 18, currentY + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...textDark);
    const tradeInDesc = quote.tradeIn.modelName + (quote.tradeIn.description ? ` (${quote.tradeIn.description})` : '');
    doc.text(`Modelo avaliado: ${tradeInDesc}`, 18, currentY + 10.5);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...brandGreen);
    doc.text(`- ${formatMoneyBR(quote.tradeIn.tradeInAmount)}`, pageWidth - 18, currentY + 8, { align: 'right' });

    currentY += 19;
  }

  // 5. Bloco de Totais e Resumo Financeiro (Alinhado à direita)
  const summaryBoxWidth = 85;
  const summaryX = pageWidth - 14 - summaryBoxWidth;

  doc.setFillColor(...bgLight);
  doc.setDrawColor(...borderLight);
  doc.roundedRect(summaryX, currentY, summaryBoxWidth, 36, 2, 2, 'FD');

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...textMuted);
  doc.text('Subtotal Produtos:', summaryX + 6, currentY + 6);
  doc.text(formatMoneyBR(quote.totals?.grossTotal || quote.totalAmount), pageWidth - 20, currentY + 6, { align: 'right' });

  let lineY = currentY + 12;
  if (quote.totals?.tradeInDeduction > 0) {
    doc.text('Dedução Trade-In:', summaryX + 6, lineY);
    doc.setTextColor(...brandGreen);
    doc.text(`- ${formatMoneyBR(quote.totals.tradeInDeduction)}`, pageWidth - 20, lineY, { align: 'right' });
    doc.setTextColor(...textMuted);
    lineY += 6;
  }

  if (quote.totals?.generalDiscount > 0) {
    doc.text('Desconto Especial:', summaryX + 6, lineY);
    doc.setTextColor(225, 29, 72); // Vermelho
    doc.text(`- ${formatMoneyBR(quote.totals.generalDiscount)}`, pageWidth - 20, lineY, { align: 'right' });
    doc.setTextColor(...textMuted);
    lineY += 6;
  }

  // Linha divisória
  doc.setDrawColor(...borderLight);
  doc.line(summaryX + 6, lineY - 1, pageWidth - 20, lineY - 1);

  // Total Final Destacado
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...brandBlack);
  doc.text('VALOR TOTAL:', summaryX + 6, lineY + 6);

  doc.setFontSize(13);
  doc.setTextColor(...brandGreen);
  doc.text(formatMoneyBR(quote.totalAmount || 0), pageWidth - 20, lineY + 6, { align: 'right' });

  // Bloco de Formas de Pagamento (Lado Esquerdo do Resumo)
  const paymentBoxWidth = pageWidth - 28 - summaryBoxWidth - 6;
  doc.setFillColor(...bgLight);
  doc.setDrawColor(...borderLight);
  doc.roundedRect(14, currentY, paymentBoxWidth, 36, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...brandBlack);
  doc.text('CONDIÇÕES DE PAGAMENTO:', 18, currentY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...textDark);
  doc.text(`• ${quote.paymentTerms?.commercialConditions || 'À vista no PIX com entrega imediata ou até 18x no cartão.'}`, 18, currentY + 12, { maxWidth: paymentBoxWidth - 8 });

  if (quote.paymentTerms?.cashDownPayment > 0) {
    doc.text(`• Entrada em PIX / Espécie: ${formatMoneyBR(quote.paymentTerms.cashDownPayment)}`, 18, currentY + 19);
    const balanceFinanced = Math.max(0, quote.totalAmount - quote.paymentTerms.cashDownPayment);
    doc.text(`• Saldo a financiar: ${formatMoneyBR(balanceFinanced)}`, 18, currentY + 24);
  }

  const selectedInst = quote.paymentTerms?.selectedInstallmentCount || 12;
  const sim = (quote.paymentTerms?.installmentOptions || []).find(o => o.installmentCount === selectedInst);
  if (sim && sim.monthlyAmount > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...brandGreen);
    doc.text(`• Opção selecionada no cartão: ${selectedInst}x de ${formatMoneyBR(sim.monthlyAmount)}`, 18, currentY + 30);
  }

  currentY += 42;

  // 6. Termos de Garantia e Rodapé Oficial
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...textDark);
  doc.text('GARANTIA E POLÍTICA DE ENTREGA:', 14, currentY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...textMuted);
  const termsText = `${quote.warrantyNotes || '1 ano de garantia oficial Apple para produtos lacrados.'} Proposta válida por ${quote.dates?.validityDays || 3} dias a partir da data de emissão. Valores sujeitos à disponibilidade do estoque diário.`;
  doc.text(termsText, 14, currentY + 4, { maxWidth: pageWidth - 28 });

  // Rodapé da Página
  doc.setDrawColor(...borderLight);
  doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);

  doc.setFontSize(6.8);
  doc.text('Mundo Apple Delivery • São Paulo - SP • Documento gerado eletronicamente para fins de proposta comercial.', 14, pageHeight - 8);
  doc.text(`Página 1 de 1 • Código: ${quote.code}`, pageWidth - 14, pageHeight - 8, { align: 'right' });

  return doc;
}

// Visualizar / Baixar PDF
function generateAndOpenPDF(quoteId) {
  const quote = quotesList.find(q => q.id === quoteId);
  if (!quote) return;
  const doc = generateQuotePDFDoc(quote);
  
  // Abre o PDF em nova aba para visualização e impressão nativa
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

function downloadQuotePDF(quoteId) {
  const quote = quotesList.find(q => q.id === quoteId);
  if (!quote) return;
  const doc = generateQuotePDFDoc(quote);
  const fileName = `Proposta_${quote.code}_MundoApple.pdf`;
  doc.save(fileName);
}

// Compartilhar Orçamento no WhatsApp com texto estruturado profissional
function shareQuoteWhatsApp(quoteId) {
  const quote = quotesList.find(q => q.id === quoteId);
  if (!quote) return;

  const phone = (quote.customer?.whatsapp || '').replace(/\D/g, '');
  const itemsText = (quote.items || []).map(it => {
    const specs = [it.storage, it.ram ? it.ram + ' RAM' : '', it.color, it.condition].filter(Boolean).join(' • ');
    return `• *${it.quantity}x ${it.name}* (${specs})\n   Preço: *${formatMoneyBR(it.subtotal)}*`;
  }).join('\n\n');

  let tradeInTxt = '';
  if (quote.tradeIn?.hasTradeIn && quote.tradeIn.tradeInAmount > 0) {
    tradeInTxt = `\n🔄 *Aparelho na Troca:* ${quote.tradeIn.modelName} (- ${formatMoneyBR(quote.tradeIn.tradeInAmount)})\n`;
  }

  let cardTxt = '';
  const selectedInst = quote.paymentTerms?.selectedInstallmentCount || 12;
  const sim = (quote.paymentTerms?.installmentOptions || []).find(o => o.installmentCount === selectedInst);
  if (sim && sim.monthlyAmount > 0) {
    cardTxt = `💳 *Cartão:* ou em até *${selectedInst}x de ${formatMoneyBR(sim.monthlyAmount)}*\n`;
  }

  const message = `Olá, *${quote.customer?.name || 'Cliente'}*! Segue sua proposta personalizada da *Mundo Apple Delivery*:\n\n` +
    `📋 *Proposta:* ${quote.code}\n` +
    `📅 *Validade:* ${quote.dates?.validityDays || 3} dias\n\n` +
    `🛍️ *PRODUTOS ESCOLHIDOS:*\n${itemsText}\n` +
    tradeInTxt +
    `\n💵 *VALOR TOTAL: ${formatMoneyBR(quote.totalAmount)}*\n` +
    cardTxt +
    `🛡️ *Garantia:* ${quote.warrantyNotes}\n\n` +
    `Podemos confirmar a separação do seu pedido? Ficamos à sua disposição!`;

  const encoded = encodeURIComponent(message);
  const waUrl = phone ? `https://wa.me/55${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
  window.open(waUrl, '_blank');
}

// Visualizar detalhes rápidos da proposta
function openQuoteDetail(quoteId) {
  editQuote(quoteId);
}

// Utilitário de escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
