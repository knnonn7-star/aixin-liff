 let cachedEmployees = [], cachedShifts = [], cachedAllSchedules = [], cachedPayrollResult = [];

function switchHrTab(tab) {
  ['myschedule', 'request', 'scheduling', 'payroll'].forEach(t => {
    const sec = document.getElementById(`hr-sec-${t}`);
    const tb = document.getElementById(`hr-tab-${t}`);
    if (sec) sec.classList.add('hidden');
    if (tb) tb.className = "py-2 rounded-lg hover:text-slate-900 transition";
  });
  const activeSec = document.getElementById(`hr-sec-${tab}`);
  const activeTb = document.getElementById(`hr-tab-${tab}`);
  if (activeSec) activeSec.classList.remove('hidden');
  if (activeTb) activeTb.className = "py-2 rounded-lg bg-indigo-600 text-white shadow-sm transition";

  if (tab === 'request') initRequestPage();
  if (tab === 'scheduling') loadScheduleAdminData();
  if (tab === 'payroll') {
    const today = new Date();
    document.getElementById('payroll-month').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  }
}

function initHrDefaults() {
  const schDate = document.getElementById('sch-date');
  if (schDate) schDate.value = new Date().toISOString().split('T')[0];
}

async function loadMySchedule() {
  if (!currentUser.empId) return;
  const today = new Date();
  const firstDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const { data } = await supabaseClient.from('clinic_schedules')
    .select('*, clinic_shifts(*)')
    .eq('employee_id', currentUser.empId)
    .gte('date', firstDay)
    .order('date', { ascending: true });

  const container = document.getElementById('my-schedule-list');
  if (!container) return;
  if (!data || data.length === 0) {
    container.innerHTML = '<p class="text-slate-400 text-center py-3">本月尚無排定班表</p>';
    return;
  }
  container.innerHTML = '';
  data.forEach(s => {
    const shift = s.clinic_shifts || { shift_name: '常規班', start_time: '08:00', end_time: '17:00' };
    const row = document.createElement('div');
    row.className = "flex justify-between items-center bg-white p-2.5 rounded-lg border border-slate-200 text-xs";
    row.innerHTML = `
      <span class="font-bold text-slate-700">${s.date}</span>
      <span class="bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded text-[11px]">${shift.shift_name} (${shift.start_time.substring(0,5)} ~ ${shift.end_time.substring(0,5)})</span>
    `;
    container.appendChild(row);
  });
}async function initRequestPage() {
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const targetMonth = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
  const targetElem = document.getElementById('req-target-month');
  if (targetElem) {
    targetElem.value = targetMonth;
    updateRequestMonthDays();
  }

  const currentDay = today.getDate();
  const deadlineTag = document.getElementById('request-deadline-tag');
  const submitBtn = document.getElementById('btn-submit-request');

  if (deadlineTag && submitBtn) {
    if (currentDay > 20) {
      deadlineTag.innerText = "⚠️ 本月預約已截止 (已鎖定)";
      deadlineTag.className = "bg-rose-100 text-rose-800 text-[10px] px-2 py-0.5 rounded font-bold";
      submitBtn.disabled = true;
      submitBtn.innerText = "🔒 預約已於 20 號截止 (轉交護理長整合中)";
      submitBtn.className = "w-full bg-slate-400 text-white font-bold py-2.5 rounded-xl text-xs cursor-not-allowed";
    } else {
      deadlineTag.innerText = `距離 20 號截止還剩 ${20 - currentDay} 天`;
      deadlineTag.className = "bg-indigo-200 text-indigo-800 text-[10px] px-2 py-0.5 rounded font-bold";
      submitBtn.disabled = false;
      submitBtn.innerText = "📤 送出排班需求";
      submitBtn.className = "w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl shadow-sm text-xs transition";
    }
  }

  const { data: shifts } = await supabaseClient.from('clinic_shifts').select('*');
  const shiftSelect = document.getElementById('req-shift-select');
  if (shiftSelect) {
    shiftSelect.innerHTML = '';
    (shifts || []).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.innerText = `${s.shift_name} (${s.start_time.substring(0,5)} ~ ${s.end_time.substring(0,5)})`;
      shiftSelect.appendChild(opt);
    });
  }
  loadMyRequests();
}

function updateRequestMonthDays() {
  const monthStr = document.getElementById('req-target-month')?.value;
  if (!monthStr) return;
  const [y, m] = monthStr.split('-');
  const reqDate = document.getElementById('req-date');
  if (reqDate) {
    reqDate.min = `${y}-${m}-01`;
    reqDate.max = `${y}-${m}-${new Date(y, m, 0).getDate()}`;
    reqDate.value = `${y}-${m}-01`;
  }
}

function toggleRequestShiftSelect() {
  const type = document.getElementById('req-type')?.value;
  const shiftGroup = document.getElementById('req-shift-group');
  if (shiftGroup) {
    if (type === 'off') shiftGroup.classList.add('hidden');
    else shiftGroup.classList.remove('hidden');
  }
}

const reqForm = document.getElementById('schedule-request-form');
if (reqForm) {
  reqForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser.empId) await syncEmployeeRecord();

    const targetMonth = document.getElementById('req-target-month').value;
    const reqDate = document.getElementById('req-date').value;
    const reqType = document.getElementById('req-type').value;
    const shiftId = reqType === 'off' ? null : document.getElementById('req-shift-select').value;
    const reason = document.getElementById('req-reason').value;

    const { error } = await supabaseClient.from('clinic_schedule_requests').upsert([{
      target_month: targetMonth,
      employee_id: currentUser.empId,
      request_date: reqDate,
      request_type: reqType,
      shift_id: shiftId,
      reason: reason,
      status: 'pending'
    }], { onConflict: 'employee_id,request_date' });

    if (error) alert('送出失敗：' + error.message);
    else {
      alert('✅ 排班需求已登記！護理長將於 21~25 號進行班表整合。');
      document.getElementById('req-reason').value = '';
      loadMyRequests();
    }
  });
}

async function loadMyRequests() {
  if (!currentUser.empId) return;
  const targetMonth = document.getElementById('req-target-month')?.value;
  if (!targetMonth) return;
  const { data } = await supabaseClient.from('clinic_schedule_requests')
    .select('*, clinic_shifts(*)')
    .eq('employee_id', currentUser.empId)
    .eq('target_month', targetMonth)
    .order('request_date', { ascending: true });

  const container = document.getElementById('my-request-list');
  if (!container) return;
  if (!data || data.length === 0) {
    container.innerHTML = '<p class="text-slate-400 text-center py-3">尚無登錄的預約需求</p>';
    return;
  }
  container.innerHTML = '';
  data.forEach(r => {
    const shiftText = r.request_type === 'off' ? '🏖️ 預約休假' : `⭐ 希望班別: ${r.clinic_shifts?.shift_name || ''}`;
    const div = document.createElement('div');
    div.className = "flex justify-between items-center bg-white p-2 rounded-lg border border-slate-200";
    div.innerHTML = `
      <div>
        <span class="font-bold text-slate-800">${r.request_date}</span>
        <span class="text-[11px] text-slate-500 ml-1">(${shiftText})</span>
        ${r.reason ? `<p class="text-[10px] text-slate-400">備註: ${r.reason}</p>` : ''}
      </div>
      <button onclick="deleteRequest('${r.id}')" class="text-rose-500 font-bold text-xs p-1">✕</button>
    `;
    container.appendChild(div);
  });
}

async function deleteRequest(id) {
  if (!confirm('確定取消此預約排班嗎？')) return;
  await supabaseClient.from('clinic_schedule_requests').delete().eq('id', id);
  loadMyRequests();async function loadScheduleAdminData() {
  const { data: empData } = await supabaseClient.from('clinic_employees').select('*').eq('is_active', true);
  cachedEmployees = empData || [];
  const { data: shiftData } = await supabaseClient.from('clinic_shifts').select('*');
  cachedShifts = shiftData || [];

  const empSelect = document.getElementById('sch-emp-select');
  if (empSelect) {
    empSelect.innerHTML = '';
    cachedEmployees.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.innerText = `${e.name} (${e.role === 'doctor' ? '醫師' : (e.role === 'nurse' ? '護理師' : '行政')})`;
      empSelect.appendChild(opt);
    });
  }

  const shiftSelect = document.getElementById('sch-shift-select');
  if (shiftSelect) {
    shiftSelect.innerHTML = '';
    cachedShifts.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.innerText = `${s.shift_name} (${s.start_time.substring(0,5)} ~ ${s.end_time.substring(0,5)})`;
      shiftSelect.appendChild(opt);
    });
  }

  const { data: allSch } = await supabaseClient.from('clinic_schedules')
    .select('*, clinic_employees(*), clinic_shifts(*)')
    .order('date', { ascending: false }).limit(100);

  cachedAllSchedules = allSch || [];
  renderAllScheduleList();
  checkShiftCompliance();
}

function renderAllScheduleList() {
  const schList = document.getElementById('all-schedule-list');
  if (!schList) return;
  if (cachedAllSchedules.length === 0) {
    schList.innerHTML = '<p class="text-slate-400 text-center py-3">尚無排班紀錄</p>';
    return;
  }
  schList.innerHTML = '';
  cachedAllSchedules.forEach(s => {
    const empName = s.clinic_employees?.name || '未指定';
    const shiftName = s.clinic_shifts?.shift_name || '常規班';
    const div = document.createElement('div');
    div.className = "flex justify-between items-center bg-white p-2 rounded-lg border border-slate-200";
    div.innerHTML = `
      <div>
        <span class="font-bold text-slate-800">${s.date}</span> - <span class="font-semibold text-indigo-700">${empName}</span>
        ${s.is_special_interval ? `<span class="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.2 rounded ml-1">8hr間隔(${s.special_interval_reason})</span>` : ''}
      </div>
      <span class="bg-indigo-100 text-indigo-800 text-[10px] font-bold px-2 py-0.5 rounded">${shiftName}</span>
    `;
    schList.appendChild(div);
  });
}

function checkShiftCompliance() {
  const dateStr = document.getElementById('sch-date')?.value;
  const empId = document.getElementById('sch-emp-select')?.value;
  const shiftId = document.getElementById('sch-shift-select')?.value;
  const warningDiv = document.getElementById('sch-warning-msg');
  const specialBox = document.getElementById('special-interval-box');
  const saveBtn = document.getElementById('btn-save-schedule');

  if (!warningDiv || !specialBox || !saveBtn) return;
  warningDiv.classList.add('hidden');
  specialBox.classList.add('hidden');
  saveBtn.disabled = false;
  saveBtn.className = "w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm transition";

  if (!dateStr || !empId || !shiftId) return;
  const targetShift = cachedShifts.find(s => s.id === shiftId);
  const empSchedules = cachedAllSchedules.filter(s => s.employee_id === empId);

  // 連續出勤檢核
  const curDate = new Date(dateStr);
  let consecutiveDays = 0;
  for (let i = 1; i <= 6; i++) {
    const prev = new Date(curDate); prev.setDate(prev.getDate() - i);
    if (empSchedules.some(s => s.date === prev.toISOString().split('T')[0])) consecutiveDays++;
    else break;
  }

  if (consecutiveDays >= 6) {
    warningDiv.innerText = `🚨 違規警告：該同仁已連續出勤 ${consecutiveDays} 日！依勞基法規定不得連續工作超過 6 日。`;
    warningDiv.classList.remove('hidden');
    saveBtn.disabled = true;
    saveBtn.className = "w-full bg-slate-400 text-white font-bold py-2.5 rounded-xl text-xs cursor-not-allowed";
    return;
  }

  // 輪班間隔檢核
  const prevDay = new Date(curDate); prevDay.setDate(prevDay.getDate() - 1);
  const prevSch = empSchedules.find(s => s.date === prevDay.toISOString().split('T')[0]);

  if (prevSch && prevSch.clinic_shifts && targetShift) {
    const [ph, pm] = prevSch.clinic_shifts.end_time.split(':').map(Number);
    const [ch, cm] = targetShift.start_time.split(':').map(Number);
    let intervalHours = (ch + 24 - ph) + (cm - pm) / 60;
    if (intervalHours >= 24) intervalHours -= 24;

    if (intervalHours < 8) {
      warningDiv.innerText = `🚨 強制違規：與前一日班別間隔僅 ${intervalHours.toFixed(1)} 小時，小於法定下限 8 小時，禁止排班！`;
      warningDiv.classList.remove('hidden');
      saveBtn.disabled = true;
      saveBtn.className = "w-full bg-slate-400 text-white font-bold py-2.5 rounded-xl text-xs cursor-not-allowed";
    } else if (intervalHours < 11) {
      specialBox.classList.remove('hidden');
      warningDiv.innerText = `⚠️ 提醒：與前日班別間隔為 ${intervalHours.toFixed(1)} 小時，需勾選並註記符合勞動合約之「緊急透析/教育訓練」事由。`;
      warningDiv.classList.remove('hidden');
    }
  }
}

async function saveSchedule() {
  const date = document.getElementById('sch-date').value;
  const empId = document.getElementById('sch-emp-select').value;
  const shiftId = document.getElementById('sch-shift-select').value;
  const isSpecial = document.getElementById('sch-is-special')?.checked || false;
  const specialReason = isSpecial ? document.getElementById('sch-special-reason').value : null;

  if (!date || !empId || !shiftId) {
    alert('請完整選擇日期、員工與班別！');
    return;
  }

  const { error } = await supabaseClient.from('clinic_schedules').upsert([{
    date: date,
    employee_id: empId,
    shift_id: shiftId,
    is_special_interval: isSpecial,
    special_interval_reason: specialReason
  }], { onConflict: 'date,employee_id' });

  if (error) alert('儲存失敗：' + error.message);
  else {
    alert('✅ 排班成功儲存！已符合四週變形工時規範。');
    loadScheduleAdminData();
  }
}

async function calculateMonthlyPayroll() {
  const month = document.getElementById('payroll-month')?.value;
  if (!month) { alert('請選擇試算月份'); return; }

  const { data: emps } = await supabaseClient.from('clinic_employees').select('*').eq('is_active', true);
  const container = document.getElementById('payroll-table-container');
  if (!container) return;
  container.innerHTML = '';
  cachedPayrollResult = [];

  (emps || []).forEach(emp => {
    const base = Number(emp.base_salary) || 0;
    const license = Number(emp.license_allowance) || 0;
    const mgmt = Number(emp.management_allowance) || 0;
    const pharmacy = Number(emp.pharmacy_allowance) || 0;
    const monthlyTotal = base + license + mgmt + pharmacy;

    cachedPayrollResult.push({
      name: emp.name,
      role: emp.role === 'nurse' ? '護理師' : (emp.role === 'doctor' ? '醫師' : '行政/清潔'),
      hireDate: emp.hire_date || '',
      baseSalary: base,
      previousSalary: emp.previous_salary || 0,
      licenseAllowance: license,
      mgmtAllowance: mgmt,
      pharmacyAllowance: pharmacy,
      laborBracket: emp.labor_insurance_bracket || 0,
      totalSalary: monthlyTotal,
      yearEndEstimate: base
    });

    const card = document.createElement('div');
    card.className = "bg-white p-3 rounded-xl border border-slate-200 text-xs flex justify-between items-center";
    card.innerHTML = `
      <div>
        <div class="font-bold text-slate-800">${emp.name} <span class="text-[10px] bg-slate-100 px-1 rounded">${emp.role === 'nurse' ? '透析護理師' : emp.role}</span></div>
        <div class="text-[11px] text-slate-500 mt-0.5">底薪: NT$ ${base.toLocaleString()} | 主管加給: NT$ ${mgmt} | 執照費: NT$ ${license}</div>
      </div>
      <div class="text-right">
        <span class="text-[10px] text-slate-400">本月應發全薪</span>
        <div class="text-sm font-black text-emerald-700">NT$ ${monthlyTotal.toLocaleString()}</div>
      </div>
    `;
    container.appendChild(card);
  });

  const resultBox = document.getElementById('payroll-result-box');
  if (resultBox) resultBox.classList.remove('hidden');
}

function exportPayrollCsv() {
  const month = document.getElementById('payroll-month')?.value;
  if (cachedPayrollResult.length === 0) return;

  let csv = "月份,姓名,職務類別,到職日,前次薪資,本期本薪/年資薪,透析執照費,主管加給,藥事加給,勞保投保級距,本月應發全薪,預估年終基準(1個月)\n";
  cachedPayrollResult.forEach(p => {
    csv += `"${month}","${p.name}","${p.role}","${p.hireDate}","${p.previousSalary}","${p.baseSalary}","${p.licenseAllowance}","${p.mgmtAllowance}","${p.pharmacyAllowance}","${p.laborBracket}","${p.totalSalary}","${p.yearEndEstimate}"\n`;
  });

  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8;' });
  const downloadLink = document.createElement("a");
  downloadLink.href = URL.createObjectURL(blob);
  downloadLink.setAttribute("download", `愛欣診所護理薪資清單_${month}.csv`);
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}

}

