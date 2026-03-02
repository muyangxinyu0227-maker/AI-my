# 其他 MCP

## 文件系统 MCP

### 配置

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    }
  }
}
```

## Puppeteer MCP

### 配置

```json
{
  "mcpServers": {
    "puppeteer": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-puppeteer"]
    }
  }
}
```

### 使用

```
打开 https://example.com 并截图
```

## Brave Search MCP

### 配置

```json
{
  "mcpServers": {
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "your-api-key"
      }
    }
  }
}
```

## 资源列表

更多 MCP 服务器：
- [Awesome MCP Servers](https://github.com/punkpeye/awesome-mcp-servers)
- [MCP Registry](https://registry.modelcontextprotocol.io)

## 下一步

完成 MCP 学习后，前往 [04-Skills](./04-skills/README.md) 学习技能系统
