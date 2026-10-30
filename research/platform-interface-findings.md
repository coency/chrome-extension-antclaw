# 新平台接口验证记录

验证日期：2026-09-22。来源：用户扫码登录的独立 Chrome 创作者后台；仅检查数据页面。未保存 Cookie、Authorization、签名值或账号个人资料。

## 小红书

接口基址：`https://creator.xiaohongshu.com`。以下均为页面实际发起的 GET 请求。

| 用途 | 路径 | 已确认行为 |
| --- | --- | --- |
| 账号汇总 | `/api/galaxy/v2/creator/datacenter/account/base` | `data.seven`、`data.thirty`，各自带 `begin_time`、`end_time` 及逐日数组 |
| 作品列表 | `/api/galaxy/creator/datacenter/note/analyze/list` | `post_begin_time`、`post_end_time` 为毫秒时间戳；`type=0`、`page_size=10`、`page_num=1`；返回 `data.note_infos` 和 `data.total` |
| 单篇详情 | `/api/galaxy/creator/datacenter/note/base` | 参数 `note_id`；返回笔记信息、总体指标和 `day`、`hour` 时间序列 |

### 已确认字段

- 列表：`id`、`post_time`、`type`、`cover_url`、`imp_count`、`read_count`、`like_count`、`comment_count`、`fav_count`、`share_count`、`increase_fans_count`、`danmaku_count`、`view_time_avg`、`coverClickRate`。
- 详情：`note_info` 包含正文 `desc`、封面及发布时间；正文不能无条件当作标题。列表中的标题可能缺失，网页也会显示“无标题笔记”。
- 详情的 `view_time_avg_with_double` 保留小数；列表的 `view_time_avg` 在样本中只有整数。列表 `coverClickRate=0.127` 对应详情 `cover_click_rate=12.7` 和页面 12.7%，单位必须分别处理。
- 汇总包含曝光、观看、互动、发布、粉丝增减和主页访客等计数及逐日数组；比率和平均值不能直接按日求和。

### 口径及限制

- 内容分析页面注明“仅支持查看近半年发布的笔记数据（不含未发布的定时笔记）”；日期控件标为“笔记首发时间”。列表日期条件不是互动统计周期。
- 账号概览页面提供近 7 日、近 30 日。本次账号汇总的 30 日数组覆盖 2026-08-23 至 2026-09-21，不能据此导出完整的 2026 年 8 月汇总。
- 上一自然周计数可考虑从完整覆盖该周的逐日数组计算，但须逐字段验证日期覆盖及求和；尚未完成导出对照。
- 单篇样本有逐日计数，但尚未验证较老作品的时间序列覆盖范围，不承诺任意周期增量。
- 页面正常汇总请求带 Authorization、Cookie、X-S、X-S-Common、X-T 等请求头。只记录头名称，未保存值。
- 在登录页面中用普通 `fetch(..., {credentials:'include'})` 请求上一自然周列表，实测 HTTP 406、`code=-1`、`success=false`。尚不能复用现有内容脚本的普通 fetch 采集方式；需要进一步验证站内请求机制或读取页面正常请求响应的方案。
- 当前仅定位并验证页面请求，尚未实现扩展接入、封面下载、完整分页和 CSV 对照测试。

## B 站

已确认登录状态并检查数据中心。主页面 `/platform/data-up/video/` 内嵌 `/york/data-center-web/dataCenter/video`；自动化定位控件时需进入对应 iframe。

接口基址：`https://member.bilibili.com`，以下为页面实际使用的 GET 接口。

| 用途 | 路径及参数 | 已确认行为 |
| --- | --- | --- |
| 账号区间总计 | `/x/web/data/v2/overview/stat/num?period=2&tab=0` | `period=0` 近7天，`period=2` 近90天，不能把预设总计直接当自然周/月 |
| 账号逐日趋势 | `/x/web/data/v2/overview/stat/graph?period=2&s_locale=zh_CN&type=play` | `data.tendency` 和 `data.data_tendency.play`，每项 `date_key`（秒）、`total_inc`、`sub_total_inc` |
| 作品列表 | `/x/web/data/archive/index?pn=1&ps=20&scene=archive_compare&order=0` | `data.list`、`data.pager`，后者包含 `pn`、`ps`、`total` |
| 作品对比 | `/x/web/data/archive_diagnose/compare?size=10` | 列表含发布时间、时长和累计互动等指标；有 `bvid` 变体；尚未验证能否覆盖任意作品 |
| 单篇详情 | `/x/web/data/v3/archive/view?bvid=<作品BV号>` | 已观察到真实页面请求，结构待进一步验证 |
| 单篇分析 | `/x/web/data/archive_diagnose/play_analyze?bvid=<作品BV号>` | 已观察到真实页面请求，结构待进一步验证 |

### 已验证结果

- 在数据中心页面中通过普通 `fetch` 携带当前登录态读取列表及90天播放趋势，均返回 HTTP 200、业务 `code=0`。
- 播放趋势返回90天数据，本次更新截至2026-09-20。筛选2026-09-14至09-20，覆盖7天、播放合计29，与页面近7天数值一致。
- 同一数组筛选2026-08-01至08-31，覆盖31天、播放合计13。已验证完整日期覆盖及本地计算；尚未与月度官方导出作独立对照。
- 列表包含 `aid`、`bvid`、`title`、`cover`、`ctime`、`pubtime`、`duration`、`stat`、`real_stat`。筛选发布时间应使用 `pubtime`，不是稿件创建时间 `ctime`。
- 列表存在离线和实时两组指标，样本播放数为24与25；导出应明确选择同一种更新时间口径，不能混用。
- 页面作品对比明确标为“历史累计数据”。`full_play_ratio=6005` 对应“平均播放进度”约60.1%，不是完播率；比例字段不能沿用其他平台的单位。
- 封面主机在样本中为 `i0.hdslb.com`、`i1.hdslb.com`、`i2.hdslb.com`，下载和 HTTPS 可用性尚未实测。
- 其他汇总指标类型、多页列表、单篇完整字段、封面 ZIP、扩展内实际请求与 CSV 对照测试仍需完成。

## 当前交付状态

上文为 2026-09-22 的接入前实测记录。2026-10-28 已在本地实现 B 站接入并启用选项；小红书保持未接入。B 站新实现已通过合成响应回归测试，尚未完成当前版本的真实账号联调。

## B 站实现补充（2026-10-28）

本次读取了官方数据中心公开前端脚本，并未读取真实账号凭证或响应：

- [数据中心入口脚本](https://s1.hdslb.com/bfs/static/creator-monorepo/data-center-web/static/js/js/data-center-web.index.fafffd36906747cf.js)：作品列表字段映射为 `play → view`、`likes → like`、`fans → fans_incr`。官网优先读取 `real_stat`，缺失时回退 `stat`；扩展为保持统一口径，只使用 `stat`，缺失留空并提示。
- [概览页面脚本](https://s1.hdslb.com/bfs/static/creator-monorepo/data-center-web/static/js/async/js/data-center-web.782.76a78288748d976e.js)：官方导出支持以逗号分隔的 `type` 批量请求逐日指标，并读取 `data_tendency[指标].total_inc`。本次实现 `play/like/fav/coin/comment/dm/share/fan`；空间访客涉及去重，不将每日访客直接相加；播放时长指数的适用范围不同，首版不导出。
- 汇总仅在一个指标完整覆盖所选周期且日期唯一、数值有效时输出总量；作品以北京时间 `pubtime` 筛选，保留累计播放、点赞和涨粉量。不将作品累计之和作为账号周期汇总。
- 顶层页面与 iframe 同源，扩展从 `member.bilibili.com` 顶层内容脚本发起同源请求；清单未开启 `all_frames`，防止多份脚本重复处理任务。
- 每页 20 条、最多 200 页，间隔 600ms；按作品标识去重，失败保留已取得的数据并提示。封面仅允许已记录的 `i0/i1/i2.hdslb.com`，HTTP 链接转 HTTPS。

### 当前版本真实账号验收（待执行）

1. 在扩展管理页重新加载本地扩展，再刷新已登录的 B 站创作中心，分别提取上一自然周、上一自然月。
2. 与官网导出的逐日数据逐列对照：确认完整覆盖目标日期，核对增量合计、粉丝负净增及数据更新时间。出现缺日时应留空并提示。
3. 使用有多页作品的账号核对页数和 BV 号；检查月初、月末、旧稿新发布、零播放作品。按发布时间选择作品，对照 `stat` 累计值；官网若显示实时值，差异需按口径核对。逐作品进入单篇概览，对照新增的评论、收藏、投币、分享、弹幕五列。
4. 下载汇总 CSV、明细 CSV、封面 ZIP，核对标题转义、中文编码、封面与 BV 号对应关系。
5. 关闭并重新打开弹窗，检查任务完成、失败恢复、部分成功下载及冷却。确认小红书仍不可选择。

自动测试命令：`node --test tests/*.test.cjs`。测试数据为合成响应，不应据此声称已完成真实接口验收。

### 单篇互动补充（v1.2.1，2026-10-28）

- 官方入口脚本中的单篇概览请求为 `GET /x/web/data/archive_diagnose/overview?bvid=<BV号>`；[单篇概览页面脚本](https://s1.hdslb.com/bfs/static/creator-monorepo/data-center-web/static/js/async/js/data-center-web.7890.36a1ecf951384a0a.js) 调用此请求并用 `stat.comment/fav/coin/share/dm` 展示评论、收藏、投币、分享、弹幕。
- 扩展仅对筛选、去重后的作品请求该接口，最多两并发。同一工作流请求之间间隔 600ms；异常留空并汇总提示，不回退到实时数据或零值。登录失效时停止后续补充请求，保留列表和已取得的明细。
- [播放分析页面脚本](https://s1.hdslb.com/bfs/static/creator-monorepo/data-center-web/static/js/async/js/data-center-web.5865.7cc2e305fc40074a.js) 将 `quit_info.full_play_ratio / 100` 显示为「平均播放进度」百分比。它表示观看进度，不是完整播放次数占播放次数的比例。虽然页面说明文字提及提升完播率，但本次未找到可确认的独立完播率字段，因此未新增完播率列，也不将平均播放进度冒充为完播率。
- 本次验证依据为公开前端脚本和合成响应测试，五个补充字段仍待真实登录账号对照。

### 扩展统计补充（v1.3.0，2026-10-28）

本轮再次读取官网数据中心及其公开脚本，未调用真实账号的统计接口。以下更新覆盖首版关于访客和时长暂不导出的限制；并不表示所有账号都会返回所有字段。

- [粉丝分析脚本](https://s1.hdslb.com/bfs/static/creator-monorepo/data-center-web/static/js/async/js/data-center-web.8359.c7bfdfde8ff6896d.js)：`v3/fans/stat/export?period=2` 提供近 90 天序列。`data_tendency_follow/unfollow` 中的 `date` 为秒级日期，`fans_total_inc` 为对应日关注/取消关注量。`data_tendency_total` 的同名值实际为净增，不能取最后一天冒充总粉丝。扩展只在日期完整、唯一且计数有效时汇总关注增减。
- [概览脚本](https://s1.hdslb.com/bfs/static/creator-monorepo/data-center-web/static/js/async/js/data-center-web.782.76a78288748d976e.js)：`visitor` 是空间访客，导出明确命名为“逐日人数合计”，不称周期独立访客。`vt` 是播放时长指数，单位分钟；页面对账号及日期预设有适用限制，因此独立请求，不支持 90 天或缺日时留空。不能用播放量与作品时长估算此指标。
- [稿件对比查询脚本](https://s1.hdslb.com/bfs/static/creator-monorepo/data-center-web/static/js/async/js/data-center-web.2853.4c31749fbcc6e123.js)：请求 `archive_diagnose/compare`，传 `compare_bvids`（选中的 BV 号逗号分隔）及 `size=10`。扩展每批最多 10 篇，按返回 `data.list[].bvid` 精确关联，取 `stat`，不取 `hour_stat`。响应漏项、重复 BV 或失败均留空并提示，不能用默认推荐作品代替。
- [指标定义脚本](https://s1.hdslb.com/bfs/static/creator-monorepo/data-center-web/static/js/async/js/data-center-web.3962.d765cfae33c9c0b1.js) 的模块 `91245` 给出字段、说明和计算方式；[对比组件脚本](https://s1.hdslb.com/bfs/static/creator-monorepo/data-center-web/static/js/async/js/data-center-web.7883.56e1829062e86c10.js) 以万分数格式化比例；[对比帮助脚本](https://s1.hdslb.com/bfs/static/creator-monorepo/data-center-web/static/js/async/js/data-center-web.1242.34a5346621aec31e.js) 说明点击、跳出和互动的前 14 天范围。

| 对比 `stat` 字段 | 导出解释及单位 |
| --- | --- |
| `unfollow` | 取关量，仅支持 2024-06-01 及以后发布的作品 |
| `vt` | 播放时长指数（分钟） |
| `avg_play_time` | 平均实际观看时长（秒），不以作品时长封顶 |
| `full_play_ratio` | 平均播放进度，原值除以 100 后加百分号；不是完整播放次数比例 |
| `play_viewer_rate`、`active_fans_rate` | 游客播放占比、粉丝观看率；分母不同，不能互相相减补齐 |
| `crash_rate`、`crash_fan_rate`、`crash_viewer_rate` | 总体、粉丝、游客的 3 秒跳出率 |
| `interact_rate`、`interact_fan_rate`、`interact_viewer_rate` | 对应互动数/播放数，可以超过 100% |
| `play_trans_fan_rate` | 播转粉率，涨粉量/游客播放量 |
| `tm_pass_rate`、`tm_fan_pass_rate`、`tm_viewer_pass_rate` | 点击表现超过同类稿件的比例，不是实际点击率 |
| `tm_star`、`tm_fan_star`、`tm_viewer_star` | 点击表现星级，原值除以 10；相关列标记前 14 天 |
| `like/comment/dm/fav/coin/share` 与 `play` | 用同一响应计算点赞/评论/弹幕/收藏/投币/分享率；任一缺失或分母零即留空 |

官网在零播放等场景的展示函数可能回退为零；扩展不沿用这种展示兜底。仅保留接口明确给出的有效零值，缺失与异常值留空，百分比不猜测单位。没有独立完播率来源时不创建完播率列；平均时长除作品时长也不能替代平均最大观看进度。

未导出：周期末总粉丝（现有逐日值是净增）、独立完播率、未确认单位的时长候选值及充电金额、与所选周期不一致的人群画像。空间访客求和不声称跨日去重。基础明细来自列表和概览，新增比率来自对比接口，不同接口更新时间可能导致数值略有差异；六项计算比率始终在同一份对比响应中计算。

新增合成测试覆盖字段顺序和单位、进度与完播区分、百分比边界、零与缺失、分母零、时长超过作品时长、逐日缺失、可选接口失败、按 BV 号匹配乱序/缺项/重复响应、十篇分批及登录失效停止后续请求。当前真实账号联调仍待执行。

### 字段精简（v1.3.1，2026-10-28）

按用户确认，汇总删除原第 12、13、15 列（新增关注、取消关注、时长指数），保留 12 列。作品明细删除原第 14、15、18、20、21、23、24、26—37 列，保留 18 列，顺序见 README。

当前不再请求 `v3/fans/stat/export` 或 `type=vt`，也不再解析被删除的对比字段或计算六项单独互动率。以上 v1.3.0 的接口研究保留为历史记录，不代表当前导出字段。原第 19 列现为第 16 列，仍读取 `stat.crash_rate`：该作品整体播放不足 3 秒的播放量/总播放量，涵盖粉丝和游客；与 `crash_fan_rate`、`crash_viewer_rate` 区分。

### 平均播放进度展示修正（v1.3.2，2026-10-28）

用户提供的 9 月 19 日作品截图显示“平均播放进度 0分20秒 / 占总时长 67.5%”。重新检查[播放分析组件](https://s1.hdslb.com/bfs/static/creator-monorepo/data-center-web/static/js/async/js/data-center-web.5865.7cc2e305fc40074a.js)，发现之前只关注了百分比展示分支，忽略了截图所用的分秒加占比展示分支。

- `quit_info.avg_play_progress` 是进度秒数，页面分别取 `floor(value / 60)` 分与 `floor(value % 60)` 秒。
- `quit_info.full_play_ratio / 100` 保留一位小数，展示为占总时长百分比；不以已取整秒数反算。
- 这不是被删除的播放时长指数 `vt`，也不是实际观看耗时 `avg_play_time`。后者位于另一展示分支，不能拿来补进度秒数。
- 该组件调用模块 `14879` 的 `r6`，对应入口脚本函数 `G`，实际接口是 `GET /x/web/data/v2/archive/analyze/graph?cid=<CID>`，不是 `archive_diagnose/play_analyze?bvid=...`。上文旧记录中的页面/接口关联以本节修正为准。
- [稿件页面](https://s1.hdslb.com/bfs/static/creator-monorepo/data-center-web/static/js/async/js/data-center-web.5408.9378b715bf253f88.js) 从 `v3/archive/view?bvid=...` 的 `videos[].cid` 选择分 P。扩展优先复用列表的分 P 信息，缺失时查询详情，仅单 P 作品输出这两列。多 P 的单个 CID 数据不能代替整篇作品，不默认选择第一 P。

明细现为 19 列：第 14 列平均播放进度（分秒），第 15 列占总时长比，其余保留字段顺序不变。两项各自校验缺失与无效值，保留接口明确给出的零，不读取页面展示函数的默认零值，也不混用对比接口的进度占比。

本次未读取该作品的真实接口响应。截图示例回归使用合成 `avg_play_progress=20.25`、`full_play_ratio=6750` 验证显示规则，不代表已确认这篇作品的原始秒数恰好为 20.25。真实原值可能被页面取整或四舍五入，应以登录账号重新提取为准。
