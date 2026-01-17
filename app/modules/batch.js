// Модуль "Партия" — вынесен отдельно, чтобы не перегружать app.js
// Подключается после app.js

(function () {
  if (typeof BusinessCalculator === 'undefined') return;

  BusinessCalculator.prototype.calculateBatch = function (data) {
    const qty = Number(data.batch_qty) || 0;
    const months = Math.max(1, Number(data.batch_months) || 1);

    const block = document.getElementById('batch_block');
    if (!block) return;

    // Если партия не задана — прячем блок
    if (qty <= 0 || (Number(data.price) || 0) <= 0) {
      block.style.display = 'none';
      return;
    }

    // Показываем блок
    block.style.display = 'block';

    const invest = qty * (Number(data.unit_cost) || 0);
    const revenue = qty * (Number(data.price) || 0);

    // leftPerSale уже рассчитан в основном калькуляторе (включая переменные расходы и налог с оборота, если включён)
    const margin = qty * (Number(this.leftPerSale) || 0);

    // Фиксированные расходы за период распродажи партии
    const fixed = (Number(this.fixedMonthly) || 0) * months;

    // Налог на прибыль (если включён)
    const profitBeforeTax = margin - fixed;
    const profitTaxPct = (Number(this.taxProfitPct) || 0);
    const profitTax = Math.max(0, profitBeforeTax) * profitTaxPct / 100;

    const net = profitBeforeTax - profitTax;

    const neededMonthlySales = Math.ceil(qty / months);

    // UI
    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = typeof val === 'number' ? this.formatNumber(val) : String(val);
    };

    setText('batch_profit', net);
    setText('batch_invest', invest);
    setText('batch_revenue', revenue);

    const neededEl = document.getElementById('batch_needed_sales');
    if (neededEl) neededEl.textContent = neededMonthlySales;

    // Статусная подсветка
    const statusItem = document.getElementById('batch_status_item');
    if (statusItem) {
      statusItem.classList.remove('positive', 'negative', 'zero');
      statusItem.classList.add(net > 0 ? 'positive' : net < 0 ? 'negative' : 'zero');
    }

    // Текст‑подсказка
    const noteEl = document.getElementById('batch_note');
    if (noteEl) {
      const parts = [];

      if ((Number(this.leftPerSale) || 0) <= 0) {
        parts.push('⚠️ Каждая продажа убыточна. Партия почти гарантированно уйдёт в минус — сначала правь цену/расходы.');
      } else {
        parts.push(`Если распродашь партию за ${months} мес, план ≈ ${neededMonthlySales} продаж/мес.`);
      }

      // Сравнение с текущими продажами (если есть)
      let currentSalesMonthly = Number(data.current_sales) || 0;
      if (data.current_sales_type === 'day') currentSalesMonthly = currentSalesMonthly * 30;
      if (currentSalesMonthly > 0) {
        if (currentSalesMonthly >= neededMonthlySales) {
          parts.push(`Текущий темп (${currentSalesMonthly}/мес) — хватает.`);
        } else {
          parts.push(`Текущий темп (${currentSalesMonthly}/мес) — не хватает, нужно +${neededMonthlySales - currentSalesMonthly}/мес.`);
        }
      }

      // ROI (если есть смысл)
      if (invest > 0) {
        const roi = (net / invest) * 100;
        if (isFinite(roi)) parts.push(`ROI партии: ${roi.toFixed(1)}%.`);
      }

      noteEl.textContent = parts.join(' ');
    }
  };
})();
