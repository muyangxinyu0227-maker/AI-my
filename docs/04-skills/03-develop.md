# 开发 Skill

## Skill 结构

```
my-skill/
├── SKILL.md          # 技能定义
└── prompts/          # 提示词
    └── ...
```

## SKILL.md 格式

```markdown
# Skill 名称

## 描述
技能的功能描述

## 触发关键词
- keyword1
- keyword2

## 工作流程
1. 第一步
2. 第二步

## 输出格式
- 输出格式说明
```

## 示例

```markdown
# 代码审查

## 描述
进行代码审查，检查安全性和质量

## 触发关键词
- 审查
- code review

## 工作流程
1. 读取代码
2. 检查安全问题
3. 检查性能问题
4. 检查代码质量
5. 生成审查报告

## 输出格式
- 严重问题
- 建议修复
- 改进建议
```

## 安装自定义 Skill

```bash
mkdir -p ~/.claude/skills/my-skill
# 添加 SKILL.md
```

## 下一步

完成 Skills 学习后，前往 [05-Superpowers](./05-superpowers/README.md) 学习工程级开发
