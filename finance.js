// ==================== 帳務管理與 OCR 模組 ====================
let cachedAllData = [];

function switchFinTab(tab) {
  ['register', 'invoice', 'report'].forEach(t => {
    document.getElementById(`fin-sec-${t}`)?.classList.add('hidden');
    const tabBtn = document.getElementById(`fin-tab-${t}`);
    if (tabBtn) tabBtn.className = "py-2 rounded-lg hover:text-slate-900 transition";
  });
  document.getElementById(`fin-sec-${tab}`)?.classList.remove('hidden');
  const activeTab = document.getElementById(`fin-tab-${tab}`);
  if (activeTab) activeTab.className = "py-2 rounded-lg bg-slate-900 text-white shadow-sm transition";

  if (tab === 'invoice') loadPendingInvoices();
  if (tab === 'report') loadAdminData();
}

function initFinanceDefaults() {
  const today = new Date();
  const repMonth = document.getElementById('report-month');
  if (repMonth) repMonth.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
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
      categoryOptions[type].forEach(item => {
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

async function checkDuplicateInvoiceNo(invoiceNo, excludeId = null) {
  if (!invoiceNo) return 0;
  let query = supabaseClient.from('cash_log').select('id', { count: 'exact' }).eq('invoice_no', invoiceNo.trim().toUpperCase());
  if (excludeId) query = query.neq('id', excludeId);
  const { count } = await query;
  return count || 0;
}

function parseInvoiceQr(text) {
  if (!text || text.length < 10) return null;
  const invNo = text.substring(0, 10);
  if (!/^[A-Z]{2}\d{8}$/i.test(invNo)) return null;

  let amt = null;
  if (text.length >= 37) {
    const hex = text.substring(29, 37);
    const val = parseInt(hex, 16);
    if (!isNaN(val) && val > 0 && val < 50000000) amt = val;
  }
  return { invoiceNo: invNo.toUpperCase(), amount: amt };
}

function loadImageCanvas(file, maxWidth = 1400) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        h = Math.round((h * maxWidth) / w);
        w = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function cropCanvas(sourceCanvas, startXRatio, endXRatio) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const cropW = Math.round(w * (endXRatio - startXRatio));
  const cropX = Math.round(w * startXRatio);
  const target = document.createElement('canvas');
  target.width = cropW;
  target.height = h;
  const ctx = target.getContext('2d');
  ctx.drawImage(sourceCanvas, cropX, 0, cropW, h, 0, 0, cropW, h);
  return target;
}

async function processInvoiceImage(inputElem, targetNoId, targetAmtId, statusElemId) {
  if (!inputElem.files || inputElem.files.length === 0) return;
  const file = inputElem.files[0];
  const statusTag = document.getElementById(statusElemId);
  if (statusTag) statusTag.innerText = "⚡ 影像解析中...";

  try {
    let detected = null;
    const mainCanvas = await loadImageCanvas(file, 1400);

    if ('BarcodeDetector' in window) {
      try {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        const barcodes = await detector.detect(mainCanvas);
        for (let b of barcodes) {
          const res = parseInvoiceQr(b.rawValue);
          if (res) { detected = res; break; }
        }
      } catch (e) { }
    }

    if (!detected) {
      const leftCanvas = cropCanvas(mainCanvas, 0, 0.65);
      const blobLeft = await new Promise(r => leftCanvas.toBlob(r, 'image/jpeg', 0.95));
      try {
        const html5Qr = new Html5Qrcode("pending-invoice-list");
        const decodedText = await html5Qr.scanFile(blobLeft, false);
        detected = parseInvoiceQr(decodedText);
      } catch (e) { }
    }

    if (!detected) {
      if (statusTag) statusTag.innerText = "🔍 OCR 文字辨識中...";
      const ocrRes = await Tesseract.recognize(mainCanvas.toDataURL('image/png'), 'eng', { logger: m => {} });
      const text = ocrRes.data.text || "";
      const matchNo = text.match(/[A-Z]{2}[- ]?\d{8}/i);
      if (matchNo) {
        const invNo = matchNo[0].replace(/[- ]/g, '').toUpperCase();
        let amt = null;
        const matchAmt = text.match(/(?:總計|金額|小計|Total|NT\$?)\s*:?\s*(\d+)/i);
        if (matchAmt) amt = parseInt(matchAmt[1], 10);
        detected = { invoiceNo: invNo, amount: amt };
      }
    }

    if (detected && detected.invoiceNo) {
      document.getElementById(targetNoId).value = detected.invoiceNo;
      if (detected.amount) document.getElementById(targetAmtId).value = detected.amount;

      const dupCount = await checkDuplicateInvoiceNo(detected.invoiceNo);
      if (dupCount > 0) {
        alert(`⚠️ 警告！發票號碼【${detected.invoiceNo}】已存在 ${dupCount} 筆！`);
      } else {
        alert(`✅ 辨識成功！\n號碼：${detected.invoiceNo}\n金額：${detected.amount ? 'NT$ ' + detected.amount : '請確認'}`);
      }
    } else {
      alert('⚠️ 未能讀取發票，請手動輸入。');
    }
  } catch (err) {
    alert('⚠️ 辨識結束，請手動輸入。');
  } finally {
    inputElem.value = '';
    if (statusTag) statusTag.innerText = "就緒";
  }
}

document.getElementById('cash-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('submit-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = "處理中...";
  }

  try {
    const type = document.querySelector('input[name="type"]:checked').value;
    const note = document.getElementById('note').value;
    let supplier = null, category = null, amount = 0, invoiceNo = null, status = 'paid', receiptUrl = null;

    if (type === 'delivery' || type === 'pharma') {
      supplier = document.getElementById('supplier').value;
      category = type === 'delivery' ? '衛材進貨點收' : '藥品進貨點收';
      const docMode = document.querySelector('input[name="doc_mode"]:checked').value;
      
      if (docMode === 'has_invoice') {
        invoiceNo = document.getElementById('reg-invoice-no').value.trim().toUpperCase();
        amount = parseFloat(document.getElementById('amount').value) || 0;
        status = 'unpaid';

        if (!invoiceNo) {
          alert('⚠️ 請輸入或拍照辨識發票號碼！');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = "確認點收並送出";
          }
          return;
        }
      } else {
        status = 'pending_invoice';
        const receiptFile = document.getElementById('receipt').files[0];
        if (receiptFile) {
          const fileExt = receiptFile.name.split('.').pop();
          const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
          const filePath = `receipts/${fileName}`;
          await supabaseClient.storage.from('receipts').upload(filePath, receiptFile);
          const { data: urlData } = supabaseClient.storage.from('receipts').getPublicUrl(filePath);
          receiptUrl = urlData.publicUrl;
        }
      }
    } else {
      category = document.getElementById('category').value;
      amount = parseFloat(document.getElementById('amount').value) || 0;
      const receiptFile = document.getElementById('receipt').files[0];
      if (receiptFile) {
        const fileExt = receiptFile.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `receipts/${fileName}`;
        await supabaseClient.storage.from('receipts').upload(filePath, receiptFile);
        const { data: urlData } = supabaseClient.storage.from('receipts').getPublicUrl(filePath);
        receiptUrl = urlData.publicUrl;
      }
    }

    const today = new Date();
    const defaultDueDate = new Date(today.getFullYear(), today.getMonth() + 2, 0).toISOString().split('T')[0];

    await supabaseClient.from('cash_log').insert([{
      line_user_id: currentUser.lineUserId || 'UNKNOWN',
      user_name: currentUser.displayName,
      type: type,
      supplier: supplier,
      category: category,
      amount: amount,
      invoice_no: invoiceNo,
      payment_due_date: (status === 'unpaid') ? defaultDueDate : null,
      receipt_url: receiptUrl,
      note: note,
      status: status
    }]);

    alert((type === 'delivery' || type === 'pharma') ? ((status === 'unpaid') ? '✅ 隨貨發票已登記！已歸入待付款。' : '✅ 簽收單已上傳！已進入待補發票。') : '✅ 登記成功！');
    document.getElementById('cash-form').reset();
    const regInv = document.getElementById('reg-invoice-no');
    if (regInv) regInv.value = '';
    updateFormMode();
  } catch (err) {
    alert('❌ 失敗：' + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = "確認點收並送出";
    }
  }
});

async function loadPendingInvoices() {
  const container = document.getElementById('pending-invoice-list');
  if (!container) return;
  container.innerHTML = '<p class="text-center text-xs text-slate-400 py-4">載入中...</p>';
  const { data } = await supabaseClient.from('cash_log').select('*').eq('status', 'pending_invoice').order('created_at', { ascending: false });

  if (!data || data.length === 0) {
    container.innerHTML = '<p class="text-center text-xs text-slate-400 py-6">🎉 無待補發票的進貨紀錄！</p>';
    return;
  }

  container.innerHTML = '';
  data.forEach(item => {
    const div = document.createElement('div');
    div.className = "bg-slate-50 border p-3 rounded-xl space-y-2 text-xs";
    div.innerHTML = `
      <div class="flex justify-between font-bold text-slate-800">
        <span class="bg-blue-100 text-blue-800 px-2 py-0.5 rounded">${item.category || '進貨'}</span>
        <span class="text-slate-500">${item.supplier || '未指定廠商'}</span>
      </div>
      <p class="text-slate-600">說明：${item.note || '無'}</p>
      ${item.receipt_url ? `<a href="${item.receipt_url}" target="_blank" class="text-blue-600 underline font-bold inline-block">📄 查看簽收單照片</a>` : ''}
      <button onclick="openInvoiceModal('${item.id}')" class="w-full bg-amber-500 text-white font-bold py-2 rounded-lg text-xs shadow-sm">📝 補登發票與金額</button>
    `;
    container.appendChild(div);
  });
}

function openInvoiceModal(id) {
  document.getElementById('modal-id').value = id;
  document.getElementById('modal-invoice-no').value = '';
  document.getElementById('modal-amount').value = '';
  const today = new Date();
  document.getElementById('modal-due-date').value = new Date(today.getFullYear(), today.getMonth() + 2, 0).toISOString().split('T')[0];
  document.getElementById('invoice-modal')?.classList.remove('hidden');
}

function closeInvoiceModal() {
  document.getElementById('invoice-modal')?.classList.add('hidden');
}

document.getElementById('modal-invoice-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('modal-id').value;
  const invoiceNo = document.getElementById('modal-invoice-no').value.trim().toUpperCase();
  const amount = parseFloat(document.getElementById('modal-amount').value);

  await supabaseClient.from('cash_log').update({
    invoice_no: invoiceNo,
    amount: amount,
    payment_due_date: document.getElementById('modal-due-date').value,
    status: 'unpaid'
  }).eq('id', id);

  alert('✅ 發票補登成功！');
  closeInvoiceModal();
  loadPendingInvoices();
});

async function loadAdminData() {
  const { data, error } = await supabaseClient.from('cash_log').select('*').order('created_at', { ascending: false });
  if (error) return;
  cachedAllData = data || [];

  const pendingItems = cachedAllData.filter(d => d.status === 'pending_invoice');
  const unpaidItems = cachedAllData.filter(d => d.status === 'unpaid');

  const pendingCount = document.getElementById('stat-pending-count');
  if (pendingCount) pendingCount.innerText = `${pendingItems.length} 筆`;
  const unpaidTotal = unpaidItems.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  const unpaidTotalElem = document.getElementById('stat-unpaid-total');
  if (unpaidTotalElem) unpaidTotalElem.innerText = `NT$ ${unpaidTotal.toLocaleString()}`;

  renderSupplierTimeline(unpaidItems);
  renderAdminUnpaidList(unpaidItems);
}

function renderSupplierTimeline(unpaidItems) {
  const timelineContainer = document.getElementById('supplier-timeline-list');
  if (!timelineContainer) return;
  if (unpaidItems.length === 0) {
    timelineContainer.innerHTML = '<p class="text-center text-xs text-slate-400 py-3">🎉 目前無未結餘應付帳款</p>';
    return;
  }

  const grouped = {};
  unpaidItems.forEach(item => {
    const monthKey = item.payment_due_date ? item.payment_due_date.substring(0, 7) : '未指定月份';
    const supplierKey = item.supplier || '未指定廠商';
    const amt = Number(item.amount) || 0;
    if (!grouped[monthKey]) grouped[monthKey] = {};
    grouped[monthKey][supplierKey] = (grouped[monthKey][supplierKey] || 0) + amt;
  });

  timelineContainer.innerHTML = '';
  Object.keys(grouped).sort().forEach(month => {
    const monthBox = document.createElement('div');
    monthBox.className = "bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-1.5 text-xs";
    let monthTotal = 0;
    let supplierRows = '';
    Object.entries(grouped[month]).forEach(([supplier, sum]) => {
      monthTotal += sum;
      supplierRows += `<li class="flex justify-between py-0.5 border-b border-slate-100 last:border-0"><span>${supplier}</span><span class="font-bold">NT$ ${sum.toLocaleString()}</span></li>`;
    });
    monthBox.innerHTML = `
      <div class="flex justify-between items-center border-b pb-1 border-slate-200">
        <span class="font-bold text-blue-900 bg-blue-100 px-2 py-0.5 rounded text-[11px]">🗓️ ${month}</span>
        <span class="font-black text-rose-600">NT$ ${monthTotal.toLocaleString()}</span>
      </div>
      <ul class="pl-1 text-[11px]">${supplierRows}</ul>
    `;
    timelineContainer.appendChild(monthBox);
  });
}

function renderAdminUnpaidList(unpaidItems) {
  const container = document.getElementById('admin-data-list');
  if (!container) return;
  if (unpaidItems.length === 0) {
    container.innerHTML = '<p class="text-center text-xs text-slate-400 py-3">無待核銷項目</p>';
    return;
  }
  container.innerHTML = '';
  unpaidItems.forEach(item => {
    const div = document.createElement('div');
    div.className = "bg-slate-50 border border-slate-200 p-2.5 rounded-xl space-y-1.5 text-xs";
    div.innerHTML = `
      <div class="flex justify-between font-bold text-slate-800">
        <span>${item.supplier || item.category}</span>
        <span class="text-rose-600 font-black">NT$ ${Number(item.amount).toLocaleString()}</span>
      </div>
      <p class="text-slate-600">發票：<span class="font-mono bg-slate-200 px-1 rounded">${item.invoice_no || '未設定'}</span> | 到期：<span class="font-bold text-rose-600">${item.payment_due_date || '未設定'}</span></p>
      <button onclick="markAsPaid('${item.id}')" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1.5 rounded-lg text-xs shadow-sm">💵 完成付款與核銷</button>
    `;
    container.appendChild(div);
  });
}

function generateMonthlyReport() {
  const targetMonth = document.getElementById('report-month')?.value;
  if (!targetMonth) return;

  const monthData = cachedAllData.filter(d => {
    const dateStr = d.created_at ? d.created_at.substring(0, 7) : '';
    const dueStr = d.payment_due_date ? d.payment_due_date.substring(0, 7) : '';
    return dateStr === targetMonth || dueStr === targetMonth;
  });

  let totalIncome = 0, totalExpense = 0, totalDelivery = 0;
  const supplierSums = {};

  monthData.forEach(d => {
    const amt = Number(d.amount) || 0;
    if (d.type === 'income') totalIncome += amt;
    if (d.type === 'expense') totalExpense += amt;
    if (d.type === 'delivery' || d.type === 'pharma') {
      totalDelivery += amt;
      const sup = d.supplier || '其他廠商';
      supplierSums[sup] = (supplierSums[sup] || 0) + amt;
    }
  });

  document.getElementById('report-title').innerText = `愛欣診所 - ${targetMonth} 財務月報`;
  document.getElementById('report-period').innerText = `月份：${targetMonth} | 共 ${monthData.length} 筆`;
  document.getElementById('rep-income').innerText = `NT$ ${totalIncome.toLocaleString()}`;
  document.getElementById('rep-expense').innerText = `NT$ ${totalExpense.toLocaleString()}`;
  document.getElementById('rep-delivery').innerText = `NT$ ${totalDelivery.toLocaleString()}`;

  const breakdownList = document.getElementById('rep-supplier-breakdown');
  if (breakdownList) {
    breakdownList.innerHTML = '';
    Object.entries(supplierSums).forEach(([sup, sum]) => {
      const li = document.createElement('li');
      li.className = "flex justify-between border-b border-slate-100 py-0.5";
      li.innerHTML = `<span>${sup}</span><span class="font-bold">NT$ ${sum.toLocaleString()}</span>`;
      breakdownList.appendChild(li);
    });
  }

  document.getElementById('report-result-box')?.classList.remove('hidden');
}

function exportCsvReport() {
  const targetMonth = document.getElementById('report-month')?.value || new Date().toISOString().substring(0, 7);
  const listToExport = cachedAllData;
  let csvText = "建檔時間,登記類型,廠商名稱,分類項目,金額(NT$),發票號碼,付款到期日,點收人員,備註,請款狀態\n";

  listToExport.forEach(d => {
    const timeStr = d.created_at ? new Date(d.created_at).toLocaleDateString('zh-TW') : '';
    let typeStr = d.type === 'delivery' ? '衛材進貨' : (d.type === 'pharma' ? '藥品進貨' : d.type);
    const noteClean = (d.note || '').replace(/"/g, '""');
    csvText += `"${timeStr}","${typeStr}","${d.supplier || ''}","${d.category || ''}","${d.amount || 0}","${d.invoice_no || ''}","${d.payment_due_date || ''}","${d.user_name || ''}","${noteClean}","${d.status || ''}"\n`;
  });

  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, csvText], { type: 'text/csv;charset=utf-8;' });
  const downloadLink = document.createElement("a");
  downloadLink.href = URL.createObjectURL(blob);
  downloadLink.setAttribute("download", `愛欣診所各廠商進貨與請款明細_${targetMonth}.csv`);
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}

async function markAsPaid(id) {
  if (!confirm('確認核銷已付款嗎？')) return;
  await supabaseClient.from('cash_log').update({ status: 'paid' }).eq('id', id);
  alert('✅ 已核銷！');
  loadAdminData();
}
