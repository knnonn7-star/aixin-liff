// 愛欣診所系統全域環境設定 (config.js)
window.LIFF_ID = '2011071479-1rEMTEv0';
window.SUPABASE_URL = 'https://bvbknaaljuwxrzvoqcrt.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_fPdr9TBzrw9Ycb6GEpF7UA_zeLqblfo';

// 診所精確 GPS 座標 (高雄市苓雅區正義路 136 號)
window.CLINIC_LOCATION = {
  lat: 22.6309209,
  lng: 120.3392031,
  radiusMeters: 100
};

// 初始化全域 Supabase 客戶端
if (typeof supabase !== 'undefined') {
  window.supabaseClient = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
}
