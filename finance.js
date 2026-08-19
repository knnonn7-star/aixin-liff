/**
 * 愛欣診所 LINE 管理系統 - 帳務管理模組 (finance.js) - 第一段
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
    repMonth.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
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

async function checkDuplicateInvoiceNo(invoiceNo, excludeId = null) {
  if (!invoiceNo) return 0;
  const client = window.supabaseClient;
  if (!client) return 0;

  let query = client.from('cash_log').select('id', { count: 'exact' }).eq('invoice_no', invoiceNo.trim().toUpperCase());
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

function loadImageCanvas(file, maxWidth = 1000) {
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
/**
 * 愛欣診所 LINE 管理系統 - 帳務管理模組 (finance.js) - 第二段
 */

async function processInvoiceImage(inputElem, targetNoId, targetAmtId, statusElemId) {
  if (!inputElem.files || inputElem.files.length === 0) return;
  const file = inputElem.files[0];
  const targetNoElem = document.getElementById(targetNoId);
  const targetAmtElem = document.getElementById(targetAmtId);

  // 1. 檔名優先快速規則解析（若檔名已有字軌）
  const matchFileName = file.name.match(/[A-Z]{2}\d{8}/i);
  if (matchFileName && targetNoElem) {
    targetNoElem.value = matchFileName[0].toUpperCase();
  }

  try {
    let detected = null;
    const mainCanvas = await loadImageCanvas(file, 1000);

    // 2. 原生 BarcodeDetector 優先
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

    // 3. Html5Qrcode 解析左半部 QR 碼
    if (!detected && typeof Html5Qrcode !== 'undefined') {
      try {
        const leftCanvas = cropCanvas(mainCanvas, 0, 0.65);
        const blobLeft = await new Promise(r => leftCanvas.toBlob(r, 'image/jpeg', 0.9));
        const html5Qr = new Html5Qrcode("fin-sec-register");
        const decodedText = await html5Qr.scanFile(blobLeft, false);
        detected = parseInvoiceQr(decodedText);
      } catch (e) { }
    }

    // 4. Tesseract OCR 文字辨識降級備援
    if (!detected && typeof Tesseract !== 'undefined') {
      const ocrRes = await Tesseract.recognize(mainCanvas.toDataURL('image/jpeg', 0.8), 'eng', {
        logger: m => console.log(m.status)
      });
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

    // 填入辨識結果
    if (detected && detected.invoiceNo) {
      if (targetNoElem) targetNoElem.value = detected.invoiceNo;
      if (detected.amount && targetAmtElem) targetAmtElem.value = detected.amount;

      const dupCount = await checkDuplicateInvoiceNo(detected.invoiceNo);
      if (dupCount > 0) {
        alert(`⚠️ 發票號碼【${detected.invoiceNo}】已存在 ${dupCount} 筆，請確認是否重複進貨！`);
      } else {
        alert(`✅ 辨識完成！\n發票號碼：${detected.invoiceNo}\n金額：${detected.amount ? 'NT$ ' + detected.amount : '請手動確認'}`);
      }
    } else {
      alert('⚠️ 未能自動解析發票資訊，請手動鍵入發票號碼與金額。');
    }
  } catch (err) {
    console.error('發票解析異常:', err);
    alert('辨識未完成，請手動鍵入發票號碼與金額。');
  } finally {
    inputElem.value = '';
  }
}

// 現場進貨表單提交
const cashForm = document.getElementById('cash-form');
if (cashForm) {
  cashForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const client = window.supabaseClient;
    if (!client) {
      alert('資料庫連線失敗，請稍候重試！');
      return;
    }

    const submitBtn = document.getElementById('submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerText = "資料送出中...";
    }

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

          if (!invoiceNo) {
            alert('⚠️ 請輸入或拍照辨識發票號碼！');
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.innerText = "確認點收並送出";
            }
            return;
          }

          const dupCount = await checkDuplicateInvoiceNo(invoiceNo);
          if (dupCount > 0) {
            const confirmDup = confirm(`🚨 重複發票警示！\n\n發票【${invoiceNo}】已存在 ${dupCount} 筆。\n確定要建立嗎？`);
            if (!confirmDup) {
              if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = "確認點收並送出";
              }
              return;
            }
          }
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

      alert(status === 'pending_invoice' ? '✅ 簽收單已登記！發票將轉入櫃檯待補清單。' : '🎉 帳務紀錄登記成功！');
      cashForm.reset();
      document.getElementById('reg-invoice-no').value = '';
      updateFormMode();
    } catch (err) {
      alert('登記失敗：' + err.message);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = "確認點收並送出";
      }
    }
  });
}

// 載入待補發票清單
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
        <div class="text-[10px] text-slate-400">${item.note || '無備註'} (${(item.created_at || '').substring(0, 10)})</div>
      </div>
      <span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded">待補發票</span>
    `;
    container.appendChild(div);
  });
}

// 財務月報統計
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
  const supplierSums = {};

  monthData.forEach(d => {
    const a = Number(d.amount) || 0;
    if (d.type === 'income') inc += a;
    if (d.type === 'expense') exp += a;
    if (d.type === 'delivery' || d.type === 'pharma') {
      del += a;
      const sup = d.supplier || '其他廠商';
      supplierSums[sup] = (supplierSums[sup] || 0) + a;
    }
  });

  document.getElementById('rep-income').innerText = `NT$ ${inc.toLocaleString()}`;
  document.getElementById('rep-expense').innerText = `NT$ ${exp.toLocaleString()}`;
  document.getElementById('rep-delivery').innerText = `NT$ ${del.toLocaleString()}`;
  document.getElementById('report-period').innerText = `統計月份：${month}`;

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
  const month = document.getElementById('report-month')?.value || new Date().toISOString().substring(0, 7);
  let csv = "建檔時間,登記類型,廠商名稱,分類項目,金額(NT$),發票號碼,點收人員,狀態\n";
  cachedAllFinanceData.forEach(d => {
    csv += `"${(d.created_at || '').substring(0, 10)}","${d.type}","${d.supplier || ''}","${d.category || ''}","${d.amount || 0}","${d.invoice_no || ''}","${d.user_name || ''}","${d.status || ''}"\n`;
  });
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `愛欣帳務月報_${month}.csv`;
  a.click();
}
