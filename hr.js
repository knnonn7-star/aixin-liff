// ==================== 愛欣診所 人事與排班模組 (hr.js) ====================
let cachedEmployees = [];
let cachedShifts = [];
let cachedMonthSchedules = [];
let cachedMonthRequests = [];
let editingDate = null;
let userReqDate = null;

// 固定週一至五上班、週六加班，不參與透析輪班但可自填特休/年休的同仁
const FIXED_STAFF_ROLES = {
  '盧明伶': { roleName: '門診藥事', tag: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
  '涂春娥': { roleName: '工作人員', tag: 'bg-teal-100 text-teal-900 border-teal-300' },
  '胡月霞': { roleName: '清潔人員', tag: 'bg-cyan-100 text-cyan-900 border-cyan-300' }
};

// 9 大國定假日清單 (全年度自動比對與醒目標示)
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

// 國定假日查詢輔助函式
function getHolidayInfo(dateStr) {
  return NATIONAL_HOLIDAYS_2026.find(h => h.date === dateStr);
}

// ==================== 頁籤切換與初始化 ====================
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

  if (tab === 'myschedule') loadMySchedule();
  if (tab === 'request') initRequestPage();
  if (tab === 'scheduling') initScheduleAdmin();
}

function initHrDefaults() {
  const today = new Date();
  const thisMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const nextMonthStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;

  const mySchMonth = document.getElementById('my-sch-month');
  if (mySchMonth && !mySchMonth.value) mySchMonth.value = thisMonthStr;

  const reqMonthElem = document.getElementById('req-target-month');
  if (reqMonthElem && !reqMonthElem.value) reqMonthElem.value = nextMonthStr;

  const adminMonthElem = document.getElementById('admin-sch-month');
  if (adminMonthElem && !adminMonthElem.value) adminMonthElem.value = nextMonthStr;
}

function isFixedStaff(name) { return !!FIXED_STAFF_ROLES[name]; }
function isDoctor(name, role) { return name === '林和正' || role === 'doctor'; }
function isDialysisNurse(name, role) { return !isFixedStaff(name) && !isDoctor(name, role); }

function getEmpCode(emp) {
  if (isDoctor(emp.name, emp.role)) return '醫師';
  if (isFixedStaff(emp.name)) return FIXED_STAFF_ROLES[emp.name].roleName;
  const dialysisNurses = cachedEmployees.filter(e => isDialysisNurse(e.name, e.role));
  const idx = dialysisNurses.findIndex(e => e.id === emp.id);
  return idx >= 0 ? String(idx + 1).padStart(2, '0') : '護理';
}

// ==================== 1. 「我的班表」月曆視圖 (含節日標註) ====================
async function loadMySchedule() {
  if (!currentUser.empId) await syncEmployeeRecord();
  initHrDefaults();

  const monthStr = document.getElementById('my-sch-month')?.value;
  if (!monthStr) return;

  const [y, m] = monthStr.split('-').map(Number);
  const firstDayObj = new Date(y, m - 1, 1);
  const totalDays = new Date(y, m, 0).getDate();
  const startDayOfWeek = firstDayObj.getDay();

  const startDateStr = `${monthStr}-01`;
  const endDateStr = `${monthStr}-${totalDays}`;

  const [schRes, lotteryRes] = await Promise.all([
    supabaseClient.from('clinic_schedules').select('*, clinic_shifts(*)').eq('employee_id', currentUser.empId).gte('date', startDateStr).lte('date', endDateStr),
    supabaseClient.from('clinic_holiday_lottery').select('*').eq('winner_emp_id', currentUser.empId).gte('holiday_date', startDateStr).lte('holiday_date', endDateStr)
  ]);

  const mySchedules = schRes.data || [];
  const myHolidays = lotteryRes.data || [];

  const grid = document.getElementById('my-calendar-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let i = 0; i < startDayOfWeek; i++) {
    const empty = document.createElement('div');
    empty.className = "min-h-[65px] bg-slate-50/50 rounded-lg border border-dashed border-slate-200";
    grid.appendChild(empty);
  }

  for (let d = 1; d <= totalDays; d++) {
    const dayStr = `${monthStr}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = new Date(y, m - 1, d).getDay();
    const sch = mySchedules.find(s => s.date === dayStr);
    const holiday = getHolidayInfo(dayStr);
    const wonHoliday = myHolidays.find(h => h.holiday_date === dayStr);

    const cell = document.createElement('div');
    cell.className = `min-h-[65px] p-1 rounded-lg border flex flex-col justify-between text-xs ${
      holiday ? 'bg-rose-50/70 border-rose-300' : (dayOfWeek === 0 ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-200')
    }`;

    // 頂部日期與國定節日標籤
    let headerHtml = `<div class="flex justify-between items-center font-bold">`;
    headerHtml += `<span class="${holiday || dayOfWeek === 0 ? 'text-rose-600 font-black' : 'text-slate-700'}">${d}</span>`;
    if (holiday) {
      headerHtml += `<span class="text-[9px] bg-rose-600 text-white px-1 rounded-full font-bold">🎌${holiday.name}</span>`;
    } else if (dayOfWeek === 0) {
      headerHtml += `<span class="text-[9px] bg-slate-200 text-slate-700 px-1 rounded">休診</span>`;
    }
    headerHtml += `</div>`;

    // 班別狀態
    let statusHtml = `<div class="mt-0.5">`;
    if (wonHoliday) {
      statusHtml += `<span class="text-[10px] bg-rose-500 text-white font-bold px-1 py-0.5 rounded block text-center shadow-xs">🎉 國定抽中輪休</span>`;
    } else if (sch) {
      if (sch.shift_id === 'off') {
        statusHtml += `<span class="text-[10px] bg-rose-100 text-rose-800 font-bold px-1 py-0.5 rounded block text-center">🏖️ 特休/年休</span>`;
      } else if (sch.shift_id === 'afternoon' || sch.clinic_shifts?.shift_name?.includes('中')) {
        statusHtml += `<span class="text-[10px] bg-blue-100 text-blue-900 font-bold px-1 py-0.5 rounded block text-center">🌤️ 中班</span>`;
      } else {
        statusHtml += `<span class="text-[10px] bg-amber-100 text-amber-900 font-bold px-1 py-0.5 rounded block text-center">☀️ 早班</span>`;
      }
    } else if (dayOfWeek === 0) {
      statusHtml += `<span class="text-[10px] text-slate-300 block text-center">固定休</span>`;
    } else {
      if (isFixedStaff(currentUser.displayName)) {
        statusHtml += `<span class="text-[10px] bg-emerald-50 text-emerald-800 px-1 py-0.5 rounded block text-center">常規班</span>`;
      } else {
        statusHtml += `<span class="text-[10px] text-slate-300 block text-center">未排班</span>`;
      }
    }
    statusHtml += `</div>`;

    cell.innerHTML = headerHtml + statusHtml;
    grid.appendChild(cell);
  }
}

// ==================== 2. 「預約排班 / 特休登記」月曆點選視圖 ====================
async function initRequestPage() {
  if (!currentUser.empId) await syncEmployeeRecord();
  initHrDefaults();

  const today = new Date();
  const currentDay = today.getDate();
  const deadlineTag = document.getElementById('request-deadline-tag');
  const isAdminUser = (currentUser.displayName === '陳慧倪' || currentUser.displayName === '林和正' || currentUser.role === 'doctor');
  const isFixed = isFixedStaff(currentUser.displayName);

  if (deadlineTag) {
    if (isFixed) {
      deadlineTag.innerText = "🌿 工作人員：特休/年休自由登記";
      deadlineTag.className = "bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 rounded font-bold";
    } else if (currentDay > 15 && !isAdminUser) {
      deadlineTag.innerText = "⚠️ 護理預約已於 15 號截止 (護理長排班中)";
      deadlineTag.className = "bg-rose-100 text-rose-800 text-[10px] px-2 py-0.5 rounded font-bold";
    } else {
      deadlineTag.innerText = currentDay <= 15 ? `距離 15 號截止剩 ${15 - currentDay} 天` : `管理職特別編輯模式`;
      deadlineTag.className = "bg-indigo-200 text-indigo-800 text-[10px] px-2 py-0.5 rounded font-bold";
    }
  }

  loadRequestCalendar();
}

async function loadRequestCalendar() {
  const monthStr = document.getElementById('req-target-month')?.value;
  if (!monthStr) return;

  const [y, m] = monthStr.split('-').map(Number);
  const firstDayObj = new Date(y, m - 1, 1);
  const totalDays = new Date(y, m, 0).getDate();
  const startDayOfWeek = firstDayObj.getDay();

  const startDateStr = `${monthStr}-01`;
  const endDateStr = `${monthStr}-${totalDays}`;

  const { data: myRequests } = await supabaseClient.from('clinic_schedule_requests')
    .select('*')
    .eq('employee_id', currentUser.empId)
    .gte('request_date', startDateStr)
    .lte('request_date', endDateStr);

  const grid = document.getElementById('req-calendar-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let i = 0; i < startDayOfWeek; i++) {
    const empty = document.createElement('div');
    empty.className = "min-h-[70px] bg-slate-50/50 rounded-lg border border-dashed border-slate-200";
    grid.appendChild(empty);
  }

  for (let d = 1; d <= totalDays; d++) {
    const dayStr = `${monthStr}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = new Date(y, m - 1, d).getDay();
    const req = (myRequests || []).find(r => r.request_date === dayStr);
    const holiday = getHolidayInfo(dayStr);

    const cell = document.createElement('div');
    cell.className = `min-h-[70px] p-1 rounded-lg border flex flex-col justify-between text-xs cursor-pointer transition hover:shadow-md ${
      holiday ? 'bg-rose-50/60 border-rose-300' : (dayOfWeek === 0 ? 'bg-slate-50 border-slate-200 cursor-not-allowed' : (req ? 'bg-indigo-50/80 border-indigo-400' : 'bg-white border-slate-200 hover:border-indigo-400'))
    }`;
    
    if (dayOfWeek !== 0) {
      cell.onclick = () => openUserReqModal(dayStr, dayOfWeek, req, holiday);
    }

    let headerHtml = `<div class="flex justify-between items-center font-bold">`;
    headerHtml += `<span class="${holiday || dayOfWeek === 0 ? 'text-rose-600 font-black' : 'text-slate-700'}">${d}</span>`;
    if (holiday) {
      headerHtml += `<span class="text-[9px] bg-rose-600 text-white px-1 rounded-full font-bold">🎌${holiday.name}</span>`;
    } else if (dayOfWeek === 0) {
      headerHtml += `<span class="text-[9px] bg-slate-200 text-slate-700 px-1 rounded">休診</span>`;
    }
    headerHtml += `</div>`;

    let reqHtml = `<div class="mt-0.5">`;
    if (dayOfWeek === 0) {
      reqHtml += `<span class="text-[10px] text-slate-300 block text-center">固定休</span>`;
    } else if (req) {
      if (req.request_type === 'off') {
        reqHtml += `<span class="text-[10px] bg-rose-500 text-white font-bold px-1.5 py-0.5 rounded block text-center">🏖️ 特休/年休</span>`;
      } else if (req.shift_id === 'afternoon') {
        reqHtml += `<span class="text-[10px] bg-blue-600 text-white font-bold px-1.5 py-0.5 rounded block text-center">🌤️ 預約中班</span>`;
      } else {
        reqHtml += `<span class="text-[10px] bg-amber-500 text-white font-bold px-1.5 py-0.5 rounded block text-center">☀️ 預約早班</span>`;
      }
    } else {
      reqHtml += `<span class="text-[10px] text-slate-300 block text-center">＋登記</span>`;
    }
    reqHtml += `</div>`;

    cell.innerHTML = headerHtml + reqHtml;
    grid.appendChild(cell);
  }
}

// 點擊日曆格子彈出預約設定
function openUserReqModal(dateStr, dayOfWeek, existingReq, holiday) {
  const today = new Date();
  const isAdminUser = (currentUser.displayName === '陳慧倪' || currentUser.displayName === '林和正' || currentUser.role === 'doctor');
  const isFixed = isFixedStaff(currentUser.displayName);

  if (today.getDate() > 15 && !isAdminUser && !isFixed) {
    alert('⚠️ 預約已於 15 號截止，目前為護理長整合排班期。若有特殊需求請洽護理長。');
    return;
  }

  userReqDate = dateStr;
  const titleElem = document.getElementById('user-req-date-title');
  titleElem.innerText = `📅 ${dateStr} ${holiday ? `(🎌${holiday.name})` : ''} 登記`;

  const morningOpt = document.getElementById('user-req-morning-opt');
  const afternoonOpt = document.getElementById('user-req-afternoon-opt');

  // 三位固定工作人員（盧明伶、涂春娥、胡月霞）只顯示特休/年休選項
  if (isFixed) {
    if (morningOpt) morningOpt.classList.add('hidden');
    if (afternoonOpt) afternoonOpt.classList.add('hidden');
  } else {
    if (morningOpt) morningOpt.classList.remove('hidden');
    if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
      if (afternoonOpt) afternoonOpt.classList.remove('hidden');
    } else {
      if (afternoonOpt) afternoonOpt.classList.add('hidden');
    }
  }

  const deleteBtn = document.getElementById('btn-delete-req');
  const reasonInput = document.getElementById('user-req-reason');

  if (existingReq) {
    deleteBtn.classList.remove('hidden');
    reasonInput.value = existingReq.reason || '';
    const radios = document.querySelectorAll('input[name="user-req-type"]');
    radios.forEach(r => {
      if (existingReq.request_type === 'off' && r.value === 'off') r.checked = true;
      else if (existingReq.shift_id === r.value) r.checked = true;
    });
  } else {
    deleteBtn.classList.add('hidden');
    reasonInput.value = '';
    document.querySelector('input[name="user-req-type"][value="off"]').checked = true;
  }

  document.getElementById('user-req-modal').classList.remove('hidden');
}

function closeUserReqModal() {
  document.getElementById('user-req-modal').classList.add('hidden');
  userReqDate = null;
}

// 送出預約 / 特休
async function submitUserDayRequest() {
  if (!userReqDate) return;

  const selectedType = document.querySelector('input[name="user-req-type"]:checked')?.value || 'off';
  const reason = document.getElementById('user-req-reason').value;
  const targetMonth = document.getElementById('req-target-month').value;
  const dayOfWeek = new Date(userReqDate).getDay();

  const isNurse = isDialysisNurse(currentUser.displayName, currentUser.role);

  // 僅透析護理師受一三五限休 2 次限制
  if (selectedType === 'off' && isNurse) {
    if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
      const { data: myReqs } = await supabaseClient.from('clinic_schedule_requests')
        .select('*')
        .eq('employee_id', currentUser.empId)
        .eq('target_month', targetMonth)
        .eq('request_type', 'off');

      const mwfCount = (myReqs || []).filter(r => {
        const d = new Date(r.request_date).getDay();
        return (d === 1 || d === 3 || d === 5) && r.request_date !== userReqDate;
      }).length;

      if (mwfCount >= 2 && currentUser.displayName !== '陳慧倪') {
        alert('🚨 預約上限：每位透析護理師每月「星期一、三、五」最多僅能預約 2 次休假！');
        return;
      }
    }
  }

  const isFixed = isFixedStaff(currentUser.displayName);
  const noteReason = isFixed ? `特休/年休 (${reason || '依同仁排定'})` : reason;

  const { error } = await supabaseClient.from('clinic_schedule_requests').upsert([{
    target_month: targetMonth,
    employee_id: currentUser.empId,
    request_date: userReqDate,
    request_type: selectedType === 'off' ? 'off' : 'shift',
    shift_id: selectedType === 'off' ? 'off' : selectedType,
    reason: noteReason,
    status: 'pending'
  }], { onConflict: 'employee_id,request_date' });

  if (error) alert('儲存失敗：' + error.message);
  else alert('✅ 登記成功！');

  closeUserReqModal();
  loadRequestCalendar();
}

async function deleteCurrentDayRequest() {
  if (!userReqDate) return;
  await supabaseClient.from('clinic_schedule_requests').delete().eq('employee_id', currentUser.empId).eq('request_date', userReqDate);
  closeUserReqModal();
  loadRequestCalendar();
}

// ==================== 3. 護理長月曆視覺化排班 ====================
async function initScheduleAdmin() {
  const { data: empData } = await supabaseClient.from('clinic_employees').select('*').eq('is_active', true);
  
  const seen = new Set();
  cachedEmployees = (empData || []).filter(e => {
    if (!e.name || seen.has(e.name.trim())) return false;
    seen.add(e.name.trim());
    return true;
  });

  const codeTagsContainer = document.getElementById('nurse-code-tags');
  if (codeTagsContainer) {
    codeTagsContainer.innerHTML = '';

    const docs = cachedEmployees.filter(e => isDoctor(e.name, e.role));
    docs.forEach(e => {
      const span = document.createElement('span');
      span.className = "px-2 py-0.5 rounded-md border text-[11px] font-bold bg-indigo-100 text-indigo-900 border-indigo-300 shadow-xs";
      span.innerText = `[醫師] ${e.name}`;
      codeTagsContainer.appendChild(span);
    });

    const dialysisNurses = cachedEmployees.filter(e => isDialysisNurse(e.name, e.role));
    dialysisNurses.forEach((e, idx) => {
      const code = String(idx + 1).padStart(2, '0');
      const isHead = e.name === '陳慧倪';
      const span = document.createElement('span');
      span.className = `px-2 py-0.5 rounded-md border text-[11px] font-bold shadow-xs ${isHead ? 'bg-purple-100 text-purple-900 border-purple-300' : 'bg-slate-100 text-slate-800 border-slate-300'}`;
      span.innerText = `[${code}] ${e.name}${isHead ? '(護理長)' : ''}`;
      codeTagsContainer.appendChild(span);
    });

    const fixedStaffs = cachedEmployees.filter(e => isFixedStaff(e.name));
    fixedStaffs.forEach(e => {
      const info = FIXED_STAFF_ROLES[e.name];
      const span = document.createElement('span');
      span.className = `px-2 py-0.5 rounded-md border text-[11px] font-bold shadow-xs ${info.tag}`;
      span.innerText = `[${info.roleName}] ${e.name} (固定班/自排特休)`;
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

  const [schRes, reqRes, lotteryRes] = await Promise.all([
    supabaseClient.from('clinic_schedules').select('*, clinic_employees(*)').gte('date', startDateStr).lte('date', endDateStr),
    supabaseClient.from('clinic_schedule_requests').select('*, clinic_employees(*)').gte('request_date', startDateStr).lte('request_date', endDateStr).eq('request_type', 'off'),
    supabaseClient.from('clinic_holiday_lottery').select('*, clinic_employees(*)').gte('holiday_date', startDateStr).lte('holiday_date', endDateStr)
  ]);

  cachedMonthSchedules = schRes.data || [];
  cachedMonthRequests = reqRes.data || [];
  const monthLotteries = lotteryRes.data || [];

  const grid = document.getElementById('calendar-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let i = 0; i < startDayOfWeek; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = "min-h-[75px] bg-slate-50/50 rounded-lg border border-dashed border-slate-200";
    grid.appendChild(emptyCell);
  }

  for (let d = 1; d <= totalDays; d++) {
    const dayStr = `${monthStr}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = new Date(y, m - 1, d).getDay();
    const daySchedules = cachedMonthSchedules.filter(s => s.date === dayStr);
    const dayOffReqs = cachedMonthRequests.filter(r => r.request_date === dayStr);
    const holiday = getHolidayInfo(dayStr);
    const holidayWinner = monthLotteries.find(l => l.holiday_date === dayStr);

    const cell = document.createElement('div');
    cell.className = `min-h-[75px] p-1.5 rounded-lg border flex flex-col justify-between transition hover:shadow-md cursor-pointer ${
      holiday ? 'bg-rose-50/80 border-rose-300' : (dayOfWeek === 0 ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-200 hover:border-indigo-400')
    }`;
    cell.onclick = () => openShiftEditModal(dayStr, dayOfWeek, holiday);

    // 頂部日期與節日標籤
    let headerHtml = `<div class="flex justify-between items-center font-bold">`;
    headerHtml += `<span class="text-xs ${holiday || dayOfWeek === 0 ? 'text-rose-600 font-black' : 'text-slate-700'}">${d}</span>`;
    if (holiday) {
      headerHtml += `<span class="text-[9px] bg-rose-600 text-white px-1.5 py-0.2 rounded-full font-bold">🎌${holiday.name}</span>`;
    } else if (dayOfWeek === 0) {
      headerHtml += `<span class="text-[9px] bg-slate-200 text-slate-700 px-1 rounded">休診</span>`;
    }
    headerHtml += `</div>`;

    // 班別與特休代碼
    let bodyHtml = `<div class="space-y-0.5 mt-0.5">`;
    if (holidayWinner) {
      bodyHtml += `<div class="text-[9px] bg-purple-100 text-purple-900 font-bold px-1 rounded truncate">🎉抽中休:${holidayWinner.clinic_employees?.name || ''}</div>`;
    }

    if (dayOfWeek !== 0) {
      const morningList = daySchedules.filter(s => s.shift_id === 'morning' || (!s.clinic_shifts?.shift_name?.includes('中') && s.shift_id !== 'afternoon' && s.shift_id !== 'off'));
      const afternoonList = daySchedules.filter(s => s.shift_id === 'afternoon' || s.clinic_shifts?.shift_name?.includes('中'));
      const offNames = dayOffReqs.map(r => r.clinic_employees?.name).filter(Boolean);

      if (morningList.length > 0) {
        const mCodes = morningList.map(s => getEmpCode(s.clinic_employees || { name: s.employee_id })).join(',');
        bodyHtml += `<div class="text-[10px] bg-amber-100 text-amber-900 font-bold px-1 py-0.2 rounded truncate">☀️早:${mCodes}</div>`;
      }
      if (afternoonList.length > 0) {
        const aCodes = afternoonList.map(s => getEmpCode(s.clinic_employees || { name: s.employee_id })).join(',');
        bodyHtml += `<div class="text-[10px] bg-blue-100 text-blue-900 font-bold px-1 py-0.2 rounded truncate">🌤️中:${aCodes}</div>`;
      }
      if (offNames.length > 0) {
        bodyHtml += `<div class="text-[9px] bg-rose-100 text-rose-800 font-bold px-1 py-0.2 rounded truncate" title="特休：${offNames.join('、')}">🏖️特休:${offNames.join(',')}</div>`;
      }
      if (morningList.length === 0 && afternoonList.length === 0 && offNames.length === 0 && !holidayWinner) {
        bodyHtml += `<div class="text-[10px] text-slate-300 text-center py-1">＋排班</div>`;
      }
    }
    bodyHtml += `</div>`;

    cell.innerHTML = headerHtml + bodyHtml;
    grid.appendChild(cell);
  }
}

function openShiftEditModal(dateStr, dayOfWeek, holiday) {
  if (dayOfWeek === 0) {
    if (!confirm(`${dateStr} 為週日固定休診日，確定要為此日指派特別出勤嗎？`)) return;
  }

  editingDate = dateStr;
  document.getElementById('modal-date-title').innerText = `📅 ${dateStr} ${holiday ? `(🎌${holiday.name})` : ''} 排班指派`;
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
  const currentMorningEmpIds = daySchedules.filter(s => s.shift_id === 'morning' || (!s.clinic_shifts?.shift_name?.includes('中') && s.shift_id !== 'afternoon' && s.shift_id !== 'off')).map(s => s.employee_id);
  const currentAfternoonEmpIds = daySchedules.filter(s => s.shift_id === 'afternoon' || s.clinic_shifts?.shift_name?.includes('中')).map(s => s.employee_id);

  // 僅展示透析輪班護理師（排除醫師與固定班三位工作人員）
  const dialysisNurses = cachedEmployees.filter(e => isDialysisNurse(e.name, e.role));

  const morningContainer = document.getElementById('morning-nurses-select');
  morningContainer.innerHTML = '';
  dialysisNurses.forEach(emp => {
    const isChecked = currentMorningEmpIds.includes(emp.id);
    const code = getEmpCode(emp);
    const label = document.createElement('label');
    label.className = `flex items-center gap-1 p-1.5 rounded-lg border text-xs font-bold cursor-pointer transition ${isChecked ? 'bg-amber-100 border-amber-400 text-amber-900 shadow-xs' : 'bg-slate-50 border-slate-200 text-slate-700'}`;
    label.innerHTML = `<input type="checkbox" name="modal-morning-emp" value="${emp.id}" ${isChecked ? 'checked' : ''} onchange="this.parentElement.classList.toggle('bg-amber-100'); this.parentElement.classList.toggle('border-amber-400');"> [${code}] ${emp.name}`;
    morningContainer.appendChild(label);
  });

  const afternoonContainer = document.getElementById('afternoon-nurses-select');
  afternoonContainer.innerHTML = '';
  dialysisNurses.forEach(emp => {
    const isChecked = currentAfternoonEmpIds.includes(emp.id);
    const code = getEmpCode(emp);
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

async function saveModalDaySchedule() {
  if (!editingDate) return;

  const morningChecked = Array.from(document.querySelectorAll('input[name="modal-morning-emp"]:checked')).map(cb => cb.value);
  const afternoonChecked = Array.from(document.querySelectorAll('input[name="modal-afternoon-emp"]:checked')).map(cb => cb.value);

  const dialysisNurseIds = cachedEmployees.filter(e => isDialysisNurse(e.name, e.role)).map(e => e.id);
  await supabaseClient.from('clinic_schedules').delete().eq('date', editingDate).in('employee_id', dialysisNurseIds);

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

// 國定假日 9 大節日抽籤
async function runNationalHolidayLottery() {
  if (!confirm('確定由「透析輪班護理師」進行全年度 9 大國定假日抽籤輪休？（每人均休過一次後才重啟下一輪）')) return;

  const regularNurses = cachedEmployees.filter(e => isDialysisNurse(e.name, e.role) && e.name !== '陳慧倪');

  if (!regularNurses || regularNurses.length === 0) {
    alert('查無符合輪抽資格的一般透析護理師！');
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
  if (error) alert('抽籤儲存失敗：' + error.message);
  else alert('🎉 2026 年度 9 大國定假日抽籤排定完成！');
  loadScheduleCalendar();
}
