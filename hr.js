// ==================== 愛欣診所 人事排班與特休管理模組 (hr.js) ====================
let cachedEmployees = [];
let cachedMonthSchedules = [];
let cachedMonthRequests = [];
let cachedMonthLotteries = [];
let editingDate = null;
let userReqDate = null;

// 3 大核心班別
const SHIFT_TYPES = ['未排班', '開門白班', '正常白班', '正常晚班'];

// 5 種標準工時 (小時)
const WORK_HOURS = [7, 7.5, 8.5, 9, 9.5];

// 診所全員入職日期資料庫
const EMPLOYEE_ONBOARDING_DATA = {
  '陳惠倪': { onboard: '2005-05-01', roleName: '護理長' },
  '曾憲敏': { onboard: '2012-05-01', roleName: '副護理長' },
  '薛雅仁': { onboard: '2005-05-16', roleName: '護理師' },
  '李牧音': { onboard: '2006-01-11', roleName: '護理師' },
  '林雯琦': { onboard: '2006-12-01', roleName: '護理師' },
  '謝宜婷': { onboard: '2009-11-02', roleName: '護理師' },
  '盧明伶': { onboard: '2009-11-02', roleName: '門診藥事' },
  '陳金暖': { onboard: '2010-04-01', roleName: '小組長' },
  '王瓊代': { onboard: '2014-05-01', roleName: '護理師' },
  '吳金燕': { onboard: '2018-05-01', roleName: '護理師' },
  '王靜慧': { onboard: '2019-07-08', roleName: '護理師' },
  '吳培瑜': { onboard: '2021-09-20', roleName: '護理師' },
  '李香瑩': { onboard: '2023-07-10', roleName: '護理師' },
  '吳沐芸': { onboard: '2024-05-15', roleName: '護理師' },
  '涂春娥': { onboard: '2008-10-20', roleName: '工作人員' },
  '胡月霞': { onboard: '2022-04-01', roleName: '清潔人員' },
  '王芝妍': { onboard: '2018-08-06', roleName: '工時透析' },
  '林和正': { onboard: '2000-01-01', roleName: '醫師' }
};

// 固定班同仁名冊
const FIXED_STAFF_ROLES = {
  '盧明伶': { roleName: '門診藥事', tag: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
  '涂春娥': { roleName: '工作人員', tag: 'bg-teal-100 text-teal-900 border-teal-300' },
  '胡月霞': { roleName: '清潔人員', tag: 'bg-cyan-100 text-cyan-900 border-cyan-300' }
};

// 2026 年度政府法定國定假日 (共 12 日)
const NATIONAL_HOLIDAYS_2026 = [
  { name: '元旦', date: '2026-01-01' },
  { name: '除夕', date: '2026-02-16' },
  { name: '春節初一', date: '2026-02-17' },
  { name: '春節初二', date: '2026-02-18' },
  { name: '春節初三', date: '2026-02-19' },
  { name: '228和平紀念日', date: '2026-02-28' },
  { name: '兒童節', date: '2026-04-04' },
  { name: '清明節', date: '2026-04-05' },
  { name: '勞動節', date: '2026-05-01' },
  { name: '端午節', date: '2026-06-19' },
  { name: '中秋節', date: '2026-09-25' },
  { name: '雙十國慶', date: '2026-10-10' }
];

function getHolidayInfo(dateStr) {
  return NATIONAL_HOLIDAYS_2026.find(h => h.date === dateStr);
}

function calculateLaborSpecialLeave(name) {
  const info = EMPLOYEE_ONBOARDING_DATA[name];
  if (!info) return { days: 10, seniorityText: '年資：約 2 年 (預設)' };

  const onboard = new Date(info.onboard);
  const now = new Date('2026-08-17');
  const totalMonths = (now.getFullYear() - onboard.getFullYear()) * 12 + (now.getMonth() - onboard.getMonth());
  const years = totalMonths / 12;

  let days = 0;
  if (years < 0.5) days = 0;
  else if (years < 1) days = 3;
  else if (years < 2) days = 7;
  else if (years < 3) days = 10;
  else if (years < 5) days = 14;
  else if (years < 10) days = 15;
  else {
    const extraYears = Math.floor(years - 10) + 1;
    days = Math.min(30, 15 + extraYears);
  }

  const seniorityText = `到職：${info.onboard} (年資 ${years.toFixed(1)} 年)`;
  return { days, seniorityText, roleName: info.roleName };
}

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

// ==================== 1. 「我的班表」月曆與法定假期餘額結算 ====================
async function loadMySchedule() {
  if (!currentUser.empId) await syncEmployeeRecord();
  initHrDefaults();

  const monthStr = document.getElementById('my-sch-month')?.value;
  if (!monthStr) return;

  const yearStr = monthStr.substring(0, 4);
  const [y, m] = monthStr.split('-').map(Number);
  const firstDayObj = new Date(y, m - 1, 1);
  const totalDays = new Date(y, m, 0).getDate();
  const startDayOfWeek = firstDayObj.getDay();

  const startDateStr = `${monthStr}-01`;
  const endDateStr = `${monthStr}-${totalDays}`;

  const [yearSchRes, monthSchRes, yearLotteryRes] = await Promise.all([
    supabaseClient.from('clinic_schedules').select('*').eq('employee_id', currentUser.empId).gte('date', `${yearStr}-01-01`).lte('date', `${yearStr}-12-31`),
    supabaseClient.from('clinic_schedules').select('*').eq('employee_id', currentUser.empId).gte('date', startDateStr).lte('date', endDateStr),
    supabaseClient.from('clinic_holiday_lottery').select('*').eq('winner_emp_id', currentUser.empId).eq('year', parseInt(yearStr, 10))
  ]);

  const yearSchedules = yearSchRes.data || [];
  const monthSchedules = monthSchRes.data || [];
  const yearLotteries = yearLotteryRes.data || [];

  const { days: totalSpecialLeave, seniorityText } = calculateLaborSpecialLeave(currentUser.displayName);
  const usedSpecialLeave = yearSchedules.filter(s => s.shift_name?.includes('特休') || s.shift_name?.includes('年休')).length;
  document.getElementById('my-seniority-text').innerText = seniorityText;
  document.getElementById('stat-special-leave').innerText = `${usedSpecialLeave} / ${totalSpecialLeave}日`;

  const totalNational = NATIONAL_HOLIDAYS_2026.length;
  const usedNational = yearLotteries.length;
  document.getElementById('stat-national-leave').innerText = `${usedNational} / ${totalNational}日`;

  const totalWeekend = 104;
  const usedWeekend = yearSchedules.filter(s => s.shift_name === '休假' || s.shift_name === '未排班').length;
  document.getElementById('stat-weekend-leave').innerText = `${usedWeekend} / ${totalWeekend}日`;

  let netHoursDiff = 0;
  let monthWorkHours = 0;
  yearSchedules.forEach(s => {
    if (s.hours && s.shift_name !== '未排班' && s.shift_name !== '休假' && !s.shift_name?.includes('特休')) {
      const h = Number(s.hours) || 0;
      netHoursDiff += (h - 8.0);
    }
  });

  monthSchedules.forEach(s => {
    if (s.hours && s.shift_name !== '未排班' && s.shift_name !== '休假' && !s.shift_name?.includes('特休')) {
      monthWorkHours += Number(s.hours) || 0;
    }
  });

  const hoursOffsetDays = (netHoursDiff / 8.0);
  const offsetSign = hoursOffsetDays >= 0 ? '+' : '';
  document.getElementById('stat-hours-offset-days').innerText = `${offsetSign}${hoursOffsetDays.toFixed(1)}日 (${netHoursDiff.toFixed(1)}h)`;
  document.getElementById('my-total-hours').innerText = `${monthWorkHours} 小時`;

  const remainingSpecial = Math.max(0, totalSpecialLeave - usedSpecialLeave);
  const remainingNational = Math.max(0, totalNational - usedNational);
  const remainingTotal = (remainingSpecial + remainingNational + hoursOffsetDays);
  document.getElementById('my-remaining-total-days').innerText = `${remainingTotal.toFixed(1)} 天`;

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
    const sch = monthSchedules.find(s => s.date === dayStr);
    const holiday = getHolidayInfo(dayStr);
    const wonHoliday = yearLotteries.find(h => h.holiday_date === dayStr);

    const cell = document.createElement('div');
    cell.className = `min-h-[65px] p-1 rounded-lg border flex flex-col justify-between text-xs ${
      holiday ? 'bg-rose-50/70 border-rose-300' : (dayOfWeek === 0 ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-200')
    }`;

    let headerHtml = `<div class="flex justify-between items-center font-bold">`;
    headerHtml += `<span class="${holiday || dayOfWeek === 0 ? 'text-rose-600 font-black' : 'text-slate-700'}">${d}</span>`;
    if (holiday) headerHtml += `<span class="text-[9px] bg-rose-600 text-white px-1 rounded-full font-bold">🎌${holiday.name}</span>`;
    else if (dayOfWeek === 0) headerHtml += `<span class="text-[9px] bg-slate-200 text-slate-700 px-1 rounded">休診</span>`;
    headerHtml += `</div>`;

    let statusHtml = `<div class="mt-0.5">`;
    if (wonHoliday) {
      statusHtml += `<span class="text-[10px] bg-purple-600 text-white font-bold px-1 py-0.5 rounded block text-center">🎉 國定抽中輪休</span>`;
    } else if (sch && sch.shift_name && sch.shift_name !== '未排班') {
      const hStr = sch.hours ? ` (${sch.hours}h)` : '';
      if (sch.shift_name.includes('開門')) {
        statusHtml += `<span class="text-[10px] bg-amber-100 text-amber-900 font-bold px-1 py-0.5 rounded block text-center">☀️ ${sch.shift_name}${hStr}</span>`;
      } else if (sch.shift_name.includes('晚')) {
        statusHtml += `<span class="text-[10px] bg-indigo-100 text-indigo-900 font-bold px-1 py-0.5 rounded block text-center">🌙 ${sch.shift_name}${hStr}</span>`;
      } else if (sch.shift_name.includes('特休') || sch.shift_name.includes('休')) {
        statusHtml += `<span class="text-[10px] bg-rose-100 text-rose-800 font-bold px-1 py-0.5 rounded block text-center">🏖️ ${sch.shift_name}</span>`;
      } else {
        statusHtml += `<span class="text-[10px] bg-blue-100 text-blue-900 font-bold px-1 py-0.5 rounded block text-center">🌤️ ${sch.shift_name}${hStr}</span>`;
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

// ==================== 2. 「全員預約看板」共享月曆視圖 ====================
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
      deadlineTag.innerText = "🌿 工作同仁：特休/年休登記";
      deadlineTag.className = "bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 rounded font-bold";
    } else if (currentDay > 15 && !isAdminUser) {
      deadlineTag.innerText = "⚠️ 預約已於 15 號截止 (護理長排班中)";
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

  const [empRes, allReqRes, lotteryRes] = await Promise.all([
    supabaseClient.from('clinic_employees').select('*').eq('is_active', true),
    supabaseClient.from('clinic_schedule_requests').select('*, clinic_employees(*)').gte('request_date', startDateStr).lte('request_date', endDateStr),
    supabaseClient.from('clinic_holiday_lottery').select('*, clinic_employees(*)').gte('holiday_date', startDateStr).lte('holiday_date', endDateStr)
  ]);

  cachedEmployees = empRes.data || [];
  const allRequests = allReqRes.data || [];
  const monthLotteries = lotteryRes.data || [];

  const grid = document.getElementById('req-calendar-grid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let i = 0; i < startDayOfWeek; i++) {
    const empty = document.createElement('div');
    empty.className = "min-h-[75px] bg-slate-50/50 rounded-lg border border-dashed border-slate-200";
    grid.appendChild(empty);
  }

  for (let d = 1; d <= totalDays; d++) {
    const dayStr = `${monthStr}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = new Date(y, m - 1, d).getDay();
    const dayReqs = allRequests.filter(r => r.request_date === dayStr);
    const myReq = dayReqs.find(r => r.employee_id === currentUser.empId);
    const holiday = getHolidayInfo(dayStr);
    const holidayWinner = monthLotteries.find(l => l.holiday_date === dayStr);

    const cell = document.createElement('div');
    cell.className = `min-h-[75px] p-1 rounded-lg border flex flex-col justify-between text-xs cursor-pointer transition hover:shadow-md ${
      holiday ? 'bg-rose-50/60 border-rose-300' : (dayOfWeek === 0 ? 'bg-slate-50 border-slate-200 cursor-not-allowed' : (myReq ? 'bg-indigo-50/80 border-indigo-400 ring-1 ring-indigo-300' : 'bg-white border-slate-200 hover:border-indigo-400'))
    }`;
    
    if (dayOfWeek !== 0) {
      cell.onclick = () => openUserReqModal(dayStr, dayOfWeek, myReq, holiday);
    }

    let headerHtml = `<div class="flex justify-between items-center font-bold">`;
    headerHtml += `<span class="${holiday || dayOfWeek === 0 ? 'text-rose-600 font-black' : 'text-slate-700'}">${d}</span>`;
    if (holiday) headerHtml += `<span class="text-[9px] bg-rose-600 text-white px-1 rounded-full font-bold">🎌${holiday.name}</span>`;
    else if (dayOfWeek === 0) headerHtml += `<span class="text-[9px] bg-slate-200 text-slate-700 px-1 rounded">休診</span>`;
    headerHtml += `</div>`;

    let bodyHtml = `<div class="space-y-0.5 mt-0.5">`;

    if (holidayWinner) {
      bodyHtml += `<div class="text-[9px] bg-purple-100 text-purple-900 font-bold px-1 rounded truncate">🥇國定休:${holidayWinner.clinic_employees?.name || ''}</div>`;
    }

    const abroadList = dayReqs.filter(r => r.request_type === 'abroad');
    if (abroadList.length > 0) {
      const aNames = abroadList.map(r => getEmpCode(r.clinic_employees || { name: r.employee_id })).join(',');
      bodyHtml += `<div class="text-[9px] bg-purple-600 text-white font-bold px-1 rounded truncate">✈️出國:${aNames}</div>`;
    }

    const offList = dayReqs.filter(r => r.request_type === 'off');
    if (offList.length > 0) {
      const oNames = offList.map(r => getEmpCode(r.clinic_employees || { name: r.employee_id })).join(',');
      bodyHtml += `<div class="text-[9px] bg-rose-500 text-white font-bold px-1 rounded truncate">🏖️排休:${oNames}</div>`;
    }

    if (dayOfWeek !== 0 && !holidayWinner && abroadList.length === 0 && offList.length === 0) {
      bodyHtml += `<div class="text-[10px] text-slate-300 text-center py-1">＋登記</div>`;
    }

    bodyHtml += `</div>`;
    cell.innerHTML = headerHtml + bodyHtml;
    grid.appendChild(cell);
  }
}

function openUserReqModal(dateStr, dayOfWeek, existingReq, holiday) {
  const today = new Date();
  const isAdminUser = (currentUser.displayName === '陳慧倪' || currentUser.displayName === '林和正' || currentUser.role === 'doctor');
  const isFixed = isFixedStaff(currentUser.displayName);

  if (today.getDate() > 15 && !isAdminUser && !isFixed) {
    alert('⚠️ 預約已於 15 號截止，目前為護理長排班期。若有異動需求請直接聯繫護理長陳慧倪。');
    return;
  }

  userReqDate = dateStr;
  document.getElementById('user-req-date-title').innerText = `📅 ${dateStr} ${holiday ? `(🎌${holiday.name})` : ''} 登記`;

  const abroadOpt = document.getElementById('user-req-abroad-opt');
  if (isFixed) abroadOpt.classList.add('hidden');
  else abroadOpt.classList.remove('hidden');

  const deleteBtn = document.getElementById('btn-delete-req');
  const reasonInput = document.getElementById('user-req-reason');

  if (existingReq) {
    deleteBtn.classList.remove('hidden');
    reasonInput.value = existingReq.reason || '';
    const radios = document.querySelectorAll('input[name="user-req-type"]');
    radios.forEach(r => {
      if (existingReq.request_type === r.value) r.checked = true;
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

async function submitUserDayRequest() {
  if (!userReqDate) return;

  const selectedType = document.querySelector('input[name="user-req-type"]:checked')?.value || 'off';
  const reason = document.getElementById('user-req-reason').value;
  const targetMonth = document.getElementById('req-target-month').value;

  const isFixed = isFixedStaff(currentUser.displayName);
  const noteReason = isFixed ? `特休/年休 (${reason || '自排'})` : (selectedType === 'abroad' ? `✈️出國 (${reason || '國外行程'})` : reason);

  const { error } = await supabaseClient.from('clinic_schedule_requests').upsert([{
    target_month: targetMonth,
    employee_id: currentUser.empId,
    request_date: userReqDate,
    request_type: selectedType,
    shift_id: 'off',
    reason: noteReason,
    status: 'pending'
  }], { onConflict: 'employee_id,request_date' });

  if (error) alert('登記失敗：' + error.message);
  else alert('✅ 登記成功！已同步至全員看板與護理長排班系統。');

  closeUserReqModal();
  loadRequestCalendar();
}

async function deleteCurrentDayRequest() {
  if (!userReqDate) return;
  await supabaseClient.from('clinic_schedule_requests').delete().eq('employee_id', currentUser.empId).eq('request_date', userReqDate);
  closeUserReqModal();
  loadRequestCalendar();
}

// ==================== 3. 護理長排班中心 ====================
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
      span.innerText = `[${info.roleName}] ${e.name}`;
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
    supabaseClient.from('clinic_schedule_requests').select('*, clinic_employees(*)').gte('request_date', startDateStr).lte('request_date', endDateStr),
    supabaseClient.from('clinic_holiday_lottery').select('*, clinic_employees(*)').gte('holiday_date', startDateStr).lte('holiday_date', endDateStr)
  ]);

  cachedMonthSchedules = schRes.data || [];
  cachedMonthRequests = reqRes.data || [];
  cachedMonthLotteries = lotteryRes.data || [];

  renderNurseHoursSummary();

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
    const dayRequests = cachedMonthRequests.filter(r => r.request_date === dayStr);
    const holiday = getHolidayInfo(dayStr);
    const holidayWinner = cachedMonthLotteries.find(l => l.holiday_date === dayStr);

    const cell = document.createElement('div');
    cell.className = `min-h-[75px] p-1.5 rounded-lg border flex flex-col justify-between transition hover:shadow-md cursor-pointer ${
      holiday ? 'bg-rose-50/80 border-rose-300' : (dayOfWeek === 0 ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-200 hover:border-indigo-400')
    }`;
    cell.onclick = () => openShiftEditModal(dayStr, dayOfWeek, holiday, holidayWinner, dayRequests);

    let headerHtml = `<div class="flex justify-between items-center font-bold">`;
    headerHtml += `<span class="text-xs ${holiday || dayOfWeek === 0 ? 'text-rose-600 font-black' : 'text-slate-700'}">${d}</span>`;
    if (holiday) headerHtml += `<span class="text-[9px] bg-rose-600 text-white px-1.5 py-0.2 rounded-full font-bold">🎌${holiday.name}</span>`;
    else if (dayOfWeek === 0) headerHtml += `<span class="text-[9px] bg-slate-200 text-slate-700 px-1 rounded">休診</span>`;
    headerHtml += `</div>`;

    let bodyHtml = `<div class="space-y-0.5 mt-0.5">`;

    if (holidayWinner) {
      bodyHtml += `<div class="text-[9px] bg-purple-100 text-purple-900 font-bold px-1 rounded truncate">🥇國定休:${holidayWinner.clinic_employees?.name || ''}</div>`;
    }

    const abroadReqs = dayRequests.filter(r => r.request_type === 'abroad');
    if (abroadReqs.length > 0) {
      const aNames = abroadReqs.map(r => r.clinic_employees?.name).filter(Boolean).join(',');
      bodyHtml += `<div class="text-[9px] bg-purple-50 text-purple-800 font-bold px-1 rounded truncate">🥈出國:${aNames}</div>`;
    }

    const generalOffs = dayRequests.filter(r => r.request_type === 'off');
    if (generalOffs.length > 0) {
      const offNames = generalOffs.map(r => r.clinic_employees?.name).filter(Boolean).join(',');
      bodyHtml += `<div class="text-[9px] bg-rose-100 text-rose-800 font-bold px-1 rounded truncate">🏖️排休:${offNames}</div>`;
    }

    const workSchedules = daySchedules.filter(s => s.shift_name && s.shift_name !== '未排班' && s.shift_name !== '休假');
    if (workSchedules.length > 0) {
      const summaryList = workSchedules.map(s => {
        const code = getEmpCode(s.clinic_employees || { name: s.employee_id });
        const shortShift = s.shift_name.replace('班', '');
        return `${code}(${shortShift}${s.hours}h)`;
      }).join(' ');
      bodyHtml += `<div class="text-[9px] bg-indigo-50 text-indigo-900 font-bold px-1 py-0.2 rounded leading-tight">${summaryList}</div>`;
    }

    if (dayOfWeek !== 0 && workSchedules.length === 0 && !holidayWinner && abroadReqs.length === 0 && generalOffs.length === 0) {
      bodyHtml += `<div class="text-[10px] text-slate-300 text-center py-1">＋排班</div>`;
    }

    bodyHtml += `</div>`;
    cell.innerHTML = headerHtml + bodyHtml;
    grid.appendChild(cell);
  }
}

function renderNurseHoursSummary() {
  const summaryBox = document.getElementById('nurse-hours-summary');
  if (!summaryBox) return;
  summaryBox.innerHTML = '';

  const dialysisNurses = cachedEmployees.filter(e => isDialysisNurse(e.name, e.role));
  
  dialysisNurses.forEach(emp => {
    let empHours = 0;
    cachedMonthSchedules.filter(s => s.employee_id === emp.id).forEach(s => {
      if (s.hours && s.shift_name !== '未排班' && s.shift_name !== '休假') {
        empHours += Number(s.hours) || 0;
      }
    });

    const code = getEmpCode(emp);
    const div = document.createElement('div');
    div.className = "flex justify-between items-center p-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[11px]";
    div.innerHTML = `
      <span class="font-bold text-slate-700">[${code}] ${emp.name}</span>
      <span class="font-black text-indigo-700 bg-indigo-100 px-1.5 py-0.2 rounded">${empHours}h</span>
    `;
    summaryBox.appendChild(div);
  });
}

function openShiftEditModal(dateStr, dayOfWeek, holiday, holidayWinner, dayRequests) {
  if (dayOfWeek === 0) {
    if (!confirm(`${dateStr} 為週日固定休診日，確定要為此日指派特別出勤嗎？`)) return;
  }

  editingDate = dateStr;
  document.getElementById('modal-date-title').innerText = `📅 ${dateStr} ${holiday ? `(🎌${holiday.name})` : ''} 排班`;

  let priorityHints = [];
  if (holidayWinner) priorityHints.push(`🥇 國定抽中輪休：${holidayWinner.clinic_employees?.name}`);
  const abroads = (dayRequests || []).filter(r => r.request_type === 'abroad').map(r => r.clinic_employees?.name);
  if (abroads.length > 0) priorityHints.push(`🥈 出國休假：${abroads.join('、')}`);
  const regularOffs = (dayRequests || []).filter(r => r.request_type === 'off').map(r => r.clinic_employees?.name);
  if (regularOffs.length > 0) priorityHints.push(`🏖️ 一般排休/特休：${regularOffs.join('、')}`);

  document.getElementById('modal-priority-hint').innerText = priorityHints.join(' | ') || '無登記休假同仁';

  const daySchedules = cachedMonthSchedules.filter(s => s.date === dateStr);
  const dialysisNurses = cachedEmployees.filter(e => isDialysisNurse(e.name, e.role));

  const rowsContainer = document.getElementById('modal-nurse-rows');
  rowsContainer.innerHTML = '';

  dialysisNurses.forEach(emp => {
    const existing = daySchedules.find(s => s.employee_id === emp.id);
    const code = getEmpCode(emp);

    const row = document.createElement('div');
    row.className = "flex items-center justify-between gap-1 p-1.5 rounded-lg border border-slate-200 bg-slate-50";

    let shiftOptionsHtml = '';
    SHIFT_TYPES.forEach(st => {
      const selected = (existing && existing.shift_name === st) ? 'selected' : (!existing && st === '未排班' ? 'selected' : '');
      shiftOptionsHtml += `<option value="${st}" ${selected}>${st}</option>`;
    });

    let hoursOptionsHtml = '';
    WORK_HOURS.forEach(h => {
      const selected = (existing && Number(existing.hours) === h) ? 'selected' : (!existing && h === 8.5 ? 'selected' : '');
      hoursOptionsHtml += `<option value="${h}" ${selected}>${h}h</option>`;
    });

    row.innerHTML = `
      <span class="font-bold text-slate-800 w-24 truncate">[${code}] ${emp.name}</span>
      <div class="flex items-center gap-1">
        <select data-emp-id="${emp.id}" class="nurse-shift-type-select border rounded p-1 bg-white font-bold text-xs">
          ${shiftOptionsHtml}
        </select>
        <select data-emp-id="${emp.id}" class="nurse-hours-select border rounded p-1 bg-white font-bold text-xs text-indigo-700">
          ${hoursOptionsHtml}
        </select>
      </div>
    `;
    rowsContainer.appendChild(row);
  });

  document.getElementById('shift-edit-modal').classList.remove('hidden');
}

function closeShiftEditModal() {
  document.getElementById('shift-edit-modal').classList.add('hidden');
  editingDate = null;
}

async function saveModalDaySchedule() {
  if (!editingDate) return;

  const shiftSelects = document.querySelectorAll('.nurse-shift-type-select');
  const hoursSelects = document.querySelectorAll('.nurse-hours-select');

  const dialysisNurseIds = cachedEmployees.filter(e => isDialysisNurse(e.name, e.role)).map(e => e.id);
  await supabaseClient.from('clinic_schedules').delete().eq('date', editingDate).in('employee_id', dialysisNurseIds);

  const newRecords = [];
  shiftSelects.forEach((sel, idx) => {
    const empId = sel.getAttribute('data-emp-id');
    const shiftName = sel.value;
    const hours = parseFloat(hoursSelects[idx].value) || 8.5;

    if (shiftName && shiftName !== '未排班') {
      newRecords.push({
        date: editingDate,
        employee_id: empId,
        shift_id: shiftName.includes('晚') ? 'afternoon' : 'morning',
        shift_name: shiftName,
        hours: hours
      });
    }
  });

  if (newRecords.length > 0) {
    const { error } = await supabaseClient.from('clinic_schedules').insert(newRecords);
    if (error) alert('儲存失敗：' + error.message);
  }

  closeShiftEditModal();
  loadScheduleCalendar();
}

async function runNationalHolidayLottery() {
  if (!confirm('確定由「透析輪班護理師」進行全年度 12 日政府國定假日抽籤輪休？（每人均休過一次後才重啟下一輪）')) return;

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
  else alert('🎉 2026 年度政府國定假日抽籤排定完成！');
  loadScheduleCalendar();
}

// ==================== 4. A4 橫向列印預覽與跨瀏覽器列印引擎 ====================
function buildA4HtmlString(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const totalDays = new Date(y, m, 0).getDate();
  const dialysisNurses = cachedEmployees.filter(e => isDialysisNurse(e.name, e.role));

  let tableHeaderCols = '<th style="border: 1px solid #000; padding: 4px; background: #e2e8f0; font-size: 11px; width: 85px;">姓名/代碼</th>';
  for (let d = 1; d <= totalDays; d++) {
    const dayStr = `${monthStr}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = new Date(y, m - 1, d).getDay();
    const holiday = getHolidayInfo(dayStr);
    const dayName = ['日', '一', '二', '三', '四', '五', '六'][dayOfWeek];
    const thBg = holiday || dayOfWeek === 0 ? '#ffe4e6' : '#f8fafc';
    const thColor = holiday || dayOfWeek === 0 ? '#b91c1c' : '#334155';
    tableHeaderCols += `<th style="border: 1px solid #000; padding: 2px; font-size: 9px; background: ${thBg}; color: ${thColor}; text-align: center; min-width: 22px;">${d}<br><span style="font-size: 8px;">${dayName}</span></th>`;
  }
  tableHeaderCols += '<th style="border: 1px solid #000; padding: 4px; background: #e2e8f0; font-size: 11px; width: 60px;">總時數</th>';

  let tableRows = '';
  dialysisNurses.forEach(emp => {
    const code = getEmpCode(emp);
    let totalH = 0;
    let rowCells = `<td style="border: 1px solid #000; padding: 3px; font-weight: bold; font-size: 10px; text-align: center; background: #f1f5f9; white-space: nowrap;">[${code}] ${emp.name}</td>`;

    for (let d = 1; d <= totalDays; d++) {
      const dayStr = `${monthStr}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(y, m - 1, d).getDay();
      const sch = cachedMonthSchedules.find(s => s.employee_id === emp.id && s.date === dayStr);
      const req = cachedMonthRequests.find(r => r.employee_id === emp.id && r.request_date === dayStr && r.request_type === 'off');
      const holidayWon = cachedMonthLotteries.find(l => l.winner_emp_id === emp.id && l.holiday_date === dayStr);

      let cellText = '';
      let cellBg = '#ffffff';

      if (holidayWon) {
        cellText = '國休';
        cellBg = '#f3e8ff';
      } else if (req) {
        cellText = '排休';
        cellBg = '#ffe4e6';
      } else if (sch && sch.shift_name && sch.shift_name !== '未排班') {
        const h = Number(sch.hours) || 0;
        totalH += h;
        const shortShift = sch.shift_name === '開門白班' ? '開白' : (sch.shift_name === '正常白班' ? '白' : '晚');
        cellText = `${shortShift}<br>${h}`;
        cellBg = sch.shift_name.includes('開門') ? '#fef3c7' : (sch.shift_name.includes('晚') ? '#e0e7ff' : '#ffffff');
      } else if (dayOfWeek === 0) {
        cellText = '休';
        cellBg = '#f8fafc';
      }

      rowCells += `<td style="border: 1px solid #000; padding: 2px; text-align: center; font-size: 9px; background: ${cellBg}; line-height: 1.1;">${cellText}</td>`;
    }

    rowCells += `<td style="border: 1px solid #000; padding: 3px; font-weight: 900; text-align: center; font-size: 11px; background: #f8fafc;">${totalH}h</td>`;
    tableRows += `<tr>${rowCells}</tr>`;
  });

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif; color: black; width: 100%;">
      <div style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid black; padding-bottom: 4px; margin-bottom: 6px;">
        <div>
          <h2 style="font-size: 16px; font-weight: 900; margin: 0; letter-spacing: 1px;">🏥 愛欣診所透析中心 - 護理人員出勤班表</h2>
          <span style="font-size: 11px; font-weight: bold; color: #334155;">排班月份：${monthStr} ｜ 護理長：陳慧倪</span>
        </div>
        <div style="font-size: 10px; color: #64748b;">
          產表日期：${new Date().toLocaleDateString('zh-TW')}
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; border: 1px solid black; text-align: center;">
        <thead><tr>${tableHeaderCols}</tr></thead>
        <tbody>${tableRows}</tbody>
      </table>

      <div style="display: flex; justify-content: space-between; font-size: 11px; margin-top: 14px; font-weight: bold;">
        <span>製表 / 護理長：陳慧倪 _______________</span>
        <span>院長 / 醫師：林和正 _______________</span>
        <span>管理部核定：_______________</span>
      </div>
    </div>
  `;
}

function openA4PrintPreview() {
  const monthStr = document.getElementById('admin-sch-month')?.value;
  if (!monthStr) return alert('請先選擇要列印的月份！');

  const container = document.getElementById('a4-printable-content');
  if (container) {
    container.innerHTML = buildA4HtmlString(monthStr);
  }
  document.getElementById('a4-print-modal')?.classList.remove('hidden');
}

function closeA4PrintModal() {
  document.getElementById('a4-print-modal')?.classList.add('hidden');
}

function triggerNativePrint() {
  window.print();
}

function openInExternalBrowser() {
  const monthStr = document.getElementById('admin-sch-month')?.value;
  const htmlContent = buildA4HtmlString(monthStr);
  
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>愛欣診所出勤班表_${monthStr}</title>
        <style>
          @page { size: A4 landscape; margin: 6mm; }
          body { margin: 0; padding: 10px; background: white; font-family: -apple-system, sans-serif; }
        </style>
      </head>
      <body>
        ${htmlContent}
        <script>
          window.onload = function() { window.print(); };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  } else {
    // 若在 LINE 內無法直接 window.open，調用 LIFF 外部瀏覽器開啟
    if (typeof liff !== 'undefined' && liff.openWindow) {
      liff.openWindow({
        url: window.location.href,
        external: true
      });
    } else {
      alert('請複製網址於 Safari 或 Chrome 瀏覽器中開啟以進行列印！');
    }
  }
}
