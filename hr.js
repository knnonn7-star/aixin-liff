// ==================== 愛欣診所 人事與排班模組 (hr.js) ====================
let cachedEmployees = [];
let cachedShifts = [];
let cachedAllSchedules = [];

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
    alert('🔒 權限提示：排班總表之編排與發布僅限護理長（陳慧倪）與醫師操作。');
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
  if (tab === 'scheduling') loadScheduleAdminData();
}

function initHrDefaults() {
  const today = new Date();
  const schDate = document.getElementById('sch-date');
  if (schDate) {
    schDate.value = today.toISOString().split('T')[0];
    schDate.onchange = () => {
      updateAdminShiftOptions();
      checkShiftCompliance();
    };
  }
}

// 根據星期動態更新指定班別（一三五：早班/中班，二四六：早班，日：休診；不標示時間）
function filterShiftsByDate(dateStr, selectElemId) {
  const selectElem = document.getElementById(selectElemId);
  if (!selectElem || !dateStr) return;

  const dateObj = new Date(dateStr);
  const dayOfWeek = dateObj.getDay(); // 0:日, 1:一, 2:二, 3:三, 4:四, 5:五, 6:六

  selectElem.innerHTML = '';

  if (dayOfWeek === 0) {
    const opt = document.createElement('option');
    opt.value = "";
    opt.innerText = "週日固定休診";
    selectElem.appendChild(opt);
    return;
  }

  // 篩選允許的班別
  let allowedShifts = [];
  if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
    // 星期一、三、五：早班、中班
    allowedShifts = cachedShifts.filter(s => s.shift_name.includes('早') || s.shift_name.includes('中'));
  } else {
    // 星期二、四、六：只有早班
    allowedShifts = cachedShifts.filter(s => s.shift_name.includes('早'));
  }

  // 若資料庫尚未設定對應班別，提供標準預設
  if (allowedShifts.length === 0) {
    allowedShifts = (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) 
      ? [{ id: 'morning', shift_name: '早班' }, { id: 'afternoon', shift_name: '中班' }]
      : [{ id: 'morning', shift_name: '早班' }];
  }

  allowedShifts.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    // 去除時間標示，純顯示班別名稱
    opt.innerText = s.shift_name.replace(/\s*\(.*?\)/g, '').trim();
    selectElem.appendChild(opt);
  });
}

function updateAdminShiftOptions() {
  const dateStr = document.getElementById('sch-date')?.value;
  filterShiftsByDate(dateStr, 'sch-shift-select');
}

function updateRequestShiftOptions() {
  const dateStr = document.getElementById('req-date')?.value;
  filterShiftsByDate(dateStr, 'req-shift-select');
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
    const rawShiftName = s.clinic_shifts?.shift_name || '常規班';
    const shiftName = rawShiftName.replace(/\s*\(.*?\)/g, '').trim(); // 不標示時間
    const row = document.createElement('div');
    row.className = "flex justify-between items-center bg-white p-2.5 rounded-lg border border-slate-200 text-xs";
    row.innerHTML = `
      <span class="font-bold text-slate-700">${s.date}</span>
      <span class="bg-indigo-100 text-indigo-800 font-bold px-2.5 py-0.5 rounded text-[11px]">${shiftName}</span>
    `;
    container.appendChild(row);
  });
}

// ==================== 每月 15 號預約排班 ====================
async function initRequestPage() {
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const nextMonthStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
  const reqMonth = document.getElementById('req-target-month');
  if (reqMonth) reqMonth.value = nextMonthStr;
  updateRequestMonthDays();

  const reqDate = document.getElementById('req-date');
  if (reqDate) {
    reqDate.onchange = updateRequestShiftOptions;
  }

  const currentDay = today.getDate();
  const deadlineTag = document.getElementById('request-deadline-tag');
  const submitBtn = document.getElementById('btn-submit-request');
  const isAdminUser = (currentUser.displayName === '陳慧倪' || currentUser.displayName === '林和正' || currentUser.role === 'doctor');

  if (currentDay > 15 && !isAdminUser) {
    if (deadlineTag) {
      deadlineTag.innerText = "⚠️ 護理師預約已於 15 號截止 (護理長排班整合中)";
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

  const { data: shifts } = await supabaseClient.from('clinic_shifts').select('*');
  cachedShifts = shifts || [];
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

// 預約提交與規則校驗
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
  const shiftId = reqType === 'off' ? null : document.getElementById('req-shift-select').value;
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
    shift_id: shiftId,
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
    const rawShiftName = r.clinic_shifts?.shift_name || '上班';
    const shiftName = rawShiftName.replace(/\s*\(.*?\)/g, '').trim();
    const shiftText = r.request_type === 'off' ? '🏖️ 預約休假' : `⭐ 希望班別: ${shiftName}`;
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

// ==================== 國定假日 9 大節日抽籤 ====================
async function runNationalHolidayLottery() {
  if (!confirm('確定由「一般護理師」進行全年度 9 大國定假日抽籤輪休？（每人均休一次後才重啟下一輪）')) return;

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

// ==================== 護理長排班管理 ====================
async function loadScheduleAdminData() {
  const { data: empData } = await supabaseClient.from('clinic_employees').select('*').eq('is_active', true);
  cachedEmployees = empData || [];

  const { data: shiftData } = await supabaseClient.from('clinic_shifts').select('*');
  cachedShifts = shiftData || [];

  const empSelect = document.getElementById('sch-emp-select');
  if (empSelect) {
    empSelect.innerHTML = '';
    cachedEmployees.forEach(e => {
      let roleLabel = '護理師';
      if (e.name === '林和正' || e.role === 'doctor') {
        roleLabel = '醫師'; // 修正林和正身份為醫師
      } else if (e.name === '陳慧倪') {
        roleLabel = '護理長';
      } else if (e.name === '盧明伶') {
        roleLabel = '門診藥事';
      }

      const deductionText = (e.sat_off_deduction > 0 && roleLabel === '護理師') ? ` (遲到扣休週六 ${e.sat_off_deduction}次)` : '';
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.innerText = `${e.name} (${roleLabel})${deductionText}`;
      empSelect.appendChild(opt);
    });
  }

  updateAdminShiftOptions();

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
  if (!schList) return;
  if (cachedAllSchedules.length === 0) {
    schList.innerHTML = '<p class="text-slate-400 text-center py-3">尚無排班紀錄</p>';
    return;
  }
  schList.innerHTML = '';
  cachedAllSchedules.forEach(s => {
    const empName = s.clinic_employees?.name || '未指定';
    const rawShiftName = s.clinic_shifts?.shift_name || '常規班';
    const shiftName = rawShiftName.replace(/\s*\(.*?\)/g, '').trim(); // 不標示時間
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

  if (warningDiv) warningDiv.classList.add('hidden');
  if (specialBox) specialBox.classList.add('hidden');
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.className = "w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm transition";
  }

  if (!dateStr || !empId || !shiftId) return;

  const targetEmp = cachedEmployees.find(e => e.id === empId);
  const empSchedules = cachedAllSchedules.filter(s => s.employee_id === empId);
  const curDate = new Date(dateStr);
  const dayOfWeek = curDate.getDay();

  if (dayOfWeek === 0) {
    if (warningDiv) {
      warningDiv.innerText = `⚠️ 提醒：診所每週日固定休診。`;
      warningDiv.classList.remove('hidden');
    }
  }

  if (targetEmp?.name === '陳慧倪' && (dayOfWeek === 0 || dayOfWeek === 6)) {
    if (warningDiv) {
      warningDiv.innerText = `⚠️ 提醒：護理長陳慧倪原則固定休週末（週六/週日）。`;
      warningDiv.classList.remove('hidden');
    }
  }

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
    if (warningDiv) {
      warningDiv.innerText = `🚨 違規警告：該同仁已連續出勤 ${consecutiveDays} 日！依四週變形工時不得連續工作超過 6 日。`;
      warningDiv.classList.remove('hidden');
    }
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.className = "w-full bg-slate-400 text-white font-bold py-2.5 rounded-xl text-xs cursor-not-allowed";
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
    alert('✅ 排班成功儲存！');
    loadScheduleAdminData();
  }
}
