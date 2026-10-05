# 核实来源

- PRODUCT.md：用户当前完整目标及授权；父线程 01a10a5b-7f1a-7017-afb5-2681ffc95023 最新完整授权消息再次只读核对。
- server/turn-engine.ts、turn-prompt.ts、action-coach-contracts.ts：当前单生成链、来源约束、可选事件增量、有限修复。
- server/store.ts、memory.ts、campus.ts、http.ts：事务提交、记忆开关/抑制、来源失效、现有认证接口。
- src/features/conversation/ConversationPage.tsx、ConversationSummary.tsx；src/features/cognition/graph.ts：实际产品入口及图谱范围。
- server/migrations/000–013：当前已存在迁移。新功能只用增量迁移。
- [百炼模型大全](https://help.aliyun.com/zh/model-studio/models)：2026-10-05 直接读取官方页面，列出 qwen3.8-flash / qwen3.8-max / qwen3.7-plus / deepseek-v4.1-flash 等；这不是本账号接口成功证据。
- [百炼模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)：2026-10-05 可读，阶梯按整次输入范围计费、缓存价格独立；具体候选价格需选定部署地域和输入区间后摘录，当前没有改价格/模型。

搜索的非官方结果未用作模型可用性或价格依据。

## GitHub 复用优先（用户 2026-10-05 新规则）

本批沿用已有 pg / TypeBox / better-auth / pi-ai / Playwright，不引入迁移型 UI 或代理框架。成长控件接现有认证与 API，源校验调用已有 checkCampusSource；省去另建身份、持久化框架和模型平台。原 Companion/2D 资产、原主题样式和 Canvas 代码未改，新增页面适配旧 UI。

已读公开 [Mozilla Readability](https://github.com/mozilla/readability) README/API：Apache-2.0、实际 Readability.js/JSDOMParser.js 与 test 目录；只作为下批网页提取候选，尚未下载/执行/复制代码。Node 需要 DOM，脚本和外部资源默认禁用；纯文本产物优先，发布日期可能为空。官方短通知不能依靠默认 500 字阈值必定抽出正文。

已读 [TanStack Virtual](https://github.com/TanStack/virtual)：MIT、局部 React adapter 候选，尚未安装。父线程进一步只读核实 Cheerio MIT/当前 Node 范围、Virtual 3.14.13 和 Playwright 现有 Chrome/CDP 复用；锁定版本前仍需核对源码/测试/许可。当前记录数少，先使用原生语义表单和既有状态，后续分页再按真实规模引入 virtual。

## 百炼候选模型核实

官方价格页华北2北京、2026-10-05读取：Qwen3.8 Flash 输入/输出 ¥0.8/¥2.7 每百万token，Max ¥12/¥36；Qwen3.7 Plus ≤256K 原价 ¥2/¥8（限时优惠不作为长期预算保证）。缓存费率须单独核实，不把免费额度假定为账号现余额。

[官方结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output) 列出 Qwen3.8 Max/Flash、Qwen3.7 Plus/Flash/Max 的 JSON Schema 支持。已有SDK/传输可复用，实际账户及新结构能力仍需真实收据，当前没有更换生产模型。

第三批再次实际核实：官方结构化输出与模型大全可直接读取；价格页在 web 工具两次超时后，本机只读下载成功，保存 `.local/campus-growth/official-model-pricing.html`，SHA256 `0d63b40f60bff1500ca07dd2a1bf3e2d26863ac2844692b1e3cc9b619286b204`。当前北京 Max 12/36、Plus ≤256K 原价2/8、高于256K为6/24，价格档和临时折扣分开。小样本配置只使用已有128K运行上下文档；不预设免费额度或缓存折扣，缓存 token 按完整输入单价保守估算。未知费用仍为未知，不把估算当账单。官方公开支持不证明当前账户模型权限。

候选传输继续复用当前 pi-ai 和 TypeBox，Max/Plus 与 Flash 均关闭思考并使用同一严格 Schema；默认仍 Flash，候选只通过临时进程配置比较。动态成长更正和观察依赖进一步约束真实授权ID/版本配对；首次无成长依据不生成持久化AI观察。新校园夹具及操作入口复用原独立数据库/真实认证/人工逐条输入/同一预算观察器，不安装新的基准框架。

父线程新增受控高推理对照后，核对[官方深度思考](https://help.aliyun.com/zh/model-studio/deep-thinking)：Qwen3.8/3.7可用 enable_thinking 与 thinking_budget；max_completion_tokens 限制思考加回答的总长度。比较仅增加一档2048思考token，上限输出仍8192；实现限配置预算0–4096且必须小于总输出，不默认最高档、不同时传 reasoning_effort。实际已安装 pi-ai@0.73.1 的 openai-completions.js 在 HTTP create 之前等待 onPayload 并使用其返回对象；其 usage.completion_tokens 含推理token，text 与 thinking content 独立。模拟 SDK 回归证实参数传输/完整输出token统计/不显示或保存内部思考。官网控制台默认预算不等于本项目实测档；收益待同场景实测，不能宣称已经更聪明或更快。
