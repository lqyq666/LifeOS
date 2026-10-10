# LIFEOS_COZE_CORE_20261011_GROWTH_R1

只修改现有项目7693388932939300905。本人已恢复开发权限；使用已有扣子积分，禁止充值、新项目、对外发送消息、自动收费重试。先保留当前4aa53641b7177604cfa96631b9584de991531324的恢复路径。本任务不部署、不改生产数据库、不真实调用模型自测。执行完成给出代码版本、差异、测试原始输出、实际输入输出Schema和下一步所需配置；不要只交设计。

目标：在现有工作流内加入一个严格的LifeOS宿主模式，供合成成年验收，当前本地LifeOS仍是身份、状态提交与私有记忆的唯一权威。保留已有节点与旧接口兼容，不另建同类Agent；扩展现有入口和节点，必要的路径分析、独立评审和综合由本项目实际执行。附加的本地TypeScript契约和五Skill是当前版本依据。

1. 新入口可承接schemaVersion=2、businessRole=growth、mode、requestId、traceId、syntheticAdult=true、宿主绑定（sourceDigest/contentHash/skills）、当前请求、授权证据片段、当前事件/上次行动/真实反馈/未知/控制、0–2张规范方法片段。真实学生模式暂拒绝；不得接受账号原始ID、邮箱、联系方式或整段历史。新增这条宿主模式不落本项目旧演示记忆表，不写用户目标或经历。普通倾听、拒绝、缺预算和已取消请求在任何模型调用前处理；未知信息保持未知。

2. direction_decision的2条路径并行分析+独立评审+综合，正常生成总计最多4次；3路径最多5次。所有客户端/SDK自动重试明确关闭；评审是另外一次模型执行，不能只是改角色名。综合只选择已审分析的现有候选，不新造个人事实、行动或依据。统一使用附加contracts.ts和provider-adapter.ts中的选择契约；模型输入/输出受严格ID白名单约束，建议有支持/限制/未知、当前阶段理由与改变建议的反馈条件。若无法完整复用，准确说明与宿主契约的差异，不声称兼容。

3. 四条模式沿用action_review/direction_decision/growth_diff/kb_maintenance，不扩大无关节点。主Skill及五专业Skill必须作为版本化源码资产加载、SHA256核对，按触发条件执行并在产物中记实际加载和执行痕迹；仅安装到开发聊天工具列表不算业务执行。攻略只用宿主传入的规范片段，无guideId的编辑建议标明性质，不复刻另一套完整攻略库。

4. 增加只读runtime/contract读回：项目ID、businessRole、candidateRelease、代码版本可获取时的实际commit、sourceDigest/contentHash、真实加载的6Skill版本/hash；无法取得代码commit则留unknown，不回显客户端版本冒充执行版本。请求绑定与加载的候选常量不同则零调用拒绝。role错误、来源变化、超出调用预算、错误Skill版、缺Skill、取消均准确拒绝。

5. 每次模型执行记录真实独立nodeId/role/dependencies/start/finish/status/provider/model/providerResponseId/usage/costCompleteness，缺金额或usage留unknown；不补0、不用一个HTTP请求代替模型次数。requestId幂等，同一ID不同载荷拒绝，started/unknown不能再发相同请求。取消中止后续节点，已发生成保留费用未知；不因错误再跑另一个模型或本地兜底生成。

6. 输出只含proposal与trace，suggestedStateChanges=[]。回执包括独立receiptId、实际运行runtime绑定、实际node次数、Skill版本/hash、完整或unknown费用、取消/错误。正常缺证据可waiting_user或unknown，不整条失败；action adoption不等于execution。宿主再做权限/来源/控制/版本校验后才保存。

7. 仅运行无模型的契约、拒绝、DAG依赖、幂等、取消测试；模拟输出必须标synthetic/local，不当作真实选择能力。不要宣称本任务完成了真人批准、真实模型效果或生产发布。附加主Skill及5专业Skill全文应保存原字节并核对摘要。
