# P5 行为验收证据

批次：GLM_P5_EXECUTION（2026-10-07）。审阅身份：**实施者（GLM）**。三类结果分列；失败保留。

## 附件探针（P5_ZERO_NETWORK_PROBES）——全部转绿

| 探针 | 结果 |
|---|---|
| M01 零重叠旧约束入选 | **PASS**（45 干扰+1 约束→约束入选） |
| M02 快照 40/41/200 | **全 PASS**（growthAll 驱动） |
| M03 同分偏新 | **PASS** |
| M04 字符预算 | **PASS**（≤60k） |
| K01 禁用+附加断言 | **PASS**（verified=0） |

## 隔离 PG 回归（新）

60 条 user_edit 来源记录 + 模拟 provider：普通轮提交成功（无幻影 INVALIDATED）；selection audit 记录裁剪；真实并发 revision+1 正确拒绝。60 条不是 40/41/200 的替代，是引擎路径的补充验证。

## 真实链

| 运行 | 冻结 | 范围 | 技术 | 语义 |
|---|---|---|---|---|
| `coach-f736cc93` | 4e0ad9bb | L1/L2/L3/L1OFF 24 轮 | 17 保存 | T9 答对当前主播机会+4h 预算计算；L1OFF 2/2 同会话记忆正确 |
| `coach-93cf159e` | 182f3452 | L1/L1OFF 11 轮 | 8 保存 | **T9 语义失败（SAVED）**：答旧公众号而非新主播；T8 遗忘轮诚实拒绝（守卫生效） |

### 诚实记录：T9 当前问题主导的方差

两链同输入 T9：一链答对（主播+4h）、一链答错（公众号+10h）——提示规则是概率改善非保证。记为已改善未根除。

### T8 遗忘生命周期（最新链）

T8（"把海报记录忘掉吧"+学长反馈）：REPLY_CLAIMS_UNCOMMITTED_FORGET 触发（outstanding-forget 守卫使诚实拒绝优先于虚称）。修复前形态：T8 失败后 T9 虚称"已撤下"。

## 云端生产品质（部署 `4aa53641`）

- 自编方法建议式：hard-residue=false（无"官方规定/不可安排满"）；4 verified 引用。
- 情绪→方法同会话恢复：turn1 自然倾听→turn2 route=knowledge（修复前留 none）。
- 证据：`.local/coze-competition/p5-comp-verify.json`。

## 未达项

见 P5_DELIVERY.md。**WIP_NOT_READY 维持。**
