# MCP 简介

## 什么是 MCP？

MCP (Model Context Protocol) 是一个让 AI 助手连接外部工具的协议。

## 配置文件

| 级别 | 路径 | 作用范围 |
|------|------|----------|
| 用户级 | ~/.claude.json | 所有项目 |
| 项目级 | .mcp.json | 当前项目 |

## 配置格式

```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token"
      }
    }
  }
}
```

## 添加 MCP

用自然语言告诉 Claude：

```
帮我添加 GitHub MCP
```

Claude 会自动帮你配置。

## 常用 MCP

| MCP | 功能 |
|-----|------|
| github | GitHub 操作 |
| sqlite | SQLite 数据库 |
| postgres | PostgreSQL |
| filesystem | 文件系统 |
| puppeteer | 浏览器 |

## 下一步

[GitHub MCP](./02-github.md) →
