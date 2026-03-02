# AI-My Claude Code 学习工程

> 系统化学习 Claude Code 的完整指南，从入门到进阶

[![GitHub stars](https://img.shields.io/github/stars/muyangxinyu0227-maker/AI-my)](https://github.com/muyangxinyu0227-maker/AI-my/stargazers)
[![License](https://img.shields.io/github/license/muyangxinyu0227-maker/AI-my)](LICENSE)

## 简介

本项目是基于 [Datawhale Easy-Vibe](https://datawhalechina.github.io/easy-vibe/) 课程整理的 Claude Code 系统学习工程。专为想系统掌握 Claude Code 的开发者设计，提供从入门到进阶的完整学习路径。

## 为什么学习 Claude Code？

Claude Code 是 Anthropic 官方推出的 AI 编程助手，它能：

- 🤖 **智能编程**：理解整个项目上下文，生成高质量代码
- 🔧 **自动化任务**：执行复杂开发任务，从代码生成到重构
- 📚 **学习助手**：帮你理解代码、调试问题、编写文档
- 🚀 **效率提升**：10 倍开发效率提升

## 学习路径

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code 学习路线                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  阶段一：入门基础                                            │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                    │
│  │ 安装配置 │→ │ 基础操作 │→ │ 项目实战 │                    │
│  └─────────┘  └─────────┘  └─────────┘                    │
│                                                             │
│  阶段二：核心技能                                            │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐     │
│  │ 工作流   │→ │  MCP    │→ │ Skills  │→ │ 实战演练 │     │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘     │
│                                                             │
│  阶段三：高级进阶                                            │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐     │
│  │Superpow │→ │AgentTeams│→ │ SDK开发 │→ │ 团队协作 │     │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 模块说明

| 模块 | 描述 | 难度 | 预计时间 |
|------|------|------|----------|
| [01-basics](docs/01-basics/) | 基础入门、安装配置 | ⭐ | 1天 |
| [02-workflow](docs/02-workflow/) | 工作流最佳实践 | ⭐⭐ | 2天 |
| [03-mcp](docs/03-mcp/) | MCP 外部集成 | ⭐⭐ | 2天 |
| [04-skills](docs/04-skills/) | 技能系统 | ⭐⭐⭐ | 2天 |
| [05-superpowers](docs/05-superpowers/) | 工程级开发 | ⭐⭐⭐⭐ | 3天 |
| [06-agent-teams](docs/06-agent-teams/) | 多代理协作 | ⭐⭐⭐⭐ | 2天 |
| [07-spec-coding](docs/07-spec-coding/) | 规范编程 | ⭐⭐⭐ | 2天 |
| [08-long-tasks](docs/08-long-tasks/) | 长时任务 | ⭐⭐⭐ | 1天 |
| [09-mobile](docs/09-mobile/) | 移动开发 | ⭐⭐⭐⭐ | 3天 |
| [10-agent-sdk](docs/10-agent-sdk/) | Agent SDK | ⭐⭐⭐⭐⭐ | 3天 |

## 快速开始

### 1. 环境准备

```bash
# 检查 Node.js 版本
node --version  # 需要 v18+

# 安装 Claude Code
npm install -g @anthropic-ai/claude-code

# 验证安装
claude --version
```

### 2. 克隆本项目

```bash
git clone https://github.com/muyangxinyu0227-maker/AI-my.git
cd AI-my
```

### 3. 开始学习

```bash
# 查看学习路线
cat ROADMAP.md

# 按顺序学习各模块
# 建议从 docs/01-basics 开始
```

## 目录结构

```
AI-my/
├── docs/                          # 学习文档
│   ├── 01-basics/                # 基础入门
│   ├── 02-workflow/              # 工作流
│   ├── 03-mcp/                   # MCP
│   ├── 04-skills/                # 技能
│   ├── 05-superpowers/           # 工程级开发
│   ├── 06-agent-teams/           # 多代理
│   ├── 07-spec-coding/           # 规范编程
│   ├── 08-long-tasks/            # 长时任务
│   ├── 09-mobile/                # 移动开发
│   └── 10-agent-sdk/             # Agent SDK
├── examples/                      # 示例代码
│   ├── hello-world/
│   ├── todo-app/
│   └── api-server/
├── exercises/                    # 练习项目
│   ├── 01-hello-world/
│   ├── 02-todo-cli/
│   ├── 03-api/
│   ├── 04-react-app/
│   └── 05-fullstack/
├── .claude/                      # Claude Code 配置
│   ├── settings.json
│   └── CLAUDE.md
├── study-progress.md              # 学习进度
├── ROADMAP.md                    # 学习路线
└── README.md
```

## 学习建议

### 新手入门（1-2周）

1. **第一天**：完成 basics 模块，安装配置 Claude Code
2. **第二天**：学习 workflow，理解工作流
3. **第三-四天**：掌握 MCP，会配置 GitHub 等服务
4. **第五-七天**：练习 skills 和实战项目

### 进阶提升（2-4周）

1. **第一周**：深入 superpowers，学会 TDD
2. **第二周**：掌握 agent-teams，多代理协作
3. **第三周**：学习 spec-coding，规范编程

### 高级专题（4周+）

1. 长时任务处理
2. 移动开发集成
3. Agent SDK 开发

## 资源链接

- 📖 [官方文档](https://docs.anthropic.com/zh-CN/docs/claude-code)
- 🔧 [MCP 服务器列表](https://github.com/punkpeye/awesome-mcp-servers)
- 🛠️ [Skills 市场](https://skills.sh/)
- 📚 [Easy-Vibe 课程](https://datawhalechina.github.io/easy-vibe/)

## 学习进度

使用 `study-progress.md` 追踪你的学习进度：

```bash
# 复制进度模板
cp study-progress.md my-progress.md

# 完成后在对应章节打勾
- [x] 完成 basics 模块
```

## 贡献指南

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解如何参与。

## 许可证

MIT License - 请自由使用和学习。

## 致谢

- [Datawhale](https://datawhalechina.github.io/) - 优质开源学习组织
- [Anthropic](https://www.anthropic.com/) - Claude Code 官方
- 所有贡献者
