# 部署文件

本目录包含 Dockerfile/Compose 使用的依赖锁定、Linux wheels 准备、Nginx 示例、容器检查和数据库备份脚本。当前启动流程和权限交接见项目根目录 DEPLOYMENT_HANDOFF.md。

镜像从已提交、clean源码构建；默认标签与Compose服务引用一致：`lifeos:v1.3-fast-launch-candidate`。Windows 使用 `pwsh -NoProfile -File deploy/build-image.ps1`，Linux 服务器按根目录交接步骤从捕获的提交SHA导出构建上下文。
构建上下文由`git -c core.autocrlf=false -c core.eol=lf archive "$sourceCommit"`导出脚本启动时捕获的精确提交字节；两个命令级设置避免Windows全局autocrlf改变归档内的换行，不修改机器Git配置。临时上下文保留在忽略的`.local/image-build-contexts/`。
依赖已锁定的公开离线BGE资产与Linux wheels；缺失时脚本明确失败，不依赖私人数据库或历史账本。
Windows工作树的CRLF摘要不能直接当作规范Linux镜像的Skill或source摘要。启用工作流前必须从精确镜像读取当前指纹，在该镜像环境产生受审冻结与云绑定；旧摘要不匹配时保持关闭，不用改写摘要绕过校验。
Dockerfile 将精确提交写入 OCI revision 标签和 `deploy/build-version.json`。启动前运行 `bash deploy/verify-image.sh <现有安全配置路径> "$LIFEOS_BUILD_COMMIT"`；只有Compose引用、构建参数和本机镜像标签三者一致才会返回镜像不可变 ID。把 ID 写入临时 Compose override 的 `services.app.image`，并设 `pull_policy: never`；启动、检查容器和读版本都使用同一个 override，再核对容器 `.Image` 与预检 ID 一致，以免可变标签在预检后被替换。不要把示例或合成探测凭据用于公网。
`GET /api/run/version`读回实际加载的提交、来源（Git或镜像构建清单）、主Skill及五专业Skill摘要、攻略/来源/证据摘要。
`/api/ready`只核查应用、数据库及离线编码器，不证明真实模型、扣子业务或生产验收。
核心真实验收、目标归属、备份与回滚完成前不得覆盖现有生产服务。

恢复后运行 `verify-restoration.py` 作为只读门禁，不能只用 `docker start` 的退出码宣布恢复。调用方提供恢复前保存的完整迁移清单（JSON数组，每项只有`name`与`sha256`）、原镜像不可变ID和原完整commit：

```sh
python3 deploy/verify-restoration.py --origin https://lqynb.xyz \
  --expected-head "$ORIGINAL_HEAD" --expected-image-id "$ORIGINAL_IMAGE_ID" \
  --migrations "$ORIGINAL_MIGRATION_MANIFEST" \
  --migrations-sha256 "$REVIEWED_ORIGINAL_MANIFEST_SHA256" --timeout-seconds 40
```

该检查要求公网`ready=true`、完整commit、容器image ID及全部迁移名称/哈希同时匹配；迁移数量相同但哈希变化也拒绝。清单摘要须来自停止前保存并受审的操作绑定，不能在恢复后用当前数据库重新生成。Linux父进程对整次检查实施40秒硬时限，其中预留最多1秒终止及回收检查进程组；数据库查询另受2.5秒服务端statement timeout限制。恢复包装器应将非零结果保留为恢复失败，并沿用已有受审核的恢复策略。此脚本只读取状态，不替代原生产包装器的所有权、全表数据核对、encoder排他、备份和独立审核；旧82b8572包装器仍不可用于当前版本。

远端Coze成长工作流的唯一账本和逐请求日志必须跨容器重建保留。`LIFEOS_COZE_GROWTH_STATE_DIR`挂载到`/app/.local/coze-launch`，保存既有`credits-ledger.jsonl`及`journal/`；`LIFEOS_COZE_MODEL_BUDGET_DIR`挂载到`/app/.local/v1.3-action-coach/paid`，保存既有`provider-calls.json`和其授权旁证。两个宿主目录必须先由可验证恢复流程准备，且容器UID 1000可读写；禁止在新空目录上生成第二本账或清空未知预留。工作流冻结文件由`LIFEOS_WORKFLOW_FREEZE_FILE`只读挂载到固定容器路径。默认占位目录/文件不含授权或账本；Coze保持关闭，不能作为启用配置。

这些 bind mount 的 Compose 配置检查只证明路径和权限声明，不证明生产主机已有正确账本、文件属主或真实恢复成功。启用Coze前仍须核对挂载内原账本哈希/授权/余额与当前配置，并完成生产备份及回滚演练。

`rehearse-production.py` 复用原串行私有库演练：停止前重核原容器ID、镜像、名称和Compose属主，所有主机已知模型进程/服务分别在每次编码器启动前检查；恢复后由同一 `verify-restoration.py` 联合验证公网HTTPS、精确版本、原不可变镜像和完整迁移清单。私有恢复库的全部表及完整DDL在合成控制记录加入后冻结，旧/新镜像启动后逐一对照；真实数据和备份保留在原服务器，不复制到本机。

操作绑定包含原容器、原迁移清单、目标提交/镜像、唯一release目录和三个Python文件的SHA。`scripts/run-production-recovery.mjs --binding <绑定文件> --review <独审目录>` 默认只输出已审计划；显式 `--execute` 才派发，要求该绑定及实际执行包装器逐字被独审，保留首次不可覆盖回执，最终回执原子写入。远端主操作300秒、恢复最多125秒、整体435秒，外层480秒TERM/15秒KILL，失败时保留持久恢复看门狗。不得使用旧82b绑定，也不得用源码复核或本地测试代替精确绑定审核、看门狗实际验证、生产恢复或最终真实云验收。

看门狗由同一守卫模块的 `--rescue-binding` 执行；私有停止阶段共享45秒、整次尝试共享110秒，所有Docker命令和公网验证都收缩到剩余预算。systemd实际读回必须为115秒运行时限、5秒终止等待、整组进程终止和失败后20秒重试。`TimeoutStartSec` 单独不能限制运行中的服务。115秒约束每次尝试；持久重试没有整体次数或持续时间上限。Docker容器由守护进程管理，不能凭systemd子进程终止推断其停止，必须沿已记录的不可变ID重新核对。原容器已经启动时仅允许该精确原容器的编码器，仍须通过同一公网及全部迁移门禁。

私有容器通过create取得ID，核对名称/image/标签并原子持久化后才能start；网络取得ID并持久化后才能connect。每次停止、kill、disconnect和rm都核对不可变归属。create完成与ID记录之间仍有小窗口；其中容器未启动、网络未连接，未知资源保持拒绝认领并保留，不能仅按名字或复制标签删除。绑定还须含完整预期迁移及独立冻结的最终DDL摘要，冻结来源为同版本/同image/同locale的隔离PostgreSQL和目标提交的Git blob；既有迁移保留原已记哈希，四个新迁移绑定规范源码字节。隔离库迁移前后、旧/新镜像各自启动后分别核对，不以迁移数量或启动后自生成的基线替代独立预期。
