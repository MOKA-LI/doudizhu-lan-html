# 斗地主局域网版

这是一个基于本地扑克牌素材制作的完整斗地主网页版本，包含：

- 公屏大厅
- 手机扫码加入
- 局域网同步对局
- 单人开局自动补 AI
- 经典叫分抢地主流程
- 54 张牌完整发牌
- 顺子、连对、三带、飞机、四带、炸弹、王炸等常见牌型
- 炸弹 / 王炸翻倍
- 春天判定
- 局内结算与累计积分
- 玩家超时自动托管

## 本地启动

双击运行：

- [启动斗地主.bat](/E:/桌面/扑克牌/启动斗地主.bat)

或者命令行运行：

```powershell
& "C:\Users\10482\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
```

启动后：

1. 在电脑上打开公屏地址 `http://127.0.0.1:3188`
2. 公屏会显示局域网二维码和玩家加入链接
3. 3 个玩家可扫码进入，人数不足时会自动补机器人
4. 至少需要 1 名真人玩家才能开局

## 页面说明

- `/`：公屏
- `/player`：玩家端
- `/healthz`：健康检查

## 牌面素材

- 牌面素材已整理到 [cards/CARD_MAPPING.txt](/E:/桌面/扑克牌/cards/CARD_MAPPING.txt) 所在目录
- 游戏当前会从 `cards` 文件夹读取牌面图片
- `7` 的四张牌因为原始文件命名特殊，已在映射文件中说明

## Render 部署

仓库已包含：

- `package.json`
- `render.yaml`
- `/healthz` 健康检查接口

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/MOKA-LI/doudizhu-lan-html)

在 Render 上部署时：

1. 选择 `New +`
2. 选择 `Blueprint`
3. 连接本仓库
4. 直接创建即可，Render 会自动读取 `render.yaml`

默认启动命令：

```bash
npm start
```

健康检查地址：

```text
/healthz
```

## 说明

- 为了让手机能扫码，公屏二维码默认优先使用局域网 IP，而不是 `localhost`
- 二维码图片当前使用在线生成服务；如果当前网络无法访问外网，仍可直接输入公屏显示的局域网地址进入
