# 使用 Skills

## 安装技能

```bash
# 安装 find-skills
npx skills add vercel-labs/skills@find-skills -g -y

# 安装其他技能
npx skills add owner/repo@skill-name -g -y
```

## 查看技能

```
列出已安装的技能
```

## 使用技能

直接描述需求，Claude 会自动使用合适的技能：

```
帮我写一个单元测试
```

## 触发技能

技能通过关键词触发：

| 技能 | 触发词 |
|------|--------|
| commit | "提交代码" |
| review | "审查代码" |
| test | "写测试" |

## 下一步

[开发 Skill](./03-develop.md) →
