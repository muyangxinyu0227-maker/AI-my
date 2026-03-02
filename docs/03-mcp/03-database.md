# 数据库 MCP

## SQLite MCP

### 配置

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

### 使用

```
查询数据库中最近注册的 10 个用户
```

## PostgreSQL MCP

### 配置

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "postgresql://user:pass@localhost/db"
      }
    }
  }
}
```

## 常用操作

| 操作 | 描述 |
|------|------|
| sqlite_query | 执行 SQL 查询 |
| sqlite_execute | 执行 SQL 命令 |
| postgres_query | 查询 PostgreSQL |
| postgres_execute | 执行 PostgreSQL |

## 下一步

[其他 MCP](./04-others.md) →
