const LIFF_ID = '2011071479-1rEMTEv0'; 
const SUPABASE_URL = 'https://bvbknaaljuwxrzvoqcrt.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_fPdr9TBzrw9Ycb6GEpF7UA_zeLqblfo'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 愛欣診所精確座標（高雄市苓雅區正義路136號）
const CLINIC_LOCATION = {
  lat: 22.6309209,
  lng: 120.3392031,
  radiusMeters: 300
};

let currentUser = { lineUserId: '', displayName: '林和正', empId: null };
let cachedAllData = [];
let cachedEmployees = [];
let cachedShifts = [];
let cachedAllSchedules = [];
let currentGps = { lat: null, lng: null };

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function getTaipeiDayRange() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const localDateStr = formatter.format(now);
  const startOfDay = new Date(`${localDateStr}T00:00:00+08:00`).toISOString();
  const endOfDay = new Date(`${localDateStr}T23:59:59.999+08:00`).toISOString();
  return { localDateStr, startOfDay, endOfDay };
}

function refreshGpsLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        currentGps.lat = pos.coords.latitude;
        currentGps.lng = pos.coords.longitude;
        const dist = getDistanceInMeters(currentGps.lat, currentGps.lng, CLINIC_LOCATION.lat, CLINIC_LOCATION.lng);
        const statusElem = document.getElementById('gps-status');
        if (statusElem) {
          if (dist <= CLINIC_LOCATION.radiusMeters) {
            statusElem.innerText = `📍 診所範圍內 (${Math.round(dist)}m)`;
            statusElem.className = "bg-emerald-800/80 px-2 py-0.5 rounded-full text-[10px] text-emerald-200";
          } else {
            statusElem.innerText = `📍 距離診所約 ${Math.round(dist)} 公尺`;
            statusElem.className = "bg-amber-800/80 px-2 py-0.5 rounded-full text-[10px] text-amber-200";
          }
        }
      },
      err => {
        const statusElem = document.getElementById('gps-status');
        if (statusElem) statusElem.innerText = "📍 請開啟精確定位權限";
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }
}function openMainSection(section) {
  document.getElementById('sec-main-home').classList.add('hidden');
  document.getElementById('sub-page-header').classList.remove('hidden');

  const titles = { 'hr': '🏢 人事管理系統', 'finance': '💰 帳務管理系統' };
  document.getElementById('sub-page-title').innerText = titles[section];
  document.getElementById('sec-hr').classList.add('hidden');
  document.getElementById('sec-finance').classList.add('hidden');
  document.getElementById(`sec-${section}`).classList.remove('hidden');

  if (section === 'hr') {
    loadMySchedule();
    initHrDefaults();
  }
  if (section === 'finance') {
    initFinanceDefaults();
  }
}

function backToMainMenu() {
  document.getElementById('sec-hr').classList.add('hidden');
  document.getElementById('sec-finance').classList.add('hidden');
  document.getElementById('sub-page-header').classList.add('hidden');
  document.getElementById('sec-main-home').classList.remove('hidden');
  loadTodayAttendance();
}

function switchHrTab(tab) {
  ['myschedule', 'request', 'scheduling'].forEach(t => {
    document.getElementById(`hr-sec-${t}`).classList.add('hidden');
    document.getElementById(`hr-tab-${t}`).className = "py-2 rounded-lg hover:text-slate-900 transition";
  });
  document.getElementById(`hr-sec-${tab}`).classList.remove('hidden');
  document.getElementById(`hr-tab-${tab}`).className = "py-2 rounded-lg bg-indigo-600 text-white shadow-sm transition";

  if (tab === 'request') initRequestPage();
  if (tab === 'scheduling') loadScheduleAdminData();
}

function switchFinTab(tab) {
  ['register', 'invoice', 'report'].forEach(t => {
    document.getElementById(`fin-sec-${t}`).classList.add('hidden');
    document.getElementById(`fin-tab-${t}`).className = "py-2 rounded-lg hover:text-slate-900 transition";
  });
  document.getElementById(`fin-sec-${tab}`).classList.remove('hidden');
  document.getElementById(`fin-tab-${tab}`).className = "py-2 rounded-lg bg-slate-900 text-white shadow-sm transition";

  if (tab === 'invoice') loadPendingInvoices();
  if (tab === 'report') loadAdminData();
}

async function initLiff() {
  setInterval(updateClock, 1000);
  updateClock();
  refreshGpsLocation();

  try {
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) {
      liff.login();
    } else {
      const profile = await liff.getProfile();
      currentUser.lineUserId = profile.userId;
      currentUser.displayName = profile.displayName;
      document.getElementById('user-name').innerText = currentUser.displayName;
      await syncEmployeeRecord();
      loadTodayAttendance();
    }
  } catch (err) {
    document.getElementById('user-name').innerText = "林和正";
    currentUser.displayName = "林和正";
    await syncEmployeeRecord();
    loadTodayAttendance();
  }
}

function updateClock() {
  const now = new Date();
  const dateElem = document.getElementById('clock-date');
  const timeElem = document.getElementById('clock-time');
  if (dateElem && timeElem) {
    dateElem.innerText = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
    timeElem.innerText = now.toTimeString().split(' ')[0];
  }
}

async function syncEmployeeRecord() {
  try {
    const { data } = await supabaseClient.from('clinic_employees').select('*').eq('name', currentUser.displayName);
    if (data && data.length > 0) {
      currentUser.empId = data[0].id;
    }
  } catch (e) {
    console.warn('同步員工資料略過:', e);
  }
}
// 打卡邏輯（移除不存在的 user_name 欄位）
async function punchAttendance(type) {
  if (!currentGps.lat || !currentGps.lng) {
    refreshGpsLocation();
  }

  if (!currentUser.empId) await syncEmployeeRecord();
  const btn = document.getElementById(`btn-punch-${type}`);
  if (btn) btn.disabled = true;

  try {
    const { error } = await supabaseClient.from('clinic_attendance').insert([{
      employee_id: currentUser.empId,
      punch_type: type,
      latitude: currentGps.lat,
      longitude: currentGps.lng,
      is_valid_location: true
    }]);

    if (error) throw error;

    alert(`✅ ${type === 'in' ? '上班' : '下班'}打卡成功！\n時間：${new Date().toLocaleTimeString('zh-TW')}`);
    await loadTodayAttendance();
  } catch (err) {
    alert('打卡失敗：' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// 載入當日打卡狀態 (台灣時區)
async function loadTodayAttendance() {
  const summary = document.getElementById('today-punch-summary');
  if (!summary) return;

  try {
    if (!currentUser.empId) await syncEmployeeRecord();
    const { startOfDay, endOfDay } = getTaipeiDayRange();
    
    let query = supabaseClient.from('clinic_attendance')
      .select('*')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay)
      .order('created_at', { ascending: true });

    if (currentUser.empId) {
      query = query.eq('employee_id', currentUser.empId);
    }

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      summary.innerText = "今日出勤：尚未打卡";
      return;
    }

    const last = data[data.length - 1];
    const timeStr = new Date(last.created_at || last.punch_time).toLocaleTimeString('zh-TW', {
      timeZone: 'Asia/Taipei',
      hour: '2-digit',
      minute: '2-digit'
    });
    summary.innerHTML = `今日已打卡 <strong>${data.length}</strong> 次 (最後：${last.punch_type === 'in' ? '上班' : '下班'} ${timeStr})`;
  } catch (e) {
    summary.innerText = "今日出勤：尚未打卡";
  }
}

asyn

    if (error) throw error;

    alert(`✅ ${type === 'in' ? '上班' : '下班'}打卡成功！\n時間：${new Date().toLocaleTimeString('zh-TW')}`);
    await loadTodayAttendance();
  } catch (err) {
    alert('打卡失敗：' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadTodayAttendance() {
  const summary = document.getElementById('today-punch-summary');
  if (!summary) return;

  try {
    const { startOfDay, endOfDay } = getTaipeiDayRange();
    
    let query = supabaseClient.from('clinic_attendance')
      .select('*')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay)
      .order('created_at', { ascending: true });

    if (currentUser.empId) {
      query = query.eq('employee_id', currentUser.empId);
    } else {
      query = query.eq('user_name', currentUser.displayName);
    }

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      summary.innerText = "今日出勤：尚未打卡";
      return;
    }

    const last = data[data.length - 1];
    const timeStr = new Date(last.created_at || last.punch_time).toLocaleTimeString('zh-TW', {
      timeZone: 'Asia/Taipei',
      hour: '2-digit',
      minute: '2-digit'
    });
    summary.innerHTML = `今日已打卡 <strong>${data.length}</strong> 次 (最後：${last.punch_type === 'in' ? '上班' : '下班'} ${timeStr})`;
  } catch (e) {
    summary.innerText = "今日出勤：尚未打卡";
  }
}function initHrDefaults() {
  const today = new Date();
  document.getElementById('sch-date').value = today.toISOString().split('T')[0];
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
}

async function initRequestPage() {
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const nextMonthStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
  document.getElementById('req-target-month').value = nextMonthStr;
  updateRequestMonthDays();

  const currentDay = today.getDate();
  const deadlineTag = document.getElementById('request-deadline-tag');
  const submitBtn = document.getElementById('btn-submit-request');

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

  const { data: shifts } = await supabaseClient.from('clinic_shifts').select('*');
  const shiftSelect = document.getElementById('req-shift-select');
  shiftSelect.innerHTML = '';
  (shifts || []).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.innerText = `${s.shift_name} (${s.start_time.substring(0,5)} ~ ${s.end_time.substring(0,5)})`;
    shiftSelect.appendChild(opt);
  });

  loadMyRequests();
}

function updateRequestMonthDays() {
  const monthStr = document.getElementById('req-target-month').value;
  if (!monthStr) return;
  const [y, m] = monthStr.split('-');
  document.getElementById('req-date').min = `${y}-${m}-01`;
  document.getElementById('req-date').max = `${y}-${m}-${new Date(y, m, 0).getDate()}`;
  document.getElementById('req-date').value = `${y}-${m}-01`;
}

function toggleRequestShiftSelect() {
  const type = document.getElementById('req-type').value;
  const shiftGroup = document.getElementById('req-shift-group');
  if (type === 'off') {
    shiftGroup.classList.add('hidden');
  } else {
    shiftGroup.classList.remove('hidden');
  }
}

document.getElementById('schedule-request-form').addEventListener('submit', async (e) => {
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

  if (error) {
    alert('送出失敗：' + error.message);
  } else {
    alert('✅ 排班需求已成功登記！護理長將於 21~25 號進行班表整合。');
    document.getElementById('req-reason').value = '';
    loadMyRequests();
  }
});

async function loadMyRequests() {
  if (!currentUser.empId) return;
  const targetMonth = document.getElementById('req-target-month').value;
  const { data } = await supabaseClient.from('clinic_schedule_requests')
    .select('*, clinic_shifts(*)')
    .eq('employee_id', currentUser.empId)
    .eq('target_month', targetMonth)
    .order('request_date', { ascending: true });

  const container = document.getElementById('my-request-list');
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
  loadMyRequests();
}

async function loadScheduleAdminData() {
  const { data: empData } = await supabaseClient.from('clinic_employees').select('*').eq('is_active', true);
  cachedEmployees = empData || [];

  const { data: shiftData } = await supabaseClient.from('clinic_shifts').select('*');
  cachedShifts = shiftData || [];

  const empSelect = document.getElementById('sch-emp-select');
  empSelect.innerHTML = '';
  cachedEmployees.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.innerText = `${e.name} (${e.role === 'doctor' ? '醫師' : (e.role === 'nurse' ? '護理師' : '行政')})`;
    empSelect.appendChild(opt);
  });

  const shiftSelect = document.getElementById('sch-shift-select');
  shiftSelect.innerHTML = '';
  cachedShifts.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.innerText = `${s.shift_name} (${s.start_time.substring(0,5)} ~ ${s.end_time.substring(0,5)})`;
    shiftSelect.appendChild(opt);
  });

  const { data: allSch } = await supabaseClient.from('clinic_schedules')
    .select('*, clinic_employees(*), clinic_shifts(*)')
    .order('date', { ascending: false })
    .limit(100);

  cachedAllSchedules = allSch || [];
  renderAllScheduleList();
  checkShiftCompliance();
}

function renderAllScheduleList() {
  const schList = document.getElementById('all-schedule-list');
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
  const dateStr = document.getElementById('sch-date').value;
  const empId = document.getElementById('sch-emp-select').value;
  const shiftId = document.getElementById('sch-shift-select').value;
  const warningDiv = document.getElementById('sch-warning-msg');
  const specialBox = document.getElementById('special-interval-box');
  const saveBtn = document.getElementById('btn-save-schedule');

  warningDiv.classList.add('hidden');
  specialBox.classList.add('hidden');
  saveBtn.disabled = false;
  saveBtn.className = "w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm transition";

  if (!dateStr || !empId || !shiftId) return;

  const targetShift = cachedShifts.find(s => s.id === shiftId);
  const empSchedules = cachedAllSchedules.filter(s => s.employee_id === empId);

  const curDate = new Date(dateStr);
  let consecutiveDays = 0;
  for (let i = 1; i <= 6; i++) {
    const prevDate = new Date(curDate);
    prevDate.setDate(prevDate.getDate() - i);
    const prevStr = prevDate.toISOString().split('T')[0];
    if (empSchedules.some(s => s.date === prevStr)) {
      consecutiveDays++;
    } else {
      break;
    }
  }

  if (consecutiveDays >= 6) {
    warningDiv.innerText = `🚨 違規警告：該同仁已連續出勤 ${consecutiveDays} 日！依勞基法與四週變形工時規定不得連續工作超過 6 日。`;
    warningDiv.classList.remove('hidden');
    saveBtn.disabled = true;
    saveBtn.className = "w-full bg-slate-400 text-white font-bold py-2.5 rounded-xl text-xs cursor-not-allowed";
    return;
  }

  const prevDay = new Date(curDate);
  prevDay.setDate(prevDay.getDate() - 1);
  const prevDayStr = prevDay.toISOString().split('T')[0];
  const prevSchedule = empSchedules.find(s => s.date === prevDayStr);

  if (prevSchedule && prevSchedule.clinic_shifts && targetShift) {
    const prevEnd = prevSchedule.clinic_shifts.end_time;
    const curStart = targetShift.start_time;

    const [ph, pm] = prevEnd.split(':').map(Number);
    const [ch, cm] = curStart.split(':').map(Number);
    let intervalHours = (ch + 24 - ph) + (cm - pm) / 60;
    if (intervalHours >= 24) intervalHours -= 24;

    if (intervalHours < 8) {
      warningDiv.innerText = `🚨 強制違規：與前一日班別間隔僅 ${intervalHours.toFixed(1)} 小時，小於勞基法法定下限 8 小時，禁止排班！`;
      warningDiv.classList.remove('hidden');
      saveBtn.disabled = true;
      saveBtn.className = "w-full bg-slate-400 text-white font-bold py-2.5 rounded-xl text-xs cursor-not-allowed";
    } else if (intervalHours < 11) {
      specialBox.classList.remove('hidden');
      warningDiv.innerText = `⚠️ 提醒：與前日班別間隔為 ${intervalHours.toFixed(1)} 小時（小於原則11小時），需勾選並註記符合勞資會議決議之「緊急透析/教育訓練」事由。`;
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

  if (error) {
    alert('儲存失敗：' + error.message);
  } else {
    alert('✅ 排班成功儲存！已符合四週變形工時規範。');
    loadScheduleAdminData();
  }
}

function initFinanceDefaults() {
  const today = new Date();
  document.getElementById('report-month').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  updateFormMode();
}

const categoryOptions = {
  expense: ['文具雜項', '清潔衛生用品', '餐飲茶水', '郵資快遞', '車資旅費', '維修保養', '其他零用金支出'],
  income: ['自費門診收入', '自費衛材收入', '洗腎相關自費', '其他收入']
};

function updateFormMode() {
  const type = document.querySelector('input[name="type"]:checked').value;
  const supplierGroup = document.getElementById('supplier-group');
  const categoryGroup = document.getElementById('category-group');
  const deliveryDocSection = document.getElementById('delivery-doc-mode-section');

  if (type === 'delivery' || type === 'pharma') {
    supplierGroup.classList.remove('hidden');
    categoryGroup.classList.add('hidden');
    deliveryDocSection.classList.remove('hidden');
    toggleDocMode();
  } else {
    supplierGroup.classList.add('hidden');
    categoryGroup.classList.remove('hidden');
    deliveryDocSection.classList.add('hidden');

    const categorySelect = document.getElementById('category');
    categorySelect.innerHTML = '';
    categoryOptions[type].forEach(item => {
      const opt = document.createElement('option');
      opt.value = item;
      opt.innerText = item;
      categorySelect.appendChild(opt);
    });
  }
}

function toggleDocMode() {
  const mode = document.querySelector('input[name="doc_mode"]:checked')?.value || 'receipt_only';
  const receiptBox = document.getElementById('doc-receipt-box');
  const invoiceBox = document.getElementById('doc-invoice-box');
  const receiptInput = document.getElementById('receipt');

  if (mode === 'receipt_only') {
    receiptBox.classList.remove('hidden');
    invoiceBox.classList.add('hidden');
    receiptInput.required = true;
  } else {
    receiptBox.classList.add('hidden');
    invoiceBox.classList.remove('hidden');
    receiptInput.required = false;
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
      try {
        const html5Qr = new Html5Qrcode("pending-invoice-list");
        const decodedText = await html5Qr.scanFile(file, false);
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

document.getElementById('cash-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.innerText = "處理中...";

  try {
    const type = document.querySelector('input[name="type"]:checked').value;
    const note = document.getElementById('note').value;
    let supplier = null;
    let category = null;
    let amount = 0;
    let invoiceNo = null;
    let status = 'paid';
    let receiptUrl = null;

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
          submitBtn.disabled = false;
          submitBtn.innerText = "確認點收並送出";
          return;
        }

        const dupCount = await checkDuplicateInvoiceNo(invoiceNo);
        if (dupCount > 0) {
          const confirmDup = confirm(`🚨 重複發票警示！\n\n發票【${invoiceNo}】已存在 ${dupCount} 筆。\n確定建立嗎？`);
          if (!confirmDup) {
            submitBtn.disabled = false;
            submitBtn.innerText = "確認點收並送出";
            return;
          }
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
    document.getElementById('reg-invoice-no').value = '';
    updateFormMode();
  } catch (err) {
    alert('❌ 失敗：' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = "確認點收並送出";
  }
});

async function loadPendingInvoices() {
  const container = document.getElementById('pending-invoice-list');
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
  document.getElementById('invoice-modal').classList.remove('hidden');
}

function closeInvoiceModal() {
  document.getElementById('invoice-modal').classList.add('hidden');
}

document.getElementById('modal-invoice-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('modal-id').value;
  const invoiceNo = document.getElementById('modal-invoice-no').value.trim().toUpperCase();
  const amount = parseFloat(document.getElementById('modal-amount').value);

  const dupCount = await checkDuplicateInvoiceNo(invoiceNo, id);
  if (dupCount > 0) {
    const confirmDup = confirm(`🚨 重複發票警示！\n\n發票【${invoiceNo}】已存在 ${dupCount} 筆。\n確定儲存嗎？`);
    if (!confirmDup) return;
  }

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

  document.getElementById('stat-pending-count').innerText = `${pendingItems.length} 筆`;
  const unpaidTotal = unpaidItems.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  document.getElementById('stat-unpaid-total').innerText = `NT$ ${unpaidTotal.toLocaleString()}`;

  renderSupplierTimeline(unpaidItems);
  renderAdminUnpaidList(unpaidItems);
}

function renderSupplierTimeline(unpaidItems) {
  const timelineContainer = document.getElementById('supplier-timeline-list');
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
  const targetMonth = document.getElementById('report-month').value;
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
  breakdownList.innerHTML = '';
  Object.entries(supplierSums).forEach(([sup, sum]) => {
    const li = document.createElement('li');
    li.className = "flex justify-between border-b border-slate-100 py-0.5";
    li.innerHTML = `<span>${sup}</span><span class="font-bold">NT$ ${sum.toLocaleString()}</span>`;
    breakdownList.appendChild(li);
  });

  document.getElementById('report-result-box').classList.remove('hidden');
}

function exportCsvReport() {
  const targetMonth = document.getElementById('report-month').value || new Date().toISOString().substring(0, 7);
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

initLiff();

