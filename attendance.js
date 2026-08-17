/**
 * 愛欣診所 - 核心邏輯 (app.js)
 * 正確診所座標：(22.6309209, 120.3392031)
 */
const LIFF_ID = '2011071479-1rEMTEv0'; 
const SUPABASE_URL = 'https://bvbknaaljuwxrzvoqcrt.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_fPdr9TBzrw9Ycb6GEpF7UA_zeLqblfo'; 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 📍 愛欣診所正確經緯度基準點
const CLINIC_LOCATION = {
  lat: 22.6309209,   // 診所精確緯度
  lng: 120.3392031,  // 診所精確經度
  radiusMeters: 300  // 允許打卡半徑：300 公尺以內
};

let currentUser = { lineUserId: '', displayName: '林和正', empId: null };
let currentGps = { lat: null, lng: null };

// Haversine 距離計算演算法 (公尺)
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c);
}

// 台灣時區 (GMT+8) 當日時間區間
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
  return { startOfDay, endOfDay };
}

// 取得 GPS 定位
function refreshGpsLocation() {
  if (!navigator.geolocation) {
    const statusElem = document.getElementById('gps-status');
    if (statusElem) statusElem.innerText = "⚠️ 裝置不支援定位";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      currentGps.lat = pos.coords.latitude;
      currentGps.lng = pos.coords.longitude;
      
      const dist = getDistanceInMeters(currentGps.lat, currentGps.lng, CLINIC_LOCATION.lat, CLINIC_LOCATION.lng);
      const statusElem = document.getElementById('gps-status');
      if (statusElem) {
        if (dist <= CLINIC_LOCATION.radiusMeters) {
          statusElem.innerText = `📍 診所範圍內 (${dist}m)`;
          statusElem.className = "bg-emerald-800/80 px-2 py-0.5 rounded-full text-[10px] text-emerald-200";
        } else {
          statusElem.innerText = `📍 距離診所約 ${dist} 公尺`;
          statusElem.className = "bg-amber-800/80 px-2 py-0.5 rounded-full text-[10px] text-amber-200";
        }
      }
    },
    err => {
      const statusElem = document.getElementById('gps-status');
      if (statusElem) statusElem.innerText = "⚠️ 請開啟定位權限";
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// 更新即時時鐘
function updateClock() {
  const now = new Date();
  const dateElem = document.getElementById('clock-date');
  const timeElem = document.getElementById('clock-time');
  if (dateElem) {
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    dateElem.innerText = `${y} 年 ${m} 月 ${d} 日`;
  }
  if (timeElem) {
    timeElem.innerText = now.toTimeString().split(' ')[0];
  }
}

// 載入當日打卡狀態
async function loadTodayAttendance() {
  const summary = document.getElementById('today-punch-summary');
  if (!summary) return;

  try {
    const { startOfDay, endOfDay } = getTaipeiDayRange();
    const { data, error } = await supabaseClient
      .from('clinic_attendance')
      .select('*')
      .eq('user_name', currentUser.displayName)
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay)
      .order('created_at', { ascending: true });

    if (error || !data || data.length === 0) {
      summary.innerText = "今日打卡 0 次";
      return;
    }

    const last = data[data.length - 1];
    const tStr = new Date(last.created_at).toLocaleTimeString('zh-TW', {
      timeZone: 'Asia/Taipei',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    summary.innerHTML = `今日已打卡 <strong>${data.length}</strong> 次 (最後：${last.punch_type === 'in' ? '上班' : '下班'} ${tStr})`;
  } catch (e) {
    summary.innerText = "今日打卡 0 次";
  }
}

// 執行打卡動作
async function punchAttendance(type) {
  if (!currentGps.lat || !currentGps.lng) {
    alert("⚠️ 尚未取得 GPS 定位，請確認 iPad 定位權限已開啟！");
    refreshGpsLocation();
    return;
  }

  const dist = getDistanceInMeters(currentGps.lat, currentGps.lng, CLINIC_LOCATION.lat, CLINIC_LOCATION.lng);
  if (dist > CLINIC_LOCATION.radiusMeters) {
    alert(`❌ 打卡失敗！\n目前距離診所約 ${dist} 公尺，超出打卡允許範圍 (${CLINIC_LOCATION.radiusMeters}m 內)。`);
    return;
  }

  const btn = document.getElementById(`btn-punch-${type}`);
  if (btn) btn.disabled = true;

  try {
    const { error } = await supabaseClient.from('clinic_attendance').insert([{
      user_name: currentUser.displayName,
      line_user_id: currentUser.lineUserId || 'WEB_USER',
      punch_type: type,
      latitude: currentGps.lat,
      longitude: currentGps.lng,
      distance_meters: dist,
      created_at: new Date().toISOString()
    }]);

    if (error) throw error;

    alert(`✅ ${type === 'in' ? '上班' : '下班'}打卡成功！\n距離診所：${dist} 公尺`);
    await loadTodayAttendance();
  } catch (err) {
    alert('打卡失敗：' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// LIFF 初始化
async function initLiff() {
  setInterval(updateClock, 1000);
  updateClock();
  refreshGpsLocation();

  try {
    await liff.init({ liffId: LIFF_ID });
    if (liff.isLoggedIn()) {
      const profile = await liff.getProfile();
      currentUser.lineUserId = profile.userId;
      currentUser.displayName = profile.displayName;
      const userElem = document.getElementById('user-name');
      if (userElem) userElem.innerText = currentUser.displayName;
    }
  } catch (err) {
    console.log("LIFF Init 訪客或離線模式");
  }

  await loadTodayAttendance();
}

initLiff();
