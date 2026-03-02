# Claude Code MCP 学习

## 什么是 MCP？

MCP（Model Context Protocol）是让 Claude Code 能够连接外部工具和服务的协议。

## MCP 的作用

没有 MCP 时：
- ✅ 读取本地文件
- ✅ 编辑代码
- ✅ 运行命令
- ❌ 查看 GitHub Issues
- ❌ 访问数据库
- ❌ 调用外部 API

有了 MCP 后：
- ✅ 所有原有功能
- ✅ 查看/创建 GitHub Issues 和 PR
- ✅ 查询数据库
- ✅ 访问外部服务

## 配置文件位置

| 级别 | 路径 | 作用范围 |
|------|------|---------|
| 用户级 | ~/.claude.json | 所有项目 |
| 项目级 | .mcp.json | 当前项目 |

## 快速配置示例

### GitHub MCP

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token"
      }
    }
  }
}
```

### SQLite MCP

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "./data/app.db"]
    }
  }
}
```

## 常用 MCP 服务器

| 服务器 | 功能 |
|--------|------|
| github | Issues、PR、仓库管理 |
| sqlite | SQLite 数据库 |
| filesystem | 文件系统访问 |
| puppeteer | 浏览器自动化 |
| brave-search | 网络搜索 |

## 学习资源

- [MCP 官方文档](https://modelcontextprotocol.io/)
- [Awesome MCP Servers](https://github.com/punkpeye/awesome-mcp-servers)

## 练习任务

- [ ] 配置 GitHub MCP
- [ ] 测试 MCP 连接
- [ ] 使用 MCP 工具
