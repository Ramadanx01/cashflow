/* ==========================================================================
   Axis & Fawry Cashflow Manager - Clean Business & Security System
   ========================================================================== */

const DEFAULT_SETTINGS = {
  customerRate: 1.0,  // 1% = 10 EGP per 1000 EGP
  fawryRate: 0.57,    // 0.57% = 5.70 EGP per 1000 EGP
  newWalletMonths: 3,
  newWalletDailyLimit: 10000,
  newWalletMonthlyLimit: 60000,
  standardWalletDailyLimit: 60000,
  standardWalletMonthlyLimit: 200000,
  yellowCardDailyLimit: 60000,
  yellowCardMonthlyLimit: 200000,
  walletWarningPercent: 80,
  cardWarningPercent: 80,
  safeDailyLimit: 35000,
  dangerDailyLimit: 45000,
  safeMonthlyLimit: 140000,
  dangerMonthlyLimit: 160000
};

const DEFAULT_WALLETS = [];

let appState = {
  wallets: [],
  transactions: [],
  notes: [],
  settings: { ...DEFAULT_SETTINGS },
  currentFilter: 'all'
};
let walletUpgradePromptTimer = null;
let storageWriteFailureShown = false;
let storageReady = false;

document.addEventListener('DOMContentLoaded', async () => {
  document.body.inert = true;
  try {
    const savedData = await CashflowStorage.initialize();
    appState.wallets = savedData.wallets;
    appState.transactions = savedData.transactions;
    appState.notes = savedData.notes;
    appState.settings = { ...DEFAULT_SETTINGS, ...savedData.settings };
    storageReady = true;
  } catch (error) {
    console.error('IndexedDB initialization or legacy migration failed:', error);
    storageWriteFailureShown = true;
    loadFromLocalStorage();
    Swal.fire({
      icon: 'error',
      title: 'تعذر فتح التخزين المحلي',
      text: 'لم يتم حذف بياناتك القديمة. تحقق من مساحة التخزين أو افتح التطبيق في متصفح يدعم IndexedDB قبل إجراء تعديلات.'
    });
  }
  appState.wallets.forEach(wallet => {
    if (wallet.hasWallet === undefined) wallet.hasWallet = true;
    if (!wallet.limitTier) wallet.limitTier = 'standard';
    if (!wallet.activationDate && wallet.hasWallet) wallet.activationDate = wallet.createdAt || null;
  });
  recalculateWalletBalances();
  restoreWalletsSectionState();
  renderAll();
  document.body.inert = false;
});

// --- LocalStorage Operations ---
function loadFromLocalStorage() {
  try {
    const savedWallets = localStorage.getItem('axis_wallets');
    const savedTx = localStorage.getItem('axis_transactions');
    const savedNotes = localStorage.getItem('axis_notes');
    const savedSettings = localStorage.getItem('axis_settings');

    appState.wallets = savedWallets ? JSON.parse(savedWallets) : [];
    appState.wallets.forEach(wallet => {
      if (wallet.hasWallet === undefined) wallet.hasWallet = true;
      if (!wallet.limitTier) wallet.limitTier = 'standard';
      if (!wallet.activationDate && wallet.hasWallet) wallet.activationDate = wallet.createdAt || null;
    });
    appState.transactions = savedTx ? JSON.parse(savedTx) : [];
    appState.notes = savedNotes ? JSON.parse(savedNotes) : [];
    appState.settings = savedSettings ? { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) } : { ...DEFAULT_SETTINGS };

    recalculateWalletBalances();
  } catch (e) {
    console.error('Error loading data:', e);
    appState.wallets = [];
    appState.transactions = [];
    appState.notes = [];
    appState.settings = { ...DEFAULT_SETTINGS };
  }
}

function saveToLocalStorage() {
  if (!storageReady) return Promise.resolve();
  const snapshot = {
    wallets: appState.wallets,
    transactions: appState.transactions,
    notes: appState.notes,
    settings: appState.settings
  };
  return CashflowStorage.replaceSnapshot(snapshot).catch(error => {
    console.error('Unable to persist application data:', error);
    if (!storageWriteFailureShown) {
      storageWriteFailureShown = true;
      Swal.fire({ icon: 'error', title: 'تعذر حفظ البيانات', text: 'لم يكتمل الحفظ في قاعدة البيانات المحلية. لا تغلق التطبيق قبل المحاولة مجددًا.' });
    }
  });
}

// Recalculate Wallet Balance: Initial Balance + Incomes - Expenses
function recalculateWalletBalances() {
  appState.wallets.forEach(w => {
    let bal = parseFloat(w.initialBalance || 0);
    appState.transactions.forEach(tx => {
      if (tx.walletId === w.id) {
        if (tx.type === 'income') bal += tx.amount;
        else if (tx.type === 'expense') bal -= tx.amount;
        else if (tx.type === 'card_transfer') bal -= tx.amount + (tx.serviceFee || 0);
      }
    });
    w.balance = Math.round((bal + Number.EPSILON) * 100) / 100;
  });
}

function walletHasWallet(wallet) {
  return wallet.hasWallet !== false;
}

function walletLimitTier(wallet) {
  return wallet.limitTier === 'new' ? 'new' : 'standard';
}

function walletLimits(wallet) {
  const isNew = walletLimitTier(wallet) === 'new';
  return {
    daily: Number(wallet.dailyLimit) || Number(isNew ? appState.settings.newWalletDailyLimit : appState.settings.standardWalletDailyLimit),
    monthly: Number(wallet.monthlyLimit) || Number(isNew ? appState.settings.newWalletMonthlyLimit : appState.settings.standardWalletMonthlyLimit)
  };
}

function addMonths(dateInput, months) {
  const date = new Date(dateInput);
  const day = date.getDate();
  date.setMonth(date.getMonth() + months);
  if (date.getDate() < day) date.setDate(0);
  return date;
}

function isWalletUpgradeDue(wallet, now = new Date()) {
  return walletHasWallet(wallet) && walletLimitTier(wallet) === 'new' && wallet.activationDate &&
    now >= addMonths(wallet.activationDate, Number(appState.settings.newWalletMonths) || 3);
}

function renderAll() {
  recalculateWalletBalances();
  renderNavWalletCount();
  renderNotebookCount();
  renderSummaryCards();
  renderWalletsGrid();
  renderTransactions();
  scheduleDueWalletUpgradePrompt();
}

function renderNotebookCount() {
  const count = document.getElementById('sidebar-notebook-count');
  if (count) count.textContent = appState.notes.length;
}

function renderNavWalletCount() {
  const badge = document.getElementById('nav-wallet-count');
  if (badge) {
    badge.textContent = appState.wallets.filter(walletHasWallet).length;
  }
}

function restoreWalletsSectionState() {
  const isCollapsed = localStorage.getItem('axis_wallets_collapsed') === 'true';
  setWalletsSectionState(isCollapsed);
}

function setWalletsSectionState(isCollapsed) {
  const grid = document.getElementById('wallets-grid');
  const toggleButton = document.getElementById('wallets-toggle-btn');
  if (!grid || !toggleButton) return;

  grid.classList.toggle('wallets-grid-collapsed', isCollapsed);
  toggleButton.setAttribute('aria-expanded', String(!isCollapsed));
  toggleButton.innerHTML = isCollapsed
    ? '<i class="uil uil-angle-down me-1"></i><span>عرض المحافظ</span>'
    : '<i class="uil uil-angle-up me-1"></i><span>إخفاء</span>';
}

function toggleWalletsSection() {
  const grid = document.getElementById('wallets-grid');
  if (!grid) return;

  const isCollapsed = !grid.classList.contains('wallets-grid-collapsed');
  localStorage.setItem('axis_wallets_collapsed', String(isCollapsed));
  setWalletsSectionState(isCollapsed);
}

// --- Egyptian Timezone Date Calculation ---
function getCairoDateParts(dateInput = new Date()) {
  const date = new Date(dateInput);
  const cairoDateStr = date.toLocaleDateString('en-US', { timeZone: 'Africa/Cairo' });
  const [month, day, year] = cairoDateStr.split('/').map(Number);
  return { year, month, day, dateStr: `${year}-${month}-${day}` };
}

function getFilteredTransactions() {
  const nowCairo = getCairoDateParts(new Date());
  const filter = appState.currentFilter;
  const search = (document.getElementById('search-input')?.value || '').trim().toLowerCase();

  return appState.transactions.filter(tx => {
    const txCairo = getCairoDateParts(tx.date);
    let matchTime = true;

    if (filter === 'today') {
      matchTime = txCairo.dateStr === nowCairo.dateStr;
    } else if (filter === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      matchTime = new Date(tx.date) >= weekAgo;
    } else if (filter === 'month') {
      matchTime = txCairo.month === nowCairo.month && txCairo.year === nowCairo.year;
    }

    let matchSearch = true;
    if (search) {
      const wallet = appState.wallets.find(w => w.id === tx.walletId);
      const walletName = (wallet ? wallet.name : '').toLowerCase();
      const walletCard = wallet ? wallet.cardNumber : '';
      const notes = (tx.notes || '').toLowerCase();
      const amountStr = tx.amount.toString();
      matchSearch = walletName.includes(search) || walletCard.includes(search) || notes.includes(search) || amountStr.includes(search);
    }

    return matchTime && matchSearch;
  });
}

function setFilter(filterType) {
  appState.currentFilter = filterType;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    if (btn.getAttribute('data-filter') === filterType) {
      btn.className = 'btn btn-primary btn-sm px-3 filter-btn active';
    } else {
      btn.className = 'btn btn-outline-secondary btn-sm px-3 filter-btn';
    }
  });
  renderAll();
}

function renderSummaryCards() {
  const filtered = getFilteredTransactions();

  let income = 0;
  let expense = 0;
  let profit = 0;

  filtered.forEach(tx => {
    if (tx.type === 'income') {
      income += tx.amount;
      profit += (tx.netProfit || 0);
    } else if (tx.type === 'expense') {
      expense += tx.amount;
    } else if (tx.type === 'card_transfer') {
      expense += tx.amount + (tx.serviceFee || 0);
      // The service fee paid to Fawry on a wallet → card transfer is a pure
      // cost with no matching customer commission, so it must reduce net profit too.
      profit += (tx.netProfit || 0);
    }
  });

  const totalWalletBalance = appState.wallets.reduce((sum, w) => sum + (walletHasWallet(w) ? (w.balance || 0) : 0), 0);

  document.getElementById('total-income').textContent = formatMoney(income);
  document.getElementById('total-expense').textContent = formatMoney(expense);
  document.getElementById('net-balance').textContent = formatMoney(totalWalletBalance);
  document.getElementById('total-profit').textContent = formatMoney(profit);
}

// --- Render Wallets Grid ---
function renderWalletsGrid() {
  const grid = document.getElementById('wallets-grid');
  if (!grid) return;

  if (appState.wallets.length === 0) {
    grid.innerHTML = `
      <div class="col-12 text-center py-4 bg-white rounded border border-dashed shadow-sm">
        <i class="uil uil-mobile-android fs-1 text-primary d-block mb-2"></i>
        <h6 class="fw-bold text-dark">لا توجد محافظ مسجلة حالياً</h6>
        <p class="small text-muted mb-3">يمكنك إضافة أول محفظة مع رصيدها الافتتاحي يدوياً الآن للبدء في تسجـيل المعاملات</p>
        <button class="btn btn-primary btn-sm fw-bold px-4" onclick="openWalletsModal()">
          <i class="uil uil-plus-circle me-1"></i> إضافة محفظة جديدة
        </button>
      </div>
    `;
    return;
  }

  const nowCairo = getCairoDateParts(new Date());

  grid.innerHTML = appState.wallets.map(w => {
    if (!walletHasWallet(w)) {
      return `
        <div class="col-md-4 col-sm-6">
          <div class="wallet-card-box wallet-line-inactive shadow-sm">
            <div class="d-flex justify-content-between align-items-start gap-2">
              <div>
                <h6 class="fw-bold mb-1">${escapeHtml(w.name)}</h6>
                <span class="yellow-card-badge"><i class="uil uil-credit-card me-1"></i>بطاقة ${displayCard(w.cardNumber)}</span>
                <div class="small text-muted mt-2">لا توجد محفظة مفعلة على هذا الخط</div>
                ${w.cardNumber ? `<div class="small text-info mt-1">حد الكارت: ${formatMoney(w.cardDailyLimit || appState.settings.yellowCardDailyLimit)} يومياً / ${formatMoney(w.cardMonthlyLimit || appState.settings.yellowCardMonthlyLimit)} شهرياً</div>` : ''}
              </div>
              <button class="btn btn-sm btn-outline-primary" onclick="openEditSingleWalletModal('${escapeHtml(w.id)}')" title="تعديل الخط"><i class="uil uil-edit"></i></button>
            </div>
          </div>
        </div>
      `;
    }

    let monthlyUsage = 0;
    let dailyUsage = 0;
    let cardMonthlyUsage = 0;
    let cardDailyUsage = 0;

    appState.transactions.forEach(tx => {
      if (tx.walletId === w.id && tx.type === 'income') {
        const txCairo = getCairoDateParts(tx.date);
        if (txCairo.month === nowCairo.month && txCairo.year === nowCairo.year) {
          monthlyUsage += tx.amount;
        }
        if (txCairo.dateStr === nowCairo.dateStr) {
          dailyUsage += tx.amount;
        }
      }
      if (tx.walletId === w.id && tx.type === 'card_transfer') {
        const txCairo = getCairoDateParts(tx.date);
        if (txCairo.month === nowCairo.month && txCairo.year === nowCairo.year) cardMonthlyUsage += tx.amount;
        if (txCairo.dateStr === nowCairo.dateStr) cardDailyUsage += tx.amount;
      }
    });

    const limits = walletLimits(w);
    const dailyLimitVal = limits.daily;
    const monthlyLimitVal = limits.monthly;
    const warnDaily = w.warnDailyLimit || Math.round(dailyLimitVal * (appState.settings.walletWarningPercent / 100));
    const dangerDaily = dailyLimitVal;
    const cardDailyLimit = Number(w.cardDailyLimit) || Number(appState.settings.yellowCardDailyLimit);
    const cardMonthlyLimit = Number(w.cardMonthlyLimit) || Number(appState.settings.yellowCardMonthlyLimit);

    const dailyPercent = Math.min(100, Math.round((dailyUsage / dailyLimitVal) * 100));
    const monthlyPercent = Math.min(100, Math.round((monthlyUsage / monthlyLimitVal) * 100));
    const cardDailyPercent = Math.min(100, Math.round((cardDailyUsage / cardDailyLimit) * 100));
    const cardMonthlyPercent = Math.min(100, Math.round((cardMonthlyUsage / cardMonthlyLimit) * 100));

    let statusBadge = `<span class="badge bg-success small"><i class="uil uil-check-circle me-1"></i>طبيعي</span>`;
    if (dailyUsage >= dangerDaily) {
      statusBadge = `<span class="badge bg-danger small"><i class="uil uil-multiply me-1"></i>تجاوز الحد</span>`;
    } else if (dailyUsage > warnDaily) {
      statusBadge = `<span class="badge bg-warning text-dark small"><i class="uil uil-exclamation-triangle me-1"></i>تحذير الاستخدام</span>`;
    }

    const initBal = parseFloat(w.initialBalance || 0);
    const tierLabel = walletLimitTier(w) === 'new' ? 'حد الخط الجديد' : 'حد الخط القديم';
    const upgradeButton = isWalletUpgradeDue(w) ? `<button class="btn btn-sm btn-warning fw-bold mt-2" onclick="activateWalletLimitsNow('${escapeHtml(w.id)}')">تفعيل الحد القديم</button>` : '';

    return `
      <div class="col-md-4 col-sm-6">
        <div class="wallet-card-box shadow-sm">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div>
              <h6 class="fw-bold mb-1 d-flex align-items-center gap-1">
                <span>${escapeHtml(w.name)}</span>
                <button class="btn btn-sm p-0 text-secondary ms-1" onclick="openEditSingleWalletModal('${w.id}')" title="تعديل المحفظة">
                  <i class="uil uil-edit"></i>
                </button>
              </h6>
              <span class="yellow-card-badge"><i class="uil uil-credit-card me-1"></i>بطاقة ${displayCard(w.cardNumber)}</span>
              <div class="small text-muted mt-1">${tierLabel}${w.activationDate ? ` · تفعيل ${formatNoteDate(w.activationDate).split('،')[0]}` : ''}</div>
            </div>
            <div class="text-end">
              <div>${statusBadge}</div>
              <span class="badge ${w.balance > 0 ? 'bg-primary' : 'bg-secondary'} fs-6 mt-1">
                الرصيد: ${formatMoney(w.balance)}
              </span>
            </div>
          </div>

          ${initBal > 0 ? `
            <div class="small text-muted mb-2">
              <span class="badge bg-light text-dark border"><i class="uil uil-vault me-1"></i>رصيد افتتاحي: ${formatMoney(initBal)}</span>
            </div>
          ` : ''}

          <!-- Daily Progress Bar -->
          <div class="mt-2">
            <div class="small d-flex justify-content-between text-muted mb-1" style="font-size: 11px;">
              <span>وارد اليوم: <strong>${formatMoney(dailyUsage)}</strong></span>
              <span>حد يومي: ${formatMoney(dailyLimitVal)} (${dailyPercent}%)</span>
            </div>
            <div class="progress progress-sm mb-2">
              <div class="progress-bar ${dailyUsage > dangerDaily ? 'bg-danger' : (dailyUsage > warnDaily ? 'bg-warning' : 'bg-success')}" style="width: ${dailyPercent}%"></div>
            </div>
          </div>

          <!-- Monthly Progress Bar -->
          <div>
            <div class="small d-flex justify-content-between text-muted mb-1" style="font-size: 11px;">
              <span>وارد الشهر: <strong>${formatMoney(monthlyUsage)}</strong></span>
              <span>حد شهري: ${formatMoney(monthlyLimitVal)} (${monthlyPercent}%)</span>
            </div>
            <div class="progress progress-sm">
              <div class="progress-bar ${monthlyPercent >= 90 ? 'bg-danger' : (monthlyPercent >= 75 ? 'bg-warning' : 'bg-primary')}" style="width: ${monthlyPercent}%"></div>
            </div>
          </div>

          ${w.cardNumber ? `
            <div class="wallet-card-limits mt-3">
              <div class="small fw-bold text-dark mb-2"><i class="uil uil-credit-card text-warning me-1"></i>استخدام الكارت الأصفر</div>
              <div class="small d-flex justify-content-between text-muted mb-1"><span>سحب اليوم: ${formatMoney(cardDailyUsage)}</span><span>حد ${formatMoney(cardDailyLimit)}</span></div>
              <div class="progress progress-sm mb-2"><div class="progress-bar ${cardDailyPercent >= appState.settings.cardWarningPercent ? 'bg-warning' : 'bg-info'}" style="width: ${cardDailyPercent}%"></div></div>
              <div class="small d-flex justify-content-between text-muted mb-1"><span>سحب الشهر: ${formatMoney(cardMonthlyUsage)}</span><span>حد ${formatMoney(cardMonthlyLimit)}</span></div>
              <div class="progress progress-sm"><div class="progress-bar ${cardMonthlyPercent >= appState.settings.cardWarningPercent ? 'bg-warning' : 'bg-info'}" style="width: ${cardMonthlyPercent}%"></div></div>
            </div>
          ` : ''}
          ${upgradeButton}

        </div>
      </div>
    `;
  }).join('');
}

// --- Render Transactions Table ---
function renderTransactions() {
  const tbody = document.getElementById('tx-tbody');
  const countEl = document.getElementById('tx-count');
  const filtered = getFilteredTransactions();

  if (countEl) countEl.textContent = `${filtered.length} معاملة`;

  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center text-muted py-4">
          <i class="uil uil-folder-open fs-2 d-block mb-2 text-secondary"></i>
          لا توجد معاملات مسجلة في هذا التحديد
        </td>
      </tr>
    `;
    return;
  }

  const sorted = [...filtered].sort((a, b) => new Date(b.date) - new Date(a.date));

  tbody.innerHTML = sorted.map((tx, idx) => {
    const isIncome = tx.type === 'income';
    const isInitial = tx.type === 'initial';
    const wallet = appState.wallets.find(w => w.id === tx.walletId);
    const walletName = wallet ? wallet.name : 'محفظة غير محددة';
    const walletCard = wallet ? wallet.cardNumber : '';
    const dateStr = new Date(tx.date).toLocaleString('ar-EG', {
      timeZone: 'Africa/Cairo',
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const seqNum = sorted.length - idx;

    let typeBadgeHtml = `<span class="badge bg-danger-subtle text-danger border border-danger fw-bold"><i class="uil uil-arrow-up-right me-1"></i>مدفوع (سحب)</span>`;
    if (isIncome) {
      typeBadgeHtml = `<span class="badge bg-success-subtle text-success border border-success fw-bold"><i class="uil uil-arrow-down-left me-1"></i>مستلم (وارد)</span>`;
    } else if (isInitial) {
      typeBadgeHtml = `<span class="badge bg-info-subtle text-info border border-info fw-bold"><i class="uil uil-vault me-1"></i>رصيد افتتاحي</span>`;
    } else if (tx.type === 'card_transfer') {
      typeBadgeHtml = `<span class="badge bg-warning-subtle text-dark border border-warning fw-bold"><i class="uil uil-exchange me-1"></i>رفع إلى كارت أصفر</span>`;
    }

    return `
      <tr>
        <td class="fw-bold text-muted">#${seqNum}</td>
        <td>${typeBadgeHtml}</td>
        <td>
          <div class="fw-bold text-dark">${escapeHtml(walletName)}</div>
          <small class="text-muted"><i class="uil uil-credit-card me-1"></i>بطاقة ${displayCard(walletCard)}</small>
        </td>
        <td class="fw-extrabold ${isIncome || isInitial ? 'text-success' : 'text-danger'}">
          ${isIncome || isInitial ? '+' : '-'}${formatMoney(tx.amount)}
        </td>
        <td>
          ${isIncome ? `<span class="badge bg-warning text-dark fw-bold">+${formatMoney(tx.netProfit)}</span>` : (tx.type === 'card_transfer' ? `<span class="badge bg-light text-danger border">رسوم ${formatMoney(tx.serviceFee || 0)}</span>` : '-')}
        </td>
        <td class="small text-muted">${dateStr}</td>
        <td class="small text-secondary">${escapeHtml(tx.notes || '-')}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-danger" title="حذف المعاملة" onclick="deleteTransaction('${tx.id}')">
            <i class="uil uil-trash-alt"></i> حذف
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// --- Add Transaction ---
function openAddTransactionModal(type = 'income') {
  const activeWallets = appState.wallets.filter(walletHasWallet);
  if (activeWallets.length === 0) {
    Swal.fire({
      icon: 'warning',
      title: 'تنبيـه',
      text: 'يرجى إضافة محفظة واحدة على الأقل قبل إدخال المعاملات.',
      confirmButtonText: '+ إضافة محفظة الآن',
      showCancelButton: true,
      cancelButtonText: 'إلغاء'
    }).then(res => {
      if (res.isConfirmed) openWalletsModal();
    });
    return;
  }

  const walletOptionsHtml = activeWallets.map((w, index) =>
    `<button type="button" class="transaction-wallet-option${index === 0 ? ' is-selected' : ''}" data-wallet-id="${escapeHtml(w.id)}" aria-selected="${index === 0}" onclick="selectTransactionWallet('${escapeHtml(w.id)}')">
      <span class="transaction-wallet-option__icon"><i class="uil uil-mobile-android"></i></span>
      <span class="transaction-wallet-option__details"><strong>${escapeHtml(w.name)}</strong><small>بطاقة ${displayCard(w.cardNumber)} | الرصيد: ${formatMoney(w.balance)}</small></span>
      <i class="uil uil-check transaction-wallet-option__check"></i>
    </button>`
  ).join('');

  const nowISO = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const title = type === 'income' ? 'تسجيل معاملة واردة (مستلم)' : 'تسجيل معاملة سحب (مدفوع)';

  Swal.fire({
    title: title,
    html: `
      <div class="text-start mb-3">
        <label class="form-label fw-bold small">اختيار المحفظة</label>
        <input type="hidden" id="swal-wallet-id" value="${escapeHtml(activeWallets[0].id)}">
        <div class="transaction-wallet-picker" id="transaction-wallet-picker" role="listbox" aria-label="اختيار المحفظة">
          ${walletOptionsHtml}
        </div>
      </div>
      <div class="text-start mb-3">
        <label class="form-label fw-bold small">المبلغ الإجمالي (بالجنيه)</label>
        <input type="number" step="0.01" id="swal-amount" class="form-control" placeholder="مثال: 10000" oninput="calcSwalProfit('${type}')">
      </div>
      ${type === 'income' ? `
        <div class="profit-breakdown mb-3" id="swal-profit-info" style="display:none;" role="status" aria-live="polite">
          <div class="profit-breakdown-fees">
          <div class="profit-breakdown-item is-income">
            <span class="profit-breakdown-label">عمولة العميل</span>
            <small>${appState.settings.customerRate}%</small>
            <strong id="swal-cust-fee">0 ج.م</strong>
          </div>
          <div class="profit-breakdown-item is-cost">
            <span class="profit-breakdown-label">رسوم الخدمة</span>
            <small>${appState.settings.fawryRate}%</small>
            <strong id="swal-fawry-fee">0 ج.م</strong>
          </div>
          </div>
          <button type="button" class="profit-toggle" id="profit-toggle-btn" onclick="toggleProfitDetails()" aria-expanded="false">
            <span>إظهار المكسب</span><i class="uil uil-angle-down"></i>
          </button>
          <div class="profit-net-panel" id="profit-net-panel" hidden>
            <span>صافي مكسبك</span>
            <strong id="swal-net-profit">0 ج.م</strong>
          </div>
        </div>
      ` : ''}
      <div class="text-start mb-3">
        <label class="form-label fw-bold small">التاريخ والوقت</label>
        <input type="datetime-local" id="swal-date" class="form-control" value="${nowISO}">
      </div>
      <div class="text-start mb-2">
        <label class="form-label fw-bold small">ملاحظات المعاملة</label>
        <input type="text" id="swal-notes" class="form-control" placeholder="بيانات اختيارية...">
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'حفظ المعاملة',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: type === 'income' ? '#198754' : '#0d6efd',
    focusConfirm: false,
    preConfirm: () => {
      const walletId = document.getElementById('swal-wallet-id').value;
      const amount = parseFloat(document.getElementById('swal-amount').value);
      const date = document.getElementById('swal-date').value;
      const notes = document.getElementById('swal-notes').value.trim();

      if (!walletId || isNaN(amount) || amount <= 0) {
        Swal.showValidationMessage('يرجى إدخال مبلغ صحيح واختيار المحفظة.');
        return false;
      }

      const wallet = appState.wallets.find(w => w.id === walletId);
      
      if (type === 'expense' && amount > (wallet.balance || 0)) {
        Swal.showValidationMessage(`لا يوجد رصيد كافٍ في محفظة (${wallet.name}) لإجراء عملية السحب. الرصيد الحالي: ${formatMoney(wallet.balance)}`);
        return false;
      }

      return { walletId, amount, type, date, notes };
    }
  }).then(result => {
    if (result.isConfirmed && result.value) {
      checkSecurityWarningsAndExecute(result.value);
    }
  });
}

function selectTransactionWallet(walletId) {
  const hiddenInput = document.getElementById('swal-wallet-id');
  const picker = document.getElementById('transaction-wallet-picker');
  if (!hiddenInput || !picker) return;

  hiddenInput.value = walletId;
  picker.querySelectorAll('.transaction-wallet-option').forEach(option => {
    const isSelected = option.dataset.walletId === walletId;
    option.classList.toggle('is-selected', isSelected);
    option.setAttribute('aria-selected', String(isSelected));
  });
}

function calcSwalProfit(type) {
  if (type !== 'income') return;
  const val = parseFloat(document.getElementById('swal-amount').value) || 0;
  const infoBox = document.getElementById('swal-profit-info');

  if (val > 0) {
    infoBox.style.display = 'block';
    const cFee = val * (appState.settings.customerRate / 100);
    const fFee = val * (appState.settings.fawryRate / 100);
    const nProf = cFee - fFee;

    document.getElementById('swal-cust-fee').textContent = formatMoney(cFee);
    document.getElementById('swal-fawry-fee').textContent = formatMoney(fFee);
    document.getElementById('swal-net-profit').textContent = formatMoney(nProf);
  } else {
    infoBox.style.display = 'none';
  }
}

function toggleProfitDetails() {
  const panel = document.getElementById('profit-net-panel');
  const button = document.getElementById('profit-toggle-btn');
  if (!panel || !button) return;

  const isExpanded = button.getAttribute('aria-expanded') === 'true';
  panel.hidden = isExpanded;
  button.setAttribute('aria-expanded', String(!isExpanded));
  button.innerHTML = isExpanded
    ? '<span>إظهار المكسب</span><i class="uil uil-angle-down"></i>'
    : '<span>إخفاء المكسب</span><i class="uil uil-angle-up"></i>';
}

function applyStandardWalletLimits(wallet) {
  wallet.limitTier = 'standard';
  wallet.dailyLimit = Number(appState.settings.standardWalletDailyLimit);
  wallet.monthlyLimit = Number(appState.settings.standardWalletMonthlyLimit);
  wallet.warnDailyLimit = Math.round(wallet.dailyLimit * appState.settings.walletWarningPercent / 100);
  wallet.warnMonthlyLimit = Math.round(wallet.monthlyLimit * appState.settings.walletWarningPercent / 100);
  wallet.limitUpgradePrompted = true;
}

function scheduleDueWalletUpgradePrompt(delay = 250) {
  if (walletUpgradePromptTimer) return;
  walletUpgradePromptTimer = setTimeout(() => {
    walletUpgradePromptTimer = null;
    promptDueWalletUpgrades();
  }, delay);
}

function activateWalletLimitsNow(walletId) {
  const wallet = appState.wallets.find(item => item.id === walletId);
  if (!wallet || !isWalletUpgradeDue(wallet)) return;

  Swal.fire({
    icon: 'question',
    title: 'تفعيل حدود الخط القديم؟',
    text: `سيتم تغيير حدود ${wallet.name} إلى ${formatMoney(appState.settings.standardWalletDailyLimit)} يومياً و${formatMoney(appState.settings.standardWalletMonthlyLimit)} شهرياً.`,
    showCancelButton: true,
    confirmButtonText: 'تفعيل الحدود',
    cancelButtonText: 'ليس الآن',
    confirmButtonColor: '#3d7d70'
  }).then(result => {
    if (!result.isConfirmed) return;
    applyStandardWalletLimits(wallet);
    saveToLocalStorage();
    renderAll();
  });
}

function promptDueWalletUpgrades() {
  const wallet = appState.wallets.find(item => isWalletUpgradeDue(item) && !item.limitUpgradePrompted);
  if (!wallet) return;
  if (Swal.isVisible()) {
    scheduleDueWalletUpgradePrompt(750);
    return;
  }

  Swal.fire({
    icon: 'warning',
    title: 'استحقاق حد الخط القديم',
    html: `مرّت مدة ${Number(appState.settings.newWalletMonths) || 3} شهور على تفعيل <strong>${escapeHtml(wallet.name)}</strong>. هل تريد تفعيل حد ${formatMoney(appState.settings.standardWalletDailyLimit)} يومياً و${formatMoney(appState.settings.standardWalletMonthlyLimit)} شهرياً الآن؟`,
    showCancelButton: true,
    confirmButtonText: 'تفعيل الحد القديم',
    cancelButtonText: 'تذكيري لاحقاً',
    confirmButtonColor: '#3d7d70'
  }).then(result => {
    wallet.limitUpgradePrompted = true;
    if (result.isConfirmed) applyStandardWalletLimits(wallet);
    saveToLocalStorage();
    renderAll();
  });
}

function checkSecurityWarningsAndExecute(txData) {
  const { walletId, amount, type, date } = txData;
  const wallet = appState.wallets.find(w => w.id === walletId);
  // Use the transaction's own date/time (not "right now") so a backdated
  // entry is checked against that day's/month's real usage.
  const nowCairo = getCairoDateParts(date ? new Date(date) : new Date());

  let currentDaily = 0;
  let currentMonthly = 0;

  appState.transactions.forEach(tx => {
    if (tx.walletId === walletId && tx.type === 'income') {
      const txCairo = getCairoDateParts(tx.date);
      if (txCairo.dateStr === nowCairo.dateStr) currentDaily += tx.amount;
      if (txCairo.month === nowCairo.month && txCairo.year === nowCairo.year) currentMonthly += tx.amount;
    }
  });

  const limits = walletLimits(wallet);
  const warnDaily = wallet.warnDailyLimit || Math.round(limits.daily * appState.settings.walletWarningPercent / 100);
  const warnMonthly = wallet.warnMonthlyLimit || Math.round(limits.monthly * appState.settings.walletWarningPercent / 100);
  const dailyAfter = currentDaily + amount;
  const monthlyAfter = currentMonthly + amount;

  if (type === 'income' && (dailyAfter >= warnDaily || monthlyAfter >= warnMonthly)) {
    Swal.fire({
      icon: 'warning',
      title: 'تنبيه: تجاوز حد الاستخدام الموصى به',
      html: `
        <div class="text-start">
          <p class="mb-2">بعد تسجيل المعاملة سيصل وارد ${escapeHtml(wallet.name)} إلى <strong>${formatMoney(dailyAfter)}</strong> اليوم و<strong>${formatMoney(monthlyAfter)}</strong> هذا الشهر.</p>
          <div class="alert alert-warning p-2 small mb-2">
            حدود التحذير: ${formatMoney(warnDaily)} يومياً و${formatMoney(warnMonthly)} شهرياً. الحد الأقصى: ${formatMoney(limits.daily)} يومياً و${formatMoney(limits.monthly)} شهرياً.
          </div>
          <p class="mb-0 fw-bold">هل تود تأكيد حفظ المعاملة؟</p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'تأكيد الحفظ',
      cancelButtonText: 'إلغاء المعاملة',
      confirmButtonColor: '#f59e0b'
    }).then(res => {
      if (res.isConfirmed) {
        saveFinalTransaction(txData);
      }
    });
    return;
  }

  saveFinalTransaction(txData);
}

function saveFinalTransaction(txData) {
  const { walletId, amount, type, date, notes } = txData;

  const customerFee = type === 'income' ? amount * (appState.settings.customerRate / 100) : 0;
  const fawryFee = type === 'income' ? amount * (appState.settings.fawryRate / 100) : 0;
  const netProfit = customerFee - fawryFee;

  const newTx = {
    id: 'tx_' + Date.now(),
    walletId,
    type,
    amount,
    customerFee,
    fawryFee,
    netProfit,
    date: date || new Date().toISOString(),
    notes
  };

  appState.transactions.push(newTx);
  recalculateWalletBalances();
  saveToLocalStorage();
  renderAll();

  Swal.fire({
    icon: 'success',
    title: 'تم حفظ المعاملة بنجاح',
    timer: 1500,
    showConfirmButton: false
  });
}

function getYellowCardUsage(wallet, dateInput = new Date()) {
  const target = getCairoDateParts(dateInput);
  return appState.transactions.reduce((usage, tx) => {
    if (tx.walletId !== wallet.id || tx.type !== 'card_transfer') return usage;
    const parts = getCairoDateParts(tx.date);
    if (parts.dateStr === target.dateStr) usage.daily += tx.amount;
    if (parts.month === target.month && parts.year === target.year) usage.monthly += tx.amount;
    return usage;
  }, { daily: 0, monthly: 0 });
}

function openYellowCardTransferModal() {
  const eligibleWallets = appState.wallets.filter(wallet => walletHasWallet(wallet) && wallet.cardNumber);
  if (eligibleWallets.length === 0) {
    Swal.fire({ icon: 'warning', title: 'لا يوجد كارت أصفر مرتبط', text: 'أضف آخر 4 أرقام الكارت إلى خط لديه محفظة من شاشة إدارة الخطوط والمحافظ.' });
    return;
  }

  const nowISO = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const walletOptions = eligibleWallets.map(wallet => `<option value="${escapeHtml(wallet.id)}">${escapeHtml(wallet.name)} · كارت ${displayCard(wallet.cardNumber)} · الرصيد ${formatMoney(wallet.balance)}</option>`).join('');

  Swal.fire({
    title: 'رفع من محفظة إلى كارت أصفر',
    html: `
      <div class="text-start">
        <label class="form-label fw-bold small">المحفظة والكارت المرتبط</label>
        <select id="card-transfer-wallet" class="form-select mb-3" onchange="calcYellowCardTransfer()">${walletOptions}</select>
        <label class="form-label fw-bold small">مبلغ الرفع (ج.م)</label>
        <input type="number" min="0.01" step="0.01" id="card-transfer-amount" class="form-control mb-3" placeholder="مثال: 1000" oninput="calcYellowCardTransfer()">
        <div class="profit-breakdown mb-3">
          <div class="profit-breakdown-item is-cost"><span class="profit-breakdown-label">رسوم الخدمة (${appState.settings.fawryRate}%)</span><strong id="card-transfer-fee">0 ج.م</strong></div>
          <div class="profit-net-panel"><span>إجمالي الخصم من المحفظة</span><strong id="card-transfer-total">0 ج.م</strong></div>
        </div>
        <div class="small text-muted mb-3">الحد الافتراضي للكارت: ${formatMoney(appState.settings.yellowCardDailyLimit)} يومياً و${formatMoney(appState.settings.yellowCardMonthlyLimit)} شهرياً.</div>
        <label class="form-label fw-bold small">التاريخ والوقت</label>
        <input type="datetime-local" id="card-transfer-date" class="form-control mb-3" value="${nowISO}">
        <label class="form-label fw-bold small">ملاحظات</label>
        <input type="text" id="card-transfer-notes" class="form-control" placeholder="اختياري">
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'حفظ عملية الرفع',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: '#c69a4c',
    focusConfirm: false,
    preConfirm: () => {
      const walletId = document.getElementById('card-transfer-wallet').value;
      const amount = Number(document.getElementById('card-transfer-amount').value);
      const wallet = eligibleWallets.find(item => item.id === walletId);
      const serviceFee = amount * (appState.settings.fawryRate / 100);
      const date = document.getElementById('card-transfer-date').value;
      const notes = document.getElementById('card-transfer-notes').value.trim();
      if (!wallet || !Number.isFinite(amount) || amount <= 0) {
        Swal.showValidationMessage('اختر محفظة وأدخل مبلغاً صحيحاً.');
        return false;
      }
      if (amount + serviceFee > wallet.balance) {
        Swal.showValidationMessage(`الرصيد غير كافٍ للمبلغ والرسوم. المطلوب ${formatMoney(amount + serviceFee)} والمتاح ${formatMoney(wallet.balance)}.`);
        return false;
      }
      const transactionDate = date ? new Date(date) : new Date();
      const usage = getYellowCardUsage(wallet, transactionDate);
      const dailyLimit = Number(wallet.cardDailyLimit) || Number(appState.settings.yellowCardDailyLimit);
      const monthlyLimit = Number(wallet.cardMonthlyLimit) || Number(appState.settings.yellowCardMonthlyLimit);
      if (usage.daily + amount > dailyLimit || usage.monthly + amount > monthlyLimit) {
        Swal.showValidationMessage(`العملية تتجاوز الحد الأقصى للكارت. المتبقي اليوم ${formatMoney(Math.max(0, dailyLimit - usage.daily))}، والمتبقي هذا الشهر ${formatMoney(Math.max(0, monthlyLimit - usage.monthly))}.`);
        return false;
      }
      return { walletId, amount, serviceFee, date: date ? new Date(date).toISOString() : new Date().toISOString(), notes };
    }
  }).then(result => {
    if (result.isConfirmed && result.value) checkYellowCardWarnings(result.value);
  });
}

function calcYellowCardTransfer() {
  const amount = Number(document.getElementById('card-transfer-amount')?.value) || 0;
  const fee = amount * (appState.settings.fawryRate / 100);
  const feeOutput = document.getElementById('card-transfer-fee');
  const totalOutput = document.getElementById('card-transfer-total');
  if (feeOutput) feeOutput.textContent = formatMoney(fee);
  if (totalOutput) totalOutput.textContent = formatMoney(amount + fee);
}

function checkYellowCardWarnings(txData) {
  const wallet = appState.wallets.find(item => item.id === txData.walletId);
  const usage = getYellowCardUsage(wallet, txData.date);
  const dailyLimit = Number(wallet.cardDailyLimit) || Number(appState.settings.yellowCardDailyLimit);
  const monthlyLimit = Number(wallet.cardMonthlyLimit) || Number(appState.settings.yellowCardMonthlyLimit);
  const dailyAfter = usage.daily + txData.amount;
  const monthlyAfter = usage.monthly + txData.amount;
  const warningPercent = Number(appState.settings.cardWarningPercent) || 80;
  const warningDue = dailyAfter >= dailyLimit * warningPercent / 100 || monthlyAfter >= monthlyLimit * warningPercent / 100;

  if (!warningDue) {
    saveYellowCardTransfer(txData);
    return;
  }

  Swal.fire({
    icon: 'warning',
    title: 'تنبيه حدود الكارت الأصفر',
    html: `بعد العملية يصبح سحب الكارت <strong>${escapeHtml(wallet.name)}</strong> ${formatMoney(dailyAfter)} اليوم و${formatMoney(monthlyAfter)} هذا الشهر. حد السقف: ${formatMoney(dailyLimit)} يومياً و${formatMoney(monthlyLimit)} شهرياً.`,
    showCancelButton: true,
    confirmButtonText: 'تأكيد العملية رغم التنبيه',
    cancelButtonText: 'مراجعة المبلغ',
    confirmButtonColor: '#c85454'
  }).then(result => {
    if (result.isConfirmed) saveYellowCardTransfer(txData);
  });
}

function saveYellowCardTransfer(txData) {
  appState.transactions.push({
    id: `tx_${Date.now()}`,
    walletId: txData.walletId,
    type: 'card_transfer',
    amount: txData.amount,
    serviceFee: txData.serviceFee,
    customerFee: 0,
    fawryFee: txData.serviceFee,
    netProfit: -(txData.serviceFee || 0),
    date: txData.date,
    notes: txData.notes
  });
  recalculateWalletBalances();
  saveToLocalStorage();
  renderAll();
  Swal.fire({ icon: 'success', title: 'تم تسجيل عملية الرفع', timer: 1500, showConfirmButton: false });
}

function openYellowCardLimitsModal() {
  const cards = appState.wallets.filter(wallet => wallet.cardNumber);
  const cardsHtml = cards.map(wallet => {
    const usage = getYellowCardUsage(wallet);
    const dailyLimit = Number(wallet.cardDailyLimit) || Number(appState.settings.yellowCardDailyLimit);
    const monthlyLimit = Number(wallet.cardMonthlyLimit) || Number(appState.settings.yellowCardMonthlyLimit);
    const dailyPercent = Math.min(100, Math.round(usage.daily / dailyLimit * 100));
    const monthlyPercent = Math.min(100, Math.round(usage.monthly / monthlyLimit * 100));
    return `<div class="yellow-card-limit-row"><div class="d-flex justify-content-between gap-2"><strong>${escapeHtml(wallet.name)} · ${displayCard(wallet.cardNumber)}</strong><button class="btn btn-sm btn-outline-primary" onclick="openEditSingleWalletModal('${escapeHtml(wallet.id)}')" title="تعديل الحدود"><i class="uil uil-edit"></i></button></div><div class="small text-muted mt-2">اليوم ${formatMoney(usage.daily)} من ${formatMoney(dailyLimit)} · الشهر ${formatMoney(usage.monthly)} من ${formatMoney(monthlyLimit)}</div><div class="progress progress-sm mt-2"><div class="progress-bar ${dailyPercent >= appState.settings.cardWarningPercent ? 'bg-warning' : 'bg-info'}" style="width:${dailyPercent}%"></div></div><div class="progress progress-sm mt-2"><div class="progress-bar ${monthlyPercent >= appState.settings.cardWarningPercent ? 'bg-warning' : 'bg-info'}" style="width:${monthlyPercent}%"></div></div></div>`;
  }).join('');

  Swal.fire({
    title: 'حدود الكارت الأصفر',
    html: `<div class="yellow-card-limits-list"><div class="alert alert-info small text-start">الحد الافتراضي: ${formatMoney(appState.settings.yellowCardDailyLimit)} للسحب اليومي و${formatMoney(appState.settings.yellowCardMonthlyLimit)} للإجمالي الشهري. التحذير عند ${appState.settings.cardWarningPercent}%، ويمكن تعديل حد كل كارت من زر التعديل.</div>${cardsHtml || '<div class="text-muted py-3">لا توجد كروت صفراء مسجلة.</div>'}</div>`,
    showCloseButton: true,
    showConfirmButton: false
  });
}

function deleteTransaction(txId) {
  Swal.fire({
    title: 'تأكيد حذف المعاملة',
    text: 'هل أنت متأكد من حذف هذه المعاملة؟ سيتم تحديث رصيد المحفظة مباشرة.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    cancelButtonColor: '#6c757d',
    confirmButtonText: 'تأكيد الحذف',
    cancelButtonText: 'إلغاء'
  }).then(result => {
    if (result.isConfirmed) {
      appState.transactions = appState.transactions.filter(tx => tx.id !== txId);
      recalculateWalletBalances();
      saveToLocalStorage();
      renderAll();

      Swal.fire({
        icon: 'success',
        title: 'تم حذف المعاملة بنجاح',
        timer: 1500,
        showConfirmButton: false
      });
    }
  });
}

function openNotebookModal() {
  Swal.fire({
    title: 'دفتر الملاحظات',
    html: `
      <div class="notebook-shell text-start">
        <div class="notebook-toolbar">
          <div class="notebook-summary"><i class="uil uil-notes"></i><span><strong id="notebook-visible-count">0</strong> ملاحظة محفوظة</span></div>
          <button type="button" class="btn btn-primary btn-sm fw-bold" onclick="openNoteEditor()"><i class="uil uil-plus"></i> ملاحظة جديدة</button>
        </div>
        <div class="notebook-search-wrap">
          <i class="uil uil-search"></i>
          <input type="search" id="notebook-search" class="form-control form-control-sm" placeholder="ابحث في العناوين والملاحظات..." oninput="renderNotebookList()">
        </div>
        <div id="notebook-list" class="notebook-list"></div>
      </div>
    `,
    showConfirmButton: false,
    showCloseButton: true,
    width: '640px',
    didOpen: renderNotebookList
  });
}

function renderNotebookList() {
  const list = document.getElementById('notebook-list');
  const count = document.getElementById('notebook-visible-count');
  if (!list) return;

  const search = (document.getElementById('notebook-search')?.value || '').trim().toLowerCase();
  const visibleNotes = appState.notes
    .filter(note => !search || `${note.title} ${note.content}`.toLowerCase().includes(search))
    .sort((first, second) => {
      if (Boolean(first.pinned) !== Boolean(second.pinned)) return first.pinned ? -1 : 1;
      return new Date(second.updatedAt) - new Date(first.updatedAt);
    });

  if (count) count.textContent = visibleNotes.length;

  if (visibleNotes.length === 0) {
    list.innerHTML = `
      <div class="notebook-empty">
        <i class="uil uil-notes"></i>
        <strong>${search ? 'لا توجد نتائج مطابقة' : 'دفترك جاهز'}</strong>
        <span>${search ? 'جرّب كلمة بحث مختلفة.' : 'سجّل أول ملاحظة لتنظيم يومك ومعاملاتك.'}</span>
        ${search ? '' : '<button type="button" class="btn btn-outline-primary btn-sm fw-bold" onclick="openNoteEditor()"><i class="uil uil-plus"></i> ابدأ بملاحظة</button>'}
      </div>
    `;
    return;
  }

  list.innerHTML = visibleNotes.map(note => `
    <article class="notebook-note ${note.pinned ? 'is-pinned' : ''}">
      <div class="notebook-note-main" onclick="openNoteEditor('${escapeHtml(note.id)}')">
        <div class="notebook-note-heading">
          <h6>${escapeHtml(note.title || 'ملاحظة بدون عنوان')}</h6>
          ${note.pinned ? '<i class="uil uil-bookmark-full" title="ملاحظة مثبتة"></i>' : ''}
        </div>
        <p>${escapeHtml(note.content || 'بدون نص')}</p>
        <time>${formatNoteDate(note.updatedAt)}</time>
      </div>
      <div class="notebook-note-actions">
        <button type="button" class="btn btn-sm btn-light" title="${note.pinned ? 'إلغاء التثبيت' : 'تثبيت الملاحظة'}" onclick="toggleNotePin('${escapeHtml(note.id)}')"><i class="uil ${note.pinned ? 'uil-bookmark-full text-warning' : 'uil-bookmark'}"></i></button>
        <button type="button" class="btn btn-sm btn-light text-danger" title="حذف الملاحظة" onclick="deleteNote('${escapeHtml(note.id)}')"><i class="uil uil-trash-alt"></i></button>
      </div>
    </article>
  `).join('');
}

function openNoteEditor(noteId = null) {
  const note = noteId ? appState.notes.find(item => item.id === noteId) : null;

  Swal.fire({
    title: note ? 'تعديل الملاحظة' : 'ملاحظة جديدة',
    html: `
      <div class="text-start notebook-editor">
        <label class="form-label fw-bold small">عنوان الملاحظة</label>
        <input type="text" id="note-title" class="form-control mb-3" maxlength="80" placeholder="مثال: متابعة عميل أو ملاحظة يومية" value="${escapeHtml(note?.title || '')}">
        <label class="form-label fw-bold small">المحتوى</label>
        <textarea id="note-content" class="form-control" rows="8" maxlength="5000" placeholder="اكتب ملاحظتك هنا...">${escapeHtml(note?.content || '')}</textarea>
        <div class="notebook-editor-hint"><i class="uil uil-lock"></i> تحفظ الملاحظة على هذا الجهاز وتعمل بدون إنترنت.</div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: note ? 'حفظ التعديل' : 'حفظ الملاحظة',
    cancelButtonText: 'رجوع للدفتر',
    confirmButtonColor: '#3d7d70',
    focusConfirm: false,
    preConfirm: () => {
      const noteTitle = document.getElementById('note-title').value.trim();
      const content = document.getElementById('note-content').value.trim();
      if (!noteTitle && !content) {
        Swal.showValidationMessage('اكتب عنواناً أو محتوى للملاحظة أولاً.');
        return false;
      }
      return { title: noteTitle || 'ملاحظة بدون عنوان', content };
    }
  }).then(result => {
    if (result.isConfirmed && result.value) {
      const now = new Date().toISOString();
      if (note) {
        note.title = result.value.title;
        note.content = result.value.content;
        note.updatedAt = now;
      } else {
        appState.notes.push({
          id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          title: result.value.title,
          content: result.value.content,
          pinned: false,
          createdAt: now,
          updatedAt: now
        });
      }
      saveToLocalStorage();
      renderNotebookCount();
    }
    openNotebookModal();
  });
}

function toggleNotePin(noteId) {
  const note = appState.notes.find(item => item.id === noteId);
  if (!note) return;
  note.pinned = !note.pinned;
  note.updatedAt = new Date().toISOString();
  saveToLocalStorage();
  renderNotebookList();
}

function deleteNote(noteId) {
  const note = appState.notes.find(item => item.id === noteId);
  if (!note) return;

  Swal.fire({
    title: 'حذف الملاحظة؟',
    text: `سيتم حذف "${note.title}" نهائياً من هذا الجهاز.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'حذف الملاحظة',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: '#c85454'
  }).then(result => {
    if (result.isConfirmed) {
      appState.notes = appState.notes.filter(item => item.id !== noteId);
      saveToLocalStorage();
      renderNotebookCount();
      openNotebookModal();
    }
  });
}

function formatNoteDate(dateInput) {
  return new Date(dateInput).toLocaleString('ar-EG', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// --- Edit Wallet Modal ---
function openEditSingleWalletModal(walletId) {
  const wallet = appState.wallets.find(w => w.id === walletId);
  if (!wallet) return;

  Swal.fire({
    title: `تعديل بيانات (${wallet.name})`,
    html: `
      <div class="text-start mb-3">
        <label class="form-label fw-bold small">اسم الخط / الرقم</label>
        <input type="text" id="edit-w-name" class="form-control" value="${escapeHtml(wallet.name)}">
      </div>
      <div class="mb-3">
        <div class="form-label fw-bold small">حالة المحفظة على الخط</div>
        <input class="d-none" type="checkbox" id="edit-w-has-wallet" ${walletHasWallet(wallet) ? 'checked' : ''}>
        <div class="btn-group wallet-presence-toggle w-100" role="group" aria-label="حالة المحفظة">
          <button type="button" id="edit-w-wallet-on" class="btn ${walletHasWallet(wallet) ? 'btn-primary' : 'btn-outline-primary'}" aria-pressed="${walletHasWallet(wallet)}" onclick="setWalletPresence('edit-w', true)"><i class="uil uil-check-circle me-1"></i>بمحفظة</button>
          <button type="button" id="edit-w-wallet-off" class="btn ${walletHasWallet(wallet) ? 'btn-outline-secondary' : 'btn-secondary'}" aria-pressed="${!walletHasWallet(wallet)}" onclick="setWalletPresence('edit-w', false)"><i class="uil uil-ban me-1"></i>بدون محفظة</button>
        </div>
      </div>
      <div id="edit-w-wallet-fields" class="wallet-presence-fields ${walletHasWallet(wallet) ? '' : 'd-none'} mb-3">
      <div class="row g-2 text-start">
        <div class="col-6">
          <label class="form-label fw-bold small">تاريخ تفعيل المحفظة</label>
          <input type="date" id="edit-w-activation" class="form-control" value="${wallet.activationDate ? new Date(wallet.activationDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)}">
        </div>
        <div class="col-6">
          <label class="form-label fw-bold small">فئة الحد</label>
          <select id="edit-w-tier" class="form-select" onchange="syncWalletTierDefaults('edit-w')">
            <option value="new" ${walletLimitTier(wallet) === 'new' ? 'selected' : ''}>خط جديد (أول 3 شهور)</option>
            <option value="standard" ${walletLimitTier(wallet) === 'standard' ? 'selected' : ''}>خط قديم</option>
          </select>
        </div>
        <div class="col-6"><label class="form-label fw-bold small">رصيد افتتاحي للمحفظة</label><input type="number" step="0.01" id="edit-w-init-bal" class="form-control" value="${wallet.initialBalance || 0}"></div>
        <div class="col-6"><label class="form-label fw-bold small">حد المحفظة اليومي</label><input type="number" id="edit-w-daily" class="form-control" value="${walletLimits(wallet).daily}"></div>
        <div class="col-6"><label class="form-label fw-bold small">حد المحفظة الشهري</label><input type="number" id="edit-w-monthly" class="form-control" value="${walletLimits(wallet).monthly}"></div>
        <div class="col-6"><label class="form-label fw-bold small">تحذير المحفظة اليومي</label><input type="number" id="edit-w-warn-daily" class="form-control" value="${wallet.warnDailyLimit || Math.round(walletLimits(wallet).daily * appState.settings.walletWarningPercent / 100)}"></div>
        <div class="col-6"><label class="form-label fw-bold small">تحذير المحفظة الشهري</label><input type="number" id="edit-w-warn-monthly" class="form-control" value="${wallet.warnMonthlyLimit || Math.round(walletLimits(wallet).monthly * appState.settings.walletWarningPercent / 100)}"></div>
      </div>
      </div>
      <div class="text-start mb-3">
        <label class="form-label fw-bold small">آخر 4 أرقام الكارت الأصفر</label>
        <input type="text" id="edit-w-card" maxlength="4" class="form-control" value="${escapeHtml(wallet.cardNumber || '')}" placeholder="اختياري">
      </div>
      <div class="row g-2 text-start mb-3">
        <div class="col-6"><label class="form-label fw-bold small">حد الكارت يومياً</label><input type="number" id="edit-card-daily" class="form-control" value="${wallet.cardDailyLimit || appState.settings.yellowCardDailyLimit}"></div>
        <div class="col-6"><label class="form-label fw-bold small">حد الكارت شهرياً</label><input type="number" id="edit-card-monthly" class="form-control" value="${wallet.cardMonthlyLimit || appState.settings.yellowCardMonthlyLimit}"></div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'حفظ التعديلات',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: '#198754',
    didOpen: () => setWalletPresence('edit-w', walletHasWallet(wallet)),
    preConfirm: () => {
      const name = document.getElementById('edit-w-name').value.trim();
      const hasWallet = document.getElementById('edit-w-has-wallet').checked;
      const cardNumber = document.getElementById('edit-w-card').value.trim();
      const initialBalance = hasWallet ? (parseFloat(document.getElementById('edit-w-init-bal').value) || 0) : 0;
      const dailyLimit = Number(document.getElementById('edit-w-daily').value);
      const monthlyLimit = Number(document.getElementById('edit-w-monthly').value);
      const warnDailyLimit = Number(document.getElementById('edit-w-warn-daily').value);
      const warnMonthlyLimit = Number(document.getElementById('edit-w-warn-monthly').value);
      const activationDate = document.getElementById('edit-w-activation').value;
      const limitTier = document.getElementById('edit-w-tier').value;
      const cardDailyLimit = Number(document.getElementById('edit-card-daily').value);
      const cardMonthlyLimit = Number(document.getElementById('edit-card-monthly').value);

      if (!name) {
        Swal.showValidationMessage('يرجى إدخال اسم الخط أو الرقم.');
        return false;
      }
      if (hasWallet && (!activationDate || dailyLimit <= 0 || monthlyLimit <= 0)) {
        Swal.showValidationMessage('أدخل تاريخ التفعيل وحدوداً صحيحة للمحفظة.');
        return false;
      }
      if (cardNumber && (cardDailyLimit <= 0 || cardMonthlyLimit <= 0)) {
        Swal.showValidationMessage('أدخل حدوداً صحيحة للكارت الأصفر.');
        return false;
      }

      return { name, hasWallet, cardNumber, initialBalance, dailyLimit, warnDailyLimit, monthlyLimit, warnMonthlyLimit, activationDate, limitTier, cardDailyLimit, cardMonthlyLimit };
    }
  }).then(result => {
    if (result.isConfirmed && result.value) {
      const prevInit = wallet.initialBalance || 0;
      const newInit = result.value.initialBalance;

      wallet.name = result.value.name;
      wallet.hasWallet = result.value.hasWallet;
      wallet.cardNumber = result.value.cardNumber;
      wallet.initialBalance = newInit;
      wallet.dailyLimit = result.value.dailyLimit;
      wallet.warnDailyLimit = result.value.warnDailyLimit;
      wallet.monthlyLimit = result.value.monthlyLimit;
      wallet.warnMonthlyLimit = result.value.warnMonthlyLimit;
      wallet.activationDate = result.value.activationDate ? new Date(`${result.value.activationDate}T12:00:00`).toISOString() : null;
      wallet.limitTier = result.value.limitTier;
      wallet.cardDailyLimit = result.value.cardDailyLimit || appState.settings.yellowCardDailyLimit;
      wallet.cardMonthlyLimit = result.value.cardMonthlyLimit || appState.settings.yellowCardMonthlyLimit;
      wallet.limitUpgradePrompted = false;

      if (newInit !== prevInit) {
        appState.transactions = appState.transactions.filter(tx => !(tx.walletId === wallet.id && tx.type === 'initial'));
        if (newInit > 0) {
          appState.transactions.push({
            id: 'tx_init_' + wallet.id,
            walletId: wallet.id,
            type: 'initial',
            amount: newInit,
            customerFee: 0,
            fawryFee: 0,
            netProfit: 0,
            date: new Date().toISOString(),
            notes: 'تسجيل رصيد افتتاحي للمحفظة'
          });
        }
      }

      saveToLocalStorage();
      renderAll();

      Swal.fire({
        icon: 'success',
        title: 'تم تحديث البيانات بنجاح',
        timer: 1500,
        showConfirmButton: false
      });
    }
  });
}

// --- Manage All Wallets Modal (clean browsing list only) ---
function openWalletsModal() {
  const walletsListHtml = appState.wallets.map(w => `
    <div class="wallet-manage-row">
      <div class="wallet-manage-info">
        <strong class="text-dark">${escapeHtml(w.name)}</strong>
        <div class="small text-muted">
          ${walletHasWallet(w) ? `محفظة ${walletLimitTier(w) === 'new' ? 'بحد الخط الجديد' : 'بحد الخط القديم'} · الرصيد: ${formatMoney(w.balance)}` : 'خط بدون محفظة'} · كارت: ${displayCard(w.cardNumber)}
        </div>
      </div>
      <div class="wallet-manage-actions">
        <button class="btn btn-sm btn-outline-primary" onclick="openEditSingleWalletModal('${w.id}')" title="تعديل"><i class="uil uil-edit"></i></button>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteWalletFromSwal('${w.id}')" title="حذف"><i class="uil uil-trash-alt"></i></button>
      </div>
    </div>
  `).join('');

  Swal.fire({
    title: `إدارة الخطوط والمحافظ (${appState.wallets.length})`,
    html: `
      <div class="text-start">
        <button class="btn btn-primary w-100 fw-bold mb-3 d-flex align-items-center justify-content-center gap-2" onclick="openAddWalletModal()">
          <i class="uil uil-plus-circle fs-5"></i>
          <span>إضافة خط / رقم</span>
        </button>
        <div class="wallet-manage-list">
          ${walletsListHtml || '<div class="text-muted small text-center py-3">لا توجد محافظ مسجلة حتى الآن.</div>'}
        </div>
      </div>
    `,
    showConfirmButton: false,
    showCloseButton: true
  });
}

function setWalletPresence(formPrefix, enabled) {
  const checkbox = document.getElementById(`${formPrefix}-has-wallet`);
  const fields = document.getElementById(`${formPrefix}-wallet-fields`);
  const enabledButton = document.getElementById(`${formPrefix}-wallet-on`);
  const disabledButton = document.getElementById(`${formPrefix}-wallet-off`);
  if (checkbox) checkbox.checked = enabled;
  if (fields) {
    fields.hidden = !enabled;
    fields.classList.toggle('d-none', !enabled);
  }
  if (enabledButton) {
    enabledButton.classList.toggle('btn-primary', enabled);
    enabledButton.classList.toggle('btn-outline-primary', !enabled);
    enabledButton.setAttribute('aria-pressed', String(enabled));
  }
  if (disabledButton) {
    disabledButton.classList.toggle('btn-secondary', !enabled);
    disabledButton.classList.toggle('btn-outline-secondary', enabled);
    disabledButton.setAttribute('aria-pressed', String(!enabled));
  }
}

function syncWalletTierDefaults(formPrefix) {
  const isNew = document.getElementById(`${formPrefix}-tier`)?.value === 'new';
  const daily = Number(isNew ? appState.settings.newWalletDailyLimit : appState.settings.standardWalletDailyLimit);
  const monthly = Number(isNew ? appState.settings.newWalletMonthlyLimit : appState.settings.standardWalletMonthlyLimit);
  const dailyInput = document.getElementById(`${formPrefix}-daily`);
  const monthlyInput = document.getElementById(`${formPrefix}-monthly`);
  const warnDailyInput = document.getElementById(`${formPrefix}-warn-daily`);
  const warnMonthlyInput = document.getElementById(`${formPrefix}-warn-monthly`);
  if (dailyInput) dailyInput.value = daily;
  if (monthlyInput) monthlyInput.value = monthly;
  if (warnDailyInput) warnDailyInput.value = Math.round(daily * appState.settings.walletWarningPercent / 100);
  if (warnMonthlyInput) warnMonthlyInput.value = Math.round(monthly * appState.settings.walletWarningPercent / 100);
}

function toggleNewWalletFields(enabled) {
  setWalletPresence('new-w', enabled ?? document.getElementById('new-w-has-wallet')?.checked);
}

function syncNewWalletDefaults() {
  syncWalletTierDefaults('new-w');
}

// --- Add Wallet Modal (its own focused screen, opened from the list above) ---
function openAddWalletModal() {
  Swal.fire({
    title: 'إضافة خط / رقم',
    html: `
      <div class="text-start mb-3">
        <label class="form-label fw-bold small">اسم الخط / الرقم</label>
        <input type="text" id="new-w-name" class="form-control" placeholder="مثال: خط فودافون">
      </div>
      <div class="mb-3">
        <div class="form-label fw-bold small">حالة المحفظة على الخط</div>
        <input class="d-none" type="checkbox" id="new-w-has-wallet" checked>
        <div class="btn-group wallet-presence-toggle w-100" role="group" aria-label="حالة المحفظة">
          <button type="button" id="new-w-wallet-on" class="btn btn-primary" aria-pressed="true" onclick="toggleNewWalletFields(true)"><i class="uil uil-check-circle me-1"></i>بمحفظة</button>
          <button type="button" id="new-w-wallet-off" class="btn btn-outline-secondary" aria-pressed="false" onclick="toggleNewWalletFields(false)"><i class="uil uil-ban me-1"></i>بدون محفظة</button>
        </div>
      </div>
      <div id="new-w-wallet-fields" class="wallet-presence-fields border rounded p-2 mb-3">
        <div class="row g-2 text-start">
          <div class="col-6"><label class="form-label fw-bold small">تاريخ فتح المحفظة</label><input type="date" id="new-w-activation" class="form-control" value="${new Date().toISOString().slice(0, 10)}"></div>
          <div class="col-6"><label class="form-label fw-bold small">فئة الحد</label><select id="new-w-tier" class="form-select" onchange="syncNewWalletDefaults()"><option value="new">خط جديد (أول 3 شهور)</option><option value="standard">خط قديم</option></select></div>
          <div class="col-6"><label class="form-label fw-bold small">الرصيد الافتتاحي</label><input type="number" step="0.01" id="new-w-init-bal" class="form-control" value="0"></div>
          <div class="col-6"><label class="form-label fw-bold small">الحد اليومي للمحفظة</label><input type="number" id="new-w-daily" class="form-control" value="${appState.settings.newWalletDailyLimit}"></div>
          <div class="col-6"><label class="form-label fw-bold small">الحد الشهري للمحفظة</label><input type="number" id="new-w-monthly" class="form-control" value="${appState.settings.newWalletMonthlyLimit}"></div>
          <div class="col-6"><label class="form-label fw-bold small">تحذير يومي</label><input type="number" id="new-w-warn-daily" class="form-control" value="${Math.round(appState.settings.newWalletDailyLimit * appState.settings.walletWarningPercent / 100)}"></div>
          <div class="col-6"><label class="form-label fw-bold small">تحذير شهري</label><input type="number" id="new-w-warn-monthly" class="form-control" value="${Math.round(appState.settings.newWalletMonthlyLimit * appState.settings.walletWarningPercent / 100)}"></div>
        </div>
      </div>
      <div class="row g-2 text-start">
        <div class="col-6"><label class="form-label fw-bold small">آخر 4 أرقام الكارت الأصفر</label><input type="text" id="new-w-card" maxlength="4" class="form-control" placeholder="اختياري"></div>
        <div class="col-6"><label class="form-label fw-bold small">حد الكارت اليومي</label><input type="number" id="new-card-daily" class="form-control" value="${appState.settings.yellowCardDailyLimit}"></div>
        <div class="col-6"><label class="form-label fw-bold small">حد الكارت الشهري</label><input type="number" id="new-card-monthly" class="form-control" value="${appState.settings.yellowCardMonthlyLimit}"></div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'حفظ وإضافة المحفظة',
    cancelButtonText: 'رجوع',
    confirmButtonColor: '#3d9457',
    didOpen: () => {
      toggleNewWalletFields(true);
      syncNewWalletDefaults();
    },
    preConfirm: () => {
      const name = document.getElementById('new-w-name').value.trim();
      const hasWallet = document.getElementById('new-w-has-wallet').checked;
      const cardNumber = document.getElementById('new-w-card').value.trim();
      const initialBalance = parseFloat(document.getElementById('new-w-init-bal').value) || 0;
      const activationDate = document.getElementById('new-w-activation').value;
      const limitTier = document.getElementById('new-w-tier').value;
      const dailyLimit = Number(document.getElementById('new-w-daily').value);
      const monthlyLimit = Number(document.getElementById('new-w-monthly').value);
      const warnDailyLimit = Number(document.getElementById('new-w-warn-daily').value);
      const warnMonthlyLimit = Number(document.getElementById('new-w-warn-monthly').value);
      const cardDailyLimit = Number(document.getElementById('new-card-daily').value);
      const cardMonthlyLimit = Number(document.getElementById('new-card-monthly').value);

      if (!name) {
        Swal.showValidationMessage('يرجى كتابة اسم الخط أو الرقم.');
        return false;
      }
      if (hasWallet && (!activationDate || dailyLimit <= 0 || monthlyLimit <= 0)) {
        Swal.showValidationMessage('أدخل تاريخ التفعيل وحدوداً صحيحة للمحفظة.');
        return false;
      }
      if (cardNumber && (cardDailyLimit <= 0 || cardMonthlyLimit <= 0)) {
        Swal.showValidationMessage('أدخل حدوداً صحيحة للكارت الأصفر.');
        return false;
      }

      return { name, hasWallet, cardNumber, initialBalance, activationDate, limitTier, dailyLimit, monthlyLimit, warnDailyLimit, warnMonthlyLimit, cardDailyLimit, cardMonthlyLimit };
    }
  }).then(result => {
    if (!result.isConfirmed || !result.value) {
      // User pressed "رجوع" or closed the dialog — go back to the wallets list as-is.
      openWalletsModal();
      return;
    }

    const { name, hasWallet, cardNumber, initialBalance, activationDate, limitTier, dailyLimit, monthlyLimit, warnDailyLimit, warnMonthlyLimit, cardDailyLimit, cardMonthlyLimit } = result.value;
    const walletId = 'wallet_' + Date.now();
    const createdAt = new Date().toISOString();

    appState.wallets.push({
      id: walletId,
      name,
      hasWallet,
      cardNumber,
      initialBalance: hasWallet ? initialBalance : 0,
      activationDate: hasWallet ? new Date(`${activationDate}T12:00:00`).toISOString() : null,
      createdAt,
      limitTier: hasWallet ? limitTier : 'new',
      dailyLimit: hasWallet ? dailyLimit : 0,
      warnDailyLimit: hasWallet ? warnDailyLimit : 0,
      monthlyLimit: hasWallet ? monthlyLimit : 0,
      warnMonthlyLimit: hasWallet ? warnMonthlyLimit : 0,
      cardDailyLimit,
      cardMonthlyLimit,
      balance: hasWallet ? initialBalance : 0
    });

    if (hasWallet && initialBalance > 0) {
      appState.transactions.push({
        id: 'tx_init_' + walletId,
        walletId: walletId,
        type: 'initial',
        amount: initialBalance,
        customerFee: 0,
        fawryFee: 0,
        netProfit: 0,
        date: new Date().toISOString(),
        notes: 'تسجيل رصيد افتتاحي للمحفظة'
      });
    }

    saveToLocalStorage();
    renderAll();
    openWalletsModal();
  });
}

function deleteWalletFromSwal(id) {
  Swal.fire({
    title: 'تأكيد حذف المحفظة',
    text: 'هل أنت متأكد من حذف هذه المحفظة؟',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'تأكيد الحذف',
    cancelButtonText: 'إلغاء'
  }).then(res => {
    if (res.isConfirmed) {
      appState.wallets = appState.wallets.filter(w => w.id !== id);
      appState.transactions = appState.transactions.filter(tx => tx.walletId !== id);
      saveToLocalStorage();
      renderAll();
      openWalletsModal();
    }
  });
}

function openWalletsSummaryModal() {
  const listHtml = appState.wallets.map(w => `
    <div class="wallet-balance-row">
      <div class="wallet-balance-row__details">
        <strong class="wallet-balance-row__name">${escapeHtml(w.name)}</strong>
        <div class="wallet-balance-row__meta">
          <span><i class="uil uil-credit-card"></i> ${displayCard(w.cardNumber)}</span>
          <span><i class="uil uil-history"></i> افتتاحي ${formatMoney(w.initialBalance || 0)}</span>
        </div>
      </div>
      <div class="wallet-balance-row__current ${w.balance > 0 ? 'is-positive' : 'is-zero'}">
        <span class="wallet-balance-row__label">الرصيد الحالي</span>
        <strong>${formatMoney(w.balance)}</strong>
      </div>
    </div>
  `).join('');

  Swal.fire({
    title: `ملخص رصيد المحافظ (${appState.wallets.length})`,
    html: `
      <div class="wallet-balance-list">
        ${listHtml || '<div class="wallet-balance-empty"><i class="uil uil-wallet"></i><span>لا توجد محافظ مسجلة.</span></div>'}
      </div>
    `,
    confirmButtonText: 'إغلاق النافذة',
    confirmButtonColor: '#0d6efd',
    customClass: { popup: 'wallet-balance-summary-popup' }
  });
}

function openSecurityGuideModal() {
  Swal.fire({
    title: 'ضوابط وتوصيات إدارة المحافظ',
    html: `
      <div class="text-start small" style="max-height: 350px; overflow-y: auto;">
        <div class="alert alert-success p-2 mb-2">
          <strong>الحدود الافتراضية المسجلة:</strong><br>
          • الخط الجديد لأول ${appState.settings.newWalletMonths} شهور: ${formatMoney(appState.settings.newWalletDailyLimit)} يومياً و${formatMoney(appState.settings.newWalletMonthlyLimit)} شهرياً.<br>
          • الخط القديم: ${formatMoney(appState.settings.standardWalletDailyLimit)} يومياً و${formatMoney(appState.settings.standardWalletMonthlyLimit)} شهرياً.<br>
          • الكارت الأصفر: ${formatMoney(appState.settings.yellowCardDailyLimit)} يومياً و${formatMoney(appState.settings.yellowCardMonthlyLimit)} شهرياً.
        </div>
        <div class="alert alert-danger p-2 mb-2">
          <strong>مؤشرات الاستخدام المرتفع:</strong><br>
          • التحذير عند بلوغ ${appState.settings.walletWarningPercent}% من حد المحفظة أو ${appState.settings.cardWarningPercent}% من حد الكارت.<br>
          • تجاوز حد الكارت يتطلب تأكيداً قبل تسجيل العملية.
        </div>
        <div class="border rounded p-2 bg-light">
          <strong>التوصيات الإدارية:</strong><br>
          1. تنويع مبالغ المعاملات وتجنب تكرار المبالغ الثابتة.<br>
          2. التناوب على المحافظ وتنويع مواعيد وأماكن السحب النظيرة.
        </div>
      </div>
    `,
    confirmButtonText: 'إغلاق النافذة',
    confirmButtonColor: '#0d6efd'
  });
}

function openSettingsModal() {
  Swal.fire({
    title: 'إعدادات العمولات وحدود المحافظ والكروت',
    html: `
      <div class="text-start mb-3">
        <h6 class="fw-bold">نسب العمولات:</h6>
        <div class="row g-2 mb-3">
          <div class="col-6">
            <label class="small text-muted">عمولة العميل (%)</label>
            <input type="number" step="0.01" id="swal-rate-cust" class="form-control form-control-sm" value="${appState.settings.customerRate}">
          </div>
          <div class="col-6">
            <label class="small text-muted">رسوم الخدمة (%)</label>
            <input type="number" step="0.01" id="swal-rate-fawry" class="form-control form-control-sm" value="${appState.settings.fawryRate}">
          </div>
        </div>
        <h6 class="fw-bold">حدود المحافظ الافتراضية</h6>
        <div class="row g-2 mb-3">
          <div class="col-6"><label class="small text-muted">مدة الخط الجديد (شهور)</label><input type="number" min="1" id="setting-new-months" class="form-control form-control-sm" value="${appState.settings.newWalletMonths}"></div>
          <div class="col-6"><label class="small text-muted">تحذير عند نسبة %</label><input type="number" min="1" max="100" id="setting-wallet-warning" class="form-control form-control-sm" value="${appState.settings.walletWarningPercent}"></div>
          <div class="col-6"><label class="small text-muted">الجديد يومي</label><input type="number" min="1" id="setting-new-daily" class="form-control form-control-sm" value="${appState.settings.newWalletDailyLimit}"></div>
          <div class="col-6"><label class="small text-muted">الجديد شهري</label><input type="number" min="1" id="setting-new-monthly" class="form-control form-control-sm" value="${appState.settings.newWalletMonthlyLimit}"></div>
          <div class="col-6"><label class="small text-muted">القديم يومي</label><input type="number" min="1" id="setting-old-daily" class="form-control form-control-sm" value="${appState.settings.standardWalletDailyLimit}"></div>
          <div class="col-6"><label class="small text-muted">القديم شهري</label><input type="number" min="1" id="setting-old-monthly" class="form-control form-control-sm" value="${appState.settings.standardWalletMonthlyLimit}"></div>
        </div>
        <h6 class="fw-bold">حدود الكارت الأصفر والتنبيه</h6>
        <div class="row g-2 mb-3">
          <div class="col-6"><label class="small text-muted">الكارت يومي</label><input type="number" min="1" id="setting-card-daily" class="form-control form-control-sm" value="${appState.settings.yellowCardDailyLimit}"></div>
          <div class="col-6"><label class="small text-muted">الكارت شهري</label><input type="number" min="1" id="setting-card-monthly" class="form-control form-control-sm" value="${appState.settings.yellowCardMonthlyLimit}"></div>
          <div class="col-6"><label class="small text-muted">تحذير الكارت عند نسبة %</label><input type="number" min="1" max="100" id="setting-card-warning" class="form-control form-control-sm" value="${appState.settings.cardWarningPercent}"></div>
        </div>
        <button class="btn btn-sm btn-primary mt-3 w-100 fw-bold" onclick="saveRatesFromSwal()">حفظ التعديلات</button>
      </div>
      <hr>
      <div class="text-start mb-3">
        <h6 class="fw-bold">إدارة النسخ الاحتياطي:</h6>
        <div class="d-flex gap-2 mb-2">
          <button class="btn btn-sm btn-outline-primary w-50" onclick="exportBackup()"><i class="uil uil-download-alt me-1"></i> تصدير (JSON)</button>
          <label class="btn btn-sm btn-outline-success w-50 m-0">
            <i class="uil uil-upload-alt me-1"></i> استعادة
            <input type="file" accept=".json" style="display:none;" onchange="importBackup(event)">
          </label>
        </div>
      </div>
    `,
    showConfirmButton: false,
    showCloseButton: true
  });
}



function saveRatesFromSwal() {
  const custRate = parseFloat(document.getElementById('swal-rate-cust').value) || 1.0;
  const fawryRate = parseFloat(document.getElementById('swal-rate-fawry').value) || 0.57;
  const newMonths = Number(document.getElementById('setting-new-months').value);
  const newDaily = Number(document.getElementById('setting-new-daily').value);
  const newMonthly = Number(document.getElementById('setting-new-monthly').value);
  const oldDaily = Number(document.getElementById('setting-old-daily').value);
  const oldMonthly = Number(document.getElementById('setting-old-monthly').value);
  const cardDaily = Number(document.getElementById('setting-card-daily').value);
  const cardMonthly = Number(document.getElementById('setting-card-monthly').value);
  const walletWarningPercent = Number(document.getElementById('setting-wallet-warning').value);
  const cardWarningPercent = Number(document.getElementById('setting-card-warning').value);

  if ([newMonths, newDaily, newMonthly, oldDaily, oldMonthly, cardDaily, cardMonthly, walletWarningPercent, cardWarningPercent].some(value => !Number.isFinite(value) || value <= 0) || walletWarningPercent > 100 || cardWarningPercent > 100) {
    Swal.showValidationMessage('يرجى إدخال حدود ونسب تحذير صحيحة.');
    return;
  }

  appState.settings.customerRate = custRate;
  appState.settings.fawryRate = fawryRate;
  appState.settings.newWalletMonths = newMonths;
  appState.settings.newWalletDailyLimit = newDaily;
  appState.settings.newWalletMonthlyLimit = newMonthly;
  appState.settings.standardWalletDailyLimit = oldDaily;
  appState.settings.standardWalletMonthlyLimit = oldMonthly;
  appState.settings.yellowCardDailyLimit = cardDaily;
  appState.settings.yellowCardMonthlyLimit = cardMonthly;
  appState.settings.walletWarningPercent = walletWarningPercent;
  appState.settings.cardWarningPercent = cardWarningPercent;

  saveToLocalStorage();
  renderAll();

  Swal.fire({
    icon: 'success',
    title: 'تم حفظ التعديلات بنجاح',
    timer: 1500,
    showConfirmButton: false
  });
}

async function exportBackup() {
  await saveToLocalStorage();
  const backup = {
    ...appState,
    wallets: appState.wallets,
    transactions: appState.transactions,
    notes: appState.notes,
    settings: appState.settings
  };
  const dataStr = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  anchor.setAttribute("href", dataStr);
  anchor.setAttribute("download", `cashflow_backup_${dateStr}.json`);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(dataStr), 1000);
}

function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!storageReady) {
    Swal.fire({ icon: 'error', title: 'التخزين غير جاهز', text: 'لم تكتمل تهيئة قاعدة البيانات، لذلك لم يتم استيراد النسخة الاحتياطية.' });
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const data = JSON.parse(e.target.result);
      await restoreBackupData(data, file.name);
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'خطأ', text: 'حدث خطأ أثناء قراءة ملف الاستعادة.' });
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

async function restoreBackupData(data, sourceName = 'النسخة الاحتياطية') {
  const validCollection = value => Array.isArray(value) && value.every(item => item && typeof item === 'object' && !Array.isArray(item));
  const validSettings = data && (data.settings === undefined || (data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)));
  if (!data || !validCollection(data.wallets) || !validCollection(data.transactions) ||
      (data.notes !== undefined && !validCollection(data.notes)) || !validSettings) {
    Swal.fire({ icon: 'error', title: 'ملف غير صالح', text: 'لا تتوافق هذه النسخة مع صيغة بيانات التطبيق. لم يتم تغيير بياناتك.' });
    return false;
  }

  const wallets = data.wallets.map(wallet => ({
    ...wallet,
    hasWallet: wallet.hasWallet === undefined ? true : wallet.hasWallet,
    limitTier: wallet.limitTier || 'standard',
    activationDate: wallet.activationDate || wallet.createdAt || null
  }));
  const transactions = data.transactions;
  const notes = Array.isArray(data.notes) ? data.notes : [];
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  const confirmation = await Swal.fire({
    icon: 'warning',
    title: 'استبدال البيانات الحالية؟',
    text: `سيتم استبدال بيانات التطبيق الحالية بمحتوى النسخة: ${sourceName}.`,
    showCancelButton: true,
    confirmButtonText: 'استعادة النسخة',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: '#dc3545'
  });
  if (!confirmation.isConfirmed) return false;

  try {
    await CashflowStorage.replaceSnapshot({ wallets, transactions, notes, settings });
    appState.wallets = wallets;
    appState.transactions = transactions;
    appState.notes = notes;
    appState.settings = settings;
    recalculateWalletBalances();
    renderAll();
    Swal.fire({ icon: 'success', title: 'تمت استعادة البيانات بنجاح' });
    return true;
  } catch (error) {
    console.error('Backup restore failed:', error);
    Swal.fire({ icon: 'error', title: 'تعذرت الاستعادة', text: 'لم يكتمل حفظ النسخة المستعادة. بقيت البيانات المحلية كما هي.' });
    return false;
  }
}

function clearAllData() {
  Swal.fire({
    title: 'تأكيد تفريغ البيانات',
    text: 'هل أنت متأكد من تفريغ كافة المحافظ والمعاملات والبدء من جديد؟',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc3545',
    confirmButtonText: 'تأكيد التفريغ الكامل',
    cancelButtonText: 'إلغاء'
  }).then(result => {
    if (result.isConfirmed) {
      appState.wallets = [];
      appState.transactions = [];
      appState.notes = [];
      appState.settings = { ...DEFAULT_SETTINGS };
      saveToLocalStorage();
      renderAll();
      Swal.fire({ icon: 'success', title: 'تم تفريغ النظام بنجاح' });
    }
  });
}

async function removeAppFromThisDevice() {
  const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const deviceLabel = isMobileDevice ? 'هذا الجهاز' : 'هذا الكمبيوتر وفي ملف المتصفح الحالي';
  const confirmation = await Swal.fire({
    icon: 'warning',
    title: `حذف بيانات التطبيق من ${deviceLabel}؟`,
    html: `<div class="text-start small"><p>سيحذف هذا الإجراء من ${deviceLabel}:</p><ul><li>كل المحافظ والمعاملات والملاحظات والإعدادات المحلية.</li><li>بيانات الربط المحلية وملفات التطبيق المحفوظة للعمل دون إنترنت.</li><li>تسجيل Service Worker الخاص بالتطبيق.</li></ul><p class="fw-bold text-danger">هذا يمسح بيانات Cashflow من المتصفح الحالي فقط، ولا يستطيع الموقع إزالة أيقونة التطبيق المثبّتة بنفسه.</p><p>للمتابعة اكتب <strong>حذف التطبيق</strong> في المربع.</p></div>`,
    input: 'text',
    inputPlaceholder: 'حذف التطبيق',
    showCancelButton: true,
    confirmButtonText: 'حذف نهائي من هذا الجهاز',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: '#dc3545',
    preConfirm: value => {
      if (value !== 'حذف التطبيق') {
        Swal.showValidationMessage('اكتب «حذف التطبيق» للتأكيد.');
        return false;
      }
      return true;
    }
  });
  if (!confirmation.isConfirmed) return;

  try {
    await CashflowStorage.destroy();
    ['axis_wallets', 'axis_transactions', 'axis_notes', 'axis_settings', 'axis_wallets_collapsed']
      .forEach(key => localStorage.removeItem(key));

    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter(name => name.startsWith('cashflow-app-'))
      .map(name => caches.delete(name)));

    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const appWorkerUrl = new URL('./sw.js', location.href).href;
      await Promise.all(registrations
        .filter(registration => registration.active?.scriptURL === appWorkerUrl)
        .map(registration => registration.unregister()));
    }

    storageReady = false;
    const uninstallInstructions = isMobileDevice
      ? '<ol><li>لإزالة أيقونة التطبيق: اضغط مطولًا على أيقونة Cashflow ثم اختر «إلغاء التثبيت» أو «إزالة التطبيق».</li><li>إذا بقيت بيانات للموقع: افتح إعدادات المتصفح ثم إعدادات المواقع/بيانات المواقع، وابحث عن عنوان Cashflow واختر «مسح البيانات وإعادة الضبط».</li></ol>'
      : '<ol><li>لإزالة التطبيق من الكمبيوتر: افتح نافذة Cashflow، ثم قائمة التطبيق <strong>⋮</strong> واختر <strong>إلغاء تثبيت Cashflow Manager</strong>. في Chrome أو Edge قد تجد الخيار أيضًا في قائمة التطبيقات المثبّتة.</li><li>لمسح بيانات الموقع من المتصفح: افتح عنوان Cashflow في Chrome/Edge، اضغط رمز إعدادات الموقع بجانب العنوان، ثم «إعدادات الموقع» و«حذف البيانات».</li></ol>';
    Swal.fire({
      icon: 'success',
      title: isMobileDevice ? 'تم حذف بيانات Cashflow من هذا الجهاز' : 'تم حذف بيانات Cashflow من هذا الكمبيوتر',
      html: `<div class="text-start small"><p>تم حذف قاعدة IndexedDB التي تحتوي بياناتك، وكاش ملفات Offline، ومفاتيح التطبيق المحلية، وإلغاء تسجيل Service Worker من ملف المتصفح الحالي.</p><p class="fw-bold">لإزالة التطبيق وأي بيانات متبقية من الجهاز:</p>${uninstallInstructions}</div>`,
      confirmButtonText: 'حسنًا'
    });
  } catch (error) {
    console.error('Application removal failed:', error);
    Swal.fire({
      icon: 'error',
      title: 'لم يكتمل الحذف',
      text: error.message || 'أغلق أي تبويب آخر مفتوح للتطبيق ثم أعد المحاولة.'
    });
  }
}

function closeSidebar() {
  const sidebarEl = document.getElementById('appSidebar');
  if (sidebarEl) {
    const bsOffcanvas = bootstrap.Offcanvas.getInstance(sidebarEl);
    if (sidebarEl.classList.contains('show') && bsOffcanvas) {
      bsOffcanvas.hide();
    }
  }
}

async function checkForAppUpdates() {
  if (!('serviceWorker' in navigator)) {
    Swal.fire({ icon: 'info', title: 'التحديثات غير متاحة', text: 'شغّل التطبيق من خلال رابط HTTP أو HTTPS.' });
    return;
  }

  if (!navigator.onLine) {
    Swal.fire({ icon: 'warning', title: 'لا يوجد اتصال بالإنترنت', text: 'لا يمكن التحقق من GitHub حالياً. سيستمر التطبيق بالعمل بالنسخة المحفوظة أوفلاين.' });
    return;
  }

  Swal.fire({ title: 'جاري التحقق من التحديثات...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();

    if (registration.installing) {
      await new Promise(resolve => {
        const worker = registration.installing;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' || worker.state === 'redundant') resolve();
        });
      });
    }

    const appShellChanged = await checkAppShellFiles(registration);
    Swal.close();
    if (registration.waiting) {
      showAvailableUpdate(registration);
      Swal.fire({ icon: 'info', title: 'يوجد تحديث جديد', text: 'سيظهر لك زر تحديث التطبيق. اضغط عليه لتثبيت آخر نسخة من الملفات.' });
    } else if (appShellChanged) {
      showAvailableUpdate(registration, true);
      Swal.fire({ icon: 'info', title: 'تم العثور على تحديث', text: 'تم تحميل ملفات أحدث من GitHub. اضغط على زر التحديث لتطبيقها.' });
    } else {
      Swal.fire({ icon: 'success', title: 'التطبيق محدث', text: 'أنت تستخدم آخر نسخة منشورة من الملفات الأساسية.' });
    }
  } catch (error) {
    Swal.fire({ icon: 'error', title: 'تعذر التحقق من التحديثات', text: 'تأكد من اتصال الإنترنت ثم حاول مرة أخرى.' });
  }
}

function checkAppShellFiles(registration) {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = event => resolve(Boolean(event.data && event.data.changed));
    setTimeout(() => resolve(false), 10000);
    registration.active?.postMessage({ type: 'CHECK_APP_SHELL' }, [channel.port2]);
  });
}

// --- Clean Currency & Number Formatting ---
function formatMoney(amount) {
  const num = amount || 0;
  if (Number.isInteger(num)) {
    return num.toLocaleString('en-US') + ' ج.م';
  }
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + ' ج.م';
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, match => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[match]);
}

// Shows a friendly fallback wherever a wallet's card number is displayed,
// since the card number is now an optional field.
function displayCard(cardNumber) {
  return cardNumber && String(cardNumber).trim() ? escapeHtml(cardNumber) : 'غير موجود';
}