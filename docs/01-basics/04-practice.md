# 实战练习

## 练习目标

完成以下任务，巩固今天学到的内容：

## 练习 1：环境检查

```bash
# 检查环境
!node --version
!npm --version
!claude --version
```

## 练习 2：探索项目

```text
@directory ./
```

任务：
1. 了解项目结构
2. 识别主要目录
3. 找出配置文件

## 练习 3：读取代码

任务：
1. 找到一个 JS/TS 文件
2. 让 Claude 解释代码功能
3. 询问某个函数的作用

## 练习 4：修改代码

任务：
1. 添加一个 console.log
2. 修改一个变量名
3. 添加一个注释

## 练习 5：运行命令

任务：
1. 运行 `npm install`
2. 运行 `npm test`
3. 查看输出结果

## 练习 6：综合任务

创建一个简单的 Hello World 程序：

```javascript
// src/hello.js
function greet(name) {
  return `Hello, ${name}!`;
}

console.log(greet('World'));
```

## 验收标准

- [ ] 能启动 Claude Code
- [ ] 能读取和理解代码
- [ ] 能进行简单修改
- [ ] 能运行命令

## 下一步

完成基础入门后，前往 [02-工作流](./02-workflow/README.md) 学习开发工作流
