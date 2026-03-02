# TDD 开发

## TDD 流程

```
🔴 RED   → 🟢 GREEN → 🔵 REFACTOR
写失败测试 → 写通过代码 → 重构代码
```

## 步骤

### 1. RED：写失败测试

```
用 TDD 实现一个计算器
```

先写测试：

```javascript
test('add', () => {
  expect(add(1, 2)).toBe(3);
});
```

### 2. GREEN：写通过代码

写最少的代码让测试通过：

```javascript
function add(a, b) {
  return a + b;
}
```

### 3. REFACTOR：重构

保持测试通过，优化代码：

```javascript
// 提取公共逻辑
// 改善命名
// 优化结构
```

## 使用方法

```
用 TDD 方式实现用户认证模块
```

## 触发 TDD

- 说 "用 TDD 方式"
- 说 "测试驱动开发"
- 说 "先写测试"

## 下一步

[需求澄清](./03-brainstorming.md) →
