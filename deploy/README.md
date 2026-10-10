# 部署文件

本目录包含 Dockerfile/Compose 使用的依赖锁定、Linux wheels 准备、Nginx 示例、容器检查和数据库备份脚本。当前启动流程和权限交接见项目根目录 DEPLOYMENT_HANDOFF.md。

镜像从已提交、clean源码构建：`pwsh -NoProfile -File deploy/build-image.ps1`。
构建上下文由`git archive HEAD`导出规范提交字节，避免Windows换行转换使同一提交的冻结摘要不同；临时上下文保留在忽略的`.local/image-build-contexts/`。
依赖已锁定的公开离线BGE资产与Linux wheels；缺失时脚本明确失败，不依赖私人数据库或历史账本。
使用现有安全环境配置启动时，先设置`LIFEOS_BUILD_COMMIT`为该镜像精确源码提交，再执行`docker compose --env-file <现有安全配置路径> up -d`。不要把示例或合成探测凭据用于公网。
`GET /api/run/version`读回实际加载的提交、来源（Git或镜像构建清单）、主Skill及五专业Skill摘要、攻略/来源/证据摘要。
`/api/ready`只核查应用、数据库及离线编码器，不证明真实模型、扣子业务或生产验收。
核心真实验收、目标归属、备份与回滚完成前不得覆盖现有生产服务。
