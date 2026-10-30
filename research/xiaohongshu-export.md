# 小红书本地开发版（2026-10-30）

> 2026-10-30：用户已取消小红书功能。对应提取、导出、站点权限和临时验证入口已从本地扩展移除；下文仅为历史研究，不再继续开发或验收。
>
> 最终月汇总样本核对：用户提供的 2026 年 9 月验证 JSON 中，5 次请求均返回有效 XLSX，10 张工作表的单元格内容完全相同。9 张逐日趋势均为 2026-09-30 至 2026-10-29，每张 30 天、无重复，逐日数值之和与文件总表相符。3 组假设的历史日期参数均未改变返回范围，缺少 9 月 1—29 日，不能作为完整 9 月账号汇总；不证明不存在其他未公开参数。原始账号样本只保存在用户本机。


以下为取消功能前的研究记录，当时位于 `codex/xiaohongshu-export`；该分支现已删除，功能代码未保留。2026-10-30 已用真实账号完成自然周汇总、自然周/月图文明细与封面导出核对；视频专属字段和真实多页列表尚未验收，不能将当前结果视为全部功能验收通过。

## 请求依据

2026-09-22 的真实页面接口观察见 [接入前记录](platform-interface-findings.md)。2026-10-30 进一步核对了 [小红书创作服务平台](https://creator.xiaohongshu.com/) 公开页面加载的官方脚本：

- [入口与 API 映射](https://fe-static.xhscdn.com/formula-static/ugc/public/resource/js/index.9246593c.js)：`QUERY_ACCOUNT_DATA`、`NOTE_ANALYZE_LIST`、`BASE_NOTE_INFO` 对应下表三个路径。
- [页面共用模块](https://fe-static.xhscdn.com/formula-static/ugc/public/resource/js/2931.a0a5f7e5.js)：模块 `62376` 是已配置的 HTTP 客户端，具有 `get` / `makeUri` / `interceptors`，支持 `transform:true` 和 `extractData:true`。
- [数据中心 API 包装器](https://fe-static.xhscdn.com/formula-static/ugc/public/resource/js/async/4323.64b69cf9.js)：模块 `74686` 通过同一个客户端发出 GET 请求。
- [账号概览](https://fe-static.xhscdn.com/formula-static/ugc/public/resource/js/async/5792.064bc204.js)：逐日数组为 `{date,count}`，日期以毫秒交给 `new Date`；每个 seven/thirty 窗口附带 `beginTime` / `endTime`。`viewTimeList` 对应观看总时长，单位秒。观看与互动范围为近半年发布的笔记，粉丝与发布指标按账号口径。
- [笔记列表](https://fe-static.xhscdn.com/formula-static/ugc/public/resource/js/async/2179.51908cd7.js)：`postBeginTime` / `postEndTime` 以毫秒筛选笔记首发时间；类型 0 全部、1 图文、2 视频，页大小支持 10 / 20 / 50。
- [单篇详情](https://fe-static.xhscdn.com/formula-static/ugc/public/resource/js/async/5111.b4648751.js)：视频判断为 `noteInfo.type === 'VIDEO'`。详情平均时长为 `viewTimeAvgWithDouble` 秒，`fullViewRate` 为完播率，`exitView2sRate` 为 2 秒退出率。

| GET 用途 | 路径 |
| --- | --- |
| 账号汇总 | `/api/galaxy/v2/creator/datacenter/account/base` |
| 笔记列表 | `/api/galaxy/creator/datacenter/note/analyze/list` |
| 单篇统计 | `/api/galaxy/creator/datacenter/note/base` |

连接器以 Chrome 声明式 [MAIN 执行环境内容脚本](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts#run_time_and_execution_environment)运行。通过页面既有的 `webpackChunkugc` 取得运行时，只取已核实的客户端模块，并校验 API 映射的协议、主机及完整路径。模块或映射变化时停止并提示，不扫描未知模块、不自动切换接口、不下载或执行远程代码。

GET 调用经过官网自身的拦截器处理正常认证和签名。扩展不读取、保存或复制凭证，不接受自定义 URL、请求头、账号标识或写入请求。连接器与采集器之间只传导出所需字段和固定错误类别，不传原始异常（可能包含请求头）。页面本身能访问 MAIN 环境，连接消息不作为网站身份认证凭证；连接器不具有扩展存储、下载等权限。

## 统计口径与保护

- 汇总逐列检查窗口起止日期和每日数据；缺日、重复日期、非法值、溢出时该列留空。不会拼接不同窗口的数据，不累加每日平均值和比率，不推算缺失日期。
- 上一个自然月常常无法被近 30 天覆盖。全部汇总指标不可用时禁用汇总下载；可用作品明细仍可导出，并明确显示原因。
- 列表按北京时间首发日期筛选，最多 200 页、每页 50 条；再次核验返回的发布时间、作品标识及总数。重复页、中途失败、总数变化、提前空页或达到上限都提示不完整。
- 作品计数为累计值；官网不同指标有不同更新频率。曝光等指标截至昨日，观看与部分互动为实时值。不能用这些作品的累计之和替代账号周期汇总。
- 单篇只有明确为视频的作品才补充完播率及 2 秒退出率。详情标识或类型不匹配时不使用该详情。缺失、负数哨兵值留空，真实零值保留。
- 列表 `coverClickRate` 是 0–1 小数比例（0.127 → 12.70%），详情是百分数（12.7 → 12.70%），不采用同一种缩放。平均观看时长以秒表示，与完播率独立。
- 串行读取，请求启动间隔至少 600ms；官网客户端请求超时 15 秒，连接总等待上限 30 秒。登录失效、请求被拒绝、连接超时后停止后续请求；单次提取接近 25 分钟时停止并保留已获得的数据，避免超出共享任务锁期限。
- 封面只接受已授权的 `*.xhscdn.com` HTTPS 地址（官方 HTTP 链接转 HTTPS），拒绝带账号密码、额外端口和其他主机的地址。

## 取数与核对方式

点击插件「提取数据」后，由页面内脚本通过 API 获取数据，结果交给扩展后台保存；关闭弹窗不取消任务，不需要持续点击网页、滚动或让该窗口保持前台。需保留已登录的创作后台标签页，关闭或刷新该页会中断页面内任务。当前没有自动定时启动采集的功能。

本次操作网页是为了下载官网原生表格，与插件结果独立交叉核对，不是插件取数的必要步骤。用户已要求不再占用前台鼠标键盘；后续开发核对使用已保存的文件和本地测试，不继续控制浏览器窗口。

## 本地验证

2026-10-30 执行 `node --test tests/*.test.cjs`，102 项全部通过，覆盖 B 站既有字段、共享任务状态及 24 项小红书检查。包括完整数据、自然月覆盖不足、逐日缺失和重复、百分比单位、真实零值、分页中断、登录失效停止、单篇身份匹配、字段过滤、消息来源、超时及任务时限。这些测试使用合成数据，未接触账号凭证。

## 真实账号核对结果（2026-10-30）

实际加载目录 `D:\Codex\chrome-extension-antclaw` 中的 1.4.0 扩展，并与同一账号下载的官网 Excel 对照。原始 CSV、Excel、ZIP 和逐项核对记录仅保存在本机临时目录，不进入仓库。

| 检查 | 结果 |
| --- | --- |
| 上一自然周（10 月 19—25 日）汇总 | 官网近 30 日观看、互动、涨粉、发布表中筛出对应 7 天，14 个可对照指标逐项相等。汇总弹幕量无独立官方导出依据，本次未核实 |
| 上一自然周作品 | 1 篇图文，13 个共同字段与官网笔记明细全部相等 |
| 上一自然月（9 月）作品 | 16 篇图文，数量一致，13 个共同字段共 208 项对照全部相等 |
| 9 月账号汇总 | 官网近 30 日覆盖 9 月 30 日至 10 月 29 日，不能覆盖整月；插件正确禁用汇总下载，未补零或用作品数据代替 |
| 缺失与零值 | 官网标题为空的作品在 CSV 中仍为空；真实零值保留；图文的完播率与 2 秒退出率留空 |
| 封面 ZIP | 周度 1 张、月度 16 张；压缩包条目与明细封面文件名集合一致，每张图片均成功解码校验 |
| 弹窗恢复与文件名 | 关闭重开后恢复已完成结果；修复周期名称与封面重复平台前缀，实际下载时已确认月度 CSV、ZIP 文件名 |

明细对照字段为标题、首发时间、体裁、曝光、观看、封面点击率、点赞、评论、收藏、涨粉、分享、人均观看时长和弹幕。汇总与作品明细统计口径不同，未用作品累计之和验证账号周期汇总。

## 视频样本配合方式（1.4.1）

1.4.1 完整回归共 105 项通过；新增检查覆盖样本原值与正式映射、最多三篇和六个月范围、日期校验、任务锁、结果隔离、失败冷却，以及只有用户点击下载才弹出保存窗口。视频样本入口仍需用户在真实账号点击后确认接口返回。

在小红书创作后台点击插件「小红书视频样本」，以原生客户端查询类型为 2 的视频列表。默认逐月查本月及前五个月，最多选 3 篇；也支持用户指定首发日期。单月最多 20 页、每页 50 条，仅用于挑选样本，不声称导出全部视频。类型、日期、标识及总数异常时停止并标注；发生登录失效、接口限制或超时时保留已取得的样本，停止新请求。

JSON 包含必要字段的存在状态、原值、采集时间和正式导出映射结果。采集器与常规明细共用 `xhsApplyVideoDetail`，避免样本与正式 CSV 使用不同单位。小红书样本独立保存；B 站固定日期样本入口及专用脚本已按用户要求删除，B 站正常导出保留。

由用户重新加载扩展、刷新创作后台、点击样本入口，之后即可使用其他软件。完成时不主动下载或弹出保存窗口，用户空闲时再下载 JSON，并提供同篇视频后台可见的四项指标截图。不能把 JSON 与自身映射对照当成独立官方界面验收，未显示字段仍标记未核实。

## 尚待验收

- 本次两个周期均为图文，视频的精确平均观看时长、详情封面点击率、完播率和 2 秒退出率只通过代码及合成响应检查，未与真实视频核实。
- 16 篇作品不足插件每页 50 条，真实跨页尚未验证；分页异常和完整性已有合成测试覆盖。
- 缺少可独立对照的汇总弹幕量样本；完整上月账号汇总受近 30 日接口窗口限制，不能声称已核实。
- 保留开发分支，待剩余真实样本核对完成后再合并到 `main`。未经用户另行要求，不推送 GitHub。


## 其他自然月汇总接口排查（2026-10-30）

用户要求只在后台检查，不占用鼠标键盘。本次使用普通 HTTP 请求下载官网公开 HTML 和脚本，结合已有真实导出记录；没有操作浏览器，没有读取浏览器登录凭证，没有向账号接口发起新的登录态测试。重新取得的官网 HTML 仍引用 `index.9246593c.js` 与 `bundler-runtime.2a9031f0.js`。下载证据与校验摘要保存在本机临时目录，未纳入仓库。

结论：发现了其他导出与机构统计路径，但未找到已证实可让当前普通创作者账号取得上一个自然月完整账号汇总的替代接口。以下是对官网调用方式的核实，不等于证明服务器绝对不支持未公开的参数或其他账号权限。

| 候选 | 官方调用与用途 | 对完整自然月的判断 |
| --- | --- | --- |
| `GET /api/galaxy/v2/creator/datacenter/account/base` | 新旧账号概览均读取 `seven` / `thirty`。当前界面调用未传历史起止日期 | 已实测滚动近 30 日，不能补回本次 9 月缺失日期 |
| `GET /api/galaxy/v2/download/creator/datacenter/account/analyze` | 目前官网账号导出调用。参数 `data_type` 区分观看、互动、涨粉、发布；`days` 使用枚举 `Week=1`、`Month=2`，按钮与文件名分别标为近 7 日、近 30 日；调用未传日期 | `Month=2` 是近 30 日，不是上一个自然月。没有发现自然月选项或历史日期参数的官方调用 |
| `/api/galaxy/creator/datacenter/account/analyze/download` | 入口 API 映射还保留 `ACCOUNT_DATA_DOWNLOAD`，本次下载的当前统计页面及包装模块中未找到实际调用 | 只确认路径映射存在；方法、参数、服务端是否仍提供数据及历史范围未验证，不声称可用或不可用 |
| `GET /api/galaxy/creator/datacenter/note/analyze/download` | 笔记列表导出复用 `postBeginTime` / `postEndTime`，日期条件对应首发时间 | 按发布周期导出作品累计值，不能当账号当月新增统计 |
| `GET /api/galaxy/creator/datacenter/note/basic/data/download`、`.../note/interact/data/download` | 单篇导出只传 `noteId`。当前单篇部分趋势还注明最多更新至发稿后 14 天／72 小时 | 未发现完整任意历史月的保障；单篇数据也不能补全账号掉粉、主页访客等指标 |
| `POST /api/galaxy/v2/creator/datacenter/livedata/overview` | 账号页自定义日期传给此接口，使用 `userId`、`startTime`、`endTime`，读取 `liveOverviewData` | 自定义时间属于直播数据，不是笔记账号汇总 |
| `/api/galaxy/creator/data/fans/overall_new` 等粉丝接口 | 当前粉丝页仍为近 7 天／近 30 天，选择 `seven` / `thirty` | 未发现自然月历史补查能力 |
| `/api/galaxy/mcn/data/kol/user_statistics`、`.../query_note_statistics` | 机构接口映射存在；追查公会主播页后发现当前标签配置仅启用 `LiveData`，日期筛选用于直播请求；保留的 `NoteData` 枚举不等于功能启用 | 未证实当前普通创作者账号有权限，也未证实能返回所需自然月指标；没有试用其他账号 ID 或绕过权限 |

### 可复核的官方来源

- [官网入口/API 映射](https://fe-static.xhscdn.com/formula-static/ugc/public/resource/js/index.9246593c.js)：上述路径及统计页面加载关系。
- [账号统计共用模块 3074](https://fe-static.xhscdn.com/formula-static/ugc/public/resource/js/async/3074.47ee67a9.js)：模块 `73675` 明确账号导出使用 `INDICATORS_DOWNLOAD`；`CE` 枚举为 `Week=1, Month=2`；直播概览使用 POST。
- [新版账号概览 5792](https://fe-static.xhscdn.com/formula-static/ugc/public/resource/js/async/5792.064bc204.js)：`g.TM({data_type,days,mock_user_id})` 是官网导出调用，文件名前缀是近 7 日／近 30 日；自定义日期调用 `g.xQ` 并读取直播指标。研究只记录参数名称，没有采用 `mock_user_id` 获取他人数据。
- [旧账号概览 7721](https://fe-static.xhscdn.com/formula-static/ugc/public/resource/js/async/7721.f736df4f.js) 与[旧版组件 9832](https://fe-static.xhscdn.com/formula-static/ugc/public/resource/js/async/9832.16f76777.js)：同样区分笔记近 7／30 日与直播自定义日期。
- [笔记请求包装 4323](https://fe-static.xhscdn.com/formula-static/ugc/public/resource/js/async/4323.64b69cf9.js) 与[单篇页面 5111](https://fe-static.xhscdn.com/formula-static/ugc/public/resource/js/async/5111.b4648751.js)：单篇基础／互动导出传 `noteId`，未传历史起止日期。
- [粉丝页面 7763](https://fe-static.xhscdn.com/formula-static/ugc/public/resource/js/async/7763.2a33fcee.js)：总体与新增、流失粉丝使用 `seven` / `thirty`。
- [公会主播页面 9536](https://fe-static.xhscdn.com/formula-static/ugc/public/resource/js/async/9536.61c7ea18.js) 与[公会模块 6887](https://fe-static.xhscdn.com/formula-static/ugc/public/resource/js/async/6887.ed79a82b.js)：`74826.Gr` 仅为 `[LiveData]`，自定义时间按直播 `timeFilter` 传递；不能仅凭未启用的 `NoteData` 枚举判断存在可用笔记月汇总。
- [蒲公英官方帮助](https://pgy.xiaohongshu.com/help/detail)确有合作笔记自定义区间与开放接口说明，但属于商业合作场景，文档同时说明与创作中心的统计口径差异；[聚光官方报表说明](https://ad.xiaohongshu.com/next_help/docs/eae1a1c3fbf7b7390e7aa5657161638a)的历史分月数据属于广告报表。两者均不能据此替代当前账号完整内容汇总。

### 实施边界

本轮没有把候选路径接进正式导出，也没有猜测 `days=60/90` 或随意添加日期参数并将响应当作历史结果。未返回目标月全部日期的响应不能用于月汇总。

后续若要保证未来自然月统计，可另行实现本机逐日历史保存：在接口窗口过期前定期采集，按账号、日期、指标隔离并记录更新时间，仅完整覆盖时求和。该能力当前尚未实现，且无法追回已经错过的历史日期。平均值、比率与跨日去重人数仍需各自正确口径，不可直接按日相加。


## 旧下载路径登录态诊断入口（1.4.2，待用户点击）

本地完整回归 `node --test tests/*.test.cjs` 共 116 项全部通过。真实旧接口响应尚待用户通过样本入口取得，测试不代表服务端支持历史月份。

用户已授权继续验证旧下载接口，并要求沿用样本方式、不操作前台浏览器。新增「小红书9月汇总验证」，独立保存 `xhsMonthProbeResult`，不覆盖 `lastResult` 或 `xhsSampleResult`。本次仅开发采集入口，尚未实际读取该账号的旧接口响应，不能更新为“已取得9月汇总”。

旧接口键为 `ACCOUNT_DATA_DOWNLOAD`，完整路径严格限定 `/api/galaxy/creator/datacenter/account/analyze/download`。使用官网原生 GET 客户端与正常拦截器，`responseType:'blob'`、`transform:false`、`extractData:false`；不复制 Cookie、签名或认证头，不请求其他账号 ID，不接受任意 URL／请求头／方法。这里选择 GET 是只读诊断尝试，旧接口具体参数仍未证实。

先请求一次已验证的 `summary` 以记录当前滚动窗口边界，再按顺序尝试下列固定参数。总计最多 6 次请求，串行且间隔至少 600ms，不在失败后重复同一请求：

1. 无参数默认请求，观察路径是否仍返回数据或必填参数错误。
2. `{data_type:0, days:2}`，仅参考新版观看数据近 30 日请求作为对照，未确认旧接口同义。
3. 上述参数加 `start_time` / `end_time`，北京时间 2026-09-01 00:00:00 至 2026-09-30 23:59:59 的毫秒时间戳。
4. 改用 `begin_time` / `end_time` 的同一组毫秒时间戳。
5. 使用 `start_date:'2026-09-01'` / `end_date:'2026-09-30'` 的日期字符串。

日期参数均为假设，不宣称官方支持。HTTP 404/410、登录失效、访问限制、超时、HTML 登录/拦截页等情况停止后续尝试；保留已有错误证据。未知必填参数错误可继续余下固定组合，但没有无限扫描。连接器只传响应体与固定错误类别，不传异常对象、请求配置或请求头；JSON 递归过滤认证等字段。成功响应由官网客户端剥离 HTTP 外壳后不再含状态码，因此不伪造 200。

ZIP/XLS/CSV 文件按编码字节放入 JSON；JSON 错误和统计响应保留必要内容，超过长度／深度上限明确标记 `truncated`，超过文件大小限制则标为 `oversize`。不完整或未知格式不能证明整月数据可用。用户主动下载后，可在本机解码文件并检查实际日期、缺日、重复日期和指标口径。`completeMonthVerified` 在采集阶段始终为 false，避免把 HTTP 成功、返回文件或日期参数原样回显当作整月验收。

即使首轮取得观看分类的完整 9 月数据，仍须进一步核实其他汇总字段；取得单个分类不能宣布完整汇总已实现。没有参数生效或日期覆盖证据时不接入正式导出。
