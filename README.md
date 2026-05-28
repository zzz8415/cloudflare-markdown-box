# Cloudflare Markdown Box

一个基于 Cloudflare Workers、KV 和 R2 的 Markdown 管理与分享应用，适合单账号、自托管、可快速冷启动测试的部署场景。

## Features

- 单账号密码登录，首次请求自动初始化默认账号 `admin / admin@123`
- Markdown 文档列表、创建、删除、独立编辑页编辑
- 独立分享页查看，分享链接可主动更换并立即使旧链接失效
- Vditor 官方编辑器
- 编辑页支持常用快捷键（Windows/Linux 的 `Ctrl` 与 macOS 的 `Command`）
- 所有运行时服务与静态资源均部署在 Cloudflare 上
- 提供初始化部署和 Cloudflare 资源重置脚本，便于从零验证

## Stack

- Cloudflare Workers：API、鉴权、前端壳路由
- Cloudflare KV：用户、会话、文档元数据、分享索引
- Cloudflare R2：Markdown 正文存储
- Frontend：原生 HTML / CSS / JavaScript
- Editor runtime：[Vditor](https://github.com/Vanessa219/vditor)
- Markdown rendering：Vditor 官方渲染链路（`Vditor.preview`）

## Requirements

- Node.js 20+
- 可用的 `npx wrangler`
- 已完成 Cloudflare 登录：`npx wrangler login --config wrangler.bootstrap.toml`

## Quick Start

```bash
npm install
npx wrangler login --config wrangler.bootstrap.toml
npm run setup
npm run deploy
```

如果希望一条命令完成安装、初始化与发布：

```bash
npm run deploy:all
```

部署完成后，Wrangler 会输出 `workers.dev` 地址。首次访问时会自动初始化默认账号。

## Development

```bash
npm install
npm run dev
```

默认本地地址通常为 `http://127.0.0.1:8787`。

## Scripts

- `npm run dev`：启动本地开发环境
- `npm run check`：执行 TypeScript 检查
- `npm run setup`：创建 KV、R2、Secret，并回填 `wrangler.toml`
- `npm run deploy`：发布当前 Worker
- `npm run deploy:all`：自动登录检查 + 安装依赖 + 初始化 + 发布
- `npm run reset:cloudflare`：删除 Worker、Secret、KV、R2，并把 `wrangler.toml` 恢复为占位状态

## Runtime Flow

1. 登录后进入文档列表页。
2. 新建文档或打开已有文档的独立编辑页。
3. 在 Vditor 官方编辑器内编辑 Markdown。
4. 保存后主列表自动刷新。
5. 通过“分享”生成或更换公开链接；更换后旧链接立即失效。
6. 访客只要持有链接即可进入独立查看页。

## Keyboard Shortcuts

- 新建文档：`Ctrl/Cmd + N`
- 保存文档：`Ctrl/Cmd + S`
- 撤销：`Ctrl/Cmd + Z`
- 重做：`Ctrl/Cmd + Shift + Z`（Windows 也可 `Ctrl + Y`）
- 全选 / 复制 / 粘贴 / 剪切：`Ctrl/Cmd + A/C/V/X`
- 粗体 / 斜体：`Ctrl/Cmd + B/I`

## Reset Cloudflare Resources

```bash
npm run reset:cloudflare
```

该脚本会删除当前 Worker、`PASSWORD_PEPPER` Secret、相关 KV/R2 资源，并把 `wrangler.toml` 恢复到占位状态。重置后可以重新执行 `npm run setup && npm run deploy` 完整验证冷启动流程。

## Project Structure

```text
.
├── public/
│   ├── index.html
│   ├── main.js
│   └── styles.css
├── scripts/
│   ├── deploy-all.mjs
│   ├── reset-cloudflare.mjs
│   └── setup.mjs
├── src/
│   ├── types.ts
│   └── worker.ts
├── wrangler.bootstrap.toml
├── wrangler.toml
└── package.json
```

## Contributing

贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交前至少运行一次 `npm run check`，并在行为变更时同步更新文档。

## Security

- `PASSWORD_PEPPER` 由 `setup` 自动生成，也可以通过环境变量覆盖
- 分享链接支持手动更换，旧链接会立即失效
- 不要在示例文档、截图、测试内容或提交记录中保留真实账号、密码、令牌或内部地址
