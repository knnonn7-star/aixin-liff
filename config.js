// ==================== 系統設定與常數 (config.js) ====================
const LIFF_ID = '2011071479-1rEMTEv0'; 
const SUPABASE_URL = 'https://bvbknaaljuwxrzvoqcrt.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_fPdr9TBzrw9Ycb6GEpF7UA_zeLqblfo'; 

// 初始化 Supabase Client
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 愛欣診所精確座標（高雄市苓雅區正義路136號）
const CLINIC_LOCATION = {
  lat: 22.6309209,
  lng: 120.3392031,
  radiusMeters: 300
};

// 是否強制限制打卡範圍（測試階段設為 false，避免因室內定位誤差無法打卡）
const ENFORCE_GPS = false;

// 掛載至全域 window，確保各模組皆可直接讀取
window.LIFF_ID = LIFF_ID;
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
window.supabaseClient = supabaseClient;
window.CLINIC_LOCATION = CLINIC_LOCATION;
window.ENFORCE_GPS = ENFORCE_GPS;
