// Бизнес-калькулятор - основной JavaScript
class BusinessCalculator {
    constructor() {
        this.charts = {};
        this.treemapMode = 'per_sale';
        this.breakdownMode = 'per_month';
        // Слайдер "Продаж в месяц" в блоке графиков:
        // по умолчанию синхронизируем с рассчитанным планом продаж,
        // но если пользователь меняет его вручную — перестаём перетирать ввод.
        this.chartSalesUserSet = false;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.initTooltipsMobile();
        this.setupTabs();
        // Если пришли по ссылке "Поделиться" — берём данные из URL.
        const loadedFromShare = this.tryLoadFromShareHash();
        if (!loadedFromShare) {
            this.loadFromStorage();
        }
        this.calculateAll();
        this.initCharts();
        this.updateTreemap();
    }

    // НАСТРОЙКА СОБЫТИЙ
    setupEventListeners() {
        // Все числовые поля
        const inputs = document.querySelectorAll('input[type="number"], input[type="checkbox"], select');
        inputs.forEach(input => {
            input.addEventListener('input', () => {
                this.calculateAll();
                this.saveToStorage();
            });
            input.addEventListener('change', () => {
                this.calculateAll();
                this.saveToStorage();
            });
        });

        // Ползунок цены
        const priceSlider = document.getElementById('price_slider');
        const priceInput = document.getElementById('price');
        
        if (priceSlider && priceInput) {
            priceSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                priceInput.value = value;
                this.calculateAll();
                this.saveToStorage();
            });
            
            priceInput.addEventListener('input', (e) => {
                const value = parseInt(e.target.value) || 0;
                this.updatePriceSliderRange(value);
                const maxVal = parseInt(priceSlider.max) || 200000;
                priceSlider.value = Math.min(value, maxVal);
            });
        }

        // Переключатели налогов
        document.getElementById('tax_rev_enable').addEventListener('change', (e) => {
            document.getElementById('tax_rev_pct').disabled = !e.target.checked;
        });

        document.getElementById('tax_profit_enable').addEventListener('change', (e) => {
            document.getElementById('tax_profit_pct').disabled = !e.target.checked;
        });

        document.getElementById('fixed_tax_enable').addEventListener('change', (e) => {
            document.getElementById('fixed_tax_amount').disabled = !e.target.checked;
            document.getElementById('fixed_tax_period').disabled = !e.target.checked;
        });

        // Ползунок графиков (ползунок + ручной ввод)
        const chartSales = document.getElementById('chart_sales');
        const chartSalesInput = document.getElementById('chart_sales_input');

        if (chartSales && chartSalesInput) {
            const syncSales = (val) => {
                const min = parseInt(chartSales.min || '0', 10);
                const max = parseInt(chartSales.max || '1000000', 10);
                let v = parseInt(val, 10);
                if (isNaN(v)) v = 0;
                v = Math.max(min, Math.min(max, v));
                chartSales.value = String(v);
                chartSalesInput.value = String(v);
            };

            chartSales.addEventListener('input', (e) => {
                this.chartSalesUserSet = true;
                syncSales(e.target.value);
                this.updateCharts();
            });

            // Удобнее вводить руками на мобиле:
            // - даём стереть значение (пустая строка) без мгновенной подстановки 0
            // - приводим к числу на blur/change
            chartSalesInput.addEventListener('focus', (e) => {
                // На некоторых мобилках select() может не сработать — не критично.
                try { e.target.select(); } catch (_) {}
            });

            chartSalesInput.addEventListener('input', (e) => {
                this.chartSalesUserSet = true;
                const raw = String(e.target.value);
                if (raw.trim() === '') return;
                syncSales(raw);
                this.updateCharts();
            });

            chartSalesInput.addEventListener('change', (e) => {
                this.chartSalesUserSet = true;
                syncSales(e.target.value);
                this.updateCharts();
            });

            chartSalesInput.addEventListener('blur', (e) => {
                this.chartSalesUserSet = true;
                const raw = String(e.target.value).trim();
                syncSales(raw === '' ? '0' : raw);
                this.updateCharts();
            });
        }


        // Переключатель периода графиков
        document.getElementById('chart_period').addEventListener('change', () => {
            this.updateCharts();
        });


        // TOPBAR: пресеты + экспорт/импорт/печать
        const applyPresetBtn = document.getElementById('apply_preset');
        if (applyPresetBtn) {
            applyPresetBtn.addEventListener('click', () => {
                const presetSelect = document.getElementById('preset');
                const preset = presetSelect ? presetSelect.value : 'custom';
                if (preset && preset !== 'custom') {
                    this.applyPreset(preset);
                    this.calculateAll();
                    this.saveToStorage();
                    this.updateCharts();
                }
            });
        }

        const exportBtn = document.getElementById('btn_export');
        if (exportBtn) exportBtn.addEventListener('click', () => this.exportJSON());

        const importBtn = document.getElementById('btn_import');
        const importFile = document.getElementById('import_file');
        if (importBtn && importFile) {
            importBtn.addEventListener('click', () => importFile.click());
            importFile.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) this.importJSON(file);
                // сброс значения, чтобы можно было импортировать тот же файл повторно
                e.target.value = '';
            });
        }

        const printBtn = document.getElementById('btn_print');
        if (printBtn) printBtn.addEventListener('click', () => this.printReport());

        const shareBtn = document.getElementById('btn_share');
        if (shareBtn) shareBtn.addEventListener('click', () => this.copyShareLink());

        // TREEMAP: режим
        const tmPerSale = document.getElementById('treemap_mode_per_sale');
        const tmPerMonth = document.getElementById('treemap_mode_per_month');
        if (tmPerSale && tmPerMonth) {
            tmPerSale.addEventListener('click', () => {
                this.treemapMode = 'per_sale';
                tmPerSale.classList.add('active');
                tmPerMonth.classList.remove('active');
                this.updateTreemap();
            });
            tmPerMonth.addEventListener('click', () => {
                this.treemapMode = 'per_month';
                tmPerMonth.classList.add('active');
                tmPerSale.classList.remove('active');
                this.updateTreemap();
            });
        }

        // WATERFALL: режим (на 1 продажу / в месяц)
        const bdPerSale = document.getElementById('breakdown_mode_per_sale');
        const bdPerMonth = document.getElementById('breakdown_mode_per_month');
        if (bdPerSale && bdPerMonth) {
            bdPerSale.addEventListener('click', () => {
                this.breakdownMode = 'per_sale';
                bdPerSale.classList.add('active');
                bdPerMonth.classList.remove('active');
                this.updateCharts();
            });
            bdPerMonth.addEventListener('click', () => {
                this.breakdownMode = 'per_month';
                bdPerMonth.classList.add('active');
                bdPerSale.classList.remove('active');
                this.updateCharts();
            });
        }

    }

    // НАСТРОЙКА ВКЛАДОК
    setupTabs() {
        const tabs = document.querySelectorAll('.tab-button');
        const contents = document.querySelectorAll('.tab-content');

        tabs.forEach(tab => {
            const targetTab = tab.getAttribute('data-tab');
            if (!targetTab) return; // например, ссылка на отдельную страницу

            tab.addEventListener('click', () => {
                // Переключить активную вкладку
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // Переключить контент
                contents.forEach(c => c.classList.remove('active'));
                const targetEl = document.getElementById(targetTab);
                if (targetEl) targetEl.classList.add('active');

                // Обновить графики если открыта вкладка графиков
                if (targetTab === 'charts') {
                    setTimeout(() => this.updateCharts(), 100);
                }

                if (targetTab === 'treemap') {
                    setTimeout(() => this.updateTreemap(), 50);
                }
            });
        });
    }

    // ПОЛУЧИТЬ ДАННЫЕ ИЗ ФОРМЫ
    getFormData() {
        const data = {
            // Шаг 1
            price: this.getFloat('price'),
            unit_cost: this.getFloat('unit_cost'),
            commissions_type: document.getElementById('commissions_type').value,
            commissions: this.getFloat('commissions'),
            shipping: this.getFloat('shipping'),
            ad_per_sale: this.getFloat('ad_per_sale'),
            shipping_transit: (document.getElementById('shipping_transit') ? document.getElementById('shipping_transit').checked : false),
            packing: this.getFloat('packing'),
            loss_pct: this.getFloat('loss_pct'),

            // Маркетплейсы (доп. поля)
            mp_fulfillment: this.getFloat('mp_fulfillment'),
            mp_storage: this.getFloat('mp_storage'),
            mp_lastmile: this.getFloat('mp_lastmile'),
            mp_discount_pct: this.getFloat('mp_discount_pct'),
            
            // Налоги
            tax_rev_enable: document.getElementById('tax_rev_enable').checked,
            tax_rev_pct: this.getFloat('tax_rev_pct'),
            tax_profit_enable: document.getElementById('tax_profit_enable').checked,
            tax_profit_pct: this.getFloat('tax_profit_pct'),
            fixed_tax_enable: document.getElementById('fixed_tax_enable').checked,
            fixed_tax_amount: this.getFloat('fixed_tax_amount'),
            fixed_tax_period: document.getElementById('fixed_tax_period').value,
            
            // Шаг 2
            rent: this.getFloat('rent'),
            salaries: this.getFloat('salaries'),
            advertising: this.getFloat('advertising'),
            services: this.getFloat('services'),
            credit: this.getFloat('credit'),
            other: this.getFloat('other'),
            
            // Шаг 3
            target_profit: this.getFloat('target_profit'),
            current_sales_type: document.getElementById('current_sales_type').value,
            current_sales: this.getInt('current_sales'),
            batch_qty: this.getInt('batch_qty'),
            batch_months: this.getInt('batch_months')
        };

        // Ограничители, чтобы проценты не уезжали в космос
        data.loss_pct = this.clamp(data.loss_pct, 0, 100);
        data.tax_rev_pct = this.clamp(data.tax_rev_pct, 0, 100);
        data.tax_profit_pct = this.clamp(data.tax_profit_pct, 0, 100);
        if (data.commissions_type === 'percent') {
            data.commissions = this.clamp(data.commissions, 0, 100);
        }

        data.mp_discount_pct = this.clamp(data.mp_discount_pct, 0, 100);

        // Партия: срок не может быть 0
        data.batch_months = Math.max(1, data.batch_months || 1);

        return data;
    }

    getFloat(id) {
        const el = document.getElementById(id);
        if (!el) return 0;
        // Поддержка ввода с запятой (русская клавиатура)
        const raw = (el.value ?? '').toString().replace(',', '.');
        const val = parseFloat(raw) || 0;
        return Math.max(0, val);
    }

    getInt(id) {
        const el = document.getElementById(id);
        if (!el) return 0;
        const val = parseInt((el.value ?? '').toString(), 10) || 0;
        return Math.max(0, val);
    }

    // РАСЧЁТЫ
    calculateAll() {
        const data = this.getFormData();
        
        // Расчёт для одной продажи
        this.calculatePerSale(data);
        
        // Расчёт обязательных расходов
        this.calculateFixedExpenses(data);
        
        // Расчёт целей
        this.calculateTargets(data);

        // Карта "где течёт"
        this.updateTreemap();
    }

    calculatePerSale(data) {
        let expenses = [];
        const infoItems = [];
        
        // Стоимость товара
        expenses.push({ label: 'Стоимость товара/услуги', value: data.unit_cost });
        
        // Комиссии
        let commission_amount = data.commissions_type === 'percent' 
            ? data.price * data.commissions / 100 
            : data.commissions;
        expenses.push({ 
            label: 'Комиссии', 
            value: commission_amount,
            detail: data.commissions_type === 'percent' ? `(${data.commissions}%)` : ''
        });
        
        // Доставка
        if (!data.shipping_transit) {
            expenses.push({ label: 'Доставка/логистика', value: data.shipping });
        } else if (data.shipping > 0) {
            // Транзитная доставка: клиент платит отдельно, не влияет на прибыль/налоги
            infoItems.push({ label: 'Доставка (оплачивает клиент отдельно)', value: data.shipping });
        }

        // Реклама (CAC)
        if ((data.ad_per_sale || 0) > 0) {
            expenses.push({ label: 'Реклама (CAC)', value: data.ad_per_sale });
        }

        // Упаковка
        expenses.push({ label: 'Упаковка/расходники', value: data.packing });

        // Маркетплейсы (доп. поля)
        if (data.mp_fulfillment > 0) {
            expenses.push({ label: 'Фулфилмент/сборка', value: data.mp_fulfillment });
        }
        if (data.mp_storage > 0) {
            expenses.push({ label: 'Хранение/услуги площадки', value: data.mp_storage });
        }
        if (data.mp_lastmile > 0) {
            expenses.push({ label: 'Последняя миля/доставка МП', value: data.mp_lastmile });
        }

        // Скидки/акции (потеря выручки)
        const discount_amount = data.price * data.mp_discount_pct / 100;
        if (discount_amount > 0) {
            expenses.push({
                label: 'Скидки/акции',
                value: discount_amount,
                detail: `(${data.mp_discount_pct}%)`
            });
        }
        
        // Потери
        const loss_amount = data.price * data.loss_pct / 100;
        if (loss_amount > 0) {
            expenses.push({ 
                label: 'Потери (возвраты/брак)', 
                value: loss_amount,
                detail: `(${data.loss_pct}%)`
            });
        }
        
        // Налог с денег от клиентов
        let tax_rev_amount = 0;
        if (data.tax_rev_enable && data.tax_rev_pct > 0) {
            tax_rev_amount = data.price * data.tax_rev_pct / 100;
            expenses.push({ 
                label: 'Налог с продаж', 
                value: tax_rev_amount,
                detail: `(${data.tax_rev_pct}%)`
            });
        }
        
        // Всего расходов на одну продажу
        const total_expenses = expenses.reduce((sum, exp) => sum + exp.value, 0);
        
        // Что остаётся
        const left_per_sale = data.price - total_expenses;
        
        // Обновить UI
        document.getElementById('left_per_sale').textContent = this.formatNumber(left_per_sale);
        
        // Показать распределение
        this.showExpenseBreakdown(expenses, left_per_sale, infoItems);
        
        // Предупреждение
        const warning = document.getElementById('step1_warning');
        if (left_per_sale <= 0) {
            warning.style.display = 'block';
            // Добавить эффект мигания
            warning.style.animation = 'pulse 2s infinite';
        } else {
            warning.style.display = 'none';
            warning.style.animation = 'none';
        }
        
        // Сохранить для дальнейших расчётов
        this.leftPerSale = left_per_sale;
        this.price = data.price;
    }

    showExpenseBreakdown(expenses, left_per_sale, infoItems = []) {
        const container = document.getElementById('expenses_breakdown');
        container.innerHTML = '';
        
        // Добавить все расходы
        expenses.forEach(exp => {
            if (exp.value > 0) {
                const item = document.createElement('div');
                item.className = 'breakdown-item highlight';
                item.innerHTML = `
                    <span class="breakdown-label">${exp.label} ${exp.detail || ''}</span>
                    <span class="breakdown-value">${this.formatNumber(exp.value)} ₽</span>
                `;
                container.appendChild(item);
            }
        });
        
        // Инфо-строки (не влияют на расчёты)

        
        (infoItems || []).forEach(info => {

        
            if ((Number(info.value) || 0) > 0) {

        
                const item = document.createElement('div');

        
                item.className = 'breakdown-item info';

        
                item.innerHTML = `

        
                    <span class="breakdown-label">${info.label}</span>

        
                    <span class="breakdown-value">${this.formatNumber(info.value)} ₽</span>

        
                `;

        
                container.appendChild(item);

        
            }

        
        });

        
        

        
        // Добавить что остаётся
        const item = document.createElement('div');
        item.className = 'breakdown-item positive';
        item.innerHTML = `
            <span class="breakdown-label">Тебе остаётся</span>
            <span class="breakdown-value">${this.formatNumber(left_per_sale)} ₽</span>
        `;
        container.appendChild(item);
    }

    calculateFixedExpenses(data) {
        const expenses = [
            { label: 'Аренда', value: data.rent },
            { label: 'Зарплаты', value: data.salaries },
            { label: 'Реклама', value: data.advertising },
            { label: 'Сервисы/связь', value: data.services },
            { label: 'Кредит/лизинг', value: data.credit },
            { label: 'Прочие', value: data.other }
        ];
        
        // Фиксированные налоги
        let fixed_tax_monthly = 0;
        if (data.fixed_tax_enable && data.fixed_tax_amount > 0) {
            const periods = { month: 1, quarter: 3, year: 12 };
            fixed_tax_monthly = data.fixed_tax_amount / periods[data.fixed_tax_period];
            
            expenses.push({ 
                label: `Фикс. налог (${data.fixed_tax_period === 'month' ? 'мес' : data.fixed_tax_period === 'quarter' ? 'кварт' : 'год'})`, 
                value: fixed_tax_monthly,
                detail: `(всего ${this.formatNumber(data.fixed_tax_amount)} ₽)`
            });
        }
        
        const total_monthly = expenses.reduce((sum, exp) => sum + exp.value, 0);
        
        // Обновить UI
        document.getElementById('fixed_monthly').textContent = this.formatNumber(total_monthly);
        
        // Показать распределение
        this.showFixedBreakdown(expenses);
        
        // Сохранить
        this.fixedMonthly = total_monthly;
        this.taxProfitPct = data.tax_profit_enable ? data.tax_profit_pct : 0;
    }

    showFixedBreakdown(expenses) {
        const container = document.getElementById('fixed_breakdown');
        container.innerHTML = '';
        
        expenses.forEach(exp => {
            if (exp.value > 0) {
                const item = document.createElement('div');
                item.className = 'breakdown-item highlight';
                item.innerHTML = `
                    <span class="breakdown-label">${exp.label} ${exp.detail || ''}</span>
                    <span class="breakdown-value">${this.formatNumber(exp.value)} ₽</span>
                `;
                container.appendChild(item);
            }
        });
    }

    calculateTargets(data) {
        // Точка безубыточности
        let break_even_sales = 0;
        if (this.leftPerSale > 0) {
            break_even_sales = Math.ceil(this.fixedMonthly / this.leftPerSale);
        } else {
            break_even_sales = 'невозможно';
        }
        
        // Продажи для цели
        let target_sales = 0;
        const target_profit = data.target_profit;
        
        if (this.leftPerSale > 0 && target_profit > 0) {
            if (this.taxProfitPct === 0) {
                // Без налога на прибыль
                target_sales = Math.ceil((this.fixedMonthly + target_profit) / this.leftPerSale);
            } else {
                // С налогом на прибыль - решаем итерацией
                target_sales = this.findSalesForTarget(target_profit);
            }
        } else if (this.leftPerSale > 0) {
            target_sales = break_even_sales;
        } else {
            target_sales = 'невозможно';
        }
        
        // Текущая прибыль
        let current_sales_monthly = data.current_sales;
        if (data.current_sales_type === 'day') {
            current_sales_monthly = data.current_sales * 30;
        }
        
        const current_profit = this.calculateNetProfit(current_sales_monthly);
        
        // Обновить UI
        document.getElementById('break_even_sales').textContent = 
            typeof break_even_sales === 'number' ? break_even_sales : '∞';
        
        document.getElementById('target_display').textContent = this.formatNumber(target_profit);
        document.getElementById('target_sales').textContent = 
            typeof target_sales === 'number' ? target_sales : '∞';
        
        document.getElementById('current_display').textContent = current_sales_monthly;
        document.getElementById('current_profit').textContent = this.formatNumber(current_profit);
        
        // Статус
        const statusElement = document.getElementById('profit_status');
        statusElement.textContent = current_profit > 0 ? 'В плюс' : current_profit < 0 ? 'В минус' : 'В ноль';
        statusElement.className = 'status-badge ' + (current_profit > 0 ? 'positive' : current_profit < 0 ? 'negative' : 'zero');

        // Сценарии (−30% / база / +30% от текущего объёма)
        const bad_sales = Math.floor(current_sales_monthly * 0.7);
        const good_sales = Math.ceil(current_sales_monthly * 1.3);
        const bad_profit = this.calculateNetProfit(bad_sales);
        const good_profit = this.calculateNetProfit(good_sales);
        const scBad = document.getElementById('sc_profit_bad');
        const scBase = document.getElementById('sc_profit_base');
        const scGood = document.getElementById('sc_profit_good');
        if (scBad) scBad.textContent = this.formatNumber(bad_profit);
        if (scBase) scBase.textContent = this.formatNumber(current_profit);
        if (scGood) scGood.textContent = this.formatNumber(good_profit);
        
        // Главный пожиратель денег
        this.showMainExpense(data);
        
        // Предупреждение
        const warning = document.getElementById('step3_warning');
        if (this.leftPerSale <= 0) {
            warning.style.display = 'block';
        } else {
            warning.style.display = 'none';
        }
        
        // Обновить ползунок графиков
        // По умолчанию (пока пользователь не трогал вручную) держим графики
        // синхронизированными с рассчитанным планом продаж.
        // Если пользователь начал вводить руками — НЕ перетираем его число.
        if (!this.chartSalesUserSet) {
            const cs = document.getElementById('chart_sales');
            if (cs) cs.value = current_sales_monthly;
            const csi = document.getElementById('chart_sales_input');
            if (csi) csi.value = current_sales_monthly;
            const csv = document.getElementById('chart_sales_value');
            if (csv) csv.textContent = current_sales_monthly;
        }

        
        // Партия (если подключён модуль)
        if (typeof this.calculateBatch === 'function') {
            this.calculateBatch(data);
        }
    }

    findSalesForTarget(target) {
        // Итерационный поиск количества продаж для достижения цели
        for (let sales = 0; sales <= 1000000; sales++) {
            const profit = this.calculateNetProfit(sales);
            if (profit >= target) {
                return sales;
            }
        }
        return 'слишком много';
    }

    calculateNetProfit(sales_per_month) {
        if (this.leftPerSale <= 0) return -this.fixedMonthly;
        
        const profit_before_tax = sales_per_month * this.leftPerSale - this.fixedMonthly;
        const profit_tax = Math.max(0, profit_before_tax) * this.taxProfitPct / 100;
        return profit_before_tax - profit_tax;
    }

    showMainExpense(data) {
        const commission_amount = data.commissions_type === 'percent'
            ? data.price * data.commissions / 100
            : data.commissions;

        // Важно: сравниваем сопоставимые величины.
        // Переменные расходы — на 1 продажу, фиксированные — в месяц.
        const perSale = [
            { label: 'Закуп/материалы (на 1 продажу)', value: data.unit_cost },
            { label: 'Комиссии (на 1 продажу)', value: commission_amount },
            { label: 'Реклама (CAC) (на 1 продажу)', value: data.ad_per_sale || 0 },
            { label: data.shipping_transit ? 'Доставка (оплачивает клиент отдельно)' : 'Доставка (на 1 продажу)', value: data.shipping_transit ? 0 : data.shipping },
            { label: 'Упаковка (на 1 продажу)', value: data.packing },
            { label: 'Фулфилмент (на 1 продажу)', value: data.mp_fulfillment },
            { label: 'Хранение/площадка (на 1 продажу)', value: data.mp_storage },
            { label: 'Последняя миля МП (на 1 продажу)', value: data.mp_lastmile },
            { label: 'Скидки/акции (на 1 продажу)', value: data.price * data.mp_discount_pct / 100 },
        ];

        const monthly = [
            { label: 'Аренда (в месяц)', value: data.rent },
            { label: 'Зарплаты (в месяц)', value: data.salaries },
            { label: 'Реклама (в месяц)', value: data.advertising },
            { label: 'Сервисы (в месяц)', value: data.services },
            { label: 'Кредиты/лизинг (в месяц)', value: data.credit },
            { label: 'Прочие (в месяц)', value: data.other },
        ];

        // Вычислим «кто главный» в двух плоскостях, чтобы не путать ₽/продажа и ₽/месяц.
        const maxPerSale = perSale.reduce((a, b) => (b.value > a.value ? b : a), { label: 'нет данных', value: 0 });
        const maxMonthly = monthly.reduce((a, b) => (b.value > a.value ? b : a), { label: 'нет данных', value: 0 });

        const parts = [];
        if (maxPerSale.value > 0) parts.push(`<strong>${maxPerSale.label}</strong> (${this.formatNumber(maxPerSale.value)} ₽)`);
        if (maxMonthly.value > 0) parts.push(`<strong>${maxMonthly.label}</strong> (${this.formatNumber(maxMonthly.value)} ₽)`);

        document.getElementById('main_expense').innerHTML =
            'Главный пожиратель денег: ' + (parts.length ? parts.join(' • ') : '<strong>нет данных</strong>');
    }



    initTooltipsMobile() {
        // На мобильных hover нет — делаем "тап-открыть".
        const tips = Array.from(document.querySelectorAll('.tooltip'));
        if (!tips.length) return;

        const closeAll = () => tips.forEach(t => t.classList.remove('open'));

        tips.forEach(t => {
            t.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const willOpen = !t.classList.contains('open');
                closeAll();
                if (willOpen) t.classList.add('open');
            });
        });

        document.addEventListener('click', closeAll);
        window.addEventListener('scroll', closeAll, { passive: true });
    }

    // ГРАФИКИ
    initCharts() {
        // Если Chart.js не подключён — показываем сообщение и отключаем графики
        if (typeof Chart === 'undefined') {
            const chartsTab = document.getElementById('charts');
            if (chartsTab && !chartsTab.querySelector('.warning-box')) {
                const msg = document.createElement('div');
                msg.className = 'warning-box';
                msg.innerHTML = '📉 Графики временно недоступны: файл <strong>lib/chart.umd.js</strong> не содержит Chart.js. ' +
                                'Скачай Chart.js (chart.umd.js) и замени содержимое этого файла. Тогда графики заработают офлайн.';
                chartsTab.prepend(msg);
            }
            return;
        }

        // WATERFALL ("водопад") — как из цены утекает маржа по этапам
        // Реализация через floating bars: каждая колонка = отрезок [start, end]
        const ctx1 = document.getElementById('breakdownChart').getContext('2d');
        this.charts.breakdown = new Chart(ctx1, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'Водопад',
                    data: [], // массив вида [[start,end], ...]
                    borderWidth: 0,
                    backgroundColor: (ctx) => {
                        const raw = ctx.raw;
                        const idx = ctx.dataIndex;
                        const meta = ctx.chart?.$waterfallMeta;
                        if (meta && meta.colors && meta.colors[idx]) return meta.colors[idx];
                        // запасной вариант
                        if (!raw || !Array.isArray(raw)) return '#94a3b8';
                        const [a, b] = raw;
                        if (a === 0 && b > 0 && idx === 0) return '#3b82f6'; // цена
                        if (a === 0 && b > 0) return '#10b981'; // остаток
                        return (b < a) ? '#ef4444' : '#10b981';
                    }
                }]
            },
            options: {
                indexAxis: 'x',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const raw = context.raw;
                                if (!raw || !Array.isArray(raw)) return '';
                                const start = raw[0];
                                const end = raw[1];
                                const delta = end - start;
                                const sign = delta >= 0 ? '+' : '−';
                                const abs = Math.abs(delta);
                                return ` ${sign}${abs.toLocaleString()} ₽ (остаток: ${end.toLocaleString()} ₽)`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#cbd5e1', maxRotation: 0, autoSkip: true },
                        grid: { color: '#475569' }
                    },
                    y: {
                        ticks: {
                            color: '#cbd5e1',
                            callback: function(value) {
                                return value.toLocaleString() + ' ₽';
                            }
                        },
                        grid: { color: '#475569' }
                    }
                }
            }
        });

        // График по периоду (опционально: если canvas есть)
        const periodCanvas = document.getElementById('periodChart');
        if (periodCanvas) {
            const ctx2 = periodCanvas.getContext('2d');
            this.charts.period = new Chart(ctx2, {
                type: 'bar',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Деньги от клиентов',
                            data: [],
                            backgroundColor: '#3b82f6',
                            borderWidth: 0
                        },
                        {
                            label: 'Все расходы',
                            data: [],
                            backgroundColor: '#ef4444',
                            borderWidth: 0
                        },
                        {
                            label: 'Налоги',
                            data: [],
                            backgroundColor: '#f59e0b',
                            borderWidth: 0
                        },
                        {
                            label: 'Тебе остаётся',
                            data: [],
                            backgroundColor: '#10b981',
                            borderWidth: 0
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            labels: { color: '#f8fafc' }
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => `${context.dataset.label}: ${context.parsed.y.toLocaleString()} ₽`
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#cbd5e1' },
                            grid: { color: '#475569' }
                        },
                        y: {
                            ticks: {
                                color: '#cbd5e1',
                                callback: function(value) {
                                    return value.toLocaleString() + ' ₽';
                                }
                            },
                            grid: { color: '#475569' }
                        }
                    }
                }
            });
        }
    }

    updateCharts() {
        // Если графики не инициализированы — выходим (например, если Chart.js отсутствует)
        if (!this.charts || !this.charts.breakdown) return;

        const data = this.getFormData();
        const sales_per_month = parseInt(document.getElementById('chart_sales')?.value) || 0;
        const period = document.getElementById('chart_period')?.value || 'month';

        // Водопад
        this.updateBreakdownChart(data, sales_per_month, period);

        // График по периоду — опционально (если canvas существует)
        if (this.charts.period) {
            this.updatePeriodChart(data, sales_per_month, period);
        }
    }

    
    updateBreakdownChart(data, sales_per_month, period) {
        const periods = { month: 1, quarter: 3, year: 12 };
        const months = periods[period] || 1;

        // режим: на 1 продажу (как раньше) или за период (продажи/мес * период)
        const isPerSale = (this.breakdownMode === 'per_sale');
        const units = isPerSale ? 1 : ((sales_per_month || 0) * months);

        const titleEl = document.getElementById('breakdown_title');
        if (titleEl) {
            titleEl.textContent = isPerSale
                ? 'Куда уходят деньги (на 1 продажу)'
                : `Куда уходят деньги (за ${months} мес при ${sales_per_month || 0} продаж/мес)`;
        }

        const revenue = (data.price || 0) * units;

        // Переменные расходы/налоги на продажу -> за период
        const perSaleExpenses = this.getPerSaleExpenses(data);
        const varItems = perSaleExpenses
            .map(e => ({
                label: e.label,
                value: (e.value || 0) * units,
                type: e.type || 'expense'
            }))
            .filter(e => (e.value || 0) > 0);

        // Фиксированные расходы и налог на прибыль — только в режиме "за период"
        const fixedTotal = isPerSale ? 0 : (Number(this.fixedMonthly) || 0) * months;
        const profitBeforeTax = isPerSale ? 0 : (units * (Number(this.leftPerSale) || 0) - (Number(this.fixedMonthly) || 0) * months);
        const profitTax = isPerSale ? 0 : (Math.max(0, profitBeforeTax) * (Number(this.taxProfitPct) || 0) / 100);

        const labels = [];
        const ranges = [];
        const colors = [];

        // 1) Выручка
        labels.push(isPerSale ? 'Цена (платит клиент)' : 'Выручка (за период)');
        ranges.push([0, revenue]);
        colors.push('#3b82f6');

        let cur = revenue;

        // 2) Переменные статьи
        for (const e of varItems) {
            const next = cur - e.value;
            labels.push(e.label);
            ranges.push([cur, next]);
            colors.push(e.type === 'tax' ? '#f59e0b' : '#ef4444');
            cur = next;
        }

        // 3) Фикс. расходы
        if (!isPerSale && fixedTotal > 0) {
            const next = cur - fixedTotal;
            labels.push('Фикс. расходы (за период)');
            ranges.push([cur, next]);
            colors.push('#ef4444');
            cur = next;
        }

        // 4) Налог на прибыль
        if (!isPerSale && profitTax > 0) {
            const next = cur - profitTax;
            labels.push('Налог на прибыль');
            ranges.push([cur, next]);
            colors.push('#f59e0b');
            cur = next;
        }

        // 5) Итог
        const finalLabel = isPerSale ? 'Тебе остаётся' : (cur >= 0 ? 'Тебе остаётся (за период)' : 'Минус (за период)');
        labels.push(finalLabel);
        ranges.push([0, cur]);
        colors.push(cur >= 0 ? '#10b981' : '#ef4444');

        // Прокинем цвета в chart instance, чтобы backgroundColor мог их читать
        this.charts.breakdown.$waterfallMeta = { colors };
        this.charts.breakdown.data.labels = labels;
        this.charts.breakdown.data.datasets[0].data = ranges;
        this.charts.breakdown.update();
    }

    updatePeriodChart(data, sales_per_month, period) {
        const periods = { month: 1, quarter: 3, year: 12 };
        const months = periods[period];
        
        const labels = [];
        const revenue_data = [];
        const expenses_data = [];
        const taxes_data = [];
        const profit_data = [];
        
        for (let i = 1; i <= months; i++) {
            labels.push(`Месяц ${i}`);
            
            const monthly_revenue = sales_per_month * data.price;
            const monthly_expenses = sales_per_month * (data.price - this.leftPerSale) + this.fixedMonthly;
            const profit_before_tax = sales_per_month * this.leftPerSale - this.fixedMonthly;
            const profit_tax = Math.max(0, profit_before_tax) * this.taxProfitPct / 100;
            const net_profit = profit_before_tax - profit_tax;
            
            revenue_data.push(monthly_revenue);
            expenses_data.push(monthly_expenses - profit_tax);
            taxes_data.push(profit_tax);
            profit_data.push(net_profit);
        }
        
        this.charts.period.data.labels = labels;
        this.charts.period.data.datasets[0].data = revenue_data;
        this.charts.period.data.datasets[1].data = expenses_data;
        this.charts.period.data.datasets[2].data = taxes_data;
        this.charts.period.data.datasets[3].data = profit_data;
        this.charts.period.update();
    }

    // TREEMAP: "Где течёт"
    updateTreemap() {
        const container = document.getElementById('treemap_container');
        if (!container) return;

        // Если вкладка закрыта, размеры могут быть 0 — отложим.
        const rect = container.getBoundingClientRect();
        if (rect.width < 50 || rect.height < 50) return;

        const data = this.getFormData();
        const noteEl = document.getElementById('treemap_note');
        if (noteEl) noteEl.textContent = '';

        let items = [];
        if (this.treemapMode === 'per_month') {
            const result = this.buildTreemapItemsPerMonth(data);
            items = result.items;
            if (noteEl) noteEl.innerHTML = result.noteHtml || '';
        } else {
            const result = this.buildTreemapItemsPerSale(data);
            items = result.items;
            if (noteEl) noteEl.innerHTML = result.noteHtml || '';
        }

        this.renderTreemap(container, items);
    }

    buildTreemapItemsPerSale(data) {
        const expenses = this.getPerSaleExpenses(data);
        const total_per_sale = expenses.reduce((s, e) => s + (Number(e.value) || 0), 0);
        const left = data.price - total_per_sale;

        const items = [];
        expenses
            .filter(e => (Number(e.value) || 0) > 0)
            .forEach(e => {
                const kind = (e.label.includes('Налог') || e.label.includes('Потери') || e.label.includes('Скид')) ? 'tax' : 'expense';
                items.push({ label: e.label, value: Number(e.value) || 0, kind });
            });

        let noteHtml = '';
        if (left >= 0) {
            items.push({ label: 'Тебе остаётся', value: left, kind: 'profit' });
        } else {
            items.push({ label: 'Минус (дырка)', value: Math.abs(left), kind: 'deficit' });
            noteHtml = `С одной продажи ты <strong style="color:var(--danger)">теряешь ${this.formatNumber(Math.abs(left))} ₽</strong>.`;
        }

        return { items, noteHtml };
    }

    buildTreemapItemsPerMonth(data) {
        const sales = (data.current_sales_type === 'day') ? (data.current_sales * 30) : data.current_sales;
        const expensesPerSale = this.getPerSaleExpenses(data);

        // Переменные расходы в месяц
        const items = [];
        expensesPerSale
            .filter(e => (Number(e.value) || 0) > 0)
            .forEach(e => {
                const kind = (e.label.includes('Налог') || e.label.includes('Потери') || e.label.includes('Скид')) ? 'tax' : 'expense';
                items.push({ label: e.label, value: (Number(e.value) || 0) * sales, kind });
            });

        // Фиксированные расходы по категориям
        const fixed = [
            { label: 'Аренда', value: data.rent },
            { label: 'Зарплаты', value: data.salaries },
            { label: 'Реклама', value: data.advertising },
            { label: 'Сервисы/связь', value: data.services },
            { label: 'Кредит/лизинг', value: data.credit },
            { label: 'Прочие', value: data.other },
        ].filter(x => (Number(x.value) || 0) > 0);
        fixed.forEach(e => items.push({ label: e.label, value: Number(e.value) || 0, kind: 'expense' }));

        // Фикс. налог/взносы, если включён
        let fixedTaxMonthly = 0;
        if (data.fixed_tax_enable && data.fixed_tax_amount > 0) {
            const periods = { month: 1, quarter: 3, year: 12 };
            fixedTaxMonthly = data.fixed_tax_amount / periods[data.fixed_tax_period];
            if (fixedTaxMonthly > 0) items.push({ label: 'Фикс. налог/взносы', value: fixedTaxMonthly, kind: 'tax' });
        }

        // Налог на прибыль
        const profitBeforeTax = this.leftPerSale * sales - this.fixedMonthly;
        const profitTax = Math.max(0, profitBeforeTax) * this.taxProfitPct / 100;
        if (profitTax > 0) items.push({ label: 'Налог на прибыль', value: profitTax, kind: 'tax' });

        const netProfit = profitBeforeTax - profitTax;
        let noteHtml = `Текущий объём: <strong>${sales}</strong> продаж/мес.`;
        if (netProfit >= 0) {
            items.push({ label: 'Тебе остаётся', value: netProfit, kind: 'profit' });
        } else {
            items.push({ label: 'Минус (дырка)', value: Math.abs(netProfit), kind: 'deficit' });
            noteHtml += ` • Сейчас ты <strong style="color:var(--danger)">в минусе на ${this.formatNumber(Math.abs(netProfit))} ₽/мес</strong>.`;
        }

        return { items, noteHtml };
    }

    renderTreemap(container, items) {
        container.innerHTML = '';

        const valid = (items || []).filter(i => (Number(i.value) || 0) > 0);
        if (!valid.length) {
            container.innerHTML = '<div class="hint">Нет данных для карты — заполни хотя бы цену и один расход.</div>';
            return;
        }

        // Сортируем по убыванию, так карта выглядит читабельнее
        valid.sort((a, b) => (b.value || 0) - (a.value || 0));

        const total = valid.reduce((s, i) => s + i.value, 0);
        const w = container.clientWidth;
        const h = container.clientHeight;


        // Список точных значений под картой (когда квадраты маленькие)
        const listEl = document.getElementById('treemap_list');
        if (listEl) {
            listEl.innerHTML = '';
            valid.forEach(i => {
                const pct = (i.value / total) * 100;
                const row = document.createElement('div');
                row.className = `tm-row ${i.kind || 'expense'}`;
                row.innerHTML = `
                    <span class="tm-dot"></span>
                    <span class="tm-name">${i.label}</span>
                    <span class="tm-val">${this.formatNumber(i.value)} ₽</span>
                    <span class="tm-pct">${pct.toFixed(1)}%</span>
                `;
                listEl.appendChild(row);
            });
        }
        let x = 0, y = 0, rw = w, rh = h;
        valid.forEach((i) => {
            const area = (i.value / total) * w * h;
            let iw = 0, ih = 0;
            if (rw >= rh) {
                ih = rh;
                iw = Math.max(2, area / Math.max(1, rh));
                iw = Math.min(iw, rw);
            } else {
                iw = rw;
                ih = Math.max(2, area / Math.max(1, rw));
                ih = Math.min(ih, rh);
            }

            const el = document.createElement('div');
            el.className = `treemap-item ${i.kind || 'expense'}`;
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
            el.style.width = `${Math.max(2, iw)}px`;
            el.style.height = `${Math.max(2, ih)}px`;

            const pct = (i.value / total) * 100;

            // Управление текстом на маленьких квадратах:
            // если места мало — прячем текст, оставляем tooltip.
            const areaPx = (iw * ih);
            const minSide = Math.min(iw, ih);
            let textMode = 'full';
            if (areaPx < 2400 || minSide < 38) textMode = 'none';
            else if (areaPx < 6500 || minSide < 55) textMode = 'value';

            if (textMode === 'none') {
                el.classList.add('tm-hide-text', 'tm-compact');
                el.innerHTML = '';
            } else if (textMode === 'value') {
                el.classList.add('tm-value-only', 'tm-compact');
                el.innerHTML = `
                    <div class="tm-sub">${this.formatNumber(i.value)} ₽ • ${pct.toFixed(1)}%</div>
                `;
            } else {
                el.innerHTML = `
                    <div class="tm-label">${i.label}</div>
                    <div class="tm-sub">${this.formatNumber(i.value)} ₽ • ${pct.toFixed(1)}%</div>
                `;
            }
el.title = `${i.label}: ${this.formatNumber(i.value)} ₽ (${pct.toFixed(1)}%)`;
            container.appendChild(el);

            // Сдвигаем "оставшийся прямоугольник"
            if (rw >= rh) {
                x += iw;
                rw -= iw;
            } else {
                y += ih;
                rh -= ih;
            }
        });
    }

    // УТИЛИТЫ
    formatNumber(num) {
        return num.toLocaleString('ru-RU', { 
            minimumFractionDigits: 0, 
            maximumFractionDigits: 2 
        });
    }


    updatePriceSliderRange(price) {
        const slider = document.getElementById('price_slider');
        if (!slider) return;
        const p = Number(price) || 0;
        const newMax = Math.max(200000, Math.ceil((p * 2) / 100) * 100);
        slider.max = String(newMax);
        slider.step = String(p > 50000 ? 500 : (p > 20000 ? 200 : 100));
    }



    clamp(num, min, max) {
        const n = Number(num);
        if (Number.isNaN(n)) return min;
        return Math.min(max, Math.max(min, n));
    }

    setFieldValue(id, value) {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.type === 'checkbox') {
            el.checked = Boolean(value);
            el.dispatchEvent(new Event('change'));
        } else {
            el.value = value;
            el.dispatchEvent(new Event('change'));
        }
    }

    applyPreset(name) {
        const presets = {
            marketplace: {
                price: 1500,
                unit_cost: 600,
                commissions_type: 'percent',
                commissions: 15,
                shipping: 160,
                shipping_transit: false,
                packing: 40,
                loss_pct: 5,
                mp_fulfillment: 45,
                mp_storage: 20,
                mp_lastmile: 0,
                mp_discount_pct: 0,
                tax_rev_enable: true,
                tax_rev_pct: 6,
                tax_profit_enable: false,
                tax_profit_pct: 0,
                fixed_tax_enable: false,
                fixed_tax_amount: 0,
                fixed_tax_period: 'month',
                rent: 0,
                salaries: 0,
                advertising: 15000,
                services: 0,
                credit: 0,
                other: 0,
                target_profit: 100000,
                current_sales_type: 'month',
                current_sales: 50,
            },
            services: {
                price: 3000,
                unit_cost: 800,
                commissions_type: 'fixed',
                commissions: 0,
                shipping: 0,
                shipping_transit: true,
                packing: 0,
                loss_pct: 2,
                mp_fulfillment: 0,
                mp_storage: 0,
                mp_lastmile: 0,
                mp_discount_pct: 0,
                tax_rev_enable: true,
                tax_rev_pct: 6,
                tax_profit_enable: false,
                tax_profit_pct: 0,
                fixed_tax_enable: false,
                fixed_tax_amount: 0,
                fixed_tax_period: 'month',
                rent: 15000,
                salaries: 0,
                advertising: 20000,
                services: 2000,
                credit: 0,
                other: 3000,
                target_profit: 120000,
                current_sales_type: 'month',
                current_sales: 30,
            },
        };

        if (!presets[name]) return;
        const p = presets[name];

        Object.keys(p).forEach((k) => this.setFieldValue(k, p[k]));

        // Синхронизировать ползунок цены
        this.updatePriceSliderRange(p.price);
        const priceSlider = document.getElementById('price_slider');
        if (priceSlider) {
            const maxVal = parseInt(priceSlider.max) || 200000;
            priceSlider.value = Math.min(p.price, maxVal);
        }
    }

    // ПОДЕЛИТЬСЯ ССЫЛКОЙ (без сервера)
    copyShareLink() {
        const data = this.getFormData();
        const payload = {
            v: 1,
            exported_at: new Date().toISOString(),
            data,
        };

        const json = JSON.stringify(payload);
        // base64 safe for unicode
        const b64 = btoa(unescape(encodeURIComponent(json)));
        const url = `${window.location.origin}${window.location.pathname}#d=${encodeURIComponent(b64)}`;

        const ok = () => alert('Ссылка скопирована ✅\nОтправь её партнёру/клиенту — у него откроются твои цифры.');
        const fallback = () => {
            prompt('Скопируй ссылку вручную:', url);
        };

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(url).then(ok).catch(fallback);
        } else {
            fallback();
        }
    }

    tryLoadFromShareHash() {
        try {
            const hash = String(window.location.hash || '');
            const m = hash.match(/(?:^#|[&#])d=([^&]+)/);
            if (!m) return false;

            const b64 = decodeURIComponent(m[1]);
            const json = decodeURIComponent(escape(atob(b64)));
            const obj = JSON.parse(json);
            const data = obj.data || obj;

            this.fillFormFromObject(data);
            this.calculateAll();
            this.saveToStorage();
            // Дадим сигнал пользователю, что он открылся по ссылке
            const note = document.querySelector('.topbar-note');
            if (note) note.textContent = 'Открыто по ссылке "Поделиться" — данные сохранены у тебя в браузере.';
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    }

    exportJSON() {
        const data = this.getFormData();
        const payload = {
            meta: {
                exported_at: new Date().toISOString(),
                app: 'OKComputer Business Calculator',
                version: 'ux_plus_pack_1',
            },
            data,
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dt = new Date();
        const stamp = dt.toISOString().slice(0, 10);
        a.href = url;
        a.download = `business-calculator-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    importJSON(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const obj = JSON.parse(String(reader.result || '{}'));
                const data = obj.data || obj; // поддержка "чистого" формата
                this.fillFormFromObject(data);
                this.calculateAll();
                this.saveToStorage();
                this.updateCharts();
                alert('Импорт выполнен ✅');
            } catch (e) {
                console.error(e);
                alert('Не получилось импортировать файл. Проверь, что это JSON из калькулятора.');
            }
        };
        reader.readAsText(file);
    }

    fillFormFromObject(data) {
        if (!data || typeof data !== 'object') return;
        Object.keys(data).forEach((key) => {
            const element = document.getElementById(key);
            if (!element) return;

            if (element.type === 'checkbox') {
                element.checked = Boolean(data[key]);
                element.dispatchEvent(new Event('change'));
            } else if (element.tagName === 'SELECT') {
                element.value = data[key];
                element.dispatchEvent(new Event('change'));
            } else {
                element.value = data[key] ?? '';
                element.dispatchEvent(new Event('change'));
            }

            if (key === 'price' && Number(data[key]) > 0) {
                const priceSlider = document.getElementById('price_slider');
                if (priceSlider) {
                    this.updatePriceSliderRange(data[key]);
                    const maxVal = parseInt(priceSlider.max) || 200000;
                    priceSlider.value = Math.min(Number(data[key]), maxVal);
                }
            }
        });
    }

    getPerSaleExpenses(data) {
        const expenses = [];

        expenses.push({ key: 'unit_cost', label: 'Стоимость товара/услуги', value: data.unit_cost, type: 'expense' });

        const commission_amount = data.commissions_type === 'percent'
            ? data.price * data.commissions / 100
            : data.commissions;
        expenses.push({ key: 'commissions', label: 'Комиссии', value: commission_amount, type: 'expense' });

        // Доставка: если "транзит" (клиент платит отдельно) — НЕ считаем как расход
        if (!data.shipping_transit) {
            expenses.push({ key: 'shipping', label: 'Доставка/логистика', value: data.shipping, type: 'expense' });
        }

        // Реклама на 1 продажу (CAC)
        if ((data.ad_per_sale || 0) > 0) {
            expenses.push({ key: 'ad_per_sale', label: 'Реклама (CAC)', value: data.ad_per_sale, type: 'expense' });
        }

        expenses.push({ key: 'packing', label: 'Упаковка/расходники', value: data.packing, type: 'expense' });

        if (data.mp_fulfillment > 0) expenses.push({ key: 'mp_fulfillment', label: 'Фулфилмент/сборка', value: data.mp_fulfillment, type: 'expense' });
        if (data.mp_storage > 0) expenses.push({ key: 'mp_storage', label: 'Хранение/услуги площадки', value: data.mp_storage, type: 'expense' });
        if (data.mp_lastmile > 0) expenses.push({ key: 'mp_lastmile', label: 'Последняя миля/доставка МП', value: data.mp_lastmile, type: 'expense' });

        const discount_amount = data.price * data.mp_discount_pct / 100;
        if (discount_amount > 0) expenses.push({ key: 'discount', label: 'Скидки/акции', value: discount_amount, type: 'tax' });

        const loss_amount = data.price * data.loss_pct / 100;
        if (loss_amount > 0) expenses.push({ key: 'loss', label: 'Потери (возвраты/брак)', value: loss_amount, type: 'tax' });

        if (data.tax_rev_enable && data.tax_rev_pct > 0) {
            const tax_rev_amount = data.price * data.tax_rev_pct / 100;
            expenses.push({ key: 'tax_rev', label: 'Налог с продаж', value: tax_rev_amount, type: 'tax' });
        }
        return expenses;
    }

    printReport() {
        const data = this.getFormData();
        const current_sales_monthly = data.current_sales_type === 'day' ? data.current_sales * 30 : data.current_sales;
        const current_profit = this.calculateNetProfit(current_sales_monthly);

        const bad_sales = Math.floor(current_sales_monthly * 0.7);
        const good_sales = Math.ceil(current_sales_monthly * 1.3);
        const bad_profit = this.calculateNetProfit(bad_sales);
        const good_profit = this.calculateNetProfit(good_sales);

        const break_even_sales = (this.leftPerSale > 0) ? Math.ceil(this.fixedMonthly / this.leftPerSale) : Infinity;

        let target_sales = Infinity;
        if (this.leftPerSale > 0 && data.target_profit > 0) {
            target_sales = (this.taxProfitPct === 0)
                ? Math.ceil((this.fixedMonthly + data.target_profit) / this.leftPerSale)
                : this.findSalesForTarget(data.target_profit);
        }

        const expenses = this.getPerSaleExpenses(data);
        const html = this.buildReportHtml({
            data,
            expenses,
            current_sales_monthly,
            current_profit,
            break_even_sales,
            target_sales,
            bad_sales,
            good_sales,
            bad_profit,
            good_profit,
        });

        const w = window.open('', '_blank');
        if (!w) {
            alert('Браузер заблокировал окно печати. Разреши всплывающие окна и попробуй снова.');
            return;
        }
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
        w.print();
    }

    buildReportHtml(ctx) {
        const { data, expenses } = ctx;
        const total_per_sale = expenses.reduce((s, e) => s + (Number(e.value) || 0), 0);
        const left = data.price - total_per_sale;
        const now = new Date();

        const row = (k, v) => `<tr><td>${k}</td><td style="text-align:right">${v}</td></tr>`;

        const expRows = expenses
            .filter(e => (Number(e.value) || 0) > 0)
            .sort((a,b) => b.value - a.value)
            .map(e => row(e.label, `${this.formatNumber(e.value)} ₽`))
            .join('');

        const styles = `
            <style>
                body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#0b1220}
                h1{margin:0 0 8px 0}
                .meta{color:#475569;margin-bottom:18px}
                .card{border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin:12px 0}
                .big{font-size:28px;font-weight:800}
                table{width:100%;border-collapse:collapse}
                td{padding:8px;border-bottom:1px solid #e2e8f0}
                .muted{color:#475569}
                .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
                .pill{display:inline-block;padding:6px 10px;border-radius:999px;background:#f1f5f9;font-weight:700}
                .pos{color:#059669}
                .neg{color:#dc2626}
                .zero{color:#d97706}
                @media print{button{display:none}}
            </style>
        `;

        const badge = (num) => {
            if (num > 0) return `<span class="pill pos">В плюс</span>`;
            if (num < 0) return `<span class="pill neg">В минус</span>`;
            return `<span class="pill zero">В ноль</span>`;
        };

        return `<!doctype html><html><head><meta charset="utf-8"><title>Отчёт</title>${styles}</head><body>
            <h1>Отчёт по бизнес-расчёту</h1>
            <div class="meta">Сформировано: ${now.toLocaleString('ru-RU')}</div>

            <div class="card">
                <div class="muted">С одной продажи остаётся</div>
                <div class="big">${this.formatNumber(left)} ₽</div>
            </div>

            <div class="grid">
                <div class="card">
                    <div class="muted">Фиксированные расходы (в месяц)</div>
                    <div class="big">${this.formatNumber(this.fixedMonthly)} ₽</div>
                </div>
                <div class="card">
                    <div class="muted">Точка безубыточности</div>
                    <div class="big">${ctx.break_even_sales === Infinity ? '∞' : ctx.break_even_sales} продаж/мес</div>
                </div>
                <div class="card">
                    <div class="muted">Цель</div>
                    <div class="big">${this.formatNumber(data.target_profit)} ₽</div>
                    <div class="muted">Нужно: <strong>${typeof ctx.target_sales === 'number' ? ctx.target_sales : '∞'}</strong> продаж/мес</div>
                </div>
            </div>

            <div class="card">
                <div class="muted">Текущая прибыль при ${ctx.current_sales_monthly} продаж/мес</div>
                <div class="big">${this.formatNumber(ctx.current_profit)} ₽ ${badge(ctx.current_profit)}</div>
            </div>

            <div class="card">
                <h3 style="margin:0 0 10px 0">Сценарии от текущего объёма</h3>
                <table>
                    ${row(`Плохо (−30%) — ${ctx.bad_sales} продаж/мес`, `${this.formatNumber(ctx.bad_profit)} ₽`)}
                    ${row(`База — ${ctx.current_sales_monthly} продаж/мес`, `${this.formatNumber(ctx.current_profit)} ₽`)}
                    ${row(`Хорошо (+30%) — ${ctx.good_sales} продаж/мес`, `${this.formatNumber(ctx.good_profit)} ₽`)}
                </table>
            </div>

            <div class="card">
                <h3 style="margin:0 0 10px 0">Куда уходят деньги с одной продажи</h3>
                <table>
                    ${expRows}
                    ${row('<strong>Итого расходов</strong>', `<strong>${this.formatNumber(total_per_sale)} ₽</strong>`)}
                    ${row('<strong>Остаётся</strong>', `<strong>${this.formatNumber(left)} ₽</strong>`)}
                </table>
                <p class="muted" style="margin-top:10px">Примечание: это расчёт-ориентир. Реальность может отличаться из-за сезонности, кассовых разрывов, возвратов и колебаний рекламы.</p>
            </div>

        </body></html>`;
    }


    // LOCALSTORAGE
    saveToStorage() {
        const data = this.getFormData();
        localStorage.setItem('businessCalculator', JSON.stringify(data));
    }

    loadFromStorage() {
        const saved = localStorage.getItem('businessCalculator');
        if (!saved) return;
        
        try {
            const data = JSON.parse(saved);
            
            // Заполнить поля
            Object.keys(data).forEach(key => {
                const element = document.getElementById(key);
                if (element) {
                    if (element.type === 'checkbox') {
                        element.checked = data[key];
                        // Триггерить событие change для включения/выключения зависимых полей
                        element.dispatchEvent(new Event('change'));
                    } else if (element.tagName === 'SELECT') {
                        element.value = data[key];
                    } else {
                        // ВАЖНО: не используем "|| ''", иначе 0 (ноль) теряется при восстановлении.
                        element.value = (data[key] ?? '');
                    }
                }
                
                // Синхронизировать ползунок цены
                if (key === 'price' && data[key] > 0) {
                    const priceSlider = document.getElementById('price_slider');
                    if (priceSlider) {
                        this.updatePriceSliderRange(data[key]);
                        const maxVal = parseInt(priceSlider.max) || 200000;
                        priceSlider.value = Math.min(data[key], maxVal);
                    }
                }
            });
        } catch (e) {
            console.error('Ошибка загрузки данных:', e);
        }
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    new BusinessCalculator();
});