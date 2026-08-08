# WTF Card Online 使用说明

这是一款浏览器多人卡牌游戏。

你只需要在一台 Windows 电脑上启动游戏，把生成的临时网址发给朋友。朋友使用手机或电脑浏览器打开网址，就可以加入同一个房间。

不需要购买服务器或域名，但负责启动游戏的电脑必须保持开机和联网。

## 最简单的使用方法

### 开始游戏

1. 双击 `启动游戏.cmd`。
2. 等待窗口显示 `WTF Card is running.`。
3. 找到窗口里的 `Public URL`，例如：

   ```text
   https://xxx.trycloudflare.com
   ```

4. 临时网址会同时：

   - 显示在启动窗口中；
   - 自动复制到 Windows 剪贴板；
   - 写入项目根目录的 `public-url.txt`。

5. 把网址发给朋友，所有人都通过这个网址打开游戏。

看到网址后可以关闭黑色的启动窗口。游戏服务会继续在后台运行。

### 结束游戏

双击 `关闭游戏.cmd`。

它会关闭游戏服务和临时公网通道。关闭后：

- 临时网址立即失效；
- 当前房间、玩家和分数全部清空；
- `public-url.txt` 会被删除；
- 下次启动会生成一个新的网址。

## 两种网址有什么区别

启动成功后会显示两个网址。

### Local URL

```text
http://localhost:3000
```

只有启动游戏的这台电脑可以使用，主要用于自己检查游戏是否正常。

### Public URL

```text
https://随机单词.trycloudflare.com
```

这是需要发给朋友的网址。朋友不需要安装 Node.js、cloudflared 或其他软件，只需要现代浏览器。

这个地址是临时公网地址。任何拿到链接的人在游戏运行期间都能访问，所以不要把它发布到公开群组或论坛。

## 能否复制到其他电脑使用

### 简短答案

可以移动整个文件夹，但目前不是“任意电脑上百分之百双击即用”。

### 可以直接使用的电脑

目标电脑需要满足以下条件：

1. 使用 64 位 Windows 10 或 Windows 11。
2. 已安装 Node.js 20 或更高版本。
3. Node.js 的安装程序已经把 `node` 加入系统 `PATH`。
4. 复制的是完整项目文件夹，包括 `node_modules` 和 `cloudflared.exe`。
5. 电脑可以正常访问互联网和 Cloudflare。
6. 本机的 `3000` 端口没有被其他程序占用。

满足这些条件后，文件夹可以放在桌面、移动硬盘或其他磁盘中，路径可以改变，也可以包含中文和空格。

### 不能直接使用的情况

- macOS 或 Linux：当前附带的是 Windows 版 `cloudflared.exe`，两个 `.cmd` 脚本也只能在 Windows 运行。
- 没有安装 Node.js：启动窗口会提示找不到 `node`。
- 只从 Git 仓库下载源码：`node_modules` 和 `cloudflared.exe` 默认不会提交到 Git，需要重新安装或补齐。
- 公司、学校或特殊网络阻止 Cloudflare Tunnel：本机游戏可能正常，但无法生成或访问临时公网网址。
- 杀毒软件拦截 `cloudflared.exe`：需要确认文件来源后允许它运行。

### 如何检查 Node.js

按 `Win + R`，输入 `cmd` 并回车，然后运行：

```cmd
node --version
```

如果显示类似下面的内容，说明 Node.js 已经安装：

```text
v24.18.0
```

版本号的第一个数字应当不小于 `20`。

如果提示“不是内部或外部命令”，需要先安装 Node.js。

### 如果没有复制 node_modules

在项目文件夹空白处按住 `Shift` 并单击鼠标右键，打开 PowerShell，然后运行：

```powershell
npm install
```

安装完成后再双击 `启动游戏.cmd`。

## 哪些文件必须一起复制

以下文件和文件夹是运行游戏所必需的：

```text
public/
scripts/
node_modules/
cloudflared.exe
game-data.js
server.js
package.json
package-lock.json
启动游戏.cmd
关闭游戏.cmd
```

以下内容不是运行所必需的：

```text
.git/
artifacts/
test/
Dockerfile
render.yaml
wtfcard.html
```

`.runtime` 和 `public-url.txt` 是运行时自动生成的，不需要提前复制。

## 启动游戏.cmd 具体做了什么

这个文件不是游戏代码，只是一个很短的 Windows 启动入口。

原始内容如下：

```bat
@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-game.ps1"
set "GAME_EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %GAME_EXIT_CODE%
```

逐行解释：

1. `@echo off`

   不把每条命令本身重复显示出来，让窗口更干净。

2. `setlocal`

   让脚本中设置的临时变量只在当前窗口有效，不修改系统的永久环境变量。

3. `chcp 65001 >nul`

   把窗口编码切换为 UTF-8，减少中文路径和中文文件名乱码。

4. `powershell.exe ... start-game.ps1`

   调用真正负责启动的 PowerShell 脚本。

   `%~dp0` 表示“`启动游戏.cmd` 所在的文件夹”。因此无论把项目移动到哪个磁盘，它都会寻找当前项目里的 `scripts\start-game.ps1`，而不是写死原来的路径。

   `-NoProfile` 表示不加载用户自己的 PowerShell 配置，避免个人配置干扰启动。

   `-ExecutionPolicy Bypass` 只对这一次 PowerShell 运行生效，允许执行项目附带的本地脚本，不会永久修改系统策略。

5. `set "GAME_EXIT_CODE=%ERRORLEVEL%"`

   保存 PowerShell 脚本的执行结果。`0` 表示成功，其他数字表示失败。

6. `echo.` 和 `pause`

   输出一个空行并暂停窗口，让你有时间查看临时网址或错误提示。

7. `exit /b %GAME_EXIT_CODE%`

   使用刚才保存的结果结束这个启动脚本。

## start-game.ps1 具体做了什么

`启动游戏.cmd` 会调用 `scripts/start-game.ps1`。这个文件较长，因为它需要处理检查、启动、等待和错误清理。

执行顺序如下：

1. 根据脚本所在位置计算项目根目录。
2. 检查 `server.js` 和 `cloudflared.exe` 是否存在。
3. 创建 `.runtime` 文件夹，用来保存进程编号和运行日志。
4. 检查本项目的 Node 游戏服务是否已经运行。
5. 检查 `3000` 端口是否被其他程序占用。
6. 使用 Node.js 启动 `server.js`。
7. 请求 `http://127.0.0.1:3000/health`，确认游戏服务真的启动成功。
8. 启动项目目录中的 `cloudflared.exe`。
9. 等待 Cloudflare 返回随机的临时公网网址。
10. 把网址写入 `public-url.txt` 并复制到剪贴板。
11. 从公网访问一次 `/health`，确认网址能够连接到本机游戏。
12. 显示本机地址、公网地址和检查结果。

如果中途失败，脚本会停止本次刚启动的进程，避免留下一个只启动了一半的游戏。

## 关闭脚本如何避免误关其他程序

启动时，脚本会把两个进程编号写入：

```text
.runtime/server.pid
.runtime/tunnel.pid
```

关闭时不会看到一个 `node.exe` 就直接结束。它还会检查进程命令中是否包含当前项目的完整 `server.js` 或 `cloudflared.exe` 路径。

只有路径匹配当前项目时才会关闭，因此不会主动关闭电脑上其他 Node.js 项目。

## 把游戏放到公网

这个项目有三种运行方式。根据使用时间和维护能力选择一种即可。

| 方式 | 电脑能否关机 | 网址是否固定 | 适合场景 |
|---|---:|---:|---|
| 本机直接运行 | 否 | 只有本机地址 | 自己检查游戏 |
| 本机 + Cloudflare 临时隧道 | 否 | 否，每次启动都会改变 | 偶尔和朋友玩 |
| Render 或自己的云服务器 | 是 | 是 | 长期保留一个入口 |

### 方案一：本机临时公网联机

这是项目当前默认的一键启动方式，不需要购买服务器或域名。

#### 准备条件

- 一台安装了 Node.js 20+ 的 64 位 Windows 电脑；
- 完整的项目文件夹；
- 可以正常访问互联网；
- 游戏期间电脑不能关机、休眠或断网。

#### 操作步骤

1. 双击 `启动游戏.cmd`。
2. 等待出现 `WTF Card is running.`。
3. 复制窗口里的 `Public URL`，或者打开 `public-url.txt`。
4. 把 `https://随机单词.trycloudflare.com` 地址发给朋友。
5. 所有人都使用这个公网地址进入游戏，房主也可以使用该地址。
6. 玩完后双击 `关闭游戏.cmd`。

脚本实际执行的核心命令相当于：

```powershell
node server.js
cloudflared tunnel --url http://127.0.0.1:3000
```

Cloudflare Quick Tunnel 不要求 Cloudflare 账号，也不需要修改路由器或开放入站端口。它会从本机主动建立连接，然后分配随机的 `trycloudflare.com` 地址。

这种方式只适合临时使用：地址每次都会改变，Cloudflare 不提供可用性保证，并且 Quick Tunnel 当前最多允许 200 个同时处理中请求。对于小规模朋友局通常足够。

官方说明：[Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)

### 方案二：部署到 Render，获得固定网址

这是没有自己服务器时最省事的长期方案。代码运行在 Render 的 Node.js Web Service 上，因此自己的电脑可以关机。

部署成功后会得到类似下面的固定地址：

```text
https://wtf-card-online.onrender.com
```

#### 第一步：把源码放到 GitHub

需要一个 GitHub 账号和一个代码仓库。

上传源码时不要上传下面这些本机文件：

```text
node_modules/
cloudflared.exe
.runtime/
public-url.txt
```

它们已经写入 `.gitignore`。Render 会根据 `package-lock.json` 自己安装依赖，也不需要本机隧道程序。

可以使用 GitHub Desktop 发布当前文件夹，也可以在项目目录运行：

```powershell
git add .
git commit -m "Deploy WTF Card"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库.git
git push -u origin main
```

如果仓库已经配置过 `origin`，不需要再次运行 `git remote add origin`。

#### 第二步：在 Render 创建 Web Service

1. 注册并登录 [Render](https://render.com/)。
2. 打开 Dashboard，选择 `New` → `Web Service`。
3. 连接 GitHub，并选择刚才上传的仓库。
4. 按下面的内容填写：

   | 设置 | 内容 |
   |---|---|
   | Language | `Node` |
   | Branch | `main` |
   | Build Command | `npm ci --omit=dev` |
   | Start Command | `npm start` |
   | Health Check Path | `/health` |
   | 环境变量 | `NODE_ENV=production` |

5. Region 选择离主要玩家较近的区域。
6. Instance Type 根据需要选择：免费实例适合测试；希望随时打开就能用，应选择不会因空闲而休眠的实例。
7. 点击 `Create Web Service`，等待构建和部署完成。
8. 打开 Render 提供的 `onrender.com` 地址。
9. 再访问一次 `https://你的地址/health`。如果看到下面的内容，说明服务正常：

   ```json
   {"ok":true,"rooms":0}
   ```

项目根目录已经包含 `render.yaml`，也可以在 Render 中选择 Blueprint，让 Render 读取该文件自动创建服务。当前 Blueprint 默认使用免费实例。

Render Web Service 支持公网 WebSocket，Socket.IO 不需要修改地址。项目已经监听平台提供的 `PORT`，并绑定到 `0.0.0.0`。

官方说明：

- [在 Render 部署 Node.js Express](https://render.com/docs/deploy-node-express-app)
- [Render WebSocket](https://render.com/docs/websocket)
- [Render 免费实例限制](https://render.com/docs/free)

#### 免费实例需要注意

Render 免费 Web Service 连续 15 分钟没有收到 HTTP 请求或 WebSocket 消息时会休眠。下一位玩家访问时会自动唤醒，但首次打开可能需要等待约一分钟。

免费实例也可能因为维护或平台调度而重启。重启不会改变固定网址，但会清空当时正在进行的房间。

#### 更新已经部署的网站

修改代码后提交并推送：

```powershell
git add .
git commit -m "Update game"
git push
```

Render 会自动重新构建。重新部署期间，正在进行的房间可能中断，所以最好在没有对局时更新。

### 方案三：部署到自己的 Linux 云服务器

适合已经购买 VPS、轻量应用服务器或云主机，并且愿意维护 Linux、域名和 HTTPS 的用户。

项目已包含 `Dockerfile`，以下示例假设服务器已经安装 Docker，并且源码已经通过 Git 或文件上传放到服务器。

#### 第一步：构建并运行容器

进入项目目录：

```bash
docker build -t wtf-card .
docker run -d \
  --name wtf-card \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  wtf-card
```

检查服务：

```bash
curl http://127.0.0.1:3000/health
```

应当返回：

```json
{"ok":true,"rooms":0}
```

`--restart unless-stopped` 表示服务器重启后自动恢复容器，除非你之前手动停止了它。

Docker 官方安装说明：[在 Ubuntu 安装 Docker Engine](https://docs.docker.com/engine/install/ubuntu/)

#### 第二步：配置域名和 HTTPS

1. 准备一个域名，例如 `game.example.com`。
2. 在域名 DNS 中添加 `A` 记录，指向云服务器公网 IPv4。
3. 在服务器安全组和防火墙中开放 TCP `80` 和 `443`。
4. 安装 Caddy。
5. 编辑 `/etc/caddy/Caddyfile`：

   ```caddyfile
   game.example.com {
     reverse_proxy 127.0.0.1:3000
   }
   ```

6. 重新加载 Caddy：

   ```bash
   sudo systemctl reload caddy
   ```

7. 打开 `https://game.example.com`。

Caddy 会为有效域名自动申请和续期 HTTPS 证书，`reverse_proxy` 也支持 WebSocket 升级，因此不需要额外编写 Socket.IO 转发规则。

Caddy 官方说明：[Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

#### 更新自己的服务器

```bash
git pull
docker build -t wtf-card .
docker rm -f wtf-card
docker run -d \
  --name wtf-card \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  wtf-card
```

重新创建容器会清空当时的房间和分数。

### 长期部署的重要限制

当前版本把房间状态放在单个 Node.js 进程的内存中，因此长期部署时必须注意：

- 只运行一个应用实例，不要开启多实例负载均衡；
- 服务重启或重新部署会清空所有房间；
- 固定网址会保留，但对局状态不会永久保存；
- 如果以后需要多实例或永久战绩，需要增加数据库和 Socket.IO Redis Adapter；
- 当前没有账号、房间密码和后台管理，固定网址不要大范围公开传播。

## 数据保存在哪里

房间、玩家、手牌和分数只保存在 Node.js 进程的内存中，没有数据库。

因此：

- 关闭游戏后所有对局数据都会消失；
- 重新启动不会恢复上一次分数；
- 临时网址不会保存游戏记录；
- Cloudflare 只负责转发连接，不负责保存房间状态。

## 常见错误

### 找不到 node

原因：没有安装 Node.js，或者 Node.js 没有加入 `PATH`。

处理：安装 Node.js 20+，然后重新打开 `启动游戏.cmd`。

### Port 3000 is already in use

原因：其他程序正在使用 `3000` 端口，或者上一次游戏服务没有正常关闭。

处理：先双击 `关闭游戏.cmd`，然后再次启动。

### 无法生成 Public URL

原因可能包括：网络无法访问 Cloudflare、杀毒软件阻止 `cloudflared.exe`、代理或校园网限制隧道连接。

处理：确认普通网页可以联网；检查杀毒软件提示；换一个网络或手机热点后重试。

### 网址突然失效

检查负责启动游戏的电脑是否关机、休眠、断网，或者 `cloudflared.exe` 是否被关闭。重新双击启动脚本会生成新网址。

## 开发者命令

普通玩家不需要使用下面的命令。

```powershell
npm start
npm test
```

- `npm start`：只启动本机 Node.js 服务，不创建公网网址。
- `npm test`：执行多人游戏流程自动化测试。
