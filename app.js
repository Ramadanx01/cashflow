/* ==========================================================================
   Axis & Fawry Cashflow Manager - Clean Business & Security System
   ========================================================================== */

const DEFAULT_SETTINGS = {
  customerRate: 1.0,  // 1% = 10 EGP per 1000 EGP
  fawryRate: 0.57,    // 0.57% = 5.70 EGP per 1000 EGP
  safeDailyLimit: 35000,
  dangerDailyLimit: 45000,
  safeMonthlyLimit: 140000,
  dangerMonthlyLimit: 160000
};

const DEFAULT_WALLETS = [];

let appState = {
  wallets: [],
  transactions: [],
  settings: { ...DEFAULT_SETTINGS },
  currentFilter: 'all'
};

document.addEventListener('DOMContentLoaded', () => {
  loadFromLocalStorage();
  renderAll();
});

// --- LocalStorage Operations ---
function loadFromLocalStorage() {
  try {
    const savedWallets = localStorage.getItem('axis_wallets');
    const savedTx = localStorage.getItem('axis_transactions');
    const savedSettings = localStorage.getItem('axis_settings');

    appState.wallets = savedWallets ? JSON.parse(savedWallets) : [];
    appState.transactions = savedTx ? JSON.parse(savedTx) : [];
    appState.settings = savedSettings ? { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) } : { ...DEFAULT_SETTINGS };

    recalculateWalletBalances();
  } catch (e) {
    console.error('Error loading data:', e);
    appState.wallets = [];
    appState.transactions = [];
    appState.settings = { ...DEFAULT_SETTINGS };
  }
}

function saveToLocalStorage() {
  localStorage.setItem('axis_wallets', JSON.stringify(appState.wallets));
  localStorage.setItem('axis_transactions', JSON.stringify(appState.transactions));
  localStorage.setItem('axis_settings', JSON.stringify(appState.settings));
}

// Recalculate Wallet Balance: Initial Balance + Incomes - Expenses
function recalculateWalletBalances() {
  appState.wallets.forEach(w => {
    let bal = parseFloat(w.initialBalance || 0);
    appState.transactions.forEach(tx => {
      if (tx.walletId === w.id) {
        if (tx.type === 'income') bal += tx.amount;
        else if (tx.type === 'expense') bal -= tx.amount;
      }
    });
    w.balance = bal;
  });
}

function renderAll() {
  recalculateWalletBalances();
  renderNavWalletCount();
  renderSummaryCards();
  renderWalletsGrid();
  renderTransactions();
}

function renderNavWalletCount() {
  const badge = document.getElementById('nav-wallet-count');
  if (badge) {
    badge.textContent = appState.wallets.length;
  }
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
    }
  });

  const totalWalletBalance = appState.wallets.reduce((sum, w) => sum + (w.balance || 0), 0);

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
    let monthlyUsage = 0;
    let dailyUsage = 0;

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
    });

    const dailyLimitVal = w.dailyLimit || 60000;
    const monthlyLimitVal = w.monthlyLimit || 200000;
    const warnDaily = w.warnDailyLimit || appState.settings.safeDailyLimit || 35000;
    const dangerDaily = appState.settings.dangerDailyLimit || 45000;

    const dailyPercent = Math.min(100, Math.round((dailyUsage / dailyLimitVal) * 100));
    const monthlyPercent = Math.min(100, Math.round((monthlyUsage / monthlyLimitVal) * 100));

    let statusBadge = `<span class="badge bg-success small"><i class="uil uil-check-circle me-1"></i>طبيعي</span>`;
    if (dailyUsage > dangerDaily) {
      statusBadge = `<span class="badge bg-danger small"><i class="uil uil-multiply me-1"></i>تجاوز الحد</span>`;
    } else if (dailyUsage > warnDaily) {
      statusBadge = `<span class="badge bg-warning text-dark small"><i class="uil uil-exclamation-triangle me-1"></i>تحذير الاستخدام</span>`;
    }

    const initBal = parseFloat(w.initialBalance || 0);

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
              <span class="yellow-card-badge"><i class="uil uil-credit-card me-1"></i>بطاقة ${w.cardNumber}</span>
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
    }

    return `
      <tr>
        <td class="fw-bold text-muted">#${seqNum}</td>
        <td>${typeBadgeHtml}</td>
        <td>
          <div class="fw-bold text-dark">${escapeHtml(walletName)}</div>
          <small class="text-muted"><i class="uil uil-credit-card me-1"></i>بطاقة ${walletCard}</small>
        </td>
        <td class="fw-extrabold ${isIncome || isInitial ? 'text-success' : 'text-danger'}">
          ${isIncome || isInitial ? '+' : '-'}${formatMoney(tx.amount)}
        </td>
        <td>
          ${isIncome ? `<span class="badge bg-warning text-dark fw-bold">+${formatMoney(tx.netProfit)}</span>` : '-'}
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
  if (appState.wallets.length === 0) {
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

  const walletOptionsHtml = appState.wallets.map(w => 
    `<option value="${w.id}">${w.name} (الرصيد المتاح: ${formatMoney(w.balance)})</option>`
  ).join('');

  const nowISO = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const title = type === 'income' ? 'تسجيل معاملة واردة (مستلم)' : 'تسجيل معاملة سحب (مدفوع)';

  Swal.fire({
    title: title,
    html: `
      <div class="text-start mb-3">
        <label class="form-label fw-bold small">اختيار المحفظة</label>
        <select id="swal-wallet-id" class="form-select">${walletOptionsHtml}</select>
      </div>
      <div class="text-start mb-3">
        <label class="form-label fw-bold small">المبلغ الإجمالي (بالجنيه)</label>
        <input type="number" step="0.01" id="swal-amount" class="form-control" placeholder="مثال: 10000" oninput="calcSwalProfit('${type}')">
      </div>
      ${type === 'income' ? `
        <div class="alert alert-secondary p-2 small mb-3 text-start" id="swal-profit-info" style="display:none;">
          <div>عمولة العميل (${appState.settings.customerRate}%): <strong class="text-success" id="swal-cust-fee">0 ج.م</strong></div>
          <div>رسوم الخدمة (${appState.settings.fawryRate}%): <strong class="text-danger" id="swal-fawry-fee">0 ج.م</strong></div>
          <div>صافي الربح الإداري: <strong class="text-dark fw-bold" id="swal-net-profit">0 ج.م</strong></div>
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

function checkSecurityWarningsAndExecute(txData) {
  const { walletId, amount, type } = txData;
  const wallet = appState.wallets.find(w => w.id === walletId);
  const nowCairo = getCairoDateParts(new Date());

  let currentDaily = 0;

  appState.transactions.forEach(tx => {
    if (tx.walletId === walletId && tx.type === 'income') {
      const txCairo = getCairoDateParts(tx.date);
      if (txCairo.dateStr === nowCairo.dateStr) currentDaily += tx.amount;
    }
  });

  const warnDaily = wallet.warnDailyLimit || appState.settings.safeDailyLimit || 35000;

  if (type === 'income' && (currentDaily + amount) > warnDaily) {
    Swal.fire({
      icon: 'warning',
      title: 'تنبيه: تجاوز حد الاستخدام الموصى به',
      html: `
        <div class="text-start">
          <p class="mb-2">إجمالي الوارد اليومي لمحفظة <strong>(${wallet.name})</strong> سيصل إلى <strong>${formatMoney(currentDaily + amount)}</strong>.</p>
          <div class="alert alert-warning p-2 small mb-2">
            تجاوز حد الاستخدام اليومي (${formatMoney(warnDaily)}) ينقل المحفظة إلى مستوى المراقبة التشغيلية.
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

// --- Edit Wallet Modal ---
function openEditSingleWalletModal(walletId) {
  const wallet = appState.wallets.find(w => w.id === walletId);
  if (!wallet) return;

  Swal.fire({
    title: `تعديل بيانات (${wallet.name})`,
    html: `
      <div class="text-start mb-3">
        <label class="form-label fw-bold small">اسم المحفظة / الخط</label>
        <input type="text" id="edit-w-name" class="form-control" value="${escapeHtml(wallet.name)}">
      </div>
      <div class="row g-2 text-start mb-3">
        <div class="col-6">
          <label class="form-label fw-bold small">آخر 4 أرقام البطاقة</label>
          <input type="text" id="edit-w-card" maxlength="4" class="form-control" value="${escapeHtml(wallet.cardNumber)}">
        </div>
        <div class="col-6">
          <label class="form-label fw-bold small text-primary">الرصيد الافتتاحي (ج.م)</label>
          <input type="number" step="0.01" id="edit-w-init-bal" class="form-control border-primary" value="${wallet.initialBalance || 0}">
        </div>
      </div>
      <div class="row g-2 text-start mb-2">
        <div class="col-6">
          <label class="form-label fw-bold small">الحد اليومي (ج.م)</label>
          <input type="number" id="edit-w-daily" class="form-control" value="${wallet.dailyLimit || 60000}">
        </div>
        <div class="col-6">
          <label class="form-label fw-bold small">حد التحذير اليومي (ج.م)</label>
          <input type="number" id="edit-w-warn-daily" class="form-control" value="${wallet.warnDailyLimit || 35000}">
        </div>
        <div class="col-6">
          <label class="form-label fw-bold small">الحد الشهري (ج.م)</label>
          <input type="number" id="edit-w-monthly" class="form-control" value="${wallet.monthlyLimit || 200000}">
        </div>
        <div class="col-6">
          <label class="form-label fw-bold small">حد التحذير الشهري (ج.م)</label>
          <input type="number" id="edit-w-warn-monthly" class="form-control" value="${wallet.warnMonthlyLimit || 140000}">
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'حفظ التعديلات',
    cancelButtonText: 'إلغاء',
    confirmButtonColor: '#198754',
    preConfirm: () => {
      const name = document.getElementById('edit-w-name').value.trim();
      const cardNumber = document.getElementById('edit-w-card').value.trim();
      const initialBalance = parseFloat(document.getElementById('edit-w-init-bal').value) || 0;
      const dailyLimit = parseFloat(document.getElementById('edit-w-daily').value) || 60000;
      const warnDailyLimit = parseFloat(document.getElementById('edit-w-warn-daily').value) || 35000;
      const monthlyLimit = parseFloat(document.getElementById('edit-w-monthly').value) || 200000;
      const warnMonthlyLimit = parseFloat(document.getElementById('edit-w-warn-monthly').value) || 140000;

      if (!name || !cardNumber) {
        Swal.showValidationMessage('يرجى إدخال اسم المحفظة ورقم البطاقة.');
        return false;
      }

      return { name, cardNumber, initialBalance, dailyLimit, warnDailyLimit, monthlyLimit, warnMonthlyLimit };
    }
  }).then(result => {
    if (result.isConfirmed && result.value) {
      const prevInit = wallet.initialBalance || 0;
      const newInit = result.value.initialBalance;

      wallet.name = result.value.name;
      wallet.cardNumber = result.value.cardNumber;
      wallet.initialBalance = newInit;
      wallet.dailyLimit = result.value.dailyLimit;
      wallet.warnDailyLimit = result.value.warnDailyLimit;
      wallet.monthlyLimit = result.value.monthlyLimit;
      wallet.warnMonthlyLimit = result.value.warnMonthlyLimit;

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

// --- Manage All Wallets Modal ---
function openWalletsModal() {
  const walletsListHtml = appState.wallets.map(w => `
    <div class="d-flex justify-content-between align-items-center bg-light p-2 rounded mb-2 border">
      <div>
        <strong class="text-dark">${escapeHtml(w.name)}</strong> (بطاقة: ${w.cardNumber})
        <div class="small text-muted">
          الرصيد الافتتاحي: ${formatMoney(w.initialBalance || 0)} | الرصيد الحالي: ${formatMoney(w.balance)}
        </div>
      </div>
      <div>
        <button class="btn btn-sm btn-outline-primary me-1" onclick="openEditSingleWalletModal('${w.id}')"><i class="uil uil-edit"></i></button>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteWalletFromSwal('${w.id}')"><i class="uil uil-trash-alt"></i></button>
      </div>
    </div>
  `).join('');

  Swal.fire({
    title: `إدارة المحافظ (${appState.wallets.length})`,
    html: `
      <div class="mb-3 text-start">
        <h6 class="fw-bold mb-2">+ إضافة محفظة جديدة بيدك:</h6>
        <div class="row g-2">
          <div class="col-6">
            <input type="text" id="new-w-name" class="form-control form-control-sm" placeholder="اسم المحفظة">
          </div>
          <div class="col-6">
            <input type="text" id="new-w-card" maxlength="4" class="form-control form-control-sm" placeholder="آخر 4 أرقام البطاقة">
          </div>
          <div class="col-6">
            <label class="small text-primary fw-bold">الرصيد الافتتاحي (ج.م)</label>
            <input type="number" step="0.01" id="new-w-init-bal" class="form-control form-control-sm border-primary" value="0" placeholder="0">
          </div>
          <div class="col-6">
            <label class="small text-muted">الحد اليومي (ج.م)</label>
            <input type="number" id="new-w-daily" class="form-control form-control-sm" value="60000" placeholder="الحد اليومي">
          </div>
        </div>
        <button class="btn btn-sm btn-success w-100 mt-2 fw-bold" onclick="addNewWalletFromSwal()">+ حفظ وإضافة المحفظة</button>
      </div>
      <hr>
      <div class="text-start">
        <h6 class="fw-bold mb-2">المحافظ المسجلة حالياً (${appState.wallets.length}):</h6>
        <div style="max-height: 200px; overflow-y: auto;">
          ${walletsListHtml || '<div class="text-muted small">لا توجد محافظ مسجلة حتى الآن.</div>'}
        </div>
      </div>
    `,
    showConfirmButton: false,
    showCloseButton: true
  });
}

function addNewWalletFromSwal() {
  const name = document.getElementById('new-w-name').value.trim();
  const cardNumber = document.getElementById('new-w-card').value.trim();
  const initialBalance = parseFloat(document.getElementById('new-w-init-bal').value) || 0;
  const dailyLimit = parseFloat(document.getElementById('new-w-daily').value) || 60000;

  if (!name || !cardNumber) {
    alert('يرجى كتابة اسم المحفظة ورقم البطاقة.');
    return;
  }

  const walletId = 'wallet_' + Date.now();

  const newWallet = {
    id: walletId,
    name,
    cardNumber,
    initialBalance,
    dailyLimit,
    warnDailyLimit: 35000,
    monthlyLimit: 200000,
    warnMonthlyLimit: 140000,
    balance: initialBalance
  };

  appState.wallets.push(newWallet);

  if (initialBalance > 0) {
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
    <div class="d-flex justify-content-between align-items-center p-2 bg-light rounded mb-2 border">
      <div>
        <strong class="text-dark">${escapeHtml(w.name)}</strong>
        <div class="small text-muted">
          بطاقة: ${w.cardNumber} | افتتاحي: ${formatMoney(w.initialBalance || 0)}
        </div>
      </div>
      <div class="text-end">
        <span class="badge ${w.balance > 0 ? 'bg-primary' : 'bg-secondary'} fs-6">
          الرصيد الحالي: ${formatMoney(w.balance)}
        </span>
      </div>
    </div>
  `).join('');

  Swal.fire({
    title: `ملخص رصيد المحافظ (${appState.wallets.length})`,
    html: `
      <div class="text-start" style="max-height: 300px; overflow-y: auto;">
        ${listHtml || '<div class="text-muted small">لا توجد محافظ مسجلة.</div>'}
      </div>
    `,
    confirmButtonText: 'إغلاق النافذة',
    confirmButtonColor: '#0d6efd'
  });
}

function openSecurityGuideModal() {
  Swal.fire({
    title: 'ضوابط وتوصيات إدارة المحافظ',
    html: `
      <div class="text-start small" style="max-height: 350px; overflow-y: auto;">
        <div class="alert alert-success p-2 mb-2">
          <strong>مستويات الاستخدام الموصى بها:</strong><br>
          • حد الوارد اليومي الموصى به: حتى 35,000 ج.م للمحفظة.<br>
          • حد الوارد الشهري الموصى به: حتى 140,000 ج.م.<br>
          • حد السحب اليومي الموصى به: حتى 25,000 ج.م للبطاقة.
        </div>
        <div class="alert alert-danger p-2 mb-2">
          <strong>مؤشرات الاستخدام المرتفع:</strong><br>
          • تجاوز 45,000 ج.م يومياً على محفظة واحدة.<br>
          • تكرار الوصول للحد النهائي (200,000 ج.م).<br>
          • إجراء عمليات سحب فورية عقب التحويلات مباشرة.
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
    title: 'إعدادات النظام وحدود التحذير العامة',
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
        <h6 class="fw-bold">حدود الأمان الافتراضية:</h6>
        <div class="row g-2">
          <div class="col-6">
            <label class="small text-muted">حد التحذير اليومي العام (ج.م)</label>
            <input type="number" id="swal-safe-daily" class="form-control form-control-sm" value="${appState.settings.safeDailyLimit || 35000}">
          </div>
          <div class="col-6">
            <label class="small text-muted">حد الخطر اليومي العام (ج.م)</label>
            <input type="number" id="swal-danger-daily" class="form-control form-control-sm" value="${appState.settings.dangerDailyLimit || 45000}">
          </div>
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
  const safeDaily = parseFloat(document.getElementById('swal-safe-daily').value) || 35000;
  const dangerDaily = parseFloat(document.getElementById('swal-danger-daily').value) || 45000;

  appState.settings.customerRate = custRate;
  appState.settings.fawryRate = fawryRate;
  appState.settings.safeDailyLimit = safeDaily;
  appState.settings.dangerDailyLimit = dangerDaily;

  saveToLocalStorage();
  renderAll();

  Swal.fire({
    icon: 'success',
    title: 'تم حفظ التعديلات بنجاح',
    timer: 1500,
    showConfirmButton: false
  });
}

function exportBackup() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appState, null, 2));
  const anchor = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  anchor.setAttribute("href", dataStr);
  anchor.setAttribute("download", `cashflow_backup_${dateStr}.json`);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (data.wallets && data.transactions) {
        appState.wallets = data.wallets;
        appState.transactions = data.transactions;
        appState.settings = data.settings || { ...DEFAULT_SETTINGS };
        saveToLocalStorage();
        renderAll();
        Swal.fire({ icon: 'success', title: 'تمت استعادة البيانات بنجاح' });
      } else {
        Swal.fire({ icon: 'error', title: 'خطأ', text: 'تنسيق الملف غير صالح.' });
      }
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'خطأ', text: 'حدث خطأ أثناء قراءة ملف الاستعادة.' });
    }
  };
  reader.readAsText(file);
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
      appState.settings = { ...DEFAULT_SETTINGS };
      saveToLocalStorage();
      renderAll();
      Swal.fire({ icon: 'success', title: 'تم تفريغ النظام بنجاح' });
    }
  });
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
