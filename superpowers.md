# Claude Code Superpowers 学习

## 什么是 Superpowers？

Superpowers 是由 Jesse Vincent 开发的开源代理技能框架，让 AI 写出"工程级"代码。

## 核心价值

- **需求优先**：模糊需求时主动提问澄清
- **流程纪律**：强制 TDD 红绿重构循环
- **任务分解**：将大项目拆解为小任务
- **质量控制**：确保代码审查

## 安装 Superpowers

```bash
# 添加 marketplace
/plugin marketplace add obra/superpowers-marketplace

# 安装
/plugin install superpowers@superpowers-marketplace

# 或手动克隆
git clone https://github.com/obra/superpowers.git ~/.claude/skills/superpowers
```

## 核心技能

### brainstorming（头脑风暴）
需求模糊时，通过提问帮你澄清真正需要什么。

### test-driven-development（TDD）
强制 RED-GREEN-REFACTOR 流程：
1. 🔴 RED：先写失败的测试
2. 🟢 GREEN：写最少代码让测试通过
3. 🔵 REFACTOR：重构代码

### writing-plans（编写计划）
将大任务分解为 2-5 分钟可完成的小任务。

### systematic-debugging（系统调试）
四阶段根因分析：
1. 复现问题
2. 隔离根因
3. 验证假设
4. 修复并验证

### verification-before-completion（完成前验证）
确保任务真正完成：
- 运行所有测试
- 手动测试关键功能
- 检查代码质量
- 确认文档更新

## 触发关键词

| 技能 | 触发关键词 |
|------|-----------|
| TDD | "TDD"、"测试驱动"、"先写测试" |
| brainstorming | 需求模糊时自动触发 |
| debugging | "调试"、"bug"、"不工作" |

## 标准开发流程

```
1. Brainstorming（头脑风暴）
   ↓ 问答澄清需求

2. Writing Plans（编写计划）
   ↓ 分解为小任务

3. Subagent Development（子代理开发）
   ↓ 每个任务启动独立代理

4. TDD（测试驱动开发）
   ↓ RED-GREEN-REFACTOR

5. Code Review（代码审查）
   ↓ 质量把关

6. 完成
```

## Superpowers vs 直接使用

| 维度 | 直接使用 | Superpowers |
|------|---------|-------------|
| 需求澄清 | 直接开始写 | 苏格拉底式提问 |
| 开发流程 | 自由发挥 | 强制 TDD |
| 任务管理 | 一次性完成 | 分解小任务 |
| 代码质量 | 依赖 AI 判断 | 强制审查 |

## 练习任务

- [ ] 安装 Superpowers
- [ ] 体验 brainstorming 技能
- [ ] 使用 TDD 方式开发
- [ ] 制定实施计划
