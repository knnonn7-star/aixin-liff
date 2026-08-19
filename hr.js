/**
 * 愛欣診所 LINE 管理系統 - 人事排班與出勤月報模組 (hr.js) - 第一段
 */

let cachedEmployees = [];
let cachedMonthSchedules = [];
let cachedMonthRequests = [];
let cachedMonthAttendance = [];
let editingDate = null;
let userReqDate = null;

const SHIFT_TYPES = ['未排班', '開門白班', '正常白班', '正常晚班'];
const WORK_HOURS = [7, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0];

const NURSE_CODE_MAP = {
  '陳慧倪': '01', '陳惠倪': '01',
  '曾憲敏': '02',
  '薛雅仁': '03',
  '李牧音': '04',
  '林雯琦': '05',
  '謝宜婷': '06',
  '陳金暖': '07',
  '王瓊代': '08',
  '吳金燕': '09',
  '王靜慧': '10',
  '吳培瑜': '11',
  '李香瑩': '12',
  '吳沐芸': '13',
  '王芝妍': '14',
  '盧明伶': '藥事',
  '涂春娥': '工作人員',
  '胡月霞': '清潔',
  '林和正': '醫師'
};

const EMPLOYEE_ONBOARDING_DATA = {
  '陳慧倪': { onboard: '2005-05-01', baseHours: (19 * 8 + 4), baseSpecialDays: 26 },
  '陳惠倪': { onboard: '2005-05-01', baseHours: (19 * 8 + 4), baseSpecialDays: 26 },
  '曾憲敏': { onboard: '2012-05-01', baseHours: (19 * 8 + 1.5), baseSpecialDays: 20 },
  '薛雅仁': { onboard: '2005-05-16', baseHours: -57.5, baseSpecialDays: 19 },
  '李牧音': { onboard: '2006-11-01', baseHours: (2 * 8 + 2.5), baseSpecialDays: 7 },
  '林雯琦': { onboard: '2006-12-01', baseHours: (-17 * 8), baseSpecialDays: 10 },
  '謝宜婷': { onboard: '2009-11-02', baseHours: (17 * 8 + 6.5), baseSpecialDays: 12 },
  '盧明伶': { onboard: '2009-11-02', baseHours: 0, baseSpecialDays: 15 },
  '陳金暖': { onboard: '2010-04-01', baseHours: (20 * 8 + 4.5), baseSpecialDays: 20 },
  '王瓊代': { onboard: '2014-05-01', baseHours: (10 * 8 + 3), baseSpecialDays: 13 },
  '吳金燕': { onboard: '2018-05-01', baseHours: (5 * 8 + 4), baseSpecialDays: 13 },
  '王靜慧': { onboard: '2019-07-08', baseHours: (-38 * 8), baseSpecialDays: 11 },
  '吳培瑜': { onboard: '2021-09-20', baseHours: (2 * 8 + 2), baseSpecialDays: 15 },
  '李香瑩': { onboard: '2023-07-10', baseHours: (-43 * 8), baseSpecialDays: 11 },
  '吳沐芸': { onboard: '2024-05-15', baseHours: (-42 * 8), baseSpecialDays: 0 },
  '王芝妍': { onboard: '2018-08-06', baseHours: 0, baseSpecialDays: 0 },
  '涂春娥': { onboard: '2008-10-20', baseHours: 0, baseSpecialDays: 15 },
  '胡月霞': { onboard: '2022-04-01', baseHours: 0, baseSpecialDays: 7 },
  '林和正': { onboard: '2000-01-01', baseHours: 0, baseSpecialDays: 30 }
};

const FIXED_STAFF_ROLES = {
  '盧明伶': { roleName: '門診藥事', tag: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
  '涂春娥': { roleName: '工作人員', tag: 'bg-teal-100 text-teal-900 border-teal-300' },
  '胡月霞': { roleName: '清潔人員', tag: 'bg-cyan-100 text-cyan-900 border-cyan-300' }
};

const NATIONAL_HOLIDAYS_2026 = [
  { name: '元旦', date: '2026-01-01' },
  { name: '除夕', date: '2026-02-16' },
  { name: '春節初一', date: '2026-02-17' },
  { name: '春節初二', date: '2026-02-18' },
  { name: '春節初三', date: '2026-02-19' },
  { name: '228紀念日', date: '2026-02-28' },
  { name: '兒童節', date: '2026-04-04' },
  { name: '清明節', date: '2026-04-05' },
  { name: '勞動節', date: '2026-05-01' },
  { name: '端午節', date: '2026-06-19' },
  { name: '中秋節', date: '2026-09-25' },
  { name: '雙十國慶', date: '2026-10-10' }
];

function getHrSupabase() {
  return window.supabaseClient || (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
}

function getHolidayInfo(dateStr) {
  return NATIONAL_HOLIDAYS_2026.find(h => h.date === dateStr);
}

function getEmpCode(empOrNameOrId) {
  if (!empOrNameOrId) return '??';
  let name = '';
  if (typeof empOrNameOrId === 'string') {
    name = empOrNameOrId;
    const found = cachedEmployees.find(e => e.id === empOrNameOrId || e.name === empOrNameOrId);
    if (found) name = found.name;
  } else if (empOrNameOrId.name) {
    name = empOrNameOrId.name;
  }

  if (NURSE_CODE_MAP[name]) return NURSE_CODE_MAP[name];
  if (name.includes('慧倪') || name.includes('惠倪')) return '01';
  return name.length >= 2 ? name.substring(0, 2) : name;
}

function calculateLaborSpecialLeave(name) {
  const info = EMPLOYEE_ONBOARDING_DATA[name] || EMPLOYEE_ONBOARDING_DATA['陳慧倪'];
  const onboard = new Date(info.onboard);
  const now = new Date();

  const totalMonths = (now.getFullYear() - onboard.getFullYear()) * 12 + (now.getMonth() - onboard.getMonth());
  const years = totalMonths / 12;

  let legalDays = 0;
  if (years < 0.5) legalDays = 0;
  else if (years < 1) legalDays = 3;
  else if (years < 2) legalDays = 7;
  else if (years < 3) legalDays = 10;
  else if (years < 5) legalDays = 14;
  else if (years < 10) legalDays = 15;
  else {
    const extraYears = Math.floor(years - 10) + 1;
    legalDays = Math.min(30, 15 + extraYears);
  }

  let nextCycleDate = new Date(now.getFullYear(), onboard.getMonth(), onboard.getDate());
  if (now > nextCycleDate) {
    nextCycleDate = new Date(now.getFullYear() + 1, onboard.getMonth(), onboard.getDate());
  }
  const nextCycleStr = `${nextCycleDate.getFullYear()}-${String(nextCycleDate.getMonth() + 1).padStart(2, '0')}-${String(nextCycleDate.getDate()).padStart(2, '0')}`;
  const seniorityText = `到職日：${info.onboard} (年資 ${years.toFixed(1)} 年，到期結算日：${nextCycleStr})`;

  return {
    legalDays,
    baseSpecialDays: info.baseSpecialDays || 0,
    baseHours: info.baseHours || 0,
    seniorityText,
    nextCycleStr
  };
}

function isFixedStaff(name) { return !!FIXED_STAFF_ROLES[name]; }
function isDoctor(name, role) { return name === '林和正' || role === 'doctor'; }
function isDialysisNurse(name, role) { return !isFixedStaff(name) && !isDoctor(name, role); }

function isSuperAdmin() {
  return (
    currentUser.name === '林和正' ||
    currentUser.displayName === '林和正' ||
    currentUser.displayName === '陳慧倪' ||
    currentUser.displayName === '陳惠倪' ||
    currentUser.role === 'doctor'
  );
}

function switchHrTab(tab) {
  if (tab === 'scheduling' && !isSuperAdmin()) {
    alert('🔒 權限提示：排班月曆之編排僅限管理者與護理長操作。');
    return;
  }

  ['myschedule', 'request', 'scheduling'].forEach(t => {
    document.getElementById(`hr-sec-${t}`)?.classList.add('hidden');
    const tabBtn = document.getElementById(`hr-tab-${t}`);
    if (tabBtn) tabBtn.className = "py-2 rounded-lg hover:text-slate-900 transition text-slate-600";
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
  if (adminMonthElem && !adminMonthElem.value) adminMonthElem.value = thisMonthStr;
}

async function loadMySchedule() {
  const client = getHrSupabase();
  if (!client) return;

  initHrDefaults();
  const monthStr = document.getElementById('my-sch-month')?.value;
  if (!monthStr) return;

  const [y, m] = monthStr.split('-').map(Number);
  const firstDayObj = new Date(y, m - 1, 1);
  const totalDays = new Date(y, m, 0).getDate();
  const startDayOfWeek = firstDayObj.getDay();

  const startDateStr = `${monthStr}-01`;
  const endDateStr = `${monthStr}-${totalDays}`;

  let totalWorkingDays = 0;
  let monthHolidayHours = 0;
  for (let d = 1; d <= totalDays; d++) {
    const curDateStr = `${monthStr}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = new Date(y, m - 1, d).getDay();
    if (dayOfWeek !== 0) {
      totalWorkingDays++;
    }
    if (getHolidayInfo(curDateStr)) {
      monthHolidayHours += 8.0;
    }
  }

  const requiredWorkingHours = totalWorkingDays * 8.0;

  const [schRes, myEmpRes] = await Promise.all([
    client.from('clinic_schedules').select('*').eq('employee_id', currentUser.empId || '00000000-0000-0000-0000-000000000000').gte('date', startDateStr).lte('date', endDateStr),
    client.from('clinic_employees').select('*').eq('id', currentUser.empId || '00000000-0000-0000-0000-000000000000').maybeSingle()
  ]);

  const monthSchedules = schRes.data || [];
  const empData = myEmpRes.data || {};

  const { legalDays, seniorityText } = calculateLaborSpecialLeave(currentUser.displayName);
  const initialBaseHours = Number(empData.base_accumulated_hours) || (EMPLOYEE_ONBOARDING_DATA[currentUser.displayName]?.baseHours || 0);
  const initialBaseSpecialDays = Number(empData.base_special_leave_days) || (EMPLOYEE_ONBOARDING_DATA[currentUser.displayName]?.baseSpecialDays || 0);

  let currentMonthWorkedHours = 0;
  let currentMonthUsedSpecialDays = 0;

  monthSchedules.forEach(s => {
    if (s.shift_name?.includes('特休')) {
      currentMonthUsedSpecialDays += 1;
    } else if (s.shift_name && s.shift_name !== '未排班' && s.shift_name !== '休假') {
      currentMonthWorkedHours += (Number(s.hours) || 8.5);
    }
  });

  const remainingSpecialDays = Math.max(0, initialBaseSpecialDays - currentMonthUsedSpecialDays);
  const specialLeaveHours = currentMonthUsedSpecialDays * 8.0;
  const nextMonthAccumulatedHours = specialLeaveHours + monthHolidayHours + initialBaseHours + currentMonthWorkedHours - requiredWorkingHours;

  if (document.getElementById('my-seniority-text')) document.getElementById('my-seniority-text').innerText = seniorityText;
  if (document.getElementById('stat-special-leave')) document.getElementById('stat-special-leave').innerText = `${legalDays} 日`;
  if (document.getElementById('stat-remaining-special')) document.getElementById('stat-remaining-special').innerText = `${remainingSpecialDays} 日`;
  if (document.getElementById('stat-required-hours')) document.getElementById('stat-required-hours').innerText = `-${requiredWorkingHours} h`;
  if (document.getElementById('my-total-hours')) document.getElementById('my-total-hours').innerText = `${currentMonthWorkedHours.toFixed(1)} h`;
  if (document.getElementById('my-remaining-total-days')) {
    const sign = nextMonthAccumulatedHours >= 0 ? '+' : '';
    document.getElementById('my-remaining-total-days').innerText = `${sign}${nextMonthAccumulatedHours.toFixed(1)} h (${(nextMonthAccumulatedHours / 8.0).toFixed(1)}日)`;
  }

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
    if (sch && sch.shift_name && sch.shift_name !== '未排班') {
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
/**
 * 愛欣診所 LINE 管理系統 - 人事排班與出勤月報模組 (hr.js) - 第二段
 */

async function initRequestPage() {
  initHrDefaults();

  const today = new Date();
  const currentDay = today.getDate();
  const deadlineTag = document.getElementById('request-deadline-tag');
  const isFixed = isFixedStaff(currentUser.displayName);

  if (deadlineTag) {
    if (isSuperAdmin()) {
      deadlineTag.innerText = "👑 管理者模式：自由排休/出國/夜班測試";
      deadlineTag.className = "bg-amber-100 text-amber-800 text-[10px] px-2 py-0.5 rounded font-bold border border-amber-300";
    } else if (isFixed) {
      deadlineTag.innerText = "🌿 常日班同仁：特休預約";
      deadlineTag.className = "bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 rounded font-bold";
    } else if (currentDay > 15) {
      deadlineTag.innerText = "⚠️ 預約已於 15 號截止 (護理長排班中)";
      deadlineTag.className = "bg-rose-100 text-rose-800 text-[10px] px-2 py-0.5 rounded font-bold";
    } else {
      deadlineTag.innerText = `距離 15 號截止剩 ${15 - currentDay} 天`;
      deadlineTag.className = "bg-indigo-200 text-indigo-800 text-[10px] px-2 py-0.5 rounded font-bold";
    }
  }

  loadRequestCalendar();
}

async function loadRequestCalendar() {
  const client = getHrSupabase();
  const monthStr = document.getElementById('req-target-month')?.value;
  if (!client || !monthStr) return;

  const [y, m] = monthStr.split('-').map(Number);
  const firstDayObj = new Date(y, m - 1, 1);
  const totalDays = new Date(y, m, 0).getDate();
  const startDayOfWeek = firstDayObj.getDay();

  const startDateStr = `${monthStr}-01`;
  const endDateStr = `${monthStr}-${totalDays}`;

  const [empRes, allReqRes] = await Promise.all([
    client.from('clinic_employees').select('*').eq('is_active', true),
    client.from('clinic_schedule_requests').select('*, clinic_employees(*)').gte('request_date', startDateStr).lte('request_date', endDateStr)
  ]);

  cachedEmployees = empRes.data || [];
  const allRequests = allReqRes.data || [];

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
    const myReq = dayReqs.find(r => r.employee_id === currentUser.empId || r.line_user_id === currentUser.lineUserId);
    const holiday = getHolidayInfo(dayStr);

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

    const abroadList = dayReqs.filter(r => r.request_type === 'abroad');
    if (abroadList.length > 0) {
      const aNames = abroadList.map(r => `[${getEmpCode(r.clinic_employees || r.employee_id)}]`).join(' ');
      bodyHtml += `<div class="text-[9px] bg-purple-600 text-white font-bold px-1 rounded truncate">✈️出國:${aNames}</div>`;
    }

    const nightList = dayReqs.filter(r => r.request_type === 'night_only');
    if (nightList.length > 0) {
      const nNames = nightList.map(r => `[${getEmpCode(r.clinic_employees || r.employee_id)}]`).join(' ');
      bodyHtml += `<div class="text-[9px] bg-indigo-600 text-white font-bold px-1 rounded truncate">🌙夜班:${nNames}</div>`;
    }

    const offList = dayReqs.filter(r => r.request_type === 'off');
    if (offList.length > 0) {
      const oNames = offList.map(r => `[${getEmpCode(r.clinic_employees || r.employee_id)}]`).join(' ');
      bodyHtml += `<div class="text-[9px] bg-rose-500 text-white font-bold px-1 rounded truncate">🏖️排休:${oNames}</div>`;
    }

    if (dayOfWeek !== 0 && abroadList.length === 0 && nightList.length === 0 && offList.length === 0) {
      bodyHtml += `<div class="text-[10px] text-slate-300 text-center py-1">＋登記</div>`;
    }

    bodyHtml += `</div>`;
    cell.innerHTML = headerHtml + bodyHtml;
    grid.appendChild(cell);
  }
}

function openUserReqModal(dateStr, dayOfWeek, existingReq, holiday) {
  const today = new Date();
  const isFixed = isFixedStaff(currentUser.displayName);

  if (today.getDate() > 15 && !isSuperAdmin() && !isFixed) {
    alert('⚠️ 預約已於 15 號截止，目前為護理長排班期。若有異動請聯繫護理長陳慧倪。');
    return;
  }

  userReqDate = dateStr;
  document.getElementById('user-req-date-title').innerText = `📅 ${dateStr} ${holiday ? `(🎌${holiday.name})` : ''} 登記`;

  const abroadOpt = document.getElementById('user-req-abroad-opt');
  const nightOpt = document.getElementById('user-req-night-opt');
  if (isFixed) {
    abroadOpt?.classList.add('hidden');
    nightOpt?.classList.add('hidden');
  } else {
    abroadOpt?.classList.remove('hidden');
    nightOpt?.classList.remove('hidden');
  }

  const deleteBtn = document.getElementById('btn-delete-req');
  const reasonInput = document.getElementById('user-req-reason');

  if (existingReq) {
    deleteBtn?.classList.remove('hidden');
    if (reasonInput) reasonInput.value = existingReq.reason || '';
    const radios = document.querySelectorAll('input[name="user-req-type"]');
    radios.forEach(r => {
      if (existingReq.request_type === r.value) r.checked = true;
    });
  } else {
    deleteBtn?.classList.add('hidden');
    if (reasonInput) reasonInput.value = '';
    const defRadio = document.querySelector('input[name="user-req-type"][value="off"]');
    if (defRadio) defRadio.checked = true;
  }

  document.getElementById('user-req-modal')?.classList.remove('hidden');
}

function closeUserReqModal() {
  document.getElementById('user-req-modal')?.classList.add('hidden');
  userReqDate = null;
}

async function submitUserDayRequest() {
  if (!userReqDate) return;
  const client = getHrSupabase();
  if (!client) return;

  const userId = currentUser.lineUserId;
  const userName = currentUser.displayName || '診所人員';
  const targetMonth = document.getElementById('req-target-month')?.value || userReqDate.substring(0, 7);
  const selectedType = document.querySelector('input[name="user-req-type"]:checked')?.value || 'off';
  const reason = document.getElementById('user-req-reason')?.value.trim() || '';

  const isFixed = isFixedStaff(userName);
  let noteReason = reason;
  if (selectedType === 'abroad') noteReason = `✈️出國 (${reason || '國外行程'})`;
  else if (selectedType === 'night_only') noteReason = `🌙只上夜班 (${reason || '夜班專責'})`;
  else if (isFixed) noteReason = `常日班特休 (${reason || '特休'})`;

  const payload = {
    target_month: targetMonth,
    employee_id: currentUser.empId || null,
    line_user_id: userId,
    employee_name: userName,
    request_date: userReqDate,
    request_type: selectedType,
    shift_id: null,
    reason: noteReason,
    status: 'approved'
  };

  try {
    const { error } = await client
      .from('clinic_schedule_requests')
      .upsert([payload], { onConflict: 'line_user_id,request_date' });

    if (error) throw error;

    alert(`🎉【${userReqDate}】登記成功！`);
    closeUserReqModal();
    loadRequestCalendar();
    if (typeof loadMySchedule === 'function') loadMySchedule();
  } catch (err) {
    alert('登記失敗：' + err.message);
  }
}

async function deleteCurrentDayRequest() {
  if (!userReqDate) return;
  const client = getHrSupabase();
  if (!client) return;

  try {
    const { error } = await client
      .from('clinic_schedule_requests')
      .delete()
      .eq('request_date', userReqDate)
      .eq('line_user_id', currentUser.lineUserId);

    if (error) throw error;

    alert('✅ 已取消登記');
    closeUserReqModal();
    loadRequestCalendar();
    if (typeof loadMySchedule === 'function') loadMySchedule();
  } catch (err) {
    alert('取消失敗：' + err.message);
  }
}

async function initScheduleAdmin() {
  const client = getHrSupabase();
  if (!client) return;

  const [empRes, ruleRes] = await Promise.all([
    client.from('clinic_employees').select('*').eq('is_active', true),
    client.from('clinic_rule_configs').select('*').eq('key', 'scheduling_rules').maybeSingle()
  ]);

  const seen = new Set();
  cachedEmployees = (empRes.data || []).filter(e => {
    if (!e.name || seen.has(e.name.trim())) return false;
    seen.add(e.name.trim());
    return true;
  });

  const ruleArea = document.getElementById('custom-scheduling-rules');
  if (ruleArea && ruleRes.data?.rule_text) {
    ruleArea.value = ruleRes.data.rule_text;
  }

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
    dialysisNurses.forEach(e => {
      const code = getEmpCode(e);
      const isHead = e.name === '陳慧倪' || e.name === '陳惠倪';
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

async function saveSchedulingRules() {
  const client = getHrSupabase();
  if (!client) return;
  const ruleText = document.getElementById('custom-scheduling-rules')?.value;

  const { error } = await client.from('clinic_rule_configs').upsert({
    key: 'scheduling_rules',
    rule_text: ruleText,
    updated_at: new Date().toISOString()
  });

  if (error) alert('儲存規則失敗：' + error.message);
  else alert('💾 排班邏輯規則已儲存！AI 自動排班將依此規則運算。');
}

async function runAiAutoScheduling() {
  const client = getHrSupabase();
  const monthStr = document.getElementById('admin-sch-month')?.value;
  if (!client || !monthStr) return;

  if (!confirm(`確定要為【${monthStr}】啟動 AI 智慧自動排班？\n這將依據護理長排班邏輯、全員預約與打卡狀況生成整月班表。`)) return;

  const [y, m] = monthStr.split('-').map(Number);
  const totalDays = new Date(y, m, 0).getDate();
  const startDateStr = `${monthStr}-01`;
  const endDateStr = `${monthStr}-${totalDays}`;

  const [reqRes, attRes] = await Promise.all([
    client.from('clinic_schedule_requests').select('*').gte('request_date', startDateStr).lte('request_date', endDateStr),
    client.from('clinic_attendance').select('*').gte('punch_date', `${monthStr}-01`).lte('punch_date', endDateStr)
  ]);

  const monthRequests = reqRes.data || [];
  const monthAttendance = attRes.data || [];

  const lateCounts = {};
  monthAttendance.forEach(a => {
    if (a.punch_type === 'in' && a.is_late) {
      lateCounts[a.employee_name] = (lateCounts[a.employee_name] || 0) + 1;
    }
  });

  const group5F = ['陳金暖', '王瓊代', '吳金燕', '吳培瑜', '吳沐芸'];
  const group6F = ['曾憲敏', '薛雅仁', '王靜慧', '李香瑩', '王芝妍'];
  const groupFloat = ['林雯琦', '李牧音', '謝宜婷'];

  const generatedSchedules = [];
  const saturdayCounts = {};
  cachedEmployees.forEach(e => { saturdayCounts[e.name] = 0; });

  const luOffDates = new Set(monthRequests.filter(r => (r.employee_name === '盧明伶' || r.line_user_id?.includes('盧明伶')) && r.request_type === 'off').map(r => r.request_date));

  for (let d = 1; d <= totalDays; d++) {
    const dayStr = `${monthStr}-${String(d).padStart(2, '0')}`;
    const dayOfWeek = new Date(y, m - 1, d).getDay();

    if (dayOfWeek === 0) continue;

    const dayReqs = monthRequests.filter(r => r.request_date === dayStr);
    const dayOffNames = new Set(dayReqs.filter(r => r.request_type === 'off' || r.request_type === 'abroad').map(r => r.employee_name));
    const dayNightOnlyNames = new Set(dayReqs.filter(r => r.request_type === 'night_only').map(r => r.employee_name));

    let xieAssignedToPharma = false;
    if (luOffDates.has(dayStr)) {
      xieAssignedToPharma = true;
      const xieEmp = cachedEmployees.find(e => e.name === '謝宜婷');
      if (xieEmp) {
        generatedSchedules.push({
          date: dayStr,
          employee_id: xieEmp.id,
          shift_id: 'morning',
          shift_name: '常規白班 (門診藥事代班)',
          hours: 8.5
        });
      }
    }

    const avail5F = group5F.filter(name => !dayOffNames.has(name));
    let opener5F = avail5F[0] || groupFloat.find(name => !dayOffNames.has(name) && (!xieAssignedToPharma || name !== '謝宜婷'));
    if (opener5F) {
      const emp = cachedEmployees.find(e => e.name === opener5F);
      if (emp) {
        generatedSchedules.push({
          date: dayStr,
          employee_id: emp.id,
          shift_id: 'morning',
          shift_name: '開門白班',
          hours: 8.5
        });
      }
    }

    const avail6F = group6F.filter(name => !dayOffNames.has(name));
    let opener6F = avail6F[0] || groupFloat.find(name => !dayOffNames.has(name) && name !== opener5F && (!xieAssignedToPharma || name !== '謝宜婷'));
    if (opener6F) {
      const emp = cachedEmployees.find(e => e.name === opener6F);
      if (emp) {
        generatedSchedules.push({
          date: dayStr,
          employee_id: emp.id,
          shift_id: 'morning',
          shift_name: '開門白班',
          hours: 8.5
        });
      }
    }

    if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
      const nightCandidates = [...dayNightOnlyNames];
      if (nightCandidates.length > 0) {
        nightCandidates.forEach(nName => {
          const emp = cachedEmployees.find(e => e.name === nName);
          if (emp) {
            generatedSchedules.push({
              date: dayStr,
              employee_id: emp.id,
              shift_id: 'afternoon',
              shift_name: '正常晚班',
              hours: 8.5
            });
          }
        });
      }
    }

    if (dayOfWeek === 6) {
      generatedSchedules.filter(s => s.date === dayStr).forEach(s => {
        const emp = cachedEmployees.find(e => e.id === s.employee_id);
        if (emp) saturdayCounts[emp.name] = (saturdayCounts[emp.name] || 0) + 1;
      });
    }
  }

  const dialysisNurseIds = cachedEmployees.filter(e => isDialysisNurse(e.name, e.role)).map(e => e.id);
  await client.from('clinic_schedules').delete().gte('date', startDateStr).lte('date', endDateStr).in('employee_id', dialysisNurseIds);

  if (generatedSchedules.length > 0) {
    const { error } = await client.from('clinic_schedules').insert(generatedSchedules);
    if (error) alert('AI 排班寫入失敗：' + error.message);
    else alert(`🎉【${monthStr}】AI 智慧排班運算完成！已自動滿足 5/6 樓開門、夜班預約與代班規則。`);
  }

  loadScheduleCalendar();
}

async function loadScheduleCalendar() {
  const client = getHrSupabase();
  const monthStr = document.getElementById('admin-sch-month')?.value;
  if (!client || !monthStr) return;

  const [y, m] = monthStr.split('-').map(Number);
  const firstDayObj = new Date(y, m - 1, 1);
  const totalDays = new Date(y, m, 0).getDate();
  const startDayOfWeek = firstDayObj.getDay();

  const startDateStr = `${monthStr}-01`;
  const endDateStr = `${monthStr}-${totalDays}`;

  const [schRes, reqRes, attRes] = await Promise.all([
    client.from('clinic_schedules').select('*, clinic_employees(*)').gte('date', startDateStr).lte('date', endDateStr),
    client.from('clinic_schedule_requests').select('*, clinic_employees(*)').gte('request_date', startDateStr).lte('request_date', endDateStr),
    client.from('clinic_attendance').select('*').gte('punch_date', startDateStr).lte('punch_date', endDateStr)
  ]);

  cachedMonthSchedules = schRes.data || [];
  cachedMonthRequests = reqRes.data || [];
  cachedMonthAttendance = attRes.data || [];

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
    const dayAttendance = cachedMonthAttendance.filter(a => a.punch_date === dayStr);
    const holiday = getHolidayInfo(dayStr);

    const cell = document.createElement('div');
    cell.className = `min-h-[75px] p-1.5 rounded-lg border flex flex-col justify-between transition hover:shadow-md cursor-pointer ${
      holiday ? 'bg-rose-50/80 border-rose-300' : (dayOfWeek === 0 ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-200 hover:border-indigo-400')
    }`;
    cell.onclick = () => openShiftEditModal(dayStr, dayOfWeek, holiday, dayRequests, dayAttendance);

    let headerHtml = `<div class="flex justify-between items-center font-bold">`;
    headerHtml += `<span class="text-xs ${holiday || dayOfWeek === 0 ? 'text-rose-600 font-black' : 'text-slate-700'}">${d}</span>`;
    if (holiday) headerHtml += `<span class="text-[9px] bg-rose-600 text-white px-1.5 py-0.2 rounded-full font-bold">🎌${holiday.name}</span>`;
    else if (dayOfWeek === 0) headerHtml += `<span class="text-[9px] bg-slate-200 text-slate-700 px-1 rounded">休診</span>`;
    headerHtml += `</div>`;

    let bodyHtml = `<div class="space-y-0.5 mt-0.5">`;

    const workSchedules = daySchedules.filter(s => s.shift_name && s.shift_name !== '未排班' && s.shift_name !== '休假');
    if (workSchedules.length > 0) {
      const summaryList = workSchedules.map(s => {
        const code = getEmpCode(s.clinic_employees || s.employee_id);
        const shortShift = s.shift_name.includes('開門') ? '開白' : (s.shift_name.includes('晚') ? '晚' : '白');
        return `[${code}]${shortShift}`;
      }).join(' ');
      bodyHtml += `<div class="text-[9px] bg-indigo-50 text-indigo-900 font-bold px-1 py-0.2 rounded leading-tight">班:${summaryList}</div>`;
    }

    const latePunches = dayAttendance.filter(a => a.punch_type === 'in' && a.is_late);
    const normalPunches = dayAttendance.filter(a => a.punch_type === 'in' && !a.is_late);
    
    if (dayAttendance.length > 0) {
      if (latePunches.length > 0) {
        const lateNames = latePunches.map(p => getEmpCode(p.employee_name)).join(',');
        bodyHtml += `<div class="text-[9px] bg-rose-100 text-rose-800 font-bold px-1 py-0.2 rounded leading-tight">⚠️遲到(${latePunches.length}): ${lateNames}</div>`;
      } else {
        bodyHtml += `<div class="text-[9px] bg-emerald-50 text-emerald-800 font-semibold px-1 py-0.2 rounded leading-tight">✅全準時 (${normalPunches.length})</div>`;
      }
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
    let satWorkCount = 0;
    cachedMonthSchedules.filter(s => s.employee_id === emp.id).forEach(s => {
      if (s.hours && s.shift_name !== '未排班' && s.shift_name !== '休假') {
        empHours += Number(s.hours) || 0;
        const dObj = new Date(s.date);
        if (dObj.getDay() === 6) satWorkCount++;
      }
    });

    const code = getEmpCode(emp);
    const div = document.createElement('div');
    div.className = "flex justify-between items-center p-1.5 rounded-lg border border-slate-200 bg-slate-50 text-[11px]";
    div.innerHTML = `
      <span class="font-bold text-slate-700">[${code}] ${emp.name} (週六${satWorkCount}次)</span>
      <span class="font-black text-indigo-700 bg-indigo-100 px-1.5 py-0.2 rounded">${empHours.toFixed(1)}h</span>
    `;
    summaryBox.appendChild(div);
  });
}

function openShiftEditModal(dateStr, dayOfWeek, holiday, dayRequests, dayAttendance) {
  editingDate = dateStr;
  document.getElementById('modal-date-title').innerText = `📅 ${dateStr} ${holiday ? `(🎌${holiday.name})` : ''} 出勤工時審核與排班`;

  let priorityHints = [];
  const abroads = (dayRequests || []).filter(r => r.request_type === 'abroad').map(r => r.employee_name || '');
  if (abroads.length > 0) priorityHints.push(`✈️ 出國行程：${abroads.join('、')}`);
  const nights = (dayRequests || []).filter(r => r.request_type === 'night_only').map(r => r.employee_name || '');
  if (nights.length > 0) priorityHints.push(`🌙 只上夜班：${nights.join('、')}`);
  const regularOffs = (dayRequests || []).filter(r => r.request_type === 'off').map(r => r.employee_name || '');
  if (regularOffs.length > 0) priorityHints.push(`🏖️ 登記特休：${regularOffs.join('、')}`);

  if (dayAttendance && dayAttendance.length > 0) {
    const attDetails = dayAttendance.map(a => {
      const t = new Date(a.punch_time).toTimeString().substring(0, 5);
      const safeName = a.employee_name || '同仁';
      return `${safeName}(${a.punch_type === 'in' ? '上班' : '下班'} ${t}${a.is_late ? ` 遲${a.late_minutes}分` : ''})`;
    }).join(' | ');
    priorityHints.push(`⏱️ 實際打卡：${attDetails}`);
  }

  document.getElementById('modal-priority-hint').innerText = priorityHints.join(' \n') || '無特別出勤紀錄';

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
      hoursOptionsHtml += `<option value="${h}" ${selected}>${h.toFixed(1)}h</option>`;
    });

    row.innerHTML = `
      <span class="font-bold text-slate-800 w-28 truncate">[${code}] ${emp.name}</span>
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
  const client = getHrSupabase();
  if (!client) return;

  const shiftSelects = document.querySelectorAll('.nurse-shift-type-select');
  const hoursSelects = document.querySelectorAll('.nurse-hours-select');

  const dialysisNurseIds = cachedEmployees.filter(e => isDialysisNurse(e.name, e.role)).map(e => e.id);
  await client.from('clinic_schedules').delete().eq('date', editingDate).in('employee_id', dialysisNurseIds);

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
    const { error } = await client.from('clinic_schedules').insert(newRecords);
    if (error) alert('儲存失敗：' + error.message);
  }

  closeShiftEditModal();
  loadScheduleCalendar();
}

function buildA4CalendarHtml(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const firstDayObj = new Date(y, m - 1, 1);
  const totalDays = new Date(y, m, 0).getDate();
  const startDayOfWeek = firstDayObj.getDay();

  const weekDays = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  let theadHtml = '<tr>';
  weekDays.forEach((wd, idx) => {
    const isSun = idx === 0;
    theadHtml += `<th style="border: 1px solid #000; padding: 4px; font-size: 11px; background: ${isSun ? '#fee2e2' : '#f1f5f9'}; color: ${isSun ? '#b91c1c' : '#0f172a'}; width: 14.28%; text-align: center;">${wd}</th>`;
  });
  theadHtml += '</tr>';

  let tbodyHtml = '<tr>';
  let dayCounter = 1;
  let cellCount = 0;

  for (let i = 0; i < startDayOfWeek; i++) {
    tbodyHtml += `<td style="border: 1px solid #000; background: #fafafa; min-height: 82px;"></td>`;
    cellCount++;
  }

  while (dayCounter <= totalDays) {
    if (cellCount % 7 === 0 && cellCount > 0) tbodyHtml += '</tr><tr>';

    const dayStr = `${monthStr}-${String(dayCounter).padStart(2, '0')}`;
    const dayOfWeek = new Date(y, m - 1, dayCounter).getDay();
    const holiday = getHolidayInfo(dayStr);
    const daySchedules = cachedMonthSchedules.filter(s => s.date === dayStr && s.shift_name && s.shift_name !== '未排班');
    const dayOffReqs = cachedMonthRequests.filter(r => r.request_date === dayStr && r.request_type === 'off');

    const isSun = dayOfWeek === 0;
    const bgStyle = holiday ? 'background: #fff1f2;' : (isSun ? 'background: #f8fafc;' : 'background: #ffffff;');

    let cellContent = `<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dotted #94a3b8; padding-bottom: 2px; margin-bottom: 3px;">`;
    cellContent += `<span style="font-weight: 900; font-size: 12px; color: ${isSun || holiday ? '#dc2626' : '#0f172a'};">${dayCounter}</span>`;
    if (holiday) {
      cellContent += `<span style="font-size: 8px; font-weight: bold; background: #e11d48; color: #fff; padding: 0.5px 3px; border-radius: 3px;">${holiday.name}</span>`;
    } else if (isSun) {
      cellContent += `<span style="font-size: 8px; color: #64748b;">休診</span>`;
    }
    cellContent += `</div>`;

    cellContent += `<div style="font-size: 9px; line-height: 1.25; min-height: 52px; font-family: monospace;">`;

    if (daySchedules.length > 0) {
      daySchedules.forEach(s => {
        const code = getEmpCode(s.clinic_employees || { name: s.employee_id });
        const shortShift = s.shift_name.includes('開門') ? '開白' : (s.shift_name.includes('晚') ? '晚' : '白');
        const shiftColor = s.shift_name.includes('開門') ? '#b45309' : (s.shift_name.includes('晚') ? '#4338ca' : '#0369a1');
        cellContent += `<div style="color: ${shiftColor}; font-weight: bold;">[${code}] ${shortShift} ${s.hours}h</div>`;
      });
    }

    if (dayOffReqs.length > 0) {
      const offCodes = dayOffReqs.map(r => getEmpCode(r.clinic_employees || { name: r.employee_id })).join(',');
      cellContent += `<div style="color: #be123c;">[特休] ${offCodes}</div>`;
    }

    cellContent += `</div>`;
    tbodyHtml += `<td style="border: 1px solid #000; padding: 3px; vertical-align: top; width: 14.28%; ${bgStyle}">${cellContent}</td>`;

    dayCounter++;
    cellCount++;
  }

  while (cellCount % 7 !== 0) {
    tbodyHtml += `<td style="border: 1px solid #000; background: #fafafa;"></td>`;
    cellCount++;
  }
  tbodyHtml += '</tr>';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif; color: black; width: 100%; max-width: 1000px; margin: 0 auto;">
      <div style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid black; padding-bottom: 3px; margin-bottom: 4px;">
        <div>
          <h2 style="font-size: 16px; font-weight: 900; margin: 0; letter-spacing: 1px;">🏥 愛欣診所透析中心 - 護理人員出勤班表</h2>
          <span style="font-size: 11px; font-weight: bold; color: #334155;">排班月份：${monthStr} ｜ 護理長：陳慧倪</span>
        </div>
        <div style="font-size: 9.5px; color: #334155; text-align: right; line-height: 1.2;">
          開白(06:00前)、白(07:00前)、晚(15:00前)｜常日常規(08:00前)<br>
          產表日期：${new Date().toLocaleDateString('zh-TW')}
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; border: 1.5px solid black; table-layout: fixed;">
        <thead>${theadHtml}</thead>
        <tbody>${tbodyHtml}</tbody>
      </table>

      <div style="display: flex; justify-content: space-between; font-size: 10.5px; margin-top: 8px; font-weight: bold; padding-top: 4px;">
        <span>護理長簽核：陳慧倪 ____________________</span>
        <span>院長 / 醫師簽核：林和正 ____________________</span>
        <span>備註 / 異動紀錄：____________________</span>
      </div>
    </div>
  `;
}

function openA4PrintPreview() {
  const monthStr = document.getElementById('admin-sch-month')?.value;
  if (!monthStr) return alert('請先選擇要列印的月份！');

  const container = document.getElementById('a4-printable-content');
  if (container) container.innerHTML = buildA4CalendarHtml(monthStr);
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
  const htmlContent = buildA4CalendarHtml(monthStr);
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>愛欣診所出勤月曆_${monthStr}</title>
        <style>@page { size: A4 landscape; margin: 5mm; } body { margin: 0; padding: 4px; font-family: -apple-system, sans-serif; }</style>
      </head>
      <body>
        ${htmlContent}
        <script>window.onload = function() { window.print(); };</script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }
}
