# GitHub MCP

## 配置 GitHub MCP

### 1. 创建 Token

1. 访问 https://github.com/settings/tokens
2. 点击 "Generate new token"
3. 勾选 `repo` 权限
4. 生成并复制 token

### 2. 配置 MCP

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

### 3. 验证配置

```
现在有哪些 MCP？
```

## 使用 GitHub 工具

### 查看仓库

```
查看这个仓库的信息
```

### 管理 Issue

```
帮我创建一个 Issue
```

### 管理 PR

```
创建一个 PR
```

## 常用操作

| 操作 | 命令 |
|------|------|
| 查看仓库 | github_view_repository |
| 创建 Issue | github_create_issue |
| 创建 PR | github_create_pull_request |
| 查看 PR | github_list_pull_requests |

## 下一步

[数据库 MCP](./03-database.md) →
