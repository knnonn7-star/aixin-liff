/**
 * 愛欣診所 LINE 管理系統 - 主控制模組 (main.js)
 * 包含：LIFF 初始化、資料庫身分同步 (以 line_user_id 為準)、GPS 診所打卡、主選單導航
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

/**
 * 頂部即時時鐘
 */
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

/**
 * 取得 Supabase 實例
 */
function getSupabaseClient() {
  if (typeof window.supabaseClient !== 'undefined' && window.supabaseClient) return window.supabaseClient;
  if (typeof supabaseClient !== 'undefined' && supabaseClient) return supabaseClient;
  if (typeof supabase !== 'undefined' && supabase) return supabase;
  return null;
}

/**
 * 取得 LIFF ID
 */
function getTargetLiffId() {
  if (typeof window.LIFF_ID !== 'undefined' && window.LIFF_ID) return window.LIFF_ID;
  if (typeof LIFF_ID !== 'undefined' && LIFF_ID) return LIFF_ID;
  return '2011071479-1rEMTEv0';
}

/**
 * 初始化 LINE LIFF SDK
 */
async function initLiff() {
  const userNameElem = document.getElementById('user-name');
  
  try {
    if (typeof liff === 'undefined') {
      throw new Error('LIFF SDK 尚未載入');
    }

    const targetLiffId = getTargetLiffId();
    await liff.init({ liffId: targetLiffId });

    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    const profile = await liff.getProfile();
    currentUser.lineUserId = profile.userId;
    currentUser.displayName = profile.displayName;

    // 向 Supabase 同步員工身分
    await syncEmployeeRecord();

    // 載入當日打卡狀態
    await checkTodayAttendance();

  } catch (err) {
    console.error('LIFF 初始化失敗:', err);
    if (userNameElem) {
      userNameElem.innerText = '未連線 LINE / 訪客模式';
    }
  }
}

/**
 * 依 LINE User ID 向 Supabase 驗證身分（精確對應職稱）
 */
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

      // 依人員姓名與職務精確給予職稱顯示
      let displayTitle = '護理師';
      if (data.role === 'doctor' || data.name === '林和正' || data.name.includes('醫師')) {
        displayTitle = '醫師';
      } else if (data.name === '陳慧倪' || data.name === '陳惠倪') {
        displayTitle = '護理長';
      } else if (data.name === '曾憲敏') {
        displayTitle = '副護理長';
      } else if (data.name === '陳金暖') {
        displayTitle = '小組長';
      } else if (data.name === '盧明伶') {
        displayTitle = '護理人員 (常日班)';
      } else if (data.name === '涂春娥') {
        displayTitle = '行政正職';
      } else if (data.name === '胡月霞') {
        displayTitle = '清潔管理';
      } else if (data.role === 'admin') {
        displayTitle = '行政管理';
      }

      if (userNameElem) {
        userNameElem.innerText = `${currentUser.displayName} (${displayTitle})`;
      }
    } else {
      currentUser.empId = null;
      currentUser.role = 'guest';
      if (userNameElem) {
        userNameElem.innerText = `${currentUser.displayName || '使用者'} (未綁定)`;
      }
      alert(`⚠️ 您的 LINE 帳號尚未綁定！\n代碼：${currentUser.lineUserId}\n請將此代碼填入 Supabase clinic_employees 表。`);
    }
  } catch (err) {
    console.error('身分同步失敗:', err);
  }
}

// ==================== GPS 診所定位偵測 ====================
function getClinicLocation() {
  if (typeof window.CLINIC_LOCATION !== 'undefined') return window.CLINIC_LOCATION;
  if (typeof CLINIC_LOCATION !== 'undefined') return CLINIC_LOCATION;
  return {
    lat: 22.6309209,
    lng: 120.3392031,
    radiusMeters: 300
  };
}

function startGpsTracking() {
  const gpsElem = document.getElementById('gps-status');

  if (!navigator.geolocation) {
    if (gpsElem) {
      gpsElem.innerText = '❌ 不支援定位';
      gpsElem.className = 'bg-rose-200 text-rose-800 px-2 py-0.5 rounded-full text-[10px] font-bold';
    }
    return;
  }

  const clinicLoc = getClinicLocation();
  const radius = clinicLoc.radiusMeters || clinicLoc.radius || 300;

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
    { enableHighAccuracy: true, timeout: 8000 }
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

// ==================== 出勤打卡邏輯 ====================
async function checkTodayAttendance() {
  const summaryElem = document.getElementById('today-punch-summary');
  const client = getSupabaseClient();
  if (!currentUser.lineUserId || !summaryElem || !client) return;

  const todayStr = new Date().toISOString().split('T')[0];

  try {
    const { data, error } = await client
      .from('clinic_attendance')
      .select('punch_type, punch_time')
      .eq('line_user_id', currentUser.lineUserId)
      .gte('punch_time', `${todayStr}T00:00:00`)
      .lte('punch_time', `${todayStr}T23:59:59`)
      .order('punch_time', { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      summaryElem.innerText = '今日出勤：尚未打卡';
      return;
    }

    const inRecord = data.find(d => d.punch_type === 'in');
    const outRecord = [...data].reverse().find(d => d.punch_type === 'out');

    let text = '今日出勤：';
    if (inRecord) {
      const inTime = new Date(inRecord.punch_time).toTimeString().substring(0, 5);
      text += `上班 ${inTime} `;
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

async function punchAttendance(type) {
  const client = getSupabaseClient();
  if (!client) {
    alert('資料庫連線失敗，請稍候重試！');
    return;
  }

  const enforceGps = window.ENFORCE_GPS || false;
  if (enforceGps) {
    const clinicLoc = getClinicLocation();
    const radius = clinicLoc.radiusMeters || 300;

    if (!currentCoordinates) {
      alert('⚠️ 尚未取得 GPS 定位，請開啟手機定位！');
      return;
    }
    const dist = calculateDistance(currentCoordinates.lat, currentCoordinates.lng, clinicLoc.lat, clinicLoc.lng);
    if (dist > radius) {
      alert(`⚠️ 超出打卡範圍！目前距離診所約 ${Math.round(dist)} 公尺。`);
      return;
    }
  }

  const now = new Date();
  const typeName = type === 'in' ? '☀️ 上班' : '🌙 下班';
  if (!confirm(`確定要進行【${typeName}】打卡嗎？`)) return;

  try {
    const { error } = await client.from('clinic_attendance').insert([{
      line_user_id: currentUser.lineUserId || 'manual_user',
      employee_id: currentUser.empId || null,
      employee_name: currentUser.displayName || '診所同仁',
      punch_type: type,
      punch_time: now.toISOString(),
      lat: currentCoordinates ? currentCoordinates.lat : null,
      lng: currentCoordinates ? currentCoordinates.lng : null
    }]);

    if (error) throw error;

    alert(`🎉【${typeName}】打卡成功！`);
    await checkTodayAttendance();
  } catch (err) {
    console.error('打卡寫入失敗:', err);
    alert('打卡失敗：' + err.message);
  }
}

// ==================== 頁面導航與切換 ====================
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
}
