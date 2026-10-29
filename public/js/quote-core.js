(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuoteCore = factory();
})(typeof self !== 'undefined' ? self : this, function() {
  const money = value => Math.round((value + Number.EPSILON) * 100) / 100;
  function amount(value, label = 'Valor') {
    const number = Number(value ?? 0);
    if (!Number.isFinite(number) || number < 0 || number > 1e10) throw new Error(`${label} inválido.`);
    return money(number);
  }
  function quantity(value) {
    const number = Number(value ?? 1);
    if (!Number.isInteger(number) || number < 1 || number > 99) throw new Error('A quantidade deve ser de 1 a 99.');
    return number;
  }
  function discount(value, type, base) {
    const number = amount(value, 'Desconto');
    if (type !== 'FIXED' && type !== 'PERCENT') throw new Error('Tipo de desconto inválido.');
    return money(Math.min(base, type === 'PERCENT' ? base * Math.min(100, number) / 100 : number));
  }
  function itemSubtotal(item) {
    const price = amount(item.unitPrice, 'Preço unitário');
    const count = quantity(item.quantity);
    // Arredonda o subtotal da linha, preservando descontos percentuais sobre múltiplas unidades.
    const value = amount(item.discountValue, 'Desconto');
    const type = item.discountType || 'FIXED';
    if (!['FIXED', 'PERCENT'].includes(type)) throw new Error('Tipo de desconto inválido.');
    const reduction = type === 'PERCENT' ? price * Math.min(100, value) / 100 : Math.min(price, value);
    return money(Math.max(0, price - reduction) * count);
  }
  function installment(cashPrice, entryAmount, installmentCount, rates = {}) {
    const count = Number(installmentCount);
    if (!Number.isInteger(count) || count < 1 || count > 18) throw new Error('Parcelamento inválido.');
    const baseRate = amount(rates.baseRate ?? 2.69, 'Taxa base');
    const parcelRate = amount(rates.installmentRates?.[String(count)] ?? (count === 1 ? 3.05 : count * 0.75), 'Taxa de parcelamento');
    const totalRate = money(baseRate + parcelRate);
    if (totalRate >= 100) throw new Error('A soma das taxas deve ser inferior a 100%.');
    const balanceToFinance = money(Math.max(0, amount(cashPrice) - amount(entryAmount)));
    const totalAmount = balanceToFinance / (1 - totalRate / 100);
    return { installmentCount: count, totalRate, totalAmount, monthlyAmount: totalAmount / count, balanceToFinance };
  }
  function totals(items, tradeIn = {}, proposalDiscount = {}, paymentTerms = {}) {
    let grossTotal = 0;
    let subtotal = 0;
    for (const item of items) {
      grossTotal += money(amount(item.unitPrice) * quantity(item.quantity));
      subtotal += itemSubtotal(item);
    }
    grossTotal = money(grossTotal);
    subtotal = money(subtotal);
    const tradeInDeduction = tradeIn.hasTradeIn ? Math.min(subtotal, amount(tradeIn.tradeInAmount, 'Avaliação da troca')) : 0;
    const afterTradeIn = money(subtotal - tradeInDeduction);
    const generalDiscount = discount(proposalDiscount.value, proposalDiscount.type || 'FIXED', afterTradeIn);
    const netTotal = money(afterTradeIn - generalDiscount);
    const cashDownPayment = Math.min(netTotal, amount(paymentTerms.cashDownPayment, 'Entrada'));
    return {
      totals: { grossTotal, itemsDiscountTotal: money(grossTotal - subtotal), tradeInDeduction, generalDiscount, netTotal },
      cashDownPayment,
      financedAmount: money(netTotal - cashDownPayment)
    };
  }
  return { money, amount, quantity, itemSubtotal, installment, totals };
});
