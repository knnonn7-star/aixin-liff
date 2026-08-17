// ==================== 愛欣診所 帳務與進貨管理模組 (finance.js) ====================
let pendingInvoices = [];
let allFinanceRecords = [];

// ==================== 頁籤切換 ====================
function switchFinTab(tab) {
  ['register', 'invoice', 'report'].forEach(t => {
    document.getElementById(`fin-sec-${t}`)?.classList.add('hidden');
    const tabBtn = document.getElementById(`fin-tab-${t}`);
    if (tabBtn) tabBtn.className = "py-2 rounded-lg hover:text-slate-900 transition";
  });
  document.getElementById(`fin-sec-${tab}`)?.classList.remove('hidden');
  const activeTab = document.getElementById(`fin-tab-${tab}`);
  if (activeTab) activeTab.className = "py-2 rounded-lg bg-slate-900 text-white shadow-xs transition";

  if (tab === 'invoice') loadPendingInvoices();
  if (tab === 'report') loadReportData();
}

function initFinanceDefaults() {
  const today = new Date();
  const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const repMonth = document.getElementById('report-month');
  if (repMonth && !repMonth.value) repMonth.value = monthStr;
}

function updateFormMode() {
  const type = document.querySelector('input[name="type"]:checked')?.value;
  const supplierGroup = document.getElementById('supplier-group');
  const categoryGroup = document.getElementById('category-group');
  const deliveryDocModeSection = document.getElementById('delivery-doc-mode-section');
  const docReceiptBox = document.getElementById('doc-receipt-box');
  const docInvoiceBox = document.getElementById('doc-invoice-box');

  if (type === 'delivery' || type === 'pharma') {
    supplierGroup?.classList.remove('hidden');
    categoryGroup?.classList.add('hidden');
    deliveryDocModeSection?.classList.remove('hidden');
    toggleDocMode();
  } else if (type === 'expense' || type === 'income') {
    supplierGroup?.classList.add('hidden');
    categoryGroup?.classList.remove('hidden');
    deliveryDocModeSection?.classList.add('hidden');
    docReceiptBox?.classList.add('hidden');
    docInvoiceBox?.classList.remove('hidden');
  }
}

function toggleDocMode() {
  const docMode = document.querySelector('input[name="doc_mode"]:checked')?.value;
  const docReceiptBox = document.getElementById('doc-receipt-box');
  const docInvoiceBox = document.getElementById('doc-invoice-box');

  if (docMode === 'has_invoice') {
    docReceiptBox?.classList.remove('hidden');
    docInvoiceBox?.classList.remove('hidden');
  } else {
    docReceiptBox?.classList.remove('hidden');
    docInvoiceBox?.classList.add('hidden');
  }
}

// ==================== 發票重複查重防呆機制 ====================
async function checkDuplicateInvoice(invNo, warnElemId) {
  const warnElem = document.getElementById(warnElemId);
  const cleanInv = (invNo || '').trim().toUpperCase();
  if (warnElem) warnElem.classList.add('hidden');

  if (!cleanInv || cleanInv.length < 8) return false;

  const { data } = await supabaseClient
    .from('clinic_cash_flow')
    .select('id, supplier, created_at, amount')
    .eq('invoice_number', cleanInv)
    .limit(1);

  if (data && data.length > 0) {
    const rec = data[0];
    if (warnElem) {
      warnElem.innerText = `🚨 警告：此發票已於 ${rec.created_at.substring(0, 10)} 由「${rec.supplier || '其他項目'}」登錄過 (NT$ ${rec.amount})！`;
      warnElem.classList.remove('hidden');
    }
    return true;
  }
  return false;
}

// ==================== OCR 智能辨識與手開發票容錯處理 ====================
async function processInvoiceImageWithVerification(fileInput, invFieldId, amtFieldId, statusElemId) {
  const file = fileInput.files[0];
  if (!file) return;

  const statusElem = document.getElementById(statusElemId);
  if (statusElem) statusElem.innerText = "⏳ 發票辨識中...";

  try {
    const { data: { text } } = await Tesseract.recognize(file, 'eng+chi_tra', {
      logger: m => {
        if (statusElem && m.status === 'recognizing text') {
          statusElem.innerText = `⏳ 辨識中 (${Math.floor(m.progress * 100)}%)`;
        }
      }
    });

    // 1. 抓取發票號碼 (2碼英文字母 + 8碼數字)
    const invMatch = text.match(/[A-Z]{2}[-\s]?[0-9]{8}/i);
    if (invMatch) {
      const invClean = invMatch[0].replace(/[-\s]/g, '').toUpperCase();
      document.getElementById(invFieldId).value = invClean;
      checkDuplicateInvoice(invClean, invFieldId === 'reg-invoice-no' ? 'reg-inv-warn' : 'modal-inv-warn');
    }

    // 2. 抓取金額 (總計、新台幣、NT$ 或數字)
    const amtMatch = text.match(/(總計|合計|新台幣|金額|NT\$?)[^\d]*([\d,]+)/i);
    if (amtMatch) {
      const numStr = amtMatch[2].replace(/,/g, '');
      document.getElementById(amtFieldId).value = numStr;
    }

    if (statusElem) statusElem.innerText = "✅ 辨識完成 (請核對校正)";
  } catch (err) {
    if (statusElem) statusElem.innerText = "⚠️ 辨識不全，請手動輸入";
  }
}

// ==================== 現場登記送出 ====================
document.getElementById('cash-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const type = document.querySelector('input[name="type"]:checked')?.value;
  const supplier = document.getElementById('supplier')?.value;
  const docMode = document.querySelector('input[name="doc_mode"]:checked')?.value;
  const invNo = document.getElementById('reg-invoice-no')?.value?.trim()?.toUpperCase();
  const amount = parseFloat(document.getElementById('amount')?.value) || 0;
  const note = document.getElementById('note')?.value;
  const receiptFile = document.getElementById('receipt')?.files[0];

  // 查重防呆
  if (invNo && invNo.length >= 8) {
    const isDup = await checkDuplicateInvoice(invNo, 'reg-inv-warn');
    if (isDup) {
      if (!confirm('🚨 此發票號碼已在系統中存在，確定要重複登記嗎？')) return;
    }
  }

  let receiptUrl = null;
  if (receiptFile) {
    const fileName = `receipts/${Date.now()}_${receiptFile.name}`;
    const { data: uploadData, error: uploadErr } = await supabaseClient.storage
      .from('clinic-docs')
      .upload(fileName, receiptFile);
    if (!uploadErr && uploadData) {
      receiptUrl = uploadData.path;
    }
  }

  const today = new Date();
  const nextMonthEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0).toISOString().split('T')[0];

  const payload = {
    type: type,
    supplier: (type === 'delivery' || type === 'pharma') ? supplier : null,
    category: (type === 'expense' || type === 'income') ? document.getElementById('category')?.value : null,
    amount: amount,
    invoice_number: invNo || null,
    receipt_url: receiptUrl,
    note: note,
    status: (docMode === 'receipt_only' && (type === 'delivery' || type === 'pharma')) ? 'pending_invoice' : 'approved',
    due_date: (type === 'delivery' || type === 'pharma') ? nextMonthEnd : null,
    is_cleared: (type === 'expense' || type === 'income')
  };

  const { error } = await supabaseClient.from('clinic_cash_flow').insert([payload]);
  if (error) {
    alert('登記失敗：' + error.message);
  } else {
    alert('✅ 登記成功！');
    document.getElementById('cash-form').reset();
    updateFormMode();
    if (document.getElementById('fin-sec-report')?.classList.contains('hidden') === false) {
      loadReportData();
    }
  }
});

// ==================== 待補發票載入與補登 ====================
async function loadPendingInvoices() {
  const { data } = await supabaseClient
    .from('clinic_cash_flow')
    .select('*')
    .eq('status', 'pending_invoice')
    .order('created_at', { ascending: false });

  pendingInvoices = data || [];
  const container = document.getElementById('pending-invoice-list');
  if (!container) return;

  if (pendingInvoices.length === 0) {
    container.innerHTML = '<p class="text-slate-400 text-center py-4">目前無待補發票項目 🎉</p>';
    return;
  }

  container.innerHTML = '';
  pendingInvoices.forEach(item => {
    const div = document.createElement('div');
    div.className = "flex justify-between items-center bg-white p-3 rounded-xl border border-slate-200 text-xs shadow-xs";
    div.innerHTML = `
      <div>
        <div class="font-bold text-slate-800">${item.supplier || '未指定廠商'} <span class="text-rose-600">(待補發票)</span></div>
        <div class="text-[11px] text-slate-500">進貨日: ${item.created_at.substring(0, 10)} ｜ 備註: ${item.note || '無'}</div>
      </div>
      <button onclick="openInvoiceModal('${item.id}')" class="bg-indigo-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-indigo-700 shadow-xs">
        補登發票
      </button>
    `;
    container.appendChild(div);
  });
}

function openInvoiceModal(id) {
  document.getElementById('modal-id').value = id;
  document.getElementById('invoice-modal').classList.remove('hidden');
}

function closeInvoiceModal() {
  document.getElementById('invoice-modal').classList.add('hidden');
}

document.getElementById('modal-invoice-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('modal-id').value;
  const invNo = document.getElementById('modal-invoice-no').value.trim().toUpperCase();
  const amount = parseFloat(document.getElementById('modal-amount').value) || 0;
  const dueDate = document.getElementById('modal-due-date').value;

  const isDup = await checkDuplicateInvoice(invNo, 'modal-inv-warn');
  if (isDup) {
    if (!confirm('🚨 此發票號碼已在系統中存在，確定重複登錄嗎？')) return;
  }

  const { error } = await supabaseClient.from('clinic_cash_flow').update({
    invoice_number: invNo,
    amount: amount,
    due_date: dueDate,
    status: 'approved'
  }).eq('id', id);

  if (error) {
    alert('補登失敗：' + error.message);
  } else {
    alert('✅ 發票補登成功！已自動歸入應付帳款。');
    closeInvoiceModal();
    loadPendingInvoices();
  }
});

// ==================== 雙軌月結報表與應付帳款統計 ====================
async function loadReportData() {
  const { data } = await supabaseClient.from('clinic_cash_flow').select('*').order('created_at', { ascending: false });
  allFinanceRecords = data || [];

  // 1. 待補發票總數
  const pendingCount = allFinanceRecords.filter(r => r.status === 'pending_invoice').length;
  document.getElementById('stat-pending-count').innerText = `${pendingCount} 筆`;

  // 2. 未結應付總額
  let unpaidTotal = 0;
  allFinanceRecords.filter(r => (r.type === 'delivery' || r.type === 'pharma') && !r.is_cleared && r.status === 'approved').forEach(r => {
    unpaidTotal += Number(r.amount) || 0;
  });
  document.getElementById('stat-unpaid-total').innerText = `NT$ ${unpaidTotal.toLocaleString()}`;

  generateMonthlyReport();
}

function generateMonthlyReport() {
  initFinanceDefaults();
  const monthStr = document.getElementById('report-month')?.value;
  if (!monthStr || allFinanceRecords.length === 0) return;

  const basis = document.querySelector('input[name="report-basis"]:checked')?.value || 'event_date';

  let income = 0;
  let expense = 0;
  let delivery = 0;
  const supplierBreakdown = {};

  allFinanceRecords.forEach(r => {
    const dateToCheck = (basis === 'due_date' && r.due_date) ? r.due_date.substring(0, 7) : r.created_at.substring(0, 7);

    if (dateToCheck === monthStr) {
      const amt = Number(r.amount) || 0;
      if (r.type === 'income') income += amt;
      else if (r.type === 'expense') expense += amt;
      else if (r.type === 'delivery' || r.type === 'pharma') {
        delivery += amt;
        const sup = r.supplier || '其他廠商';
        supplierBreakdown[sup] = (supplierBreakdown[sup] || 0) + amt;
      }
    }
  });

  const net = income - expense - delivery;

  document.getElementById('rep-income').innerText = `NT$ ${income.toLocaleString()}`;
  document.getElementById('rep-expense').innerText = `NT$ ${expense.toLocaleString()}`;
  document.getElementById('rep-delivery').innerText = `NT$ ${delivery.toLocaleString()}`;
  document.getElementById('rep-net').innerText = `NT$ ${net.toLocaleString()}`;
  document.getElementById('report-period').innerText = `(${monthStr} 依${basis === 'due_date' ? '付款到期日' : '進貨發生日'})`;

  const supList = document.getElementById('rep-supplier-breakdown');
  if (supList) {
    supList.innerHTML = '';
    for (const [sup, amt] of Object.entries(supplierBreakdown)) {
      const li = document.createElement('li');
      li.className = "flex justify-between border-b border-slate-100 py-0.5";
      li.innerHTML = `<span>${sup}</span><span class="font-bold text-slate-700">NT$ ${amt.toLocaleString()}</span>`;
      supList.appendChild(li);
    }
  }

  document.getElementById('report-result-box')?.classList.remove('hidden');
}

// 匯出 CSV
function exportCsvReport() {
  const monthStr = document.getElementById('report-month')?.value;
  if (!monthStr) return alert('請先選擇月份！');

  let csvContent = "data:text/csv;charset=utf-8,登記日期,類型,廠商/分類,發票號碼,金額,到期日,狀態,備註\n";

  allFinanceRecords.filter(r => r.created_at.startsWith(monthStr)).forEach(r => {
    csvContent += `"${r.created_at.substring(0,10)}","${r.type}","${r.supplier || r.category || ''}","${r.invoice_number || ''}","${r.amount}","${r.due_date || ''}","${r.status}","${r.note || ''}"\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `愛欣診所帳務月報_${monthStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
