// B 站适配器：账号汇总取逐日增量，作品按发布时间筛选并保留 stat 累计口径。
// 依赖 content.js 的 axhr / sleep / pMap / toCsv / fmtRange；只在用户提取时调用。
const BILI_BASE = 'https://member.bilibili.com/x/web/data/';
const BILI_PAGE_SIZE = 20;
const BILI_MAX_PAGES = 200;
const BILI_DAY_MS = 86400000;
const BILI_METRICS = [
  ['play', '播放量'], ['like', '点赞量'], ['fav', '收藏量'], ['coin', '投币量'],
  ['comment', '评论量'], ['dm', '弹幕量'], ['share', '分享量'], ['fan', '粉丝净增'],
];
const BILI_COVER_HOSTS = ['i0.hdslb.com', 'i1.hdslb.com', 'i2.hdslb.com'];
// 单篇概览 /archive_diagnose/overview 的 stat 字段，均为作品累计计数。
const BILI_DETAIL_METRICS = [
  ['comment', 'comments', '评论'], ['fav', 'favorites', '收藏'], ['coin', 'coins', '投币'],
  ['share', 'shares', '分享'], ['dm', 'danmaku', '弹幕'],
];
const BILI_EXTRA_SUMMARY_HEADERS = ['空间访客（逐日人数合计）'];
// 官网稿件对比配置：比例为万分数。进度时长和占比另从分 P 播放分析读取。
const BILI_COMPARE_METRICS = [
  ['unfollow', 'unfollow', '取关量', 'count'],
  ['play_viewer_rate', 'guestPlayShare', '游客播放占比', 'percent'],
  ['crash_rate', 'bounceRate', '3秒跳出率（发稿后14天）', 'percent'],
  ['interact_rate', 'interactionRate', '互动率（发稿后14天）', 'ratio'],
  ['play_trans_fan_rate', 'followConversion', '播转粉率', 'percent'],
];
const BILI_EXTRA_POST_COLUMNS = [
  ['unfollow', '取关量'], ['avgPlayProgress', '平均播放进度'], ['playProgressRatio', '占总时长比'],
  ...BILI_COMPARE_METRICS.slice(1).map(([, field, label]) => [field, label]),
];

function biliNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : null;
}
function biliDate(seconds) {
  const n = biliNumber(seconds);
  if (n == null || n <= 0 || n >= 1e11) return '';
  return new Date(n * 1000 + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}
function biliDay(seconds) { return biliDate(seconds).slice(0, 10).replace(/-/g, ''); }
function biliPeriod(period, now = new Date()) {
  // 平台统计使用北京时间，不随用户电脑的时区变化。
  const today = new Date(now.getTime() + 8 * 3600000);
  const y = today.getUTCFullYear(), m = today.getUTCMonth(), d = today.getUTCDate();
  let start, end, label;
  if (period === 'week') {
    const monday = Date.UTC(y, m, d - (today.getUTCDay() + 6) % 7);
    start = monday - 7 * BILI_DAY_MS; end = monday - BILI_DAY_MS;
    const thursday = new Date(start + 3 * BILI_DAY_MS);
    const weekYear = thursday.getUTCFullYear();
    const week = Math.ceil(((thursday.getTime() - Date.UTC(weekYear, 0, 1)) / BILI_DAY_MS + 1) / 7);
    label = weekYear + '年' + week + '周';
  } else {
    start = Date.UTC(y, m - 1, 1); end = Date.UTC(y, m, 0);
    const first = new Date(start);
    label = first.getUTCFullYear() + '年' + String(first.getUTCMonth() + 1).padStart(2, '0') + '月';
  }
  const day = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  const days = [];
  for (let ms = start; ms <= end; ms += BILI_DAY_MS) days.push(day(ms));
  return { startD: day(start), endD: day(end), days, label };
}
async function biliRequest(path, params) {
  const json = await axhr(BILI_BASE + path + '?' + new URLSearchParams(params));
  if (json && json.code === -101) {
    const error = new Error('登录已失效，请先登录「哔哩哔哩」后再操作（若已登录请刷新页面重试）');
    error.loginExpired = true; throw error;
  }
  if (!json || json.code !== 0) {
    throw new Error('B 站接口失败（错误码 ' + (json && json.code != null ? json.code : '缺失') + '）：' + (json && (json.message || json.msg) || '响应格式异常'));
  }
  if (!json.data || typeof json.data !== 'object') throw new Error('B 站接口未返回有效数据');
  return json.data;
}
function biliTrendTotal(series, days, { allowDecimal = false, allowNegative = true } = {}) {
  if (!Array.isArray(series)) return { value: '', reason: '缺少逐日数据' };
  const wanted = new Set(days), values = new Map();
  for (const point of series) {
    const date = biliDay(point && point.date_key);
    if (!date) return { value: '', reason: '日期格式异常' };
    if (!wanted.has(date)) continue;
    const value = biliNumber(point.total_inc);
    if (value == null || (!allowDecimal && !Number.isSafeInteger(value)) || (!allowNegative && value < 0)) return { value: '', reason: '存在无效指标值' };
    if (values.has(date)) return { value: '', reason: '存在重复日期' };
    values.set(date, value);
  }
  const missing = days.filter((day) => !values.has(day));
  if (missing.length) return { value: '', reason: '缺少 ' + missing.length + ' 天（如 ' + fmtRange(missing[0]) + '）' };
  const total = [...values.values()].reduce((sum, n) => sum + n, 0);
  return (allowDecimal ? Number.isFinite(total) && Math.abs(total) <= Number.MAX_SAFE_INTEGER : Number.isSafeInteger(total))
    ? { value: allowDecimal ? Number(total.toFixed(6)) : total, reason: '' } : { value: '', reason: '指标总量超出安全数值范围' };
}

async function biliExtraSummary(R, warning) {
  try {
    const data = await biliRequest('v2/overview/stat/graph', { period: 2, s_locale: 'zh_CN', type: 'visitor' });
    const series = data.data_tendency && Object.prototype.hasOwnProperty.call(data.data_tendency, 'visitor') ? data.data_tendency.visitor : data.tendency;
    const total = biliTrendTotal(series, R.days, { allowNegative: false });
    if (total.reason) warning.push('汇总「' + BILI_EXTRA_SUMMARY_HEADERS[0] + '」未导出：' + total.reason);
    return [total.value];
  } catch (e) {
    if (e.loginExpired) throw e;
    warning.push('汇总「' + BILI_EXTRA_SUMMARY_HEADERS[0] + '」获取失败，留空：' + e.message);
    return [''];
  }
}

function biliFormatMetric(raw, type) {
  const value = biliNumber(raw);
  if (value == null || value < 0) return '';
  if (type === 'count') return Number.isSafeInteger(value) ? value : '';
  if (type === 'percent' || type === 'ratio') {
    if (type === 'percent' && value > 10000) return '';
    return (value / 100).toFixed(2) + '%';
  }
  return value;
}

async function biliComparePosts(posts, warning, stopped = false) {
  for (const post of posts) {
    for (const [, field] of BILI_COMPARE_METRICS) post[field] = '';
  }
  if (!posts.length) return;
  if (stopped) { warning.push('登录失效，未请求扩展统计（取关、播放进度和各项比率），相关列留空'); return; }
  const selected = posts.filter((post) => post.bvid), batches = [];
  for (let i = 0; i < selected.length; i += 10) batches.push(selected.slice(i, i + 10));
  let failed = 0, absent = 0, skipped = 0, loginExpired = false, firstError = '';
  const missing = new Map();
  await pMap(2, batches, async (batch, index) => {
    if (loginExpired) { skipped += batch.length; return; }
    if (index >= 2) await sleep(600);
    if (loginExpired) { skipped += batch.length; return; }
    try {
      const data = await biliRequest('archive_diagnose/compare', { compare_bvids: batch.map((post) => post.bvid).join(','), size: 10 });
      if (!Array.isArray(data.list)) throw new Error('稿件对比列表格式异常');
      const byId = new Map(), duplicates = new Set();
      for (const item of data.list) {
        if (!item || typeof item.bvid !== 'string') continue;
        if (byId.has(item.bvid)) duplicates.add(item.bvid);
        byId.set(item.bvid, item);
      }
      for (const post of batch) {
        const item = byId.get(post.bvid);
        if (!item || duplicates.has(post.bvid)) { absent++; continue; }
        const stat = item.stat && typeof item.stat === 'object' ? item.stat : {};
        for (const [key, field, label, type] of BILI_COMPARE_METRICS) {
          const allowed = key !== 'unfollow' || post.pubtime >= Date.parse('2024-06-01T00:00:00+08:00') / 1000;
          post[field] = allowed ? biliFormatMetric(stat[key], type) : '';
          if (post[field] === '') missing.set(label, (missing.get(label) || 0) + 1);
        }
      }
    } catch (e) {
      failed += batch.length;
      if (!firstError) firstError = e.message;
      if (e.loginExpired) loginExpired = true;
    }
  });
  if (failed) warning.push(failed + ' 篇作品的扩展统计请求失败（' + firstError + '），相关列留空，基本数据保留');
  if (absent) warning.push(absent + ' 篇作品未在对比响应中唯一匹配到 BV 号，扩展统计留空');
  if (loginExpired) warning.push('扩展统计期间登录失效，已停止后续请求' + (skipped ? '，另有 ' + skipped + ' 篇未请求' : ''));
  if (selected.length !== posts.length) warning.push((posts.length - selected.length) + ' 篇作品缺少 BV 号，扩展统计留空');
  if (missing.size) warning.push('部分扩展统计缺失、不适用或格式异常，留空：' + [...missing].map(([label, count]) => label + '（' + count + '篇）').join('、'));
}
function biliCover(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const url = new URL(raw.startsWith('//') ? 'https:' + raw : raw);
    if (!['http:', 'https:'].includes(url.protocol) || !BILI_COVER_HOSTS.includes(url.hostname) || url.port || url.username || url.password) return null;
    url.protocol = 'https:';
    const match = url.pathname.match(/\.(jpe?g|png|webp)(?:@|$)/i);
    return { url: url.href, extension: match ? match[1].toLowerCase() : 'jpg' };
  } catch (e) { return null; }
}

async function biliProgressPosts(posts, warning, stopped = false) {
  for (const post of posts) { post.avgPlayProgress = ''; post.playProgressRatio = ''; }
  if (!posts.length) return { loginExpired: stopped };
  if (stopped) {
    warning.push('登录失效，未请求平均播放进度和占总时长比，相关列留空');
    return { loginExpired: true };
  }
  let failed = 0, missing = 0, multiple = 0, noBvid = 0, skipped = 0, loginExpired = false, firstError = '';
  await pMap(2, posts, async (post, index) => {
    if (!post.bvid) { noBvid++; return; }
    if (loginExpired) { skipped++; return; }
    if (index >= 2) await sleep(600);
    if (loginExpired) { skipped++; return; }
    try {
      let videos = post.videoParts;
      if (!Array.isArray(videos) || !videos.length) {
        const detail = await biliRequest('v3/archive/view', { bvid: post.bvid });
        if (detail.bvid && detail.bvid !== post.bvid) throw new Error('进度查询的作品 BV 号不一致');
        videos = detail.videos;
        if (loginExpired) { skipped++; return; }
        await sleep(600);
        if (loginExpired) { skipped++; return; }
      }
      // 此接口以 CID（分 P）为单位，不能把某一 P 的进度冒充整篇作品的进度。
      if (Array.isArray(videos) && videos.length > 1) { multiple++; return; }
      const cid = Array.isArray(videos) && videos.length === 1 ? biliNumber(videos[0] && videos[0].cid) : null;
      if (!Number.isSafeInteger(cid) || cid <= 0) throw new Error('缺少有效的单 P CID');
      const data = await biliRequest('v2/archive/analyze/graph', { cid });
      if (data.cid != null && biliNumber(data.cid) !== cid) throw new Error('进度响应的 CID 与请求不一致');
      const info = data.quit_info || {};
      const progress = biliNumber(info.avg_play_progress), ratio = biliNumber(info.full_play_ratio);
      // 与官网截图分支一致：秒数向下取整为分秒，比例保留一位小数。缺失不兜底为零。
      if (progress != null && progress >= 0) post.avgPlayProgress = Math.floor(progress / 60) + '分' + Math.floor(progress % 60) + '秒';
      if (ratio != null && ratio >= 0 && ratio <= 10000) post.playProgressRatio = (ratio / 100).toFixed(1) + '%';
      if (post.avgPlayProgress === '' || post.playProgressRatio === '') missing++;
    } catch (e) {
      failed++;
      if (!firstError) firstError = e.message;
      if (e.loginExpired) loginExpired = true;
    }
  });
  if (failed) warning.push(failed + ' 篇作品的平均播放进度/占总时长比获取失败（' + firstError + '），相关列留空');
  if (missing) warning.push(missing + ' 篇作品的平均播放进度或占总时长比缺失或无效，对应单元格留空');
  if (multiple) warning.push(multiple + ' 篇多 P 作品的平均播放进度和占总时长比留空：接口为分 P 数据，不能代表整篇作品');
  if (noBvid) warning.push(noBvid + ' 篇作品缺少 BV 号，平均播放进度和占总时长比留空');
  if (loginExpired) warning.push('进度查询期间登录失效，已停止后续请求' + (skipped ? '，另有 ' + skipped + ' 篇未请求' : ''));
  return { loginExpired };
}

async function biliEnrichPosts(posts, warning) {
  let failed = 0, skipped = 0, noBvid = 0, loginExpired = false, firstError = '';
  const missing = new Map();
  // 仅补充已选中且去重后的作品；最多 2 并发，同一工作流请求间隔 600ms。
  await pMap(2, posts, async (post, index) => {
    for (const [, field] of BILI_DETAIL_METRICS) post[field] = '';
    if (!post.bvid) { noBvid++; return; }
    if (loginExpired) { skipped++; return; }
    if (index >= 2) await sleep(600);
    if (loginExpired) { skipped++; return; }
    try {
      const data = await biliRequest('archive_diagnose/overview', { bvid: post.bvid });
      if (data.bvid && data.bvid !== post.bvid) throw new Error('返回的作品 BV 号与请求不一致');
      const stat = data.stat && typeof data.stat === 'object' ? data.stat : {};
      for (const [key, field, label] of BILI_DETAIL_METRICS) {
        const value = biliNumber(stat[key]);
        if (Number.isSafeInteger(value) && value >= 0) post[field] = value;
        else missing.set(label, (missing.get(label) || 0) + 1);
      }
    } catch (e) {
      failed++;
      if (!firstError) firstError = e.message;
      if (e.loginExpired) loginExpired = true;
    }
  });
  if (failed) warning.push('补充明细有 ' + failed + ' 篇获取失败（' + firstError + '），对应评论/收藏/投币/分享/弹幕留空，已取得的其他数据保留');
  if (loginExpired) warning.push('补充明细期间登录失效，已停止后续请求' + (skipped ? '，另有 ' + skipped + ' 篇未请求' : '') + '，请登录并刷新页面后重试');
  if (noBvid) warning.push(noBvid + ' 篇作品缺少 BV 号，无法查询补充明细，相关单元格留空');
  for (const [label, count] of missing) warning.push(count + ' 篇作品的累计' + label + '字段缺失或格式异常，相关单元格留空');
  return { loginExpired };
}

async function bilibiliExtract(period) {
  const R = biliPeriod(period), scopeLabel = period === 'week' ? '周度' : '月度';
  const warning = [], posts = [], seen = new Set();
  let summaryCsv = '', postCsv = '', listAvailable = false;
  let totals = BILI_METRICS.map(() => '');
  // 与官网导出相同：一次查询多个指标，各列独立验证完整日期覆盖。
  try {
    const data = await biliRequest('v2/overview/stat/graph', { period: 2, s_locale: 'zh_CN', type: BILI_METRICS.map(([key]) => key).join(',') });
    totals = BILI_METRICS.map(([key, label]) => {
      const total = biliTrendTotal(data.data_tendency && data.data_tendency[key], R.days);
      if (total.reason) warning.push('汇总「' + label + '」未导出：' + total.reason);
      return total.value;
    });
  } catch (e) {
    if (e.loginExpired) throw e;
    warning.push('汇总获取失败：' + e.message);
  }
  const extraTotals = await biliExtraSummary(R, warning);
  if (totals.concat(extraTotals).some((value) => value !== '')) {
    summaryCsv = toCsv([
      ['周期', '开始日期', '结束日期', ...BILI_METRICS.map(([, label]) => label), ...BILI_EXTRA_SUMMARY_HEADERS],
      [R.label, fmtRange(R.startD), fmtRange(R.endD), ...totals, ...extraTotals],
    ]);
  }

  let invalidPosts = 0, missingMetrics = 0, unavailableCovers = 0, duplicates = 0;
  try {
    for (let page = 1; page <= BILI_MAX_PAGES; page++) {
      const data = await biliRequest('archive/index', { pn: page, ps: BILI_PAGE_SIZE, scene: 'archive_compare', order: 0 });
      if (!Array.isArray(data.list)) throw new Error('作品列表格式异常');
      const pager = data.pager || {}, total = biliNumber(pager.total);
      if (!Number.isSafeInteger(total) || total < data.list.length || Number(pager.pn) !== page) throw new Error('作品分页信息异常，无法确认列表完整性');
      listAvailable = true;
      let added = 0;
      for (const item of data.list) {
        const bvid = item && typeof item.bvid === 'string' && /^BV[0-9A-Za-z]{10}$/.test(item.bvid) ? item.bvid : '';
        const aid = item && biliNumber(item.aid);
        const id = bvid || (Number.isSafeInteger(aid) && aid > 0 ? 'av' + aid : '');
        if (!id) { invalidPosts++; continue; }
        if (seen.has(id)) { duplicates++; continue; }
        seen.add(id); added++;
        // 只使用发布时间 pubtime；ctime 是稿件创建时间，不能作为替代。
        const day = biliDay(item.pubtime);
        if (!day) { invalidPosts++; continue; }
        if (day < R.startD || day > R.endD) continue;
        const stat = item.stat && typeof item.stat === 'object' ? item.stat : {};
        const metrics = ['play', 'likes', 'fans'].map((key) => {
          const value = biliNumber(stat[key]);
          return Number.isSafeInteger(value) ? value : '';
        });
        if (metrics.some((value) => value === '')) missingMetrics++;
        const cover = biliCover(item.cover);
        if (!cover) unavailableCovers++;
        const duration = biliNumber(item.duration);
        posts.push({
          id, bvid, aid: Number.isSafeInteger(aid) ? aid : '', title: typeof item.title === 'string' ? item.title : '',
          publish: biliDate(item.pubtime), pubtime: Number(item.pubtime), duration: duration != null && duration >= 0 ? duration : '',
          videoParts: Array.isArray(item.videos) ? item.videos.map((video) => ({ cid: video && video.cid })) : null,
          plays: metrics[0], likes: metrics[1], fans: metrics[2],
          url: 'https://www.bilibili.com/video/' + id, coverUrl: cover ? cover.url : '', coverExtension: cover ? cover.extension : '',
        });
      }
      if (seen.size >= total) break;
      if (!data.list.length || !added) { warning.push('作品分页未取得新数据，仅导出已获取作品，列表可能不完整'); break; }
      if (page === BILI_MAX_PAGES) { warning.push('作品列表达到 ' + BILI_MAX_PAGES + ' 页上限，仅导出已获取的周期内作品'); break; }
      await sleep(600);
    }
  } catch (e) {
    if (e.loginExpired) throw e;
    warning.push('作品获取失败，已获取的作品予以保留，列表可能不完整：' + e.message);
  }
  if (invalidPosts) warning.push(invalidPosts + ' 条作品缺少有效标识或发布时间，已跳过');
  if (duplicates) warning.push('已去重 ' + duplicates + ' 条重复作品；分页期间列表可能发生变化，请核对作品数量');
  if (missingMetrics) warning.push(missingMetrics + ' 篇作品的累计统计字段缺失或格式异常，相关单元格留空');
  if (unavailableCovers) warning.push(unavailableCovers + ' 篇作品无可用封面或封面域名暂不支持');
  posts.sort((a, b) => b.pubtime - a.pubtime);
  posts.forEach((post, i) => { post.coverFileName = post.coverUrl ? String(i + 1).padStart(2, '0') + '_' + post.id + '.' + post.coverExtension : ''; });
  const enrichment = await biliEnrichPosts(posts, warning);
  const progress = await biliProgressPosts(posts, warning, enrichment.loginExpired);
  await biliComparePosts(posts, warning, progress.loginExpired);
  if (listAvailable) {
    postCsv = toCsv([
      ['作品标题', '发布日期（北京时间）', '封面', '作品时长（秒）', '播放量', '点赞量', '涨粉量', '评论量', '收藏量', '投币量', '分享量', '弹幕量', ...BILI_EXTRA_POST_COLUMNS.map(([, label]) => label)],
      ...posts.map((p) => [p.title, p.publish, p.coverFileName, p.duration, p.plays, p.likes, p.fans, p.comments, p.favorites, p.coins, p.shares, p.danmaku, ...BILI_EXTRA_POST_COLUMNS.map(([field]) => p[field])]),
    ]);
  }
  if (!summaryCsv && !listAvailable) throw new Error(warning.join('；') || 'B 站未返回可导出的数据');
  if (!summaryCsv) warning.push(posts.length ? '汇总数据不可用，仍可下载已获取的作品明细与可用封面' : '汇总数据不可用，本周期也未获取到可下载作品');
  return {
    platform: '哔哩哔哩', scopeLabel, periodName: R.label, period: R.label,
    rangeText: fmtRange(R.startD) + '-' + fmtRange(R.endD), summaryCsv, postCsv, posts, count: posts.length,
    coverFolder: R.label + '_' + scopeLabel + '作品封面', warning: warning.join('；'),
    dataNote: '作品按发布时间筛选，计数为平台返回的累计值。平均播放进度以分秒显示，旁列为占总时长比，二者都不是完播率。多P作品的这两列留空。部分比率仅统计发稿后14天（见列名），3秒跳出率为该作品整体指标。汇总访客为逐日人数合计，未跨日去重。',
  };
}
