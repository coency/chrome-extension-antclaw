// background.js —— MV3 后台服务工作线程
// 串行处理任务状态，避免多个标签页同时读取 running:false 后启动提取。
// 锁存入 storage，Service Worker 休眠/重启后仍可恢复；超时规则与弹窗一致。
const RUNNING_STALE_MS = 30 * 60 * 1000;
const SUPPORTED_PLATFORMS = ['抖音', '视频号', '哔哩哔哩'];
let taskQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !['beginExtraction', 'endExtraction'].includes(msg.type)) return;
  if (!sender.tab || sender.tab.id == null) { sendResponse({ ok: false, error: '请从平台页面发起提取' }); return; }
  taskQueue = taskQueue.then(() => updateExtraction(msg, sender.tab.id)).then(sendResponse, (e) => {
    sendResponse({ ok: false, error: String((e && e.message) || e) });
  });
  return true;
});

async function updateExtraction(msg, tabId) {
  const v = await chrome.storage.local.get(['running', 'runningAt', 'runningId', 'runningTabId', 'runningPlatform', 'runningPeriod', 'lastResultAtMap', 'lastError']);
  const supportedTask = SUPPORTED_PLATFORMS.includes(v.runningPlatform);
  if (msg.type === 'beginExtraction') {
    if (!SUPPORTED_PLATFORMS.includes(msg.platform)) return { ok: false, error: '该平台暂未接入' };
    if (supportedTask && v.running && v.runningAt && Date.now() - v.runningAt < RUNNING_STALE_MS) {
      return { ok: false, busy: true, error: '已有提取任务正在运行，请等待完成' };
    }
    const successAt = (v.lastResultAtMap || {})[msg.platform] || 0;
    const failureAt = v.lastError && v.lastError.platform === msg.platform ? v.lastError.at : 0;
    const cooldown = Math.ceil((Math.max(successAt + 60000, (failureAt || 0) + 5000) - Date.now()) / 1000);
    if (cooldown > 0) return { ok: false, cooldown, error: '请等待 ' + cooldown + ' 秒后再提取' };
    const taskId = crypto.randomUUID();
    await chrome.storage.local.set({ running: true, runningAt: Date.now(), runningId: taskId, runningTabId: tabId, runningPlatform: msg.platform, runningPeriod: msg.period, lastError: null });
    return { ok: true, taskId };
  }
  // 旧任务晚到的回包不能覆盖新任务，也不能释放新任务的锁。
  if (!supportedTask || !v.running || v.runningId !== msg.taskId || v.runningTabId !== tabId) {
    return { ok: false, error: '提取任务已失效，请重新打开扩展查看最新状态' };
  }
  const error = msg.error || (!msg.data ? '提取未返回数据' : '');
  const lastError = error ? { message: error, platform: v.runningPlatform, period: v.runningPeriod, at: Date.now() } : null;
  const result = error ? { ok: false, error } : { ok: true, data: msg.data };
  const changes = { running: false, runningId: null, lastError };
  if (!error) {
    changes.lastResult = msg.data;
    changes.lastResultAtMap = { ...(v.lastResultAtMap || {}), [v.runningPlatform]: Date.now() };
  }
  try { await chrome.storage.local.set(changes); }
  catch (e) {
    const warning = '结果写入本地存储失败（' + String((e && e.message) || e) + '），关闭弹窗后可能无法恢复本次结果，请尽快下载';
    if (result.ok) result.data.warning = [result.data.warning, warning].filter(Boolean).join('；');
    else result.error += '；错误状态保存失败';
    // 大结果写入失败时，至少释放锁并保存说明，防止恢复成永久「提取中」。
    try { await chrome.storage.local.set({ running: false, runningId: null, lastError: lastError || { message: warning, platform: v.runningPlatform, period: v.runningPeriod, at: Date.now() } }); } catch (e2) {}
  }
  // 写入完成后再广播。失败也广播并通知，重新打开的弹窗不依赖原 sendResponse。
  try { await chrome.runtime.sendMessage({ type: result.ok ? 'extractDone' : 'extractFailed', error: result.error }).catch(() => {}); } catch (e) {}
  if (result.ok) createNotify(v.runningPlatform + '：提取完成，共 ' + msg.data.count + ' 条单篇，可打开扩展下载 CSV');
  else createNotify(v.runningPlatform + '：提取失败，' + result.error);
  return result;
}

function createNotify(message) {
  try {
    chrome.notifications.create({
      type: 'basic', iconUrl: chrome.runtime.getURL('icon128.png'),
      title: '爬爬蚁', message,
    }, (id) => { try { if (id) setTimeout(() => chrome.notifications.clear(id), 8000); } catch (e) {} });
  } catch (e) {}
}
