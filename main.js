/**
 * 愛欣診所 LINE 管理系統 - 主控制模組 (main.js)
 * 包含：LIFF 初始化、資料庫身分同步 (以 line_user_id 為準)、GPS定位打卡、頁面導航
 */

// ==================== 全域狀態宣告 ====================
let currentUser = {
  lineUserId: '',
  displayName: '載入中...',
  empId: null,
  role: 'guest' // 預設訪客身分，需透過資料庫驗證
};

let currentCoordinates = null;
let gpsWatchId = null;

// ==================== 頁面載入與 LIFF 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
  startClock();
  startGpsTracking();
  await initLiff();
});

/**
 * 啟動頂部即時時鐘
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
 * 初始化 LINE LIFF SDK
 */
async function initLiff() {
  const userNameElem = document.getElementById('user-name');
  
  try {
    if (typeof liff === 'undefined') {
      throw new Error('LIFF SDK 載入失敗');
    }

    await liff.init({ liffId: CONFIG.LIFF_ID });

    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    const profile = await liff.getProfile();
    currentUser.lineUserId = profile.userId;
    currentUser.displayName = profile.displayName;

    // 透過 LINE User ID 向 Supabase 同步真實員工資料與角色
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
 * 依 LINE User ID 向 Supabase 驗證身分與角色 (淘汰純姓名比對)
 */
async function syncEmployeeRecord() {
  if (!currentUser.lineUserId) return;

  const userNameElem = document.getElementById('user-name');

  try {
    const { data, error } = await supabaseClient
      .from('clinic_employees')
      .select('id, name, role, is_active')
      .eq('line_user_id', currentUser.lineUserId)
      .maybeSingle();

    if (error) throw error;

    if (data && data.is_active) {
      currentUser.empId = data.id;
      currentUser.displayName = data.name; // 以診所登錄的真實中文姓名為準
      currentUser.role = data.role;        // doctor / nurse / admin / counter

      const roleMap = {
        'doctor': '醫師',
        'nurse': '護理長/護理師',
        'admin': '管理員',
        'counter': '櫃台'
      };
      const roleLabel = roleMap[data.role] || data.role;

      if (userNameElem) {
        userNameElem.innerText = `${currentUser.displayName} (${roleLabel})`;
      }
    } else {
      currentUser.empId = null;
      currentUser.role = 'guest';
      if (userNameElem) {
        userNameElem.innerText = `${currentUser.displayName || '使用者'} (未綁定/訪客)`;
      }
      alert(`⚠️ 您的 LINE 帳號尚未完成員工綁定。\n您的 LINE ID 為：\n${currentUser.lineUserId}\n請將此代碼複製並提供給管理員設定。`);
    }
  } catch (err) {
    console.error('員工身分同步失敗:', err);
    if (userNameElem) {
      userNameElem.innerText = `${currentUser.displayName} (同步失敗)`;
    }
  }
}

// ==================== GPS 診所定位偵測 ====================
function startGpsTracking() {
  const gpsElem = document.getElementById('gps-status');

  if (!navigator.geolocation) {
    if (gpsElem) {
      gpsElem.innerText = '❌ 不支援定位';
      gpsElem.className = 'bg-rose-200 text-rose-800 px-2 py-0.5 rounded-full text-[10px] font-bold';
    }
    return;
  }

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      currentCoordinates = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };

      const dist = calculateDistance(
        currentCoordinates.lat,
        currentCoordinates.lng,
        CONFIG.CLINIC_LOCATION.lat,
        CONFIG.CLINIC_LOCATION.lng
      );

      if (gpsElem) {
        if (dist <= CONFIG.CLINIC_LOCATION.radius) {
          gpsElem.innerText = `📍 診所範圍內 (${Math.round(dist)}m)`;
          gpsElem.className = 'bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full text-[10px] font-bold';
        } else {
          gpsElem.innerText = `⚠️ 距離過遠 (${Math.round(dist)}m)`;
          gpsElem.className = 'bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full text-[10px] font-bold';
        }
      }
    },
    (err) => {
      console.warn('GPS 定位失敗:', err.message);
      if (gpsElem) {
        gpsElem.innerText = '📍 無法取得定位';
        gpsElem.className = 'bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full text-[10px] font-bold';
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// 計算兩點經緯度直線距離 (公尺)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// ==================== 出勤打卡邏輯 ====================
async function checkTodayAttendance() {
  const summaryElem = document.getElementById('today-punch-summary');
  if (!currentUser.lineUserId || !summaryElem) return;

  const todayStr = new Date().toISOString().split('T')[0];

  try {
    const { data, error } = await supabaseClient
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
    console.error('讀取出勤紀錄失敗:', err);
  }
}

async function punchAttendance(type) {
  if (!currentUser.empId) {
    alert('⚠️ 您的身分未綁定診所員工資料，無法打卡！請聯繫管理員。');
    return;
  }

  // GPS 範圍檢查 (若開啟強制限制)
  if (CONFIG.ENFORCE_GPS) {
    if (!currentCoordinates) {
      alert('⚠️ 尚未取得您的定位資訊，請開啟手機 GPS 後重試。');
      return;
    }
    const dist = calculateDistance(
      currentCoordinates.lat,
      currentCoordinates.lng,
      CONFIG.CLINIC_LOCATION.lat,
      CONFIG.CLINIC_LOCATION.lng
    );
    if (dist > CONFIG.CLINIC_LOCATION.radius) {
      alert(`⚠️ 打卡失敗！您目前距離診所約 ${Math.round(dist)} 公尺，超出打卡範圍 (${CONFIG.CLINIC_LOCATION.radius}m)。`);
      return;
    }
  }

  const typeName = type === 'in' ? '☀️ 上班' : '🌙 下班';
  if (!confirm(`確定要進行【${typeName}】打卡嗎？`)) return;

  try {
    const { error } = await supabaseClient.from('clinic_attendance').insert([{
      line_user_id: currentUser.lineUserId,
      employee_id: currentUser.empId,
      employee_name: currentUser.displayName,
      punch_type: type,
      punch_time: new Date().toISOString(),
      lat: currentCoordinates ? currentCoordinates.lat : null,
      lng: currentCoordinates ? currentCoordinates.lng : null
    }]);

    if (error) throw error;

    alert(`🎉【${typeName}】打卡成功！`);
    await checkTodayAttendance();
  } catch (err) {
    console.error('打卡失敗:', err);
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
