# G1 统一契约
状态：TESTED_LOCAL；非线上/学生验收。
版本：Workflow v2；最终源码摘要见 SOURCE_MANIFEST.json，集成差异见 INTEGRATION_PATCH.diff。
contracts14/14通过；16类路由夹具、schema严格字段、来源/权限、预算金额/期间、候选/收据、隐私trace、取消/截止/幂等均有可执行断言。命令：npm run test:backend -- --file=workflow-contracts.test.ts。
独立类型检查 npx tsc -p tsconfig.workflows.json 通过；全服务端类型检查未通过，未用局部结果替代。
新增真实模型0，费用0；本地耗时是程序耗时，不能当产品性能。
失败修复记录保存在evidence；最终相关回归96/96。下一步：保留默认关闭，先签收G2实际学生闭环。
