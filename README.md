# WTF Card Online 使用说明

## 2026/8/9 更新

- 新增限时裁决：裁判需在 25 秒内选择赢家，超时后由系统随机选出一个有效答案。

## 2026/8/8 更新

- 更新游戏词库：现有 72 张黑卡和 96 张白卡。
- 新增首次启动脚本：自动准备 Node.js、cloudflared 和游戏依赖。
- 修复移动端语音播报：首次交互会确认启用，裁判点选答案时直接触发朗读。
- 优化匿名裁决：选答案时隐藏出牌者，选定赢家后再公开本轮答案归属。





这是一款浏览器多人卡牌游戏。

你只需要在一台 Windows 电脑上启动游戏，把生成的临时网址发给朋友。朋友使用手机或电脑浏览器打开网址，就可以加入同一个房间。

不需要购买服务器或域名，但负责启动游戏的电脑必须保持开机和联网。

## 最简单的使用方法

### 第一次从 GitHub 下载后

1. 解压完整项目，不要只单独下载某一个文件。
2. 双击 `第一次启动时请打开该脚本.cmd`。
3. 等待窗口显示 `First-time setup completed successfully.`。
4. 关闭这个窗口。以后通常不需要再次运行首次脚本。

首次准备会联网下载运行环境和依赖，耗时取决于网速。脚本下载的内容不会上传到 GitHub，也不会安装到 Windows 系统目录，便携版 Node.js 会放在项目的 `.runtime` 文件夹中。

### 平常开始游戏

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

可以。把 GitHub 下载的完整项目移动到一台新的 64 位 Windows 电脑上，联网运行一次 `第一次启动时请打开该脚本.cmd`，准备成功后即可双击 `启动游戏.cmd`。

它不会保证在任何电脑和任何网络中都成功：macOS、Linux、32 位 Windows，以及阻止 Node.js、GitHub、Cloudflare 或脚本运行的受限网络不在当前一键脚本支持范围内。

### 目标电脑需要满足的条件

1. 使用 64 位 Windows 10 或 Windows 11。
2. 第一次准备时可以访问 `nodejs.org`、GitHub 和 npm 软件源。
3. PowerShell 可以运行，杀毒软件没有阻止下载的官方程序。
4. 游戏期间可以正常访问 Cloudflare，电脑保持开机、联网且不休眠。
5. 本机的 `3000` 端口没有被其他程序占用。

不要求提前安装 Node.js。首次脚本会优先使用电脑上已有的 Node.js 20+；如果没有，就下载项目自带使用的便携版。文件夹可以放在桌面、移动硬盘或其他磁盘中，路径可以改变，也可以包含中文和空格。

### 为什么不把缺少的文件直接上传到 GitHub

`.gitignore` 中仍然保留以下规则：

```text
node_modules/
.runtime/
/cloudflared.exe
/public-url.txt
```

这些文件不适合提交到 Git：

- `node_modules` 是可以通过 `package-lock.json` 精确重建的第三方依赖，文件数量很多。
- `.runtime` 保存便携版 Node.js、下载缓存、日志和进程编号，只属于当前电脑。
- `cloudflared.exe` 是大约 54 MB 的 Windows 可执行文件，首次脚本会从 Cloudflare 官方发布页获取。
- `public-url.txt` 每次启动都会重新生成，里面只是本次临时网址。

因此，GitHub 保存的是“源码 + 安装清单 + 自动准备脚本”，而不是某台电脑已经安装好的副本。Render 也会根据 `package-lock.json` 自动安装依赖。

### 首次脚本具体下载什么

`第一次启动时请打开该脚本.cmd` 会调用 `scripts/first-run-setup.ps1`，依次完成：

1. 确认当前系统是 64 位 Windows，并检查 `package.json` 与 `package-lock.json`。
2. 查找 Node.js 20+。如果电脑没有兼容版本，就从 Node.js 官网下载固定版本 `24.18.0` 的便携压缩包。
3. 对 Node.js 下载文件执行 SHA-256 校验，正确后解压到 `.runtime/tools/`。
4. 检查项目根目录中的 `cloudflared.exe`。如果没有，就从 Cloudflare 官方 GitHub Release 下载固定版本 `2026.7.3`。
5. 对 `cloudflared.exe` 执行 SHA-256 校验，拒绝运行下载不完整或内容不符的文件。
6. 执行 `npm ci --omit=dev`，严格按照 `package-lock.json` 创建 `node_modules`。
7. 检查游戏真正需要的几个依赖是否已经安装成功。

首次脚本可以重复运行。重复运行会重新按照锁文件整理依赖；已经校验通过的 Node.js 和 `cloudflared.exe` 不会重复下载。

脚本目前固定了下载版本和校验值。以后如果维护者升级 Node.js 或 cloudflared，需要同时更新 `scripts/first-run-setup.ps1` 中的版本、下载地址和 SHA-256。

## 哪些文件必须一起复制

从 GitHub 下载或复制给朋友时，至少应包含：

```text
public/
scripts/
game-data.js
server.js
package.json
package-lock.json
第一次启动时请打开该脚本.cmd
启动游戏.cmd
关闭游戏.cmd
```

首次脚本运行后会自动补齐：

```text
node_modules/
.runtime/tools/...
cloudflared.exe
```

`.runtime` 的其余日志、进程编号和 `public-url.txt` 也是运行时自动生成的。它们都不需要上传 GitHub。

## 第一次启动时请打开该脚本.cmd 做了什么

这个 `.cmd` 文件和 `启动游戏.cmd` 一样，只是一个方便双击的入口。它把控制台编码切换为 UTF-8，然后调用：

```bat
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\first-run-setup.ps1"
```

其中 `%~dp0` 代表这个 `.cmd` 文件所在的项目目录，因此项目换磁盘、改文件夹名或路径包含中文时，脚本仍能找到对应的 PowerShell 文件。`-ExecutionPolicy Bypass` 只影响这一次运行，不会永久修改 Windows 的脚本策略。

窗口最后的 `pause` 会等待按键，目的是让你看清成功或失败信息。真正的下载、校验和依赖安装逻辑都在 `scripts/first-run-setup.ps1` 中。

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
2. 检查 `server.js`、`cloudflared.exe` 和游戏依赖是否存在；缺少时提示先运行首次脚本。
3. 创建 `.runtime` 文件夹，用来保存进程编号和运行日志。
4. 优先查找首次脚本下载的便携版 Node.js，否则使用系统中的 Node.js 20+。
5. 检查本项目的 Node 游戏服务是否已经运行。
6. 检查 `3000` 端口是否被其他程序占用，并使用 Node.js 启动 `server.js`。
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

这不会影响其他人从 GitHub 下载后在 Windows 本地运行：他们只需先双击仓库中的 `第一次启动时请打开该脚本.cmd`。这个首次脚本只用于本地电脑，Render 部署时不需要运行它。

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

### 提示先运行首次脚本

原因：缺少 Node.js 20+、`node_modules` 或 `cloudflared.exe`。

处理：确认电脑联网，双击 `第一次启动时请打开该脚本.cmd`，看到成功提示后再打开 `启动游戏.cmd`。

### 首次准备下载失败

原因可能包括：无法访问 Node.js 官网、GitHub 或 npm；代理或校园网拦截；磁盘空间不足；杀毒软件阻止 `cloudflared.exe`。

处理：保留窗口中的具体错误，检查网络和磁盘空间后重新运行首次脚本。下载文件必须通过 SHA-256 校验，校验失败时脚本不会继续安装。

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
