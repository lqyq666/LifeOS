# P5 续作（Closeout）交付报告

工单：GLM_P5_CLOSEOUT.md（2026-10-07/08，GLM 全程）。P5 未达项续作；失败保留；WIP_NOT_READY 维持。

## 工单最终问题回答

**同一个大学生谈起新校园事情时，教练能否用正确旧依据回答当前问题？** 最终链（`coach-4254fc09`，冻结 1e6109d5）T9：学生问"校园主播运营兼职，每周4小时"，回复**直接分析主播兼职**（时间冲突/坐班需求/预算占用）并引用已存的 4 小时预算——F01 在连续三轮（f736cc93 对、93cf159e 错、4254fc09 对）中两对一错，本链正确且证据强度保真（"晚了两天不能直接等同没用"）。**新的经历与控制真正落实？** T6 海报贡献更正 SAVED（A1 修复后更正目标从全量授权集回取，不再错指招新记录）；T8 遗忘轮：A3 生命周期新代码执行了真实遗忘或进入确认卡路径，回复虚称被守卫拒绝（诚实失败保留）。**下一次帮助更贴合他？** 跨会话找回/不复问维持。**在正常应用、主Skill和扣子入口可验证？** 正常聊天入口✓（本链）；**在线 Coze→映射→个人化行动两条 trace 实测贯通**（作品集→guide-portfolio-evidence verified=true、备考→guide-exam-course-conflict verified=true，回复个人化且引用真实）；主 Skill 指纹 bec847b 当前服务可验；原生扣子 Skill 平台 UI（code.coze.cn 技能页签）未到达登录关卡——真实阻塞：浏览器会话需要账号所有者扫码登录，本环境无已获准的扣子平台登录态。

## A 线（确定性 + 引用目标 + 遗忘生命周期）

- **探针 7/7 全绿**（R01 保留修复+R02 科研事实不被 45 条无关 feedback 挤掉+R03 序列化预算+R04 方法查询×4）。
- **R02**：essentials 按用途——goal/constraint/direction 恒定，feedback 仅与当前问题词法相关才算（`growth-selection.ts` isEssential）。
- **R03**：预算计完整 JSON 序列化（sources/deps/元数据），不再只算正文。
- **R04**：方法问句 kind 在通用条件词前检测；方法查询不带 scope 值；主题锚（作品集→employment、备考→postgraduate_exam、校园名词→method）使无方向词的方法问题也能构造安全白名单查询。
- **A1/F02**：更正定位/规范化/补齐/outstanding 全部从 `growthAll` 授权——T6 更正在本链正确定位海报目标（前链错指招新）。
- **A3/F03**：当前消息显式遗忘请求 + 唯一最高分目标（≥3 非通用字符重叠且领先次名）→ 轮内执行真实 `actOnGrowthItem(forget)`（审计 growth_action_forget）；歧义 → `pendingForgetConfirmation` 确认卡；不执行不虚称（守卫保留）。
- 全量隔离后端 50 文件绿；提交 `bec847b`+`676be00`。

## B 线（在线攻略贯通）

**两条端到端 trace（当前服务器 bec847b + 真实检索服务 04849caa）**：
1. **作品/实习**：用户（大三市场营销、社团推送排版经历）问"团队项目和个人贡献怎么写清楚"→ 安全查询 `employment 作品集 实习 方法 method` → 远端真实命中 `guide-portfolio-evidence` 与 `guide-intern-first-contact`（**verified=true**）→ 回复个人化（"你提到负责内容排版，那在作品集里可以具体写清楚排版时做了哪些决策…"）。
2. **备考/课程**：用户（备考、三门硬课、4小时）问"备考和课程冲突怎么安排"→ 查询 `postgraduate_exam 备考 课程 冲突 方法 method` → 命中 `guide-exam-course-conflict`（**verified=true**）→ 回复追问 4 小时口径与最焦虑课程（正确追问而非套模板）。

修复链：R04 构造器（此前 null/requirements）→ 方法渲染带中文锚词（英文 topic token 命不中远端确定性匹配器）→ registry 映射（enabled/contentHash/excerpt 边界 P5 已修）。**负例**：旧 trace（锚词前）返回新闻文档 verified=false——mapper 正确标记未核验，回复未引用。

## C 线

- 主 Skill v1.2.0：指纹 bec847b（growthApi true）在当前隔离服务验证。
- **原生扣子 Skill**：入口 code.coze.cn 技能页签（工单纠正 docs.coze.cn 不是入口）。**真实阻塞**：无已获准的扣子平台浏览器登录态（需账号所有者扫码），CLI 无命令。最小交接：`skills/lifeos-personal-companion/` 包不含密钥，可直接上传。
- 参赛工作流入口 https://v8bjn44ynd.coze.site（4aa53641+）持续可验。

## 真实链（最终冻结 1e6109d5）

`coach-4254fc09`：L1+L1OFF 11 轮 8 保存/3 失败（GROWTH_DEPENDENCY/SOURCE_QUOTE/REPLY_CLAIMS_UNCOMMITTED_FORGET——最后一个是遗忘守卫对虚称的诚实拒绝）。**T9 当前问题+证据强度双正确**；T6 更正 SAVED；L1OFF 2/2。

## 版本与成本

- 提交：`bec847b`（A 线）+`676be00`（B2 渲染锚词）；冻结 1e6109d5。
- 账本：剩余约 **¥15.1**（本批 ≈¥0.4：探针 4、L1 链 11 轮、B2 trace 6 轮）。

## 未达项

1. 原生扣子 Skill 平台 UI（需账号所有者 code.coze.cn 扫码登录会话）。
2. 首内容 p95≤5s（供应商 TTFT；本批未重测速度大样本）。
3. ≥20 成功普通样本于单冻结。
4. 引文/依赖类模型失败率（本链 2/3 失败属此类）。
5. 在线 trace 的引擎内集成（当前 trace 走引擎同款构造器+映射代码的进程外验证；引擎进程注入 code_workflow 环境未在付费链内重跑）。
6. 生产 lqynb.xyz 未部署。

## 交付文件

| 文件 | 路径 |
|---|---|
| 本报告 | `P5_CLOSEOUT_DELIVERY.md` |
| 验收 JSON | `.planning/research/campus-growth/P5_CLOSEOUT_ACCEPTANCE.json` |
| B2 在线 trace | `.local/campus-growth/p5c-b2-traces.json`（+脚本 p5c-b2-traces.mjs） |
| 真实链 | `evidence/v1.3-action-coach/real/coach-4254fc09/` |
| 探针 | 附件 ZERO_NETWORK_CHECKS 7/7（`.local/p5c-*`） |
| 提交 | `bec847b` `676be00`（+本文档提交） |
