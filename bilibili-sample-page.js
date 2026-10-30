const sampleStatus = document.getElementById('status');
const sampleResult = document.getElementById('result');
const sampleCollect = document.getElementById('collect');
const sampleDownload = document.getElementById('download');
const sampleTabId = Number(new URLSearchParams(location.search).get('tabId'));
let sampleData = null, samplePending = false;
function showSample(data) {
  sampleData = data; sampleDownload.disabled = !data;
  if (!data) return;
  const works = Array.isArray(data.works) ? data.works : [];
  sampleResult.textContent = '采集时间：' + data.collectedAt + '\n匹配作品：' + works.length + ' 篇\n'
    + works.map((work) => work.publish + '　' + work.title + '　' + work.bvid).join('\n')
    + (data.warnings && data.warnings.length ? '\n提示：' + data.warnings.join('；') : '');
}
async function downloadSample() {
  if (!sampleData) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(sampleData, null, 2)], { type: 'application/json;charset=utf-8' }));
  try {
    await chrome.downloads.download({ url, filename: '哔哩哔哩_2026-09-29_分析样本.json', saveAs: true });
    sampleStatus.textContent = '已发起下载，请将 JSON 文件发回当前对话。';
  } catch (e) { sampleStatus.textContent = '下载未完成，可点击“下载已采集样本”重试：' + e.message; }
  finally { setTimeout(() => URL.revokeObjectURL(url), 300000); }
}
async function collectSample() {
  if (samplePending) return;
  samplePending = true; sampleCollect.disabled = true;
  sampleStatus.textContent = '正在查找并采集作品，请保持本页面和 B 站页面打开…';
  try {
    if (!Number.isInteger(sampleTabId) || sampleTabId <= 0) throw new Error('请从 B 站页面打开插件，点击“导出9月29日分析样本”');
    const tab = await chrome.tabs.get(sampleTabId);
    if (new URL(tab.url).origin !== 'https://member.bilibili.com') throw new Error('原标签页不是 B 站创作中心，请重新从 B 站页面打开样本功能');
    const response = await chrome.tabs.sendMessage(sampleTabId, { type: 'collectBiliSample' });
    if (!response || !response.ok) throw new Error(response && response.error || '采集未返回结果');
    showSample(response.data);
    await downloadSample();
  } catch (e) {
    const message = /Receiving end does not exist|Could not establish connection/i.test(e.message)
      ? '请刷新 B 站创作中心页面，再回到这里点击“采集并下载样本”。' : e.message;
    sampleStatus.textContent = '未完成：' + message;
  } finally { samplePending = false; sampleCollect.disabled = false; }
}
sampleCollect.addEventListener('click', collectSample);
sampleDownload.addEventListener('click', downloadSample);
chrome.storage.local.get(['biliSampleResult']).then((value) => {
  showSample(value.biliSampleResult);
  if (new URLSearchParams(location.search).get('start') === '1') collectSample();
  else sampleStatus.textContent = sampleData ? '已恢复上次采集样本，可下载。' : '点击“采集并下载样本”开始。';
}).catch((e) => { sampleStatus.textContent = '无法读取本地样本：' + e.message; });
