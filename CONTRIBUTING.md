# Contributing

## Scope

本项目以可部署、可重置、可快速验证的 Cloudflare Markdown 应用为目标。贡献应优先围绕以下方面展开：

- 功能正确性
- 部署与重置流程稳定性
- 前端交互与文档一致性
- Cloudflare 资源脚本的可重复执行能力

## Local Setup

```bash
npm install
npm run sync:assets
npm run check
```

如需本地联调 Worker：

```bash
npm run dev
```

## Change Guidelines

- 保持改动聚焦，不顺手重写无关模块
- 优先删除死代码、过时参数和重复样式，而不是继续堆兼容层
- 用户可见行为变化需要同步更新 README
- 第三方编辑器或静态资源链变动时，记得同步更新 `scripts/sync-vendor-assets.mjs`

## Before Opening a PR

- 运行 `npm run check`
- 确认部署或重置相关脚本没有被无意破坏
- 前端改动尽量附上截图或简要行为说明
- 如果修改了分享、鉴权、编辑器或路由行为，请补充 README 相关描述

## Sensitive Data

- 不要提交真实账号、密码、API Key、Token、域名后台凭据或服务器地址
- 不要把真实敏感 Markdown 内容作为示例数据保留在仓库里
- 如需演示，请使用脱敏内容或占位值