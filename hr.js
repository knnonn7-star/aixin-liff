// ==================== 人事排班模組 ====================
let cachedEmployees = [];
let cachedShifts = [];
let cachedAllSchedules = [];

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

function switchHrTab(tab) {
  if (tab === 'scheduling' && currentUser.displayName !== '陳慧倪' && currentUser.displayName !== '林和正') {
    alert('🔒 權限受限：全院排班發布與管理由護理長（陳慧倪）統一負責。');
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
  if (schDate) schDate.value = today.toISOString().split('T')[0];
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
}

async function initRequestPage() {
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const nextMonthStr = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
  const reqMonth = document.getElementById('req-target-month');
  if (reqMonth) reqMonth.value = nextMonthStr;
  updateRequestMonthDays();

  const currentDay = today.getDate();
  const deadlineTag = document.getElementById('request-deadline-tag');
  const submitBtn = document.getElementById('btn-submit-request');
  const isHeadNurse = (currentUser.displayName === '陳慧倪' || currentUser.displayName === '林和正');

  if (currentDay > 15 && !isHeadNurse) {
    if (deadlineTag) {
      deadlineTag.innerText = "⚠️ 預約已於 15 號截止 (轉交護理長整合中)";
      deadlineTag.className = "bg-rose-100 text-rose-800 text-[10px] px-2 py-0.5 rounded font-bold";
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerText = "🔒 預約已於 15 號截止 (月底前由護理長公布)";
      submitBtn.className = "w-full bg-slate-400 text-white font-bold py-2.5 rounded-xl text-xs cursor-not-allowed";
    }
  } else {
    if (deadlineTag) {
      deadlineTag.innerText = currentDay <= 15 ? `距離 15 號截止還剩 ${15 - currentDay} 天` : `護理長特別編輯模式`;
      deadlineTag.className = "bg-indigo-200 text-indigo-800 text-[10px] px-2 py-0.5 rounded font-bold";
    }
    if (submitBtn) {
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
  }
}

document.getElementById('schedule-request-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser.empId) await syncEmployeeRecord();

  if (currentUser.displayName === '盧明伶') {
    const isSpecialOff = confirm('盧明伶護理師固定支援門診藥事與週六加班。\n是否確定登記為個人特休？');
    if (!isSpecialOff) return;
  }

  const targetMonth = document.getElementById('req-target-month').value;
  const reqDate = document.getElementById('req-date').value;
  const reqType = document.getElementById('req-type').value;
  const shiftId = reqType === 'off' ? null : document.getElementById('req-shift-select').value;
  const reason = document.getElementById('req-reason').value;

  const dateObj = new Date(reqDate);
  const dayOfWeek = dateObj.getDay();

  if (dayOfWeek === 0) {
    alert('⚠️ 愛欣診所每週日固定休診，無需登記休假！');
    return;
  }

  if (reqType === 'off') {
    const { data: myReqs } = await supabaseClient.from('clinic_schedule_requests')
      .select('*')
      .eq('employee_id', currentUser.empId)
      .eq('target_month', targetMonth)
      .eq('request_type', 'off');

    if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
      const mwfCount = (myReqs || []).filter(r => {
        const d = new Date(r.request_date).getDay();
        return (d === 1 || d === 3 || d === 5) && r.request_date !== reqDate;
      }).length;

      if (mwfCount >= 2 && currentUser.displayName !== '陳慧倪') {
        alert('🚨 預約超額：每位護理師每月「星期一、三、五」最多僅能預約 2 次休假！');
        return;
      }

      const { data: allDateReqs } = await supabaseClient.from('clinic_schedule_requests')
        .select('*')
        .eq('request_date', reqDate)
        .eq('request_type', 'off');

      if (allDateReqs && allDateReqs.length >= 2) {
        alert(`🚨 額滿警示：${reqDate} (週${dayOfWeek===1?'一':(dayOfWeek===3?'三':'五')}) 已有 2 位同仁預約休假，請選擇其他日期！`);
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
    alert('送出失敗：' + error.message);
  } else {
    alert('✅ 排班需求登記成功！護理長將於月底前整合並發布班表。');
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

async function runNationalHolidayLottery() {
  if (!confirm('確定由一般護理師進行全年度 9 大國定假日公平抽籤輪休嗎？')) return;

  const { data: regularNurses } = await supabaseClient.from('clinic_employees')
    .select('*')
    .eq('is_active', true)
    .not('name', 'in', '("陳慧倪","盧明伶")');

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
    alert('🎉 2026 年度 9 大國定假日抽籤已完成並存檔！');
  }
}

async function loadScheduleAdminData() {
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
      opt.innerText = `${e.name} (${e.name === '陳慧倪' ? '護理長' : (e.name === '盧明伶' ? '門診藥事' : '護理師')})`;
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

  if (warningDiv) warningDiv.classList.add('hidden');
  if (specialBox) specialBox.classList.add('hidden');
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.className = "w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-sm transition";
  }

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
    if (warningDiv) {
      warningDiv.innerText = `🚨 違規警告：該同仁已連續出勤 ${consecutiveDays} 日！依勞基法四週變形工時不得連續工作超過 6 日。`;
      warningDiv.classList.remove('hidden');
    }
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.className = "w-full bg-slate-400 text-white font-bold py-2.5 rounded-xl text-xs cursor-not-allowed";
    }
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
      if (warningDiv) {
        warningDiv.innerText = `🚨 強制違規：與前一日班別間隔僅 ${intervalHours.toFixed(1)} 小時，小於法定下限 8 小時，禁止排班！`;
        warningDiv.classList.remove('hidden');
      }
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.className = "w-full bg-slate-400 text-white font-bold py-2.5 rounded-xl text-xs cursor-not-allowed";
      }
    } else if (intervalHours < 11) {
      if (specialBox) specialBox.classList.remove('hidden');
      if (warningDiv) {
        warningDiv.innerText = `⚠️ 提醒：與前日班別間隔為 ${intervalHours.toFixed(1)} 小時（小於11小時），需勾選並註記「緊急透析/教育訓練」事由。`;
        warningDiv.classList.remove('hidden');
      }
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
