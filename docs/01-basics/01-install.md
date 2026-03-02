# 安装指南

## 环境要求

- Node.js 18.0.0 或更高版本
- macOS / Linux / Windows (WSL)
- 4GB+ 内存

## 安装步骤

### 1. 检查 Node.js

```bash
node --version
```

如果版本低于 18，需要升级 Node.js：

```bash
# 使用 nvm 管理 Node.js 版本
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.zshrc
nvm install 18
nvm use 18
```

### 2. 安装 Claude Code

```bash
# 全局安装
npm install -g @anthropic-ai/claude-code

# 验证安装
claude --version
```

### 3. 登录账户

```bash
claude
```

首次启动会提示登录，按照指引完成：
1. 选择登录方式（浏览器或 token）
2. 完成身份验证
3. 选择使用计划（免费/Pro）

## 中国区用户

由于网络原因，中国区用户可能无法直接访问 Anthropic 服务。可以使用第三方 API 服务：

```bash
# 配置环境变量
export ANTHROPIC_BASE_URL=https://api.example.com
export ANTHROPIC_API_KEY=your-api-key
```

## 卸载

```bash
npm uninstall -g @anthropic-ai/claude-code
```

## 常见问题

### Q: 安装失败怎么办？
A: 检查 Node.js 版本，确保是 18+；检查网络连接

### Q: 登录失败怎么办？
A: 确认账户信息正确，或使用 API Key 方式登录

### Q: 如何更新版本？
A: 重新运行 `npm install -g @anthropic-ai/claude-code`

## 下一步

[基础概念](./02-concepts.md) →
