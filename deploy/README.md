# 部署文件

本目录包含 Dockerfile/Compose 使用的依赖锁定、Linux wheels 准备、Nginx 示例、容器检查和数据库备份脚本。当前启动流程和权限交接见项目根目录 DEPLOYMENT_HANDOFF.md。

镜像从已提交、clean源码构建；默认标签与Compose服务引用一致：`lifeos:v1.3-fast-launch-candidate`。Windows 使用 `pwsh -NoProfile -File deploy/build-image.ps1`，Linux 服务器按根目录交接步骤从同一干净提交构建。
构建上下文由`git archive HEAD`导出规范提交字节，避免Windows换行转换使同一提交的冻结摘要不同；临时上下文保留在忽略的`.local/image-build-contexts/`。
依赖已锁定的公开离线BGE资产与Linux wheels；缺失时脚本明确失败，不依赖私人数据库或历史账本。
Dockerfile 将精确提交写入 OCI revision 标签和 `deploy/build-version.json`。启动前运行 `bash deploy/verify-image.sh <现有安全配置路径> "$LIFEOS_BUILD_COMMIT"`；只有Compose引用、构建参数和本机镜像标签三者一致才会返回镜像不可变 ID。保存该 ID，再运行 `docker compose --env-file <现有安全配置路径> up -d --no-build --wait --wait-timeout 120`，并核对应用容器的 `.Image` 与预检 ID 一致。不要把示例或合成探测凭据用于公网。
`GET /api/run/version`读回实际加载的提交、来源（Git或镜像构建清单）、主Skill及五专业Skill摘要、攻略/来源/证据摘要。
`/api/ready`只核查应用、数据库及离线编码器，不证明真实模型、扣子业务或生产验收。
核心真实验收、目标归属、备份与回滚完成前不得覆盖现有生产服务。

远端Coze成长工作流的唯一账本和逐请求日志必须跨容器重建保留。`LIFEOS_COZE_GROWTH_STATE_DIR`挂载到`/app/.local/coze-launch`，保存既有`credits-ledger.jsonl`及`journal/`；`LIFEOS_COZE_MODEL_BUDGET_DIR`挂载到`/app/.local/v1.3-action-coach/paid`，保存既有`provider-calls.json`和其授权旁证。两个宿主目录必须先由可验证恢复流程准备，且容器UID 1000可读写；禁止在新空目录上生成第二本账或清空未知预留。工作流冻结文件由`LIFEOS_WORKFLOW_FREEZE_FILE`只读挂载到固定容器路径。默认占位目录/文件不含授权或账本；Coze保持关闭，不能作为启用配置。

这些 bind mount 的 Compose 配置检查只证明路径和权限声明，不证明生产主机已有正确账本、文件属主或真实恢复成功。启用Coze前仍须核对挂载内原账本哈希/授权/余额与当前配置，并完成生产备份及回滚演练。
