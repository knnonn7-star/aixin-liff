/**
 * 愛欣診所 - 打卡出勤模組 (attendance.js)
 * 修正重點：
 * 1. 強化 GPS 定位精度 (enableHighAccuracy + 排除快取)。
 * 2. 修正時區判定 (鎖定 Asia/Taipei GMT+8，解決清晨跨日查詢未歸零問題)。
 */

// =======================
// 1. 診所基礎參數設定
// =======================
const ATTENDANCE_CONFIG = {
  // 請確認填入診所正確經緯度 (緯度 Latitude, 經度 Longitude)
  CLINIC_LAT: 22.628000, // 範例：請替換為診所實際緯度
  CLINIC_LNG: 120.315000, // 範例：請替換為診所實際經度
  MAX_ALLOWED_DISTANCE_METERS: 300, // 允許打卡半徑 (公尺)
  TIMEZONE: 'Asia/Taipei'
};

// =======================
// 2. 工具函式：時區與距離計算
// =======================

/**
 * 取得台灣時間當日的起訖 ISO 字串 (避免 UTC 跨日 8 小時偏差)
 */
function getTaipeiDayRange() {
  const now = new Date();
  
  // 格式化出 YYYY-MM-DD (台灣時區)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ATTENDANCE_CONFIG.TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const localDateStr = formatter.format(now); // 例："2026-08-17"

  // 建立當日 00:00:00 與 23:59:59 的完整 ISO 時間
  const startOfDay = new Date(`${localDateStr}T00:00:00+08:00`).toISOString();
  const endOfDay = new Date(`${localDateStr}T23:59:59.999+08:00`).toISOString();

  return { localDateStr, startOfDay, endOfDay };
}

/**
 * Haversine 公式計算兩點球面距離 (公尺)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // 地球半徑 (公尺)
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * 強制取得高精度 GPS 定位
 */
function getPreciseCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error('此瀏覽器或裝置不支援 GPS 定位功能'));
    }

    const options = {
      enableHighAccuracy: true, // 強制啟用 GPS 晶片高精度模式
      timeout: 12000,           // 超時時間 12 秒
      maximumAge: 0             // 禁止讀取快取舊位置
    };

    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position.coords),
      (error) => {
        let msg = '無法取得定位資訊';
        if (error.code === error.PERMISSION_DENIED) msg = '請允許瀏覽器/LINE 存取精確位置權限';
        if (error.code === error.POSITION_UNAVAILABLE) msg = 'GPS 訊號弱或無法取得';
        if (error.code === error.TIMEOUT) msg = '定位逾時，請至收訊良好處重試';
        reject(new Error(msg));
      },
      options
    );
  });
}

// =======================
// 3. 資料庫操作與介面更新
// =======================

/**
 * 載入並刷新「今日打卡次數」與「最後打卡狀態」
 */
async function refreshTodayAttendanceStatus(userId) {
  const countTextEl = document.getElementById('today-punch-count');
  if (!countTextEl) return;

  try {
    const { startOfDay, endOfDay } = getTaipeiDayRange();

    // 依台灣時間當日區間向 Supabase 查詢
    const { data: logs, error } = await supabase
      .from('attendance_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const count = logs ? logs.length : 0;

    if (count === 0) {
      countTextEl.innerHTML = `今日已打卡 <strong>0</strong> 次`;
    } else {
      const lastRecord = logs[logs.length - 1];
      const timeStr = new Date(lastRecord.created_at).toLocaleTimeString('zh-TW', {
        timeZone: ATTENDANCE_CONFIG.TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      const typeStr = lastRecord.type === 'check_in' ? '上班' : '下班';
      countTextEl.innerHTML = `今日已打卡 <strong>${count}</strong> 次 (最後：${typeStr} ${timeStr})`;
    }
  } catch (err) {
    console.error('查詢今日打卡失敗:', err);
    countTextEl.innerText = '打卡紀錄讀取失敗';
  }
}

/**
 * 更新頂端距離顯示標籤
 */
async function updateDistanceBadge() {
  const badgeEl = document.getElementById('distance-badge');
  if (!badgeEl) return null;

  try {
    const coords = await getPreciseCurrentPosition();
    const distance = calculateDistance(
      coords.latitude,
      coords.longitude,
      ATTENDANCE_CONFIG.CLINIC_LAT,
      ATTENDANCE_CONFIG.CLINIC_LNG
    );

    badgeEl.innerText = `📍 距離診所約 ${distance} 公尺`;
    if (distance <= ATTENDANCE_CONFIG.MAX_ALLOWED_DISTANCE_METERS) {
      badgeEl.style.backgroundColor = 'rgba(16, 185, 129, 0.2)'; // 綠色
    } else {
      badgeEl.style.backgroundColor = 'rgba(239, 68, 68, 0.2)'; // 紅色提示超出
    }

    return { coords, distance };
  } catch (err) {
    badgeEl.innerText = `📍 ${err.message}`;
    return null;
  }
}

/**
 * 執行打卡動作 (上班 / 下班)
 */
async function handlePunch(type, userId, userName) {
  const btnIn = document.getElementById('btn-clock-in');
  const btnOut = document.getElementById('btn-clock-out');

  // 防止重複點擊
  if (btnIn) btnIn.disabled = true;
  if (btnOut) btnOut.disabled = true;

  try {
    // 1. 取得當下精準定位
    const coords = await getPreciseCurrentPosition();
    const distance = calculateDistance(
      coords.latitude,
      coords.longitude,
      ATTENDANCE_CONFIG.CLINIC_LAT,
      ATTENDANCE_CONFIG.CLINIC_LNG
    );

    // 2. 距離防護驗證
    if (distance > ATTENDANCE_CONFIG.MAX_ALLOWED_DISTANCE_METERS) {
      alert(`打卡失敗：距離診所過遠 (${distance} 公尺)\n請確認已開啟精確定位並處於診所範圍內。`);
      return;
    }

    // 3. 寫入 Supabase
    const { error } = await supabase.from('attendance_logs').insert([
      {
        user_id: userId,
        user_name: userName,
        type: type, // 'check_in' 或 'check_out'
        latitude: coords.latitude,
        longitude: coords.longitude,
        distance_meters: distance,
        created_at: new Date().toISOString()
      }
    ]);

    if (error) throw error;

    alert(`打卡成功！(${type === 'check_in' ? '上班' : '下班'}) 距離：${distance} 公尺`);

    // 4. 刷新今日次數與距離標籤
    await refreshTodayAttendanceStatus(userId);
    await updateDistanceBadge();

  } catch (err) {
    alert(`打卡異常: ${err.message}`);
  } finally {
    if (btnIn) btnIn.disabled = false;
    if (btnOut) btnOut.disabled = false;
  }
}

// =======================
// 4. 初始化與事件綁定
// =======================
function initAttendanceModule(currentUser) {
  if (!currentUser || !currentUser.userId) {
    console.error('未取得當前使用者資訊');
    return;
  }

  // 1. 初次載入定位與今日次數
  updateDistanceBadge();
  refreshTodayAttendanceStatus(currentUser.userId);

  // 2. 綁定按鈕事件
  const btnIn = document.getElementById('btn-clock-in');
  const btnOut = document.getElementById('btn-clock-out');

  if (btnIn) {
    btnIn.onclick = () => handlePunch('check_in', currentUser.userId, currentUser.displayName);
  }
  if (btnOut) {
    btnOut.onclick = () => handlePunch('check_out', currentUser.userId, currentUser.displayName);
  }
}
