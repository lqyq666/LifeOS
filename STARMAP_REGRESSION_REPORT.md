# STARMAP 回归报告（本轮：身份层/信任边界/变更模型）

## 测试
- 单元（零网络）：105/105 通过（含新增 starmap-acceptance 12 项、身份/考虑捕获用例）
- 隔离 PostgreSQL 后端：全选套件通过（新增 starmap-trust 信任边界 7 场景、theme-lifecycle 全链路）
- 前端：tsc 干净、vite 构建通过；浏览器桌面 + 390px 冒烟（图加载、时间轴、无演示冒充、无横向溢出）

## 受影响的原 D-Gate 回归面
- 系统 prompt、模型 schema、provider payload **均未改动** → 接口签名未变 → 既有能力探针报告仍有效，无需重跑
- turn 每轮模型调用次数不变（starMap 上下文注入同一轮调用的 user prompt；focusContext 为可选参数）
- safety/forget-intent/action-coach-engine 等既有隔离测试全部按新契约（无感入库 rev=2 起点）更新后通过
- 迁移 026 幂等（ADD COLUMN IF NOT EXISTS / CREATE IF NOT EXISTS），旧数据零丢失

## 费用
- 真实调用：自由职业链 5 轮 + 本轮其他验证 ≈ 10 轮，runs.usage 记账
- 预约类账本余额 ¥11.27（探针未消耗）；不新增预算、无自动收费重试

## 已知限制（如实）
1. 四视角过滤当前通过路径同义词间接映射，未做独立 UI 切换（无来源领域保持空白的原则已守住）
2. AI 观察身份（D 类）通道预留未启用——不自动生成任何 AI 身份观察，宁缺勿滥
3. 模型 growth 通道对复合句首子句的漏存由服务器确定性捕获兜底；残余轮间方差（如 ai_observation 依赖指向被替换条目触发既有严格校验）在验收 JSON 中如实记录
