/**
 * 愛欣診所 LINE 管理系統 - 帳務管理模組 (finance.js)
 */

let cachedAllFinanceData = [];

function switchFinTab(tab) {
  ['register', 'invoice', 'report'].forEach(t => {
    document.getElementById(`fin-sec-${t}`)?.classList.add('hidden');
    const tb = document.getElementById(`fin-tab-${t}`);
    if (tb) tb.className = "py-2 rounded-lg hover:text-slate-900 transition text-slate-600";
  });
  document.getElementById(`fin-sec-${tab}`)?.classList.remove('hidden');
  const activeTb = document.getElementById(`fin-tab-${tab}`);
  if (activeTb) activeTb.className = "py-2 rounded-lg bg-slate-900 text-white shadow-sm transition";

  if (tab === 'register') initFinanceDefaults();
  if (tab === 'invoice') loadPendingInvoices();
  if (tab === 'report') loadFinanceReportData();
}

function initFinanceDefaults() {
  const today = new Date();
  const repMonth = document.getElementById('report-month');
  if (repMonth && !repMonth.value) {
    repMonth.value = `${today.getFullYear()} - ${String(today.getMonth() + 1).padStart(2, '0')}`;
  }
  updateFormMode();
}

const categoryOptions = {
  expense: ['文具雜項', '清潔衛生用品', '餐飲茶水', '郵資快遞', '車資旅費', '維修保養', '其他零用金支出'],
  income: ['自費門診收入', '自費衛材收入', '洗腎相關自費', '其他收入']
};

function updateFormMode() {
  const typeElem = document.querySelector('input[name="type"]:checked');
  if (!typeElem) return;
  const type = typeElem.value;
  const supplierGroup = document.getElementById('supplier-group');
  const categoryGroup = document.getElementById('category-group');
  const deliveryDocSection = document.getElementById('delivery-doc-mode-section');

  if (type === 'delivery' || type === 'pharma') {
    supplierGroup?.classList.remove('hidden');
    categoryGroup?.classList.add('hidden');
    deliveryDocSection?.classList.remove('hidden');
    toggleDocMode();
  } else {
    supplierGroup?.classList.add('hidden');
    categoryGroup?.classList.remove('hidden');
    deliveryDocSection?.classList.add('hidden');

    const categorySelect = document.getElementById('category');
    if (categorySelect) {
      categorySelect.innerHTML = '';
      (categoryOptions[type] || []).forEach(item => {
        const opt = document.createElement('option');
        opt.value = item;
        opt.innerText = item;
        categorySelect.appendChild(opt);
      });
    }
  }
}

function toggleDocMode() {
  const mode = document.querySelector('input[name="doc_mode"]:checked')?.value || 'receipt_only';
  const receiptBox = document.getElementById('doc-receipt-box');
  const invoiceBox = document.getElementById('doc-invoice-box');
  const receiptInput = document.getElementById('receipt');

  if (mode === 'receipt_only') {
    receiptBox?.classList.remove('hidden');
    invoiceBox?.classList.add('hidden');
    if (receiptInput) receiptInput.required = true;
  } else {
    receiptBox?.classList.add('hidden');
    invoiceBox?.classList.remove('hidden');
    if (receiptInput) receiptInput.required = false;
  }
}

async function processInvoiceImage(inputElem, targetNoId, targetAmtId, statusElemId) {
  if (!inputElem.files || inputElem.files.length === 0) return;
  const file = inputElem.files[0];
  alert('📸 發票辨識引擎處理中...');
  const match = file.name.match(/[A-Z]{2}\d{8}/i);
  if (match) {
    document.getElementById(targetNoId).value = match[0].toUpperCase();
  }
}

const cashForm = document.getElementById('cash-form');
if (cashForm) {
  cashForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const client = window.supabaseClient;
    if (!client) return alert('資料庫未連線');

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;

    try {
      const type = document.querySelector('input[name="type"]:checked').value;
      const note = document.getElementById('note').value;
      let supplier = null;
      let category = null;
      let amount = 0;
      let invoiceNo = null;
      let status = 'paid';

      if (type === 'delivery' || type === 'pharma') {
        supplier = document.getElementById('supplier').value;
        category = type === 'delivery' ? '衛材進貨點收' : '藥品進貨點收';
        const docMode = document.querySelector('input[name="doc_mode"]:checked').value;
        if (docMode === 'has_invoice') {
          invoiceNo = document.getElementById('reg-invoice-no').value.trim().toUpperCase();
          amount = parseFloat(document.getElementById('amount').value) || 0;
          status = 'unpaid';
        } else {
          status = 'pending_invoice';
        }
      } else {
        category = document.getElementById('category').value;
        amount = parseFloat(document.getElementById('amount').value) || 0;
      }

      const { error } = await client.from('cash_log').insert([{
        line_user_id: currentUser.lineUserId || 'manual_user',
        user_name: currentUser.displayName,
        type: type,
        supplier: supplier,
        category: category,
        amount: amount,
        invoice_no: invoiceNo,
        note: note,
        status: status
      }]);

      if (error) throw error;
      alert('🎉 帳務紀錄登記成功！');
      cashForm.reset();
      updateFormMode();
    } catch (err) {
      alert('登記失敗：' + err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function loadPendingInvoices() {
  const client = window.supabaseClient;
  const container = document.getElementById('pending-invoice-list');
  if (!client || !container) return;

  const { data } = await client.from('cash_log').select('*').eq('status', 'pending_invoice').order('created_at', { ascending: false });
  if (!data || data.length === 0) {
    container.innerHTML = '<p class="text-slate-400 text-center py-4 text-xs">🎉 目前無待補發票項目</p>';
    return;
  }

  container.innerHTML = '';
  data.forEach(item => {
    const div = document.createElement('div');
    div.className = "bg-white p-2.5 rounded-xl border border-slate-200 text-xs flex justify-between items-center";
    div.innerHTML = `
      <div>
        <div class="font-bold text-slate-800">${item.supplier || item.category}</div>
        <div class="text-[10px] text-slate-400">${item.note || '無備註'}</div>
      </div>
      <span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded">待補發票</span>
    `;
    container.appendChild(div);
  });
}

async function loadFinanceReportData() {
  const client = window.supabaseClient;
  if (!client) return;
  const { data } = await client.from('cash_log').select('*');
  cachedAllFinanceData = data || [];

  const pendingCount = cachedAllFinanceData.filter(d => d.status === 'pending_invoice').length;
  const unpaidTotal = cachedAllFinanceData.filter(d => d.status === 'unpaid').reduce((s, d) => s + (Number(d.amount) || 0), 0);

  const pcElem = document.getElementById('stat-pending-count');
  const utElem = document.getElementById('stat-unpaid-total');
  if (pcElem) pcElem.innerText = `${pendingCount} 筆`;
  if (utElem) utElem.innerText = `NT$ ${unpaidTotal.toLocaleString()}`;
}

function generateMonthlyReport() {
  const month = document.getElementById('report-month')?.value;
  if (!month) return;
  const monthData = cachedAllFinanceData.filter(d => d.created_at?.startsWith(month));

  let inc = 0, exp = 0, del = 0;
  monthData.forEach(d => {
    const a = Number(d.amount) || 0;
    if (d.type === 'income') inc += a;
    if (d.type === 'expense') exp += a;
    if (d.type === 'delivery' || d.type === 'pharma') del += a;
  });

  document.getElementById('rep-income').innerText = `NT$ ${inc.toLocaleString()}`;
  document.getElementById('rep-expense').innerText = `NT$ ${exp.toLocaleString()}`;
  document.getElementById('rep-delivery').innerText = `NT$ ${del.toLocaleString()}`;
  document.getElementById('report-period').innerText = `統計月份：${month}`;
  document.getElementById('report-result-box')?.classList.remove('hidden');
}

function exportCsvReport() {
  const month = document.getElementById('report-month')?.value || '2026-08';
  let csv = "時間,類別,廠商,分類,金額,發票,狀態\n";
  cachedAllFinanceData.forEach(d => {
    csv += `"${d.created_at}","${d.type}","${d.supplier || ''}","${d.category || ''}","${d.amount}","${d.invoice_no || ''}","${d.status}"\n`;
  });
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `愛欣帳務月報_${month}.csv`;
  a.click();
}
