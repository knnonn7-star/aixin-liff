// ==================== 系統設定與常數 (config.js) ====================
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
