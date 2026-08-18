/**
 * 愛欣診所 LINE 管理系統 - 帳務管理模組 (finance.js)
 * 包含：進貨登記、待補發票管理、月報統計、CSV安全匯出
 */

// ==================== CSV 防注入安全函式 ====================
function sanitizeCsvCell(val) {
  if (val === null || val === undefined) return '""';
  let str = String(val).replace(/"/g, '""');
  // 若開頭為公式字元 (=, +, -, @, \t, \r)，前面加上單引號防止 Excel 執行惡意公式
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return `"${str}"`;
}

// ==================== 頁籤切換 ====================
function switchFinTab(tabKey) {
  const tabs = ['register', 'invoice', 'report'];
  tabs.forEach(t => {
    const sec = document.getElementById(`fin-sec-${t}`);
    const btn = document.getElementById(`fin-tab-${t}`);
    if (sec) sec.classList.toggle('hidden', t !== tabKey);
    if (btn) {
      if (t === tabKey) {
        btn.className = 'py-2 rounded-lg bg-slate-900 text-white shadow-xs';
      } else {
        btn.className = 'py-2 rounded-lg hover:text-slate-900 transition text-slate-600';
      }
    }
  });

  if (tabKey === 'invoice') loadPendingInvoices();
  if (tabKey === 'report') loadSupplierTimeline();
}

// ==================== 表單模式切換 ====================
function updateFormMode() {
  const type = document.querySelector('input[name="type"]:checked')?.value || 'delivery';
  const supGroup = document.getElementById('supplier-group');
  const catGroup = document.getElementById('category-group');
  const docSec = document.getElementById('delivery-doc-mode-section');

  if (type === 'delivery' || type === 'pharma') {
    supGroup.classList.remove('hidden');
    catGroup.classList.add('hidden');
    docSec.classList.remove('hidden');
  } else {
    supGroup.classList.add('hidden');
    catGroup.classList.remove('hidden');
    docSec.classList.add('hidden');
    initCategoryOptions(type);
  }
  toggleDocMode();
}

function initCategoryOptions(type) {
  const catSelect = document.getElementById('category');
  if (!catSelect) return;
  catSelect.innerHTML = '';
  
  const options = type === 'income' 
    ? ['掛號費收入', '自費項目收入', '其他收入']
    : ['診所耗材雜支', '水電瓦斯清潔', '文具印刷', '其他零用金'];

  options.forEach(opt => {
    const el = document.createElement('option');
    el.value = opt;
    el.innerText = opt;
    catSelect.appendChild(el);
  });
}

function toggleDocMode() {
  const type = document.querySelector('input[name="type"]:checked')?.value;
  const isDelivery = (type === 'delivery' || type === 'pharma');
  const docMode = document.querySelector('input[name="doc_mode"]:checked')?.value;

  const receiptBox = document.getElementById('doc-receipt-box');
  const invoiceBox = document.getElementById('doc-invoice-box');

  if (!isDelivery) {
    receiptBox.classList.remove('hidden');
    invoiceBox.classList.add('hidden');
    return;
  }

  if (docMode === 'has_invoice') {
    receiptBox.classList.add('hidden');
    invoiceBox.classList.remove('hidden');
  } else {
    receiptBox.classList.remove('hidden');
    invoiceBox.classList.add('hidden');
  }
}

// ==================== 發票重複檢查 ====================
async function checkDuplicateInvoice(invNo, warnElemId) {
  if (!invNo) return;
  const warnElem = document.getElementById(warnElemId);
  const cleanInv = invNo.trim().toUpperCase();

  try {
    const { data, error } = await supabaseClient
      .from('cash_log')
      .select('id, supplier, amount')
      .eq('invoice_no', cleanInv)
      .maybeSingle();

    if (warnElem) {
      if (data) {
        warnElem.innerText = `⚠️ 發票已存在！廠商: ${data.supplier}, 金額: $${data.amount}`;
        warnElem.classList.remove('hidden');
      } else {
        warnElem.classList.add('hidden');
      }
    }
  } catch (err) {
    console.error('發票檢查失敗:', err);
  }
}

// ==================== 現場登記送出 ====================
document.addEventListener('DOMContentLoaded', () => {
  const cashForm = document.getElementById('cash-form');
  if (cashForm) {
    cashForm.addEventListener('submit', handleCashLogSubmit);
  }
});

async function handleCashLogSubmit(e) {
  e.preventDefault();

  if (!currentUser.empId) {
    alert('⚠️ 您的帳號尚未完成員工綁定，無法送出！');
    return;
  }

  const type = document.querySelector('input[name="type"]:checked').value;
  const isDelivery = (type === 'delivery' || type === 'pharma');
  const docMode = isDelivery ? document.querySelector('input[name="doc_mode"]:checked').value : 'receipt_only';

  const supplier = isDelivery ? document.getElementById('supplier').value.trim() : '';
  const category = !isDelivery ? document.getElementById('category').value : '';
  const note = document.getElementById('note').value.trim();

  let invoiceNo = '';
  let amount = null;
  let status = '待核銷';

  if (isDelivery) {
    if (!supplier) {
      alert('請填寫進貨廠商名稱！');
      return;
    }
    if (docMode === 'has_invoice') {
      invoiceNo = document.getElementById('reg-invoice-no').value.trim().toUpperCase();
      const amtRaw = document.getElementById('amount').value;
      amount = parseFloat(amtRaw);

      if (isNaN(amount) || amount <= 0) {
        alert('請輸入有效的發票總金額！');
        return;
      }
      status = '已附發票待付款';
    } else {
      status = '待補發票';
    }
  } else {
    // 零用金或收入
    status = '已完成';
  }

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.innerText = '儲存中...';

  try {
    const { error } = await supabaseClient.from('cash_log').insert([{
      line_user_id: currentUser.lineUserId,
      created_by: currentUser.empId,
      user_name: currentUser.displayName,
      type: type,
      supplier: supplier || null,
      category: category || null,
      amount: amount,
      invoice_no: invoiceNo || null,
      note: note,
      status: status
    }]);

    if (error) throw error;

    alert('🎉 登記成功！');
    document.getElementById('cash-form').reset();
    updateFormMode();
  } catch (err) {
    console.error('送出失敗:', err);
    alert('登記失敗：' + (err.message.includes('idx_unique_invoice_no') ? '此發票號碼已被登記過！' : err.message));
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = '確認點收並送出';
  }
}

// ==================== 待補發票列表 ====================
async function loadPendingInvoices() {
  const container = document.getElementById('pending-invoice-list');
  if (!container) return;
  container.innerHTML = '<div class="text-center text-slate-400 py-4">載入中...</div>';

  try {
    const { data, error } = await supabaseClient
      .from('cash_log')
      .select('*')
      .eq('status', '待補發票')
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = '<div class="text-center text-emerald-600 font-bold py-6">🎉 目前沒有待補發票的項目！</div>';
      return;
    }

    container.innerHTML = data.map(item => `
      <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
        <div>
          <div class="font-bold text-slate-800">${item.supplier || '未指定廠商'}</div>
          <div class="text-[10px] text-slate-500">${new Date(item.created_at).toLocaleDateString()} | 登記人: ${item.user_name || '無'}</div>
          ${item.note ? `<div class="text-[11px] text-slate-600 mt-0.5">備註: ${item.note}</div>` : ''}
        </div>
        <button onclick="openInvoiceModal('${item.id}')" class="bg-indigo-600 text-white font-bold px-3 py-1.5 rounded-lg hover:bg-indigo-700 shadow-xs">
          🧾 補發票
        </button>
      </div>
    `).join('');
  } catch (err) {
    console.error('讀取待補發票清單失敗:', err);
    container.innerHTML = '<div class="text-center text-rose-500 py-4">讀取失敗</div>';
  }
}

// ==================== 發票補登彈窗 ====================
function openInvoiceModal(id) {
  document.getElementById('modal-id').value = id;
  document.getElementById('modal-invoice-no').value = '';
  document.getElementById('modal-amount').value = '';
  
  // 預設付款日為次月最後一天
  const nextMonthLastDay = new Date(new Date().getFullYear(), new Date().getMonth() + 2, 0);
  document.getElementById('modal-due-date').value = nextMonthLastDay.toISOString().split('T')[0];

  document.getElementById('invoice-modal').classList.remove('hidden');
}

function closeInvoiceModal() {
  document.getElementById('invoice-modal').classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', () => {
  const modalForm = document.getElementById('modal-invoice-form');
  if (modalForm) {
    modalForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('modal-id').value;
      const invNo = document.getElementById('modal-invoice-no').value.trim().toUpperCase();
      const amount = parseFloat(document.getElementById('modal-amount').value);
      const dueDate = document.getElementById('modal-due-date').value;

      if (isNaN(amount) || amount <= 0) {
        alert('請輸入大於 0 的有效金額！');
        return;
      }

      try {
        const { error } = await supabaseClient
          .from('cash_log')
          .update({
            invoice_no: invNo,
            amount: amount,
            due_date: dueDate,
            status: '已附發票待付款'
          })
          .eq('id', id);

        if (error) throw error;

        alert('✅ 發票補登成功！已列入待付款。');
        closeInvoiceModal();
        loadPendingInvoices();
      } catch (err) {
        console.error('補登發票失敗:', err);
        alert('補登失敗：' + (err.message.includes('idx_unique_invoice_no') ? '此發票號碼已被登記過！' : err.message));
      }
    });
  }
});

// ==================== 月報與 CSV 匯出 ====================
function loadSupplierTimeline() {
  const repMonth = document.getElementById('report-month');
  if (repMonth && !repMonth.value) {
    const now = new Date();
    repMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}

async function exportCsvReport() {
  const month = document.getElementById('report-month').value;
  if (!month) {
    alert('請先選擇月份！');
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from('cash_log')
      .select('*')
      .gte('created_at', `${month}-01T00:00:00`)
      .lte('created_at', `${month}-31T23:59:59`)
      .order('created_at', { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      alert('該月份無任何紀錄！');
      return;
    }

    // 加上 BOM 避免 Excel 開啟亂碼，並使用安全轉義
    let csv = '\uFEFF時間,類型,廠商/項目,金額,發票號碼,備註,登記人\n';
    data.forEach(d => {
      csv += `${sanitizeCsvCell(d.created_at)},` +
             `${sanitizeCsvCell(d.type)},` +
             `${sanitizeCsvCell(d.supplier || d.category || '')},` +
             `${Number(d.amount) || 0},` +
             `${sanitizeCsvCell(d.invoice_no || '')},` +
             `${sanitizeCsvCell(d.note || '')},` +
             `${sanitizeCsvCell(d.user_name || '')}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `愛欣診所帳務月報_${month}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error('匯出 CSV 失敗:', err);
    alert('匯出失敗：' + err.message);
  }
}
