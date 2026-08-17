// ==================== 全系統啟動入口 ====================
async function initLiff() {
  setInterval(updateClock, 1000);
  updateClock();
  refreshGpsLocation();

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
    if (userElem) userElem.innerText = "林和正";
    currentUser.displayName = "林和正";
    await syncEmployeeRecord();
    loadTodayAttendance();
  }
}

// 執行系統啟動
initLiff();
