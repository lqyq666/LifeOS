# 部署交接

## 当前候选目标

当前项目部署资料记载的候选 ECS 位于阿里云西南 1（成都，区域 ID cn-chengdu），公网地址 8.137.181.86，Ubuntu 24.04，2 vCPU，约 1.6 GiB 内存并配置 2 GiB swap。该信息来自项目配置材料，操作前由账号所有者在控制台确认实例 ID、账号归属、区域、状态和规格。

项目资料记载 lqynb.xyz 的 DNS 由 Cloudflare 管理。正式 LifeOS 子域名、DNS 变更和 TLS 发布时间仍需确认。部署时保留同机已有海闻服务。

## 部署方式

先在项目根目录准备校验过的 Linux Python wheels 和固定 BGE 模型：

    python deploy/lock-embedding.py
    python scripts/setup-coach-embedding.py

Docker 构建还需要随包提供的 qwen-default 能力报告与 interface-proof 文件。报告应原样保留，不能伪造。服务器上的私有 .env.production 从 .env.production.example 建立，填入唯一数据库密码、认证密钥、百炼 Key 和正式 HTTPS origin；不提交密钥。

    docker compose --env-file .env.production config --quiet
    docker compose --env-file .env.production build app
    docker compose --env-file .env.production up -d --wait --wait-timeout 120
    curl --fail http://127.0.0.1:8787/api/ready

Compose 将应用仅绑定到宿主机 127.0.0.1:8787，数据库没有公网端口。沿用 deploy/nginx.conf.example 配置 TLS 反向代理，关闭 SSE buffering，并设置足够的读取超时。确认 Docker 网桥的精确代理地址后再设置信任代理。

/api/ready 只验证应用、数据库和离线 embedding worker。还需在部署后的浏览器完成登录、真实 SSE 对话、保存回读及备份恢复检查。迁移前先备份，采用新增式迁移；回滚保留原数据库和镜像，不执行 docker compose down -v。

## 获取阿里云部署权限

由阿里云主账号所有者或 RAM 管理员授权。对方创建单独的 RAM 用户或角色、启用控制台登录和 MFA，先授予目标资源只读访问，再创建范围限定到 cn-chengdu 指定 ECS 实例或资源组的部署策略。不要共享主账号密码或创建、转发长期 AccessKey。

RAM 控制台权限不等于 Linux 登录权限。账号所有者还要单独创建 Linux 部署用户、配置 SSH 公钥和经确认的 sudo 命令；或者批准使用云助手。Docker 管理可获得主机级权限，应明确授予。若使用云助手，只授权目标实例必需的 RunCommand 与 DescribeInvocations；Linux 云助手命令默认以 root 执行，除非特意限制为普通用户。

DNS 权限独立于 ECS。若继续使用 Cloudflare，由 Zone 所有者只对批准的 LifeOS 子域授予 DNS 编辑权限，或由所有者代为改记录；这里不需要阿里云 DNS 权限。

向账号所有者交接时写明：登录主体、区域 cn-chengdu、目标 ECS 实例 ID、访问方式、操作范围、授权起止时间、回滚联系人；另行确认 Cloudflare Zone 与正式主机名。登录信息通过密码管理器或控制台邀请安全交付。不能确认账号所有者时，先请其确认资源归属。

官方说明：
- [创建 RAM 用户](https://help.aliyun.com/zh/ram/user-guide/create-a-ram-user)
- [为 RAM 用户授权](https://help.aliyun.com/zh/ram/user-guide/grant-permissions-to-the-ram-user)
- [限制 RAM 用户只能管理指定 ECS 实例](https://help.aliyun.com/zh/ram/support/how-do-i-restrict-ram-users-from-managing-a-specified-ecs-instance)
- [RAM 授权云助手](https://help.aliyun.com/zh/ecs/user-guide/use-ram-to-implement-permission-control)