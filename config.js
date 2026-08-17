// ==================== 系統設定與常數 ====================
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

// 全域共用狀態
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
}

function updateClock() {
  const now = new Date();
  const dateElem = document.getElementById('clock-date');
  const timeElem = document.getElementById('clock-time');
  if (dateElem) dateElem.innerText = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日`;
  if (timeElem) timeElem.innerText = now.toTimeString().split(' ')[0];
}

// ==================== 主頁面切換與打卡 ====================
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

async function punchAttendance(type) {
  if (!currentGps.lat || !currentGps.lng) refreshGpsLocation();
  if (!currentUser.empId) await syncEmployeeRecord();
  
  const btn = document.getElementById(`btn-punch-${type}`);
  if (btn) btn.disabled = true;

  try {
    const nowTime = new Date();
    const isLate = (type === 'in' && (nowTime.getHours() > 8 || (nowTime.getHours() === 8 && nowTime.getMinutes() > 10)));

    const { error } = await supabaseClient.from('clinic_attendance').insert([{
      employee_id: currentUser.empId,
      punch_type: type,
      latitude: currentGps.lat,
      longitude: currentGps.lng,
      is_valid_location: true,
      is_late: isLate
    }]);

    if (error) throw error;

    if (isLate) {
      alert(`⚠️ 打卡成功（遲到提醒）！\n依診所規定：遲到將扣減 1 次週六休假資格。`);
      await supabaseClient.rpc('increment_sat_deduction', { emp_id: currentUser.empId });
    } else {
      alert(`✅ ${type === 'in' ? '上班' : '下班'}打卡成功！\n時間：${nowTime.toLocaleTimeString('zh-TW')}`);
    }
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
