# 团队协作

## 项目配置

### 目录结构

```
.claude/
├── settings.json     # 团队共享配置
├── CLAUDE.md          # 项目说明
└── memory/            # 项目记忆
    ├── context.md
    ├── conventions.md
    └── architecture.md
```

### settings.json 示例

```json
{
  "hooks": {
    "beforeEdit": ["npm run type-check"],
    "afterEdit": ["npm run lint"],
    "beforeCommit": ["npm run test"]
  }
}
```

## CLAUDE.md

项目根目录的 CLAUDE.md 提供项目上下文：

```markdown
# 项目名称

## 技术栈
- Node.js + Express
- React + TypeScript

## 代码规范
- 使用 ESLint
- 使用 Prettier

## 注意事项
- API 统一返回格式
```

## 项目记忆

### memory/context.md
项目整体背景

### memory/conventions.md
代码规范约定

### memory/architecture.md
架构设计说明

## 团队实践

| 实践 | 说明 |
|------|------|
| 共享配置 | 将 .claude/ 提交到 Git |
| 文档规范 | 记录项目约定 |
| 代码审查 | 用 Claude 辅助审查 |
| 知识同步 | 定期更新文档 |

## 下一步

完成工作流学习后，前往 [03-MCP](./03-mcp/README.md) 学习 MCP 集成
