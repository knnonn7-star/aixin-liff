// ==================== 系統全域變數 ====================
let currentUser = { lineUserId: '', displayName: '林和正', empId: null, role: 'doctor' };
let currentGps = { lat: null, lng: null };

// ==================== 基礎工具與定位 ====================
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

// 封裝 GPS 定位等待，確保取得最新座標
function getCurrentPositionPromise() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("此裝置或瀏覽器不支援 GPS 定位"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve(pos),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

async function refreshGpsLocation() {
  const statusElem = document.getElementById('gps-status');
  try {
    const pos = await getCurrentPositionPromise();
    currentGps.lat = pos.coords.latitude;
    currentGps.lng = pos.coords.longitude;
    const dist = getDistanceInMeters(currentGps.lat, currentGps.lng, CLINIC_LOCATION.lat, CLINIC_LOCATION.lng);
    
    if (statusElem) {
      if (dist <= CLINIC_LOCATION.radiusMeters) {
        statusElem.innerText = `📍 診所範圍內 (${Math.round(dist)}m)`;
        statusElem.className = "bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full text-[10px] font-bold";
      } else {
        statusElem.innerText = `📍 距離過遠 (${Math.round(dist)}m)`;
        statusElem.className = "bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full text-[10px] font-bold";
      }
    }
    return { lat: currentGps.lat, lng: currentGps.lng, dist };
  } catch (err) {
    if (statusElem) {
      statusElem.innerText = "📍 請開啟精確定位權限";
      statusElem.className = "bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full text-[10px] font-bold";
    }
    throw err;
  }
}

function updateClock() {
  const now = new Date();
  const dateElem = document.getElementById('clock-date');
  const timeElem = document.getElementById('clock-time');
  if (dateElem) dateElem.innerText = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
  if (timeElem) timeElem.innerText = now.toTimeString().split(' ')[0];
}

// ==================== 主頁面切換 ====================
function openMainSection(section) {
  document.getElementById('sec-main-home')?.classList.add('hidden');
  document.getElementById('sub-page-header')?.classList.remove('hidden');

  const titles = { 'hr': '🏢 人事管理系統', 'finance': '💰 帳務管理系統' };
  const titleElem = document.getElementById('sub-page-title');
  if (titleElem) titleElem.innerText = titles[section] || '';

  document.getElementById('sec-hr')?.classList.add('hidden');
  document.getElementById('sec-finance')?.classList.add('hidden');
  document.getElementById(`sec-${section}`)?.classList.remove('hidden');

  if (section === 'hr' && typeof initHrDefaults === 'function') {
    loadMySchedule();
    initHrDefaults();
  }
  if (section === 'finance' && typeof initFinanceDefaults === 'function') {
    initFinanceDefaults();
  }
}

function backToMainMenu() {
  document.getElementById('sec-hr')?.classList.add('hidden');
  document.getElementById('sec-finance')?.classList.add('hidden');
  document.getElementById('sub-page-header')?.classList.add('hidden');
  document.getElementById('sec-main-home')?.classList.remove('hidden');
  loadTodayAttendance();
}

async function syncEmployeeRecord() {
  try {
    const { data } = await supabaseClient.from('clinic_employees').select('*').eq('name', currentUser.displayName);
    if (data && data.length > 0) {
      currentUser.empId = data[0].id;
      currentUser.role = data[0].role;
    }
  } catch (e) {
    console.warn('同步員工資料略過:', e);
  }
}

// ==================== 打卡核心邏輯 ====================
async function punchAttendance(type) {
  const btn = document.getElementById(`btn-punch-${type}`);
  if (btn) btn.disabled = true;

  try {
    const statusElem = document.getElementById('gps-status');
    if (statusElem) statusElem.innerText = '📍 取得即時定位中...';
    
    // 1. 等待 GPS 取得當前位置
    const locationData = await refreshGpsLocation();
    
    // 2. 檢查距離是否在診所範圍內
    if (locationData.dist > CLINIC_LOCATION.radiusMeters) {
      alert(`❌ 打卡失敗！\n您目前距離愛欣診所約 ${Math.round(locationData.dist)} 公尺。\n超出允許打卡範圍 (${CLINIC_LOCATION.radiusMeters} 公尺)。`);
      return;
    }

    // 3. 確認員工身分
    if (!currentUser.empId) await syncEmployeeRecord();

    const nowTime = new Date();
    const isLate = (type === 'in' && (nowTime.getHours() > 8 || (nowTime.getHours() === 8 && nowTime.getMinutes() > 10)));

    // 4. 寫入資料庫
    const { error } = await supabaseClient.from('clinic_attendance').insert([{
      employee_id: currentUser.empId,
      punch_type: type,
      latitude: locationData.lat,
      longitude: locationData.lng,
      is_valid_location: true,
      is_late: isLate
    }]);

    if (error) throw error;

    if (isLate) {
      alert(`⚠️ 打卡成功（遲到提醒）！\n時間：${nowTime.toLocaleTimeString('zh-TW')}\n依診所規定：遲到將扣減 1 次週六休假資格。`);
      try {
        await supabaseClient.rpc('increment_sat_deduction', { emp_id: currentUser.empId });
      } catch (rpcErr) {
        console.warn('RPC 略過:', rpcErr);
      }
    } else {
      alert(`✅ ${type === 'in' ? '上班' : '下班'}打卡成功！\n時間：${nowTime.toLocaleTimeString('zh-TW')}`);
    }

    await loadTodayAttendance();
  } catch (err) {
    console.error(err);
    alert('打卡失敗：' + (err.message || '無法取得 GPS 定位，請確認手機設定已允許 LINE 取用精確位置。'));
  } finally {
    if (btn) btn.disabled = false;
  }
}

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

    if (currentUser.empId) query = query.eq('employee_id', currentUser.empId);

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

// ==================== 全系統啟動入口 ====================
async function initLiff() {
  setInterval(updateClock, 1000);
  updateClock();

  refreshGpsLocation().catch(err => {
    console.warn('初始定位等待打卡觸發:', err);
  });

  const userElem = document.getElementById('user-name');

  try {
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    const profile = await liff.getProfile();
    currentUser.lineUserId = profile.userId;
    currentUser.displayName = profile.displayName;

    if (userElem) userElem.innerText = currentUser.displayName;

    await syncEmployeeRecord();
    await loadTodayAttendance();
  } catch (err) {
    currentUser.displayName = "林和正";
    if (userElem) userElem.innerText = currentUser.displayName;
    await syncEmployeeRecord();
    await loadTodayAttendance();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLiff);
} else {
  initLiff();
}
