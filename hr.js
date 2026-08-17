// ==================== 愛欣診所 人事與排班模組 (hr.js) ====================
let cachedEmployees = [];
let cachedShifts = [];
let cachedMonthSchedules = [];
let editingDate = null;

// 護理師固定編號代碼對照表 (依照診所同仁建立)
const NURSE_CODE_MAP = {
  '陳慧倪': '01',
  '盧明伶': '02',
  '謝宜婷': '03',
  '陳金暖': '04',
  '王瓊代': '05',
  '吳金燕': '06',
  '王靜慧': '07',
  '吳培瑜': '08',
  '李香瑩': '09',
  '吳沐芸': '10',
  '涂春娥': '11',
  '胡月霞': '12',
  '王芝妍': '13'
};

// 9 大國定假日抽籤清單
const NATIONAL_HOLIDAYS_2026 = [
  { name: '元旦', date: '2026-01-01' },
  { name: '228紀念日', date: '2026-02-28' },
  { name: '清明節', date: '2026-04-05' },
  { name: '勞動節', date: '2026-05-01' },
  { name: '端午節', date: '2026-06-19' },
  { name: '中秋節', date: '2026-09-25' },
  { name: '雙十國慶', date: '2026-10-10' },
  { name: '光復節', date: '2026-10-25' },
  { name: '行憲紀念日', date: '2026-12-25' }
];

// ==================== 頁籤切換與權限管制 ====================
function switchHrTab(tab) {
  const isAdminUser = (currentUser.displayName === '陳慧倪' || currentUser.displayName === '林和正' || currentUser.role === 'doctor');
  
  if (tab === 'scheduling' && !isAdminUser) {
    alert('🔒 權限提示：排班月曆之編排與發布僅限護理長（陳慧倪）與醫師操作。');
    return;
  }

  ['myschedule', 'request', 'scheduling'].forEach(t => {
    document.getElementById(`hr-sec-${t}`)?.classList.add('hidden');
    const tabBtn = document.getElementById(`hr-tab-${t}`);
    if (tabBtn) tabBtn.className = "py-2 rounded-lg hover:text-slate-900 transition";
  });
  document.getElementById(`hr-sec-${tab}`)?.classList.remove('hidden');
  const activeTab = document.getElementById(`hr-tab-${tab}`);
  if (activeTab) activeTab.className = "py-2 rounded-lg bg-indigo-600 text-white shadow-sm transition";

  if (tab === 'request') initRequestPage();
  if (tab === 'scheduling') initScheduleAdmin();
}

function initHrDefaults() {
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const nextMonthStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
  const adminMonthElem = document.getElementById('admin-sch-month');
  if (adminMonthElem) adminMonthElem.value = nextMonthStr;
}

// 取得員工代碼輔助函式
function getEmpCode(name) {
  return NURSE_CODE_MAP[name] || name.substring(0, 2);
}

// ==================== 查詢個人班表 ====================
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
    const rawShiftName = s.clinic_shifts?.shift_name || (s.shift_id === 'afternoon' ? '中班' : '早班');
    const shiftName = rawShiftName.replace(/\s*\(.*?\)/g, '').trim();
    const row = document.createElement('div');
    row.className = "flex justify-between items-center bg-white p-2.5 rounded-lg border border-slate-200 text-xs";
    row.innerHTML = `
      <span class="font-bold text-slate-700">${s.date}</span>
      <span class="bg-indigo-100 text-indigo-800 font-bold px-2.5 py-0.5 rounded text-[11px]">${shiftName}</span>
    `;
    container.appendChild(row);
  });
}

// ==================== 15號前護理師預約排班 ====================
async function initRequestPage() {
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const nextMonthStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
  const reqMonth = document.getElementById('req-target-month');
  if (reqMonth) reqMonth.value = nextMonthStr;
  updateRequestMonthDays();

  const reqDate = document.getElementById('req-date');
  if (reqDate) reqDate.onchange = updateRequestShiftOptions;

  const currentDay = today.getDate();
  const deadlineTag = document.getElementById('request-deadline-tag');
  const submitBtn = document.getElementById('btn-submit-request');
  const isAdminUser = (currentUser.displayName === '陳慧倪' || currentUser.displayName === '林和正' || currentUser.role === 'doctor');

  if (currentDay > 15 && !isAdminUser) {
    if (deadlineTag) {
      deadlineTag.innerText = "⚠️ 預約已於 15 號截止 (護理長排班整合中)";
      deadlineTag.className = "bg-rose-100 text-rose-800 text-[10px] px-2 py-0.5 rounded font-bold";
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerText = "🔒 預約已截止 (月底前公布班表)";
      submitBtn.className = "w-full bg-slate-400 text-white font-bold py-2.5 rounded-xl text-xs cursor-not-allowed";
    }
  } else {
    if (deadlineTag) {
      deadlineTag.innerText = currentDay <= 15 ? `距離 15 號截止還剩 ${15 - currentDay} 天` : `管理職特別編輯模式`;
      deadlineTag.className = "bg-indigo-200 text-indigo-800 text-[10px] px-2 py-0.5 rounded font-bold";
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = "📤 送出排班/休假預約";
      submitBtn.className = "w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl shadow-sm text-xs transition";
    }
  }

  updateRequestShiftOptions();
  loadMyRequests();
}

function updateRequestMonthDays() {
  const monthStr = document.getElementById('req-target-month')?.value;
  const reqDate = document.getElementById('req-date');
  if (!monthStr || !reqDate) return;
  const [y, m] = monthStr.split('-');
  reqDate.min = `${y}-${m}-01`;
  reqDate.max = `${y}-${m}-${new Date(y, m, 0).getDate()}`;
  reqDate.value = `${y}-${m}-01`;
}

function updateRequestShiftOptions() {
  const dateStr = document.getElementById('req-date')?.value;
  const selectElem = document.getElementById('req-shift-select');
  if (!selectElem || !dateStr) return;

  const dayOfWeek = new Date(dateStr).getDay();
  selectElem.innerHTML = '';

  if (dayOfWeek === 0) {
    selectElem.innerHTML = '<option value="">週日休診</option>';
    return;
  }

  const optMorning = document.createElement('option');
  optMorning.value = 'morning';
  optMorning.innerText = '早班';
  selectElem.appendChild(optMorning);

  if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
    const optAfternoon = document.createElement('option');
    optAfternoon.value = 'afternoon';
    optAfternoon.innerText = '中班';
    selectElem.appendChild(optAfternoon);
  }
}

function toggleRequestShiftSelect() {
  const type = document.getElementById('req-type')?.value;
  const shiftGroup = document.getElementById('req-shift-group');
  if (!shiftGroup) return;
  if (type === 'off') {
    shiftGroup.classList.add('hidden');
  } else {
    shiftGroup.classList.remove('hidden');
    updateRequestShiftOptions();
  }
}

document.getElementById('schedule-request-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser.empId) await syncEmployeeRecord();

  if (currentUser.displayName === '盧明伶') {
    const isSpecial = confirm('盧明伶護理師固定負責門診藥事與週六加班。\n確認登記此項目為個人特休嗎？');
    if (!isSpecial) return;
  }

  const targetMonth = document.getElementById('req-target-month').value;
  const reqDate = document.getElementById('req-date').value;
  const reqType = document.getElementById('req-type').value;
  const reason = document.getElementById('req-reason').value;

  const dateObj = new Date(reqDate);
  const dayOfWeek = dateObj.getDay();

  if (dayOfWeek === 0) {
    alert('⚠️ 愛欣診所每週日固定休診，無須預約！');
    return;
  }

  const isRegularNurse = (currentUser.displayName !== '林和正' && currentUser.displayName !== '陳慧倪' && currentUser.displayName !== '盧明伶' && currentUser.role !== 'doctor');

  if (reqType === 'off' && isRegularNurse) {
    if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
      const { data: myReqs } = await supabaseClient.from('clinic_schedule_requests')
        .select('*')
        .eq('employee_id', currentUser.empId)
        .eq('target_month', targetMonth)
        .eq('request_type', 'off');

      const mwfCount = (myReqs || []).filter(r => {
        const d = new Date(r.request_date).getDay();
        return (d === 1 || d === 3 || d === 5) && r.request_date !== reqDate;
      }).length;

      if (mwfCount >= 2) {
        alert('🚨 預約上限：每位護理師每月「星期一、三、五」最多僅能預約 2 次休假！');
        return;
      }

      const { data: allDateReqs } = await supabaseClient.from('clinic_schedule_requests')
        .select('*')
        .eq('request_date', reqDate)
        .eq('request_type', 'off');

      if (allDateReqs && allDateReqs.length >= 2) {
        alert(`🚨 人力限制：${reqDate} 已有 2 位同仁預約休假，為維持臨床人力，請選擇其他日期！`);
        return;
      }
    }
  }

  const { error } = await supabaseClient.from('clinic_schedule_requests').upsert([{
    target_month: targetMonth,
    employee_id: currentUser.empId,
    request_date: reqDate,
    request_type: reqType,
    shift_id: reqType === 'off' ? null : (document.getElementById('req-shift-select')?.value || 'morning'),
    reason: reason,
    status: 'pending'
  }], { onConflict: 'employee_id,request_date' });

  if (error) {
    alert('登記失敗：' + error.message);
  } else {
    alert('✅ 排班/休假需求已登記！');
    document.getElementById('req-reason').value = '';
    loadMyRequests();
  }
});

async function loadMyRequests() {
  if (!currentUser.empId) return;
  const targetMonth = document.getElementById('req-target-month')?.value;
  if (!targetMonth) return;
  const { data } = await supabaseClient.from('clinic_schedule_requests')
    .select('*')
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
    const shiftText = r.request_type === 'off' ? '🏖️ 預約休假' : `⭐ 希望班別: ${r.shift_id === 'afternoon' ? '中班' : '早班'}`;
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
  if (!confirm('確定取消此筆預約嗎？')) return;
  await supabaseClient.from('clinic_schedule_requests').delete().eq('id', id);
  loadMyRequests();
}

// ==================== 護理長月曆視覺化排班（代碼顯示） ====================
async function initScheduleAdmin() {
  const { data: empData } = await supabaseClient.from('clinic_employees').select('*').eq('is_active', true);
  cachedEmployees = empData || [];

  // 渲染護理師代碼對照表
  const codeTagsContainer = document.getElementById('nurse-code-tags');
  if (codeTagsContainer) {
    codeTagsContainer.innerHTML = '';
    cachedEmployees.forEach(e => {
      let tagBg = 'bg-slate-100 text-slate-800 border-slate-300';
      let roleText = '護理師';
      const code = getEmpCode(e.name);

      if (e.name === '林和正' || e.role === 'doctor') { tagBg = 'bg-indigo-100 text-indigo-900 border-indigo-300'; roleText = '醫師'; }
      else if (e.name === '陳慧倪') { tagBg = 'bg-purple-100 text-purple-900 border-purple-300'; roleText = '護理長'; }
      else if (e.name === '盧明伶') { tagBg = 'bg-emerald-100 text-emerald-900 border-emerald-300'; roleText = '門診藥事'; }

      const span = document.createElement('span');
      span.className = `px-2 py-0.5 rounded-md border text-[11px] font-bold shadow-xs ${tagBg}`;
      span.innerText = `[${code}] ${e.name} (${roleText})`;
      codeTagsContainer.appendChild(span);
    });
  }

  loadScheduleCalendar();
}

async function loadScheduleCalendar() {
  const monthStr = document.getElementById('admin-sch-month')?.value;
  if (!monthStr) return;

  const [y, m] = monthStr.split('-').map(Number);
  const firstDayObj = new Date(y, m - 1, 1);
  const totalDays = new Date(y, m, 0).getDate();
  const startDayOfWeek = firstDayObj.getDay();

  const startDateStr = `${monthStr}-01`;
  const endDateStr = `${monthStr}-${totalDays}`;
  const { data: schData } = await supabaseClient.from('clinic_schedules')
    .select('*, clinic_employees(*), clinic_shifts(*)')
    .gte('date', startDateStr)
    .lte('date', endDateStr);

  cachedMonthSchedules = schData || [];

  const grid = document.getElementById('calendar-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // 填補月初空白格
  for (let i = 0; i < startDayOfWeek; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = "min-h-[75px] bg-slate-50/50 rounded-lg border border-dashed border-slate-200";
    grid.appendChild(emptyCell);
  }

  // 填寫整月日曆格子
  for (let d = 1; d <= totalDays; d++) {
    const dayStr = `${monthStr}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = new Date(y, m - 1, d).getDay();
    const daySchedules = cachedMonthSchedules.filter(s => s.date === dayStr);

    const cell = document.createElement('div');
    cell.className = `min-h-[75px] p-1.5 rounded-lg border flex flex-col justify-between transition hover:shadow-md cursor-pointer ${
      dayOfWeek === 0 ? 'bg-rose-50/60 border-rose-200' : 'bg-white border-slate-200 hover:border-indigo-400'
    }`;
    cell.onclick = () => openShiftEditModal(dayStr, dayOfWeek);

    let headerHtml = `<div class="flex justify-between items-center"><span class="font-bold text-xs ${dayOfWeek === 0 ? 'text-rose-600' : 'text-slate-700'}">${d}</span>`;
    if (dayOfWeek === 0) headerHtml += `<span class="text-[9px] bg-rose-200 text-rose-800 px-1 rounded">休診</span>`;
    headerHtml += `</div>`;

    // 以代碼方式精簡呈現早班與中班
    let bodyHtml = `<div class="space-y-1 mt-1">`;
    if (dayOfWeek !== 0) {
      const morningList = daySchedules.filter(s => !s.clinic_shifts?.shift_name?.includes('中') && s.shift_id !== 'afternoon');
      const afternoonList = daySchedules.filter(s => s.clinic_shifts?.shift_name?.includes('中') || s.shift_id === 'afternoon');

      if (morningList.length > 0) {
        const mCodes = morningList.map(s => getEmpCode(s.clinic_employees?.name || '')).join(', ');
        const mFullNames = morningList.map(s => s.clinic_employees?.name || '').join('、');
        bodyHtml += `<div class="text-[10px] bg-amber-100 text-amber-900 font-bold px-1.5 py-0.5 rounded truncate" title="早班：${mFullNames}">☀️ ${mCodes}</div>`;
      }
      if (afternoonList.length > 0) {
        const aCodes = afternoonList.map(s => getEmpCode(s.clinic_employees?.name || '')).join(', ');
        const aFullNames = afternoonList.map(s => s.clinic_employees?.name || '').join('、');
        bodyHtml += `<div class="text-[10px] bg-blue-100 text-blue-900 font-bold px-1.5 py-0.5 rounded truncate" title="中班：${aFullNames}">🌤️ ${aCodes}</div>`;
      }
      if (morningList.length === 0 && afternoonList.length === 0) {
        bodyHtml += `<div class="text-[10px] text-slate-300 text-center py-1">＋排班</div>`;
      }
    }
    bodyHtml += `</div>`;

    cell.innerHTML = headerHtml + bodyHtml;
    grid.appendChild(cell);
  }
}

// 點擊開啟填空格子彈窗
function openShiftEditModal(dateStr, dayOfWeek) {
  if (dayOfWeek === 0) {
    if (!confirm(`${dateStr} 為週日固定休診日，確定要為此日安排出勤嗎？`)) return;
  }

  editingDate = dateStr;
  document.getElementById('modal-date-title').innerText = `📅 ${dateStr} 排班代碼指派`;
  const hintElem = document.getElementById('modal-day-hint');
  const afternoonBox = document.getElementById('box-afternoon-shift');

  if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
    hintElem.innerText = "週一/三/五：可排 早班 與 中班";
    afternoonBox.classList.remove('hidden');
  } else {
    hintElem.innerText = "週二/四/六：僅排 早班";
    afternoonBox.classList.add('hidden');
  }

  const daySchedules = cachedMonthSchedules.filter(s => s.date === dateStr);
  const currentMorningEmpIds = daySchedules.filter(s => !s.clinic_shifts?.shift_name?.includes('中') && s.shift_id !== 'afternoon').map(s => s.employee_id);
  const currentAfternoonEmpIds = daySchedules.filter(s => s.clinic_shifts?.shift_name?.includes('中') || s.shift_id === 'afternoon').map(s => s.employee_id);

  // 早班護理師代碼按鈕
  const morningContainer = document.getElementById('morning-nurses-select');
  morningContainer.innerHTML = '';
  cachedEmployees.filter(e => e.name !== '林和正').forEach(emp => {
    const isChecked = currentMorningEmpIds.includes(emp.id);
    const code = getEmpCode(emp.name);
    const label = document.createElement('label');
    label.className = `flex items-center gap-1 p-1.5 rounded-lg border text-xs font-bold cursor-pointer transition ${isChecked ? 'bg-amber-100 border-amber-400 text-amber-900 shadow-xs' : 'bg-slate-50 border-slate-200 text-slate-700'}`;
    label.innerHTML = `<input type="checkbox" name="modal-morning-emp" value="${emp.id}" ${isChecked ? 'checked' : ''} onchange="this.parentElement.classList.toggle('bg-amber-100'); this.parentElement.classList.toggle('border-amber-400');"> [${code}] ${emp.name}`;
    morningContainer.appendChild(label);
  });

  // 中班護理師代碼按鈕
  const afternoonContainer = document.getElementById('afternoon-nurses-select');
  afternoonContainer.innerHTML = '';
  cachedEmployees.filter(e => e.name !== '林和正').forEach(emp => {
    const isChecked = currentAfternoonEmpIds.includes(emp.id);
    const code = getEmpCode(emp.name);
    const label = document.createElement('label');
    label.className = `flex items-center gap-1 p-1.5 rounded-lg border text-xs font-bold cursor-pointer transition ${isChecked ? 'bg-blue-100 border-blue-400 text-blue-900 shadow-xs' : 'bg-slate-50 border-slate-200 text-slate-700'}`;
    label.innerHTML = `<input type="checkbox" name="modal-afternoon-emp" value="${emp.id}" ${isChecked ? 'checked' : ''} onchange="this.parentElement.classList.toggle('bg-blue-100'); this.parentElement.classList.toggle('border-blue-400');"> [${code}] ${emp.name}`;
    afternoonContainer.appendChild(label);
  });

  document.getElementById('shift-edit-modal').classList.remove('hidden');
}

function closeShiftEditModal() {
  document.getElementById('shift-edit-modal').classList.add('hidden');
  editingDate = null;
}

// 儲存當天勾選的填空排班
async function saveModalDaySchedule() {
  if (!editingDate) return;

  const morningChecked = Array.from(document.querySelectorAll('input[name="modal-morning-emp"]:checked')).map(cb => cb.value);
  const afternoonChecked = Array.from(document.querySelectorAll('input[name="modal-afternoon-emp"]:checked')).map(cb => cb.value);

  await supabaseClient.from('clinic_schedules').delete().eq('date', editingDate);

  const newRecords = [];
  morningChecked.forEach(empId => {
    newRecords.push({ date: editingDate, employee_id: empId, shift_id: 'morning' });
  });
  afternoonChecked.forEach(empId => {
    newRecords.push({ date: editingDate, employee_id: empId, shift_id: 'afternoon' });
  });

  if (newRecords.length > 0) {
    const { error } = await supabaseClient.from('clinic_schedules').insert(newRecords);
    if (error) alert('儲存失敗：' + error.message);
  }

  closeShiftEditModal();
  loadScheduleCalendar();
}

// ==================== 國定假日 9 大節日抽籤 ====================
async function runNationalHolidayLottery() {
  if (!confirm('確定由「一般輪班護理師」進行全年度 9 大國定假日抽籤輪休？（每人均休過一次後才重啟下一輪）')) return;

  const { data: regularNurses } = await supabaseClient.from('clinic_employees')
    .select('*')
    .eq('is_active', true)
    .not('role', 'eq', 'doctor')
    .not('name', 'in', '("林和正","陳慧倪","盧明伶")');

  if (!regularNurses || regularNurses.length === 0) {
    alert('查無符合輪抽資格的一般護理師！');
    return;
  }

  let pool = [...regularNurses];
  const assignments = [];

  NATIONAL_HOLIDAYS_2026.forEach(h => {
    if (pool.length === 0) pool = [...regularNurses];
    const idx = Math.floor(Math.random() * pool.length);
    const winner = pool.splice(idx, 1)[0];
    assignments.push({
      year: 2026,
      holiday_name: h.name,
      holiday_date: h.date,
      winner_emp_id: winner.id
    });
  });

  const { error } = await supabaseClient.from('clinic_holiday_lottery').upsert(assignments);
  if (error) {
    alert('抽籤儲存失敗：' + error.message);
  } else {
    alert('🎉 2026 年度 9 大國定假日抽籤排定完成！');
  }
}
