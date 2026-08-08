# WTF Card Online

这是 WTF Card 的服务器联机版。网页、房间和 Socket.IO 服务由同一个 Node.js 进程提供，不再依赖 PeerJS、STUN 或 TURN。

## 本地运行

需要 Node.js 20 或更高版本。

```powershell
npm install
npm start
```

打开 `http://localhost:3000`。局域网内的其他设备可以通过运行电脑的局域网 IP 和端口 `3000` 访问。

## 一键临时公网联机

项目根目录包含官方 `cloudflared.exe` 和两个可双击脚本：

- `启动游戏.cmd`：启动 Node 服务和 Cloudflare Quick Tunnel，显示临时网址、复制到剪贴板，并写入 `public-url.txt`。
- `关闭游戏.cmd`：关闭本项目的 Node 服务和临时隧道。

每次重新启动隧道都会生成不同的 `trycloudflare.com` 地址。脚本运行期间，任何拿到链接的人都可以访问游戏；关闭脚本或电脑关机后地址失效。

## 部署

项目可以部署到任何支持持续运行 Node.js 或 Docker 的平台。服务必须支持 WebSocket，并将平台分配的 `PORT` 环境变量传给应用。

仓库包含两种部署入口：

- `render.yaml`：在 Render 中导入仓库并创建 Blueprint。
- `Dockerfile`：部署到支持容器的云服务。

健康检查地址为 `/health`。正式公开前建议审阅题库内容，并根据玩家规模选择不会休眠的实例方案。

## 联机机制

- 服务器保存房间、玩家、手牌、答案、裁判和分数。
- 客户端只能请求操作，服务器验证身份、回合阶段和手牌归属。
- Socket.IO 会优先使用 WebSocket，并在必要时降级为 HTTP 长轮询。
- 短暂断线会保留席位 30 秒，刷新页面后使用本地会话令牌自动恢复。
- 玩家离开后会重新计算答题人数；房主或裁判离开时会自动迁移角色。

## 测试

```powershell
npm test
```
