// popup.js —— 统一多平台弹窗：三步式（平台/周期/功能）
const HINT = '（可先关闭，完成后再回来下载）';
const RUNNING_STALE_MS = 30 * 60 * 1000; // 提取中超过 30 分钟视为陈旧（防死锁），自动重置
const FAIL_COOLDOWN_S = 5; // 提取失败后的短冷却：既提示可立即重试，又保持「不能连点」的风控约束
// 平台 → 官方登录/数据中心地址（未登录/未打开平台页时，按所选平台提示）
const LOGIN_URL = {
  '视频号': 'https://channels.weixin.qq.com',
  '抖音': 'https://creator.douyin.com',
  '哔哩哔哩': 'https://member.bilibili.com/platform/data-up/video/',
};
let latest = null;
let extracting = false;
let requestPending = false; // 本弹窗发起的请求由回包处理，重新打开的弹窗由广播恢复。
let stateVersion = 0; // 使旧的异步恢复/冷却查询失效，避免覆盖新任务的界面。
function isRunning(v) { return v && Object.hasOwn(LOGIN_URL, v.runningPlatform) && v.running && v.runningAt && Date.now() - v.runningAt < RUNNING_STALE_MS; }
function setRunning(value) {
  extracting = value;
  $('platform').disabled = value; $('period').disabled = value;
  if (value) { clearCooldown(); setExtractBtn(false); setBtns(false); $('result').textContent = ''; setStatus('提取中…' + HINT); }
}
function restore() {
  if (requestPending) return;
  const version = ++stateVersion;
  chrome.storage.local.get(['running', 'runningAt', 'runningPlatform', 'lastResult', 'lastError']).then((v) => {
    if (requestPending || version !== stateVersion) return;
    setRunning(!!isRunning(v));
    if (extracting) return;
    latest = v && v.lastResult && Object.hasOwn(LOGIN_URL, v.lastResult.platform) ? v.lastResult : null;
    if (v && v.lastError && Object.hasOwn(LOGIN_URL, v.lastError.platform)) {
      $('platform').value = v.lastError.platform;
      $('period').value = v.lastError.period || 'month';
      setBtns(false); $('result').textContent = ''; refreshBtnState(); return;
    }
    if (latest) { syncSelectsToLatest(); applySelectionState(); }
    else { setBtns(false); $('result').textContent = ''; setStatus(''); refreshBtnState(); }
  }).catch((e) => { if (version === stateVersion && !requestPending) setStatus('无法恢复提取状态：' + e.message, true); });
}
// 接收后台的完成/失败通知（状态已写入 storage，这里恢复界面）。
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && ['extractDone', 'extractFailed'].includes(msg.type)) { restore(); }
});
restore(); // 打开弹窗时恢复上次成功结果，避免下载按钮一直灰色
function activeTab() { return new Promise((r) => chrome.tabs.query({ active: true, currentWindow: true }, (t) => r(t[0]))); }
// 判断某 URL 是否属于所选平台
function urlMatches(url, platform) {
  const hosts = platform === '视频号' ? ['channels.weixin.qq.com'] : platform === '抖音' ? ['creator.douyin.com'] : platform === '哔哩哔哩' ? ['member.bilibili.com'] : [];
  try { const h = new URL(url).hostname; return hosts.some((d) => h === d || h.endsWith('.' + d)); } catch (e) { return false; }
}
function sendToTab(tabId, msg) { return new Promise((res, rej) => { chrome.tabs.sendMessage(tabId, msg, (r) => { if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message)); else res(r); }); }); }
// 等待标签页加载完成
function waitTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(to); chrome.tabs.onUpdated.removeListener(l); resolve(); };
    const to = setTimeout(finish, timeoutMs || 15000);
    function l(id, info) { if (id === tabId && info.status === 'complete') finish(); }
    chrome.tabs.onUpdated.addListener(l);
    chrome.tabs.get(tabId, (t) => { if (chrome.runtime.lastError) return finish(); if (t && t.status === 'complete') finish(); });
  });
}
// 发送失败（内容脚本缺失，如扩展重载前的旧标签页）→ 刷新重载该页使内容脚本注入 → 重发一次。
// 只有「根本没有接收方」才刷新页面；其它异常（页面正在导航、脚本报错等）刷新会丢掉用户在当前页的状态。
async function sendToTabRetry(tabId, msg) {
  try { return await sendToTab(tabId, msg); }
  catch (e) {
    const m = String((e && e.message) || e);
    if (!/Receiving end does not exist|Could not establish connection/i.test(m)) throw e;
    await new Promise((r2) => chrome.tabs.reload(tabId, () => r2()));
    await waitTabComplete(tabId, 20000);
    return await sendToTab(tabId, msg);
  }
}
function $(id) { return document.getElementById(id); }
$('platform').addEventListener('change', () => { applySelectionState(); });
$('period').addEventListener('change', () => { applySelectionState(); });
function setStatus(s, isErr) { const el = $('status'); el.textContent = s; el.className = isErr ? 'err' : ''; }
function setBtns(enable) {
  const posts = latest && Array.isArray(latest.posts) ? latest.posts : [];
  $('csv').disabled = !(enable && latest && latest.summaryCsv);
  $('postCsv').disabled = !(enable && latest && latest.postCsv && posts.length);
  $('zipCover').disabled = !(enable && posts.some((p) => p.coverUrl && p.coverFileName));
}
function setExtractBtn(enable) { $('extract').disabled = !enable || extracting || requestPending; }
// 把平台/周期下拉框同步成当前数据（latest）对应的值，便于辨认该数据属于哪个平台/周期。
function syncSelectsToLatest() {
  if (!latest) return;
  if ($('platform') && Object.hasOwn(LOGIN_URL, latest.platform)) $('platform').value = latest.platform;
  if ($('period')) $('period').value = latest.scopeLabel === '周度' ? 'week' : 'month';
}
// 结果摘要与提示都跟随「当前所选平台+周期」：与已加载数据一致则显示并启用下载，不一致则清空（避免切换后仍显示旧平台/周期的数据与提示）。
function applySelectionState() {
  if (extracting || requestPending) return;
  if (!latest) { setBtns(false); $('result').textContent = ''; setStatus(''); refreshBtnState(); return; }
  const plat = $('platform').value, period = $('period').value;
  const latestPeriod = latest.scopeLabel === '周度' ? 'week' : 'month';
  const match = plat === latest.platform && period === latestPeriod;
  if (match) { render(latest); setBtns(true); refreshBtnState('已加载上次结果，可直接点击上方「下载」'); }
  else { setBtns(false); $('result').textContent = ''; setStatus(''); refreshBtnState(); } // 重置后仍更新当前平台「提取数据」冷却状态
}
function render(d) {
  let t = '平台: ' + d.platform + ' · 周期: ' + d.period + ' （' + (d.rangeText || d.scopeLabel) + '）\n';
  t += '单篇作品: ' + d.count + ' 条\n';
  if (d.dataNote) t += d.dataNote + '\n';
  if (d.warning) t += '⚠ ' + d.warning + '\n';
  $('result').textContent = t;
}
// 下载：objectURL 不能在 downloads.download() 的回调里立刻 revoke——大 CSV / 封面 ZIP 可能还没读完就被中断。
// 改为等 downloads.onChanged 报 complete/interrupted 后再释放，并保留 5 分钟兜底。
const pendingUrls = new Map();
try {
  chrome.downloads.onChanged.addListener((d) => {
    if (!d || d.id == null || !pendingUrls.has(d.id)) return;
    const st = d.state && d.state.current;
    if (st === 'complete' || st === 'interrupted') { URL.revokeObjectURL(pendingUrls.get(d.id)); pendingUrls.delete(d.id); }
  });
} catch (e) {}
function saveBlob(name, blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename: name, saveAs: true }, (id) => {
      const err = chrome.runtime.lastError;
      if (err || id == null) { URL.revokeObjectURL(url); setStatus('下载失败：' + ((err && err.message) || '未开始下载'), true); resolve(false); return; }
      pendingUrls.set(id, url);
      setTimeout(() => { if (pendingUrls.has(id)) { URL.revokeObjectURL(pendingUrls.get(id)); pendingUrls.delete(id); } }, 5 * 60 * 1000);
      resolve(true);
    });
  });
}
function download(name, content, mime) { return saveBlob(name, new Blob([content], { type: mime })); }
// 并发池：最多 limit 个任务同时进行，结果按原顺序返回（与 content.js 的 pMap 同思路）
async function pMapLimit(limit, items, fn) {
  const results = new Array(items.length); let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()));
  return results;
}

function crc32(buf) { let t = crc32.t || (crc32.t = (() => { const a = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); a[n] = c >>> 0; } return a; })()); let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function buildZip(files) { const enc = new TextEncoder(); const parts = [], central = []; let offset = 0;
  for (const f of files) { const name = enc.encode(f.name), data = f.data, crc = crc32(data); const local = new Uint8Array(30 + name.length), dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034B50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true); dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true);
    local.set(name, 30); parts.push(local, data);
    const c = new Uint8Array(46 + name.length), c2 = new DataView(c.buffer);
    c2.setUint32(0, 0x02014B50, true); c2.setUint16(4, 20, true); c2.setUint16(6, 20, true); c2.setUint16(8, 0x0800, true); c2.setUint16(10, 0, true); c2.setUint16(12, 0, true); c2.setUint16(14, 0x21, true);
    c2.setUint32(16, crc, true); c2.setUint32(20, data.length, true); c2.setUint32(24, data.length, true); c2.setUint16(28, name.length, true); c2.setUint16(30, 0, true); c2.setUint16(32, 0, true);
    c2.setUint16(34, 0, true); c2.setUint16(36, 0, true); c2.setUint32(38, 0, true); c2.setUint32(42, offset, true); c.set(name, 46); central.push(c); offset += local.length + data.length; }
  const cs = central.reduce((a, x) => a + x.length, 0); const e = new Uint8Array(22), ed = new DataView(e.buffer);
  ed.setUint32(0, 0x06054B50, true); ed.setUint16(4, 0, true); ed.setUint16(6, 0, true); ed.setUint16(8, files.length, true); ed.setUint16(10, files.length, true); ed.setUint32(12, cs, true); ed.setUint32(16, offset, true); ed.setUint16(20, 0, true);
  return new Blob([...parts, ...central, e], { type: 'application/zip' }); }

const COOLDOWN_S = 60;
let cdTimer = null;
function clearCooldown() { if (cdTimer) { clearInterval(cdTimer); cdTimer = null; } const b = $('extract'); if (b) b.textContent = '提取数据'; }
function startCooldown(seconds, doneMsg) {
  setExtractBtn(false); clearCooldown();
  let left = Math.max(0, Math.floor(seconds));
  const btn = $('extract'), base = '提取数据';
  if (btn) btn.textContent = left + '秒重新提取';
  if (doneMsg) setStatus(doneMsg);
  cdTimer = setInterval(() => {
    left--;
    if (left <= 0) { clearInterval(cdTimer); cdTimer = null; setExtractBtn(true); if (btn) btn.textContent = base; }
    else if (btn) btn.textContent = left + '秒重新提取';
  }, 1000);
}
// 按当前所选平台单独判断是否在 60 秒冷却内；冷却按平台独立计算。
function refreshBtnState(doneMsg) {
  if (extracting || requestPending) return;
  const version = ++stateVersion;
  const platform = $('platform').value;
  chrome.storage.local.get(['running', 'runningAt', 'runningPlatform', 'lastResultAtMap', 'lastError']).then((v) => {
    if (version !== stateVersion || extracting || requestPending || platform !== $('platform').value) return;
    if (isRunning(v)) { setRunning(true); return; }
    const map = (v && v.lastResultAtMap) || {};
    const at = map[platform] || 0;
    const error = v && v.lastError && v.lastError.platform === platform ? v.lastError : null;
    const remain = Math.ceil((Math.max(at + COOLDOWN_S * 1000, error ? error.at + FAIL_COOLDOWN_S * 1000 : 0) - Date.now()) / 1000);
    if (remain > 0) startCooldown(remain);
    else { setExtractBtn(true); clearCooldown(); }
    if (error) setStatus('提取失败！' + error.message, true);
    else if (doneMsg) setStatus(doneMsg);
  }).catch((e) => {
    if (version !== stateVersion || extracting || requestPending) return;
    setExtractBtn(true); clearCooldown(); setStatus('无法读取提取状态：' + e.message, true);
  });
}
async function doExtract() {
  if (extracting || requestPending || $('extract').disabled) return;
  ++stateVersion;
  requestPending = true; setRunning(true);
  try {
    const platform = $('platform').value, period = $('period').value;
    const tab = await activeTab();
    if (!tab || !tab.url || !urlMatches(tab.url, platform)) { requestPending = false; setRunning(false); setBtns(false); setExtractBtn(true); clearCooldown(); setStatus('请先打开并登录「' + platform + '」：' + (LOGIN_URL[platform] || '')); return; }
    const r = await sendToTabRetry(tab.id, { type: 'extract', platform, period, concurrency: 4 });
    requestPending = false; setRunning(false);
    if (r && r.busy) { restore(); return; }
    if (r && r.cooldown) { setStatus(r.error, true); startCooldown(r.cooldown); return; }
    if (!r || !r.ok) throw new Error((r && r.error) || '无响应');
    latest = r.data; render(latest); syncSelectsToLatest(); setBtns(true); startCooldown(COOLDOWN_S, '完成 ✓ 可点击上方「下载」保存');
  } catch (e) {
    requestPending = false; setRunning(false);
    setBtns(false); clearCooldown(); setStatus('提取失败！' + e.message, true);
    startCooldown(FAIL_COOLDOWN_S); // 失败也给短冷却：不能因为"失败"就绕过连点约束
  }
}
$('extract').addEventListener('click', doExtract);
// 注意：不因切换平台/周期而清空 60 秒冷却，避免绕过风控；冷却由 startCooldown 统一管理。
$('csv').addEventListener('click', async () => { if (!latest || !latest.summaryCsv) { setStatus('请先「提取数据」或本次汇总数据不可用', true); return; } const ok = await download(latest.platform + '_' + latest.periodName + '_' + latest.scopeLabel + '汇总数据统计.csv', '\uFEFF' + latest.summaryCsv, 'text/csv'); if (ok) setStatus('已发起下载汇总CSV'); });
$('postCsv').addEventListener('click', async () => { if (!latest || !latest.posts || !latest.posts.length) { setStatus('请先「提取数据」或本期无作品', true); return; } const ok = await download(latest.platform + '_' + latest.periodName + '_' + latest.scopeLabel + '作品数据统计.csv', '\uFEFF' + latest.postCsv, 'text/csv'); if (ok) setStatus('已发起下载单篇CSV'); });
$('zipCover').addEventListener('click', async () => {
  if (!latest || !latest.posts || !latest.posts.length) { setStatus('请先「提取数据」或无封面', true); return; }
  try {
    const targets = latest.posts.filter((p) => p.coverUrl && p.coverFileName);
    if (!targets.length) { setStatus('本期作品没有可用的封面链接', true); return; }
    setStatus('正在打包封面… 0/' + targets.length);
    const fails = []; let done = 0;
    // 并发取图（弹窗内存有限，固定 5 并发）；失败的把域名一并带出，便于判断是否缺 host_permissions
    const files = await pMapLimit(5, targets, async (p) => {
      try {
        const r = await fetch(p.coverUrl);
        if (!r.ok) { fails.push(p.coverFileName + '(HTTP ' + r.status + ')'); return null; }
        return { name: p.coverFileName, data: new Uint8Array(await r.arrayBuffer()) };
      } catch (e) {
        let host = ''; try { host = new URL(p.coverUrl).host; } catch (e2) {}
        fails.push(p.coverFileName + (host ? '@' + host : '') + '(网络/' + ((e && e.message) || '取图失败') + ')');
        return null;
      } finally {
        done++;
        if (done === targets.length || done % 10 === 0) setStatus('正在打包封面… ' + done + '/' + targets.length);
      }
    });
    const list = files.filter(Boolean);
    if (!list.length) { setStatus('没有可打包封面（共尝试 ' + targets.length + ' 张' + (fails.length ? '，失败 ' + fails.length + ' 张，如：' + fails.slice(0, 3).join('、') : '') + '）', true); return; }
    const saved = await saveBlob(latest.platform + '_' + latest.coverFolder + '.zip', buildZip(list));
    if (!saved) return;
    setStatus('已打包 ' + list.length + ' 张封面' + (fails.length ? '（' + fails.length + ' 张失败：' + fails.slice(0, 3).join('、') + (fails.length > 3 ? ' 等' : '') + '，可能因图片链接过期或封面域名缺少权限）' : ''));
  } catch (e) { setStatus('失败: ' + e.message, true); }
});
