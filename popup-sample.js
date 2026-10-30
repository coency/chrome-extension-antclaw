document.getElementById('biliSample').addEventListener('click', async () => {
  try {
    const tab = await activeTab();
    if (!tab || !urlMatches(tab.url, '哔哩哔哩')) {
      setStatus('请先打开已登录的 B 站创作中心，再点击样本按钮。', true); return;
    }
    await chrome.tabs.create({ url: chrome.runtime.getURL('bilibili-sample.html') + '?tabId=' + tab.id + '&start=1' });
  } catch (e) { setStatus('无法打开样本页面：' + e.message, true); }
});
