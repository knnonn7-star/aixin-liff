/**
 * 愛欣診所 LINE 管理系統 - 主控制模組 (main.js)
 * 包含：LIFF 初始化、身份識別、100m GPS 定位打卡、班表連動遲到判定、每日限制單次打卡
 */

// ==================== 全域狀態宣告 ====================
let currentUser = {
  lineUserId: '',
  displayName: '載入中...',
  empId: null,
  role: 'guest'
};

let currentCoordinates = null;
let gpsWatchId = null;

// ==================== 頁面載入與啟動 ====================
document.addEventListener('DOMContentLoaded', async () => {
  startClock();
  startGpsTracking();
  await initLiff();
});

function startClock() {
  const clockTimeElem = document.getElementById('clock-time');
  const clockDateElem = document.getElementById('clock-date');
  
  function update() {
    const now = new Date();
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    if (clockDateElem) {
      clockDateElem.innerText = `${now.getFullYear()} 年 ${String(now.getMonth() + 1).padStart(2, '0')} 月 ${String(now.getDate()).padStart(2, '0')} 日 (週${days[now.getDay()]})`;
    }
    if (clockTimeElem) {
      clockTimeElem.innerText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    }
  }
  update();
  setInterval(update, 1000);
}

function getSupabaseClient() {
  if (typeof window.supabaseClient !== 'undefined' && window.supabaseClient) return window.supabaseClient;
  if (typeof supabaseClient !== 'undefined' && supabaseClient) return supabaseClient;
  if (typeof supabase !== 'undefined' && supabase) return supabase;
  return null;
}

function getTargetLiffId() {
  return window.LIFF_ID || '2011071479-1rEMTEv0';
}

async function initLiff() {
  const userNameElem = document.getElementById('user-name');
  try {
    if (typeof liff === 'undefined') throw new Error('LIFF SDK 尚未載入');

    const targetLiffId = getTargetLiffId();
    await liff.init({ liffId: targetLiffId });

    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    const profile = await liff.getProfile();
    currentUser.lineUserId = profile.userId;
    currentUser.displayName = profile.displayName;

    await syncEmployeeRecord();
    await checkTodayAttendance();
  } catch (err) {
    console.error('LIFF 初始化失敗:', err);
    if (userNameElem) userNameElem.innerText = '未連線 LINE / 訪客模式';
  }
}

async function syncEmployeeRecord() {
  if (!currentUser.lineUserId) return;

  const userNameElem = document.getElementById('user-name');
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const { data, error } = await client
      .from('clinic_employees')
      .select('id, name, role, is_active')
      .eq('line_user_id', currentUser.lineUserId)
      .maybeSingle();

    if (error) throw error;

    if (data && data.is_active) {
      currentUser.empId = data.id;
      currentUser.displayName = data.name;
      currentUser.role = data.role;

      let displayTitle = '護理師';
      if (data.role === 'doctor' || data.name === '林和正') displayTitle = '醫師';
      else if (data.name === '陳慧倪' || data.name === '陳惠倪') displayTitle = '護理長';
      else if (data.name === '曾憲敏') displayTitle = '副護理長';
      else if (data.name === '陳金暖') displayTitle = '小組長';
      else if (data.name === '盧明伶') displayTitle = '門診藥事 (常日班)';
      else if (data.name === '涂春娥') displayTitle = '工作人員 (常日班)';
      else if (data.name === '胡月霞') displayTitle = '清潔人員 (常日班)';
      else if (data.role === 'admin') displayTitle = '行政管理';

      if (userNameElem) {
        userNameElem.innerText = `${currentUser.displayName} (${displayTitle})`;
      }
    } else {
      currentUser.empId = null;
      currentUser.role = 'guest';
      if (userNameElem) userNameElem.innerText = `${currentUser.displayName || '使用者'} (未綁定)`;
      alert(`⚠️ 您的 LINE 尚未綁定！\n代碼：${currentUser.lineUserId}\n請將此代碼設定於 clinic_employees。`);
    }
  } catch (err) {
    console.error('身分同步失敗:', err);
  }
}

// ==================== GPS 診所 100m 定位偵測 ====================
function getClinicLocation() {
  return window.CLINIC_LOCATION || {
    lat: 22.6309209,
    lng: 120.3392031,
    radiusMeters: 100 // 嚴格 100 公尺限制
  };
}

function startGpsTracking() {
  const gpsElem = document.getElementById('gps-status');
  if (!navigator.geolocation) {
    if (gpsElem) gpsElem.innerText = '❌ 不支援定位';
    return;
  }

  const clinicLoc = getClinicLocation();
  const radius = clinicLoc.radiusMeters || 100;

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      currentCoordinates = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };

      const dist = calculateDistance(
        currentCoordinates.lat,
        currentCoordinates.lng,
        clinicLoc.lat,
        clinicLoc.lng
      );

      if (gpsElem) {
        if (dist <= radius) {
          gpsElem.innerText = `📍 診所範圍內 (${Math.round(dist)}m)`;
          gpsElem.className = 'bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full text-[10px] font-bold';
        } else {
          gpsElem.innerText = `⚠️ 距離過遠 (${Math.round(dist)}m)`;
          gpsElem.className = 'bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full text-[10px] font-bold';
        }
      }
    },
    (err) => {
      if (gpsElem) gpsElem.innerText = '📍 未開啟定位';
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ==================== 出勤查詢與限制 ====================
async function checkTodayAttendance() {
  const summaryElem = document.getElementById('today-punch-summary');
  const client = getSupabaseClient();
  if (!currentUser.lineUserId || !summaryElem || !client) return;

  const todayStr = new Date().toISOString().split('T')[0];

  try {
    const { data, error } = await client
      .from('clinic_attendance')
      .select('*')
      .eq('line_user_id', currentUser.lineUserId)
      .gte('punch_time', `${todayStr}T00:00:00`)
      .lte('punch_time', `${todayStr}T23:59:59`)
      .order('punch_time', { ascending: true });

    if (error) throw error;

    const inRecord = data?.find(d => d.punch_type === 'in');
    const outRecord = data?.slice().reverse().find(d => d.punch_type === 'out');

    const btnIn = document.getElementById('btn-punch-in');
    const btnOut = document.getElementById('btn-punch-out');

    if (btnIn) {
      if (inRecord) {
        btnIn.disabled = true;
        btnIn.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
        btnIn.disabled = false;
        btnIn.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    }

    if (btnOut) {
      if (outRecord) {
        btnOut.disabled = true;
        btnOut.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
        btnOut.disabled = false;
        btnOut.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    }

    if (!data || data.length === 0) {
      summaryElem.innerText = '今日出勤：尚未打卡';
      return;
    }

    let text = '今日出勤：';
    if (inRecord) {
      const inTime = new Date(inRecord.punch_time).toTimeString().substring(0, 5);
      text += `上班 ${inTime} ${inRecord.is_late ? `(遲到${inRecord.late_minutes}分)` : '(準時)'} `;
    }
    if (outRecord) {
      const outTime = new Date(outRecord.punch_time).toTimeString().substring(0, 5);
      text += `| 下班 ${outTime}`;
    }
    summaryElem.innerText = text;
  } catch (err) {
    console.error('出勤紀錄讀取失敗:', err);
  }
}

// ==================== 執行打卡（班表連動與限制一次） ====================
async function punchAttendance(type) {
  const client = getSupabaseClient();
  if (!client) {
    alert('資料庫連線失敗，請稍候重試！');
    return;
  }

  if (!currentUser.lineUserId) {
    alert('⚠️ 身分驗證未通過，無法打卡！');
    return;
  }

  // 1. GPS 100m 嚴格檢查
  const clinicLoc = getClinicLocation();
  const radius = clinicLoc.radiusMeters || 100;

  if (!currentCoordinates) {
    alert('⚠️ 尚未取得 GPS 定位，請開啟手機定位權限並於診所範圍內打卡！');
    return;
  }

  const dist = calculateDistance(
    currentCoordinates.lat,
    currentCoordinates.lng,
    clinicLoc.lat,
    clinicLoc.lng
  );

  if (dist > radius) {
    alert(`❌ 打卡失敗！\n您目前距離診所約 ${Math.round(dist)} 公尺，超出規定範圍 (${radius} 公尺內)。`);
    return;
  }

  const todayStr = new Date().toISOString().split('T')[0];

  // 2. 檢查今天是否已打過此類型卡（單日限制一次）
  const { data: existRecords } = await client
    .from('clinic_attendance')
    .select('id, punch_time')
    .eq('line_user_id', currentUser.lineUserId)
    .eq('punch_type', type)
    .gte('punch_time', `${todayStr}T00:00:00`)
    .lte('punch_time', `${todayStr}T23:59:59`);

  if (existRecords && existRecords.length > 0) {
    const pTime = new Date(existRecords[0].punch_time).toTimeString().substring(0, 5);
    alert(`⚠️ 您今日已於 ${pTime} 完成【${type === 'in' ? '上班' : '下班'}】打卡，每天只能打卡一次！`);
    return;
  }

  // 3. 查詢今日班表以連動判斷上班遲到時間門檻
  let scheduledShiftName = '常規班';
  let limitHour = 8;
  let limitMinute = 0;

  const fixedStaffNames = ['盧明伶', '涂春娥', '胡月霞'];
  const isFixed = fixedStaffNames.includes(currentUser.displayName);

  if (isFixed) {
    limitHour = 8;
    limitMinute = 0;
    scheduledShiftName = '常日班 (08:00前)';
  } else {
    // 查詢透析護理師排班表
    const { data: schData } = await client
      .from('clinic_schedules')
      .select('shift_name, hours')
      .eq('employee_id', currentUser.empId || '00000000-0000-0000-0000-000000000000')
      .eq('date', todayStr)
      .maybeSingle();

    if (schData && schData.shift_name) {
      scheduledShiftName = schData.shift_name;
      if (scheduledShiftName.includes('開門')) {
        limitHour = 6;
        limitMinute = 0;
      } else if (scheduledShiftName.includes('晚')) {
        limitHour = 15;
        limitMinute = 0;
      } else {
        // 一般白班
        limitHour = 7;
        limitMinute = 0;
      }
    } else {
      // 若無特別排班設定，預設門檻為 08:00
      limitHour = 8;
      limitMinute = 0;
      scheduledShiftName = '常規/未排班 (08:00前)';
    }
  }

  const now = new Date();
  let isLate = false;
  let lateMinutes = 0;

  if (type === 'in') {
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const limitMins = limitHour * 60 + limitMinute;

    if (currentMins > limitMins) {
      isLate = true;
      lateMinutes = currentMins - limitMins;
    }
  }

  const typeName = type === 'in' ? '☀️ 上班' : '🌙 下班';
  if (!confirm(`確定要進行【${typeName}】打卡嗎？\n今日班別：${scheduledShiftName}`)) return;

  try {
    const { error } = await client.from('clinic_attendance').insert([{
      line_user_id: currentUser.lineUserId,
      employee_id: currentUser.empId || null,
      employee_name: currentUser.displayName,
      punch_type: type,
      punch_time: now.toISOString(),
      punch_date: todayStr,
      is_late: isLate,
      late_minutes: lateMinutes,
      scheduled_shift: scheduledShiftName,
      lat: currentCoordinates.lat,
      lng: currentCoordinates.lng
    }]);

    if (error) throw error;

    if (type === 'in') {
      if (isLate) {
        alert(`⚠️【${typeName}】打卡成功！\n注意：您本日班別為【${scheduledShiftName}】（標準應於 ${String(limitHour).padStart(2,'0')}:${String(limitMinute).padStart(2,'0')} 前），已遲到 ${lateMinutes} 分鐘。`);
      } else {
        alert(`🎉【${typeName}】打卡成功！準時出勤（班別：${scheduledShiftName}）。`);
      }
    } else {
      alert(`🎉【${typeName}】打卡成功！辛勞了。`);
    }

    await checkTodayAttendance();
  } catch (err) {
    console.error('打卡寫入失敗:', err);
    if (err.message.includes('idx_unique_daily_punch')) {
      alert(`⚠️ 您今日已完成過【${typeName}】打卡，無法重複打卡！`);
    } else {
      alert('打卡失敗：' + err.message);
    }
  }
}

// 頁面導航
function openMainSection(secKey) {
  document.getElementById('sec-main-home').classList.add('hidden');
  document.getElementById('sub-page-header').classList.remove('hidden');

  if (secKey === 'hr') {
    document.getElementById('sub-page-title').innerText = '🏢 人事管理系統';
    document.getElementById('sec-hr').classList.remove('hidden');
    document.getElementById('sec-finance').classList.add('hidden');
    if (typeof switchHrTab === 'function') switchHrTab('myschedule');
  } else if (secKey === 'finance') {
    document.getElementById('sub-page-title').innerText = '💰 帳務管理系統';
    document.getElementById('sec-finance').classList.remove('hidden');
    document.getElementById('sec-hr').classList.add('hidden');
    if (typeof switchFinTab === 'function') switchFinTab('register');
  }
}

function backToMainMenu() {
  document.getElementById('sub-page-header').classList.add('hidden');
  document.getElementById('sec-hr').classList.add('hidden');
  document.getElementById('sec-finance').classList.add('hidden');
  document.getElementById('sec-main-home').classList.remove('hidden');
  checkTodayAttendance();
}
