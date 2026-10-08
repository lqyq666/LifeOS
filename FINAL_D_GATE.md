# FINAL D GATE — 当前状态（WIP_NOT_READY）

冻结版本：`eefcf45`（源 freeze digest `aa310ffd…`，qwen3.8-flash，同一账本）。
完整机器可读评估：`.local/campus-growth/final-dgate-assessment.json`；主批日志
`.local/campus-growth/continuous-1791446462355`（121 轮）+ D01 补跑
`continuous-1791448262310`（7/7）；补充门 `.local/campus-growth/step7-extras.json`。

## 已达标

- **主批 128 轮真实交互**（34 场景，L1/L2/L3/L1OFF/D01/C01–C10/PC/P2 全量），完成 119，
  失败 9（7.0%，逐条列于 assessment；上一批为 13/55 ≈ 24%）。
- **普通 businessPass ≥20**：C/PC 场景 30+ 普通轮完成 — MET。
- **控制全链**（extras 7/9 终轮 + 主批）：forget 执行+回执+新会话不可见；pause_use 记录保留+
  退出证据集；stop_recommend 事实保留+推荐边界持久+可恢复；pending 歧义卡跨会话可发现、
  跨账号 404、确认执行 — 全部 PASS。
- **Memory-off + 跨账号 canary**：A 历史关闭记忆后新会话不引用、如实回答、无泄漏；
  canary 账户隔离 — PASS。
- **完整回复 p95 12.8s ≤ 15s** — MET（max 15.6s）。
- 13 失败零网络 replay 持续 13/13；全套件 backend+root 80+typecheck+build 全绿。

## 未达标（维持 WIP_NOT_READY 的原因）

- **有效首内容速度**：draft p50 3211ms（目标 ≤3000）、p95 8418ms（目标 ≤5000）。
  定位：provider 首 token p50 857ms/p95 2273ms（TTFT 健康）——瓶颈是本窗口生成吞吐
  （~60–90 tok/s，同一窗口内探针 R1–R4 也 4.6–9s）加首问抽取前的生成积累，不是 schema
  （裁剪后 input tokens 已降 30–45%）也不是本地等待。
- **9 个真实失败**（REPLY_CONTRADICTS×3、WEEKLY_PLAN_BASIS/BUDGET×3、COACH_CITATION×1、
  provider 传输×1、暂停杀轮×1）已逐条披露。
- **extras X-goal/X-time 跨轮翻转**（模型回复措辞 + 种子重复干扰；更正语义本身在主批
  L2、单测与 STEP-6 S3 为绿）。

## 浏览器/扣子/Skill

桌面登录+聊天+我的成长工作台、390px 移动工作台（截图
`call_d476d31aeeb84599bae9cbc6-tool-result-09eabb18`）全部渲染正常。
扣子 LifeOS个人伙伴 v1.2 自动触发证据沿用本日早前记录（新会话字面形态仍受桌面端离线
阻塞，如实记录）。主 Skill 沿用 P6 激活证据（3/3 事实跨会话）。

## 结论

除速度两项外全部达标或披露。部署（STEP 9）与比赛材料（STEP 10）未触发。
速度复查应在供应商吞吐恢复窗口重测同冻结版本（无需改代码）。
