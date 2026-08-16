const LIFF_ID = '2011071479-1rEMTEv0';
const SUPABASE_URL = 'https://bvbknaaljuwxrzvoqcrt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fPdr9TBzrw9Ycb6GEpF7UA_zeLqblfo';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CLINIC_LOCATION = { lat: 22.6273, lng: 120.3014, radiusMeters: 100 };
let currentUser = { lineUserId: '', displayName: '匿名同仁', empId: null };
let currentGps = { lat: null, lng: null };

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180, Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*(Math.sin(Δλ/2)**2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function openMainSection(section) {
  document.getElementById('sec-main-home').classList.add('hidden');
  document.getElementById('sub-page-header').classList.remove('hidden');
  const titles = { 'hr': '🏢 人事管理系統', 'finance': '💰 帳務管理系統' };
  document.getElementById('sub-page-title').innerText = titles[section];
  document.getElementById('sec-hr').classList.add('hidden');
  document.getElementById('sec-finance').classList.add('hidden');
  document.getElementById(`sec-${section}`).classList.remove('hidden');

  if (section === 'hr') { loadMySchedule(); initHrDefaults(); }
  if (section === 'finance') { initFinanceDefaults(); }
}

function backToMainMenu() {
  document.getElementById('sec-hr').classList.add('hidden');
  document.getElementById('sec-finance').classList.add('hidden');
  document.getElementById('sub-page-header').classList.add('hidden');
  document.getElementById('sec-main-home').classList.remove('hidden');
  loadTodayAttendance();
}

async function initLiff() {
  setInterval(updateClock, 1000);
  updateClock();

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        currentGps.lat = pos.coords.latitude;
        currentGps.lng = pos.coords.longitude;
        const dist = getDistanceInMeters(currentGps.lat, currentGps.lng, CLINIC_LOCATION.lat, CLINIC_LOCATION.lng);
        const statusElem = document.getElementById('gps-status');
        if (statusElem) {
          if (dist <= CLINIC_LOCATION.radiusMeters) {
            statusElem.innerText = "📍 GPS 就緒 (診所範圍內)";
            statusElem.className = "bg-emerald-800/80 px-2 py-0.5 rounded-full text-[10px] text-emerald-200";
          } else {
            statusElem.innerText = `📍 距離診所約 ${Math.round(dist)} 公尺`;
            statusElem.className = "bg-amber-800/80 px-2 py-0.5 rounded-full text-[10px] text-amber-200";
          }
        }
      },
      err => {
        const statusElem = document.getElementById('gps-status');
        if (statusElem) statusElem.innerText = "📍 診所標準打卡";
      }
    );
  }

  try {
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) {
      liff.login();
    } else {
      const profile = await liff.getProfile();
      currentUser.lineUserId = profile.userId;
      currentUser.displayName = profile.displayName;
      const userElem = document.getElementById('user-name');
      if (userElem) userElem.innerText = currentUser.displayName;
      await syncEmployeeRecord();
      loadTodayAttendance();
    }
  } catch (err) {
    const userElem = document.getElementById('user-name');
    if (userElem) userElem.innerText = "林和正 (測試模式)";
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
  const { data } = await supabaseClient.from('clinic_employees').select('*').eq('name', currentUser.displayName);
  if (data && data.length > 0) currentUser.empId = data[0].id;
}

async function punchAttendance(type) {
  if (!currentUser.empId) await syncEmployeeRecord();
  if (!currentGps.lat || !currentGps.lng) {
    alert("⚠️ 無法取得 GPS 定位，請開啟手機定位權限！");
    return;
  }
  const dist = getDistanceInMeters(currentGps.lat, currentGps.lng, CLINIC_LOCATION.lat, CLINIC_LOCATION.lng);
  if (dist > CLINIC_LOCATION.radiusMeters) {
    alert(`❌ 打卡失敗！目前距離診所約 ${Math.round(dist)} 公尺，超出允許範圍 (${CLINIC_LOCATION.radiusMeters}m 內)。`);
    return;
  }

  const btn = document.getElementById(`btn-punch-${type}`);
  if (btn) btn.disabled = true;

  const { error } = await supabaseClient.from('clinic_attendance').insert([{
    employee_id: currentUser.empId,
    punch_type: type,
    latitude: currentGps.lat,
    longitude: currentGps.lng,
    is_valid_location: true
  }]);

  if (btn) btn.disabled = false;
  if (error) alert('打卡失敗：' + error.message);
  else {
    alert(`✅ ${type === 'in' ? '上班' : '下班'}打卡成功！\n時間：${new Date().toLocaleTimeString('zh-TW')}`);
    loadTodayAttendance();
  }
}

async function loadTodayAttendance() {
  if (!currentUser.empId) return;
  const todayStr = new Date().toISOString().split('T')[0];
  const { data } = await supabaseClient.from('clinic_attendance')
    .select('*').eq('employee_id', currentUser.empId)
    .gte('punch_time', `${todayStr}T00:00:00`).lte('punch_time', `${todayStr}T23:59:59`)
    .order('punch_time', { ascending: true });

  const summary = document.getElementById('today-punch-summary');
  if (summary) {
    if (data && data.length > 0) {
      const last = data[data.length - 1];
      const tStr = new Date(last.punch_time).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
      summary.innerText = `今日已打卡 ${data.length} 次 (最後：${last.punch_type === 'in' ? '上班' : '下班'} ${tStr})`;
    } else {
      summary.innerText = "今日出勤：尚未打卡";
    }
  }
}

initLiff();
