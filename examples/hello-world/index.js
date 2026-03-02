/**
 * Hello World 示例
 * 学习目标：理解 Claude Code 基础操作
 */

/**
 * 输出问候语
 * @param {string} name - 名称
 * @returns {string} 问候语
 */
function greet(name) {
  return `Hello, ${name}!`;
}

// 主程序
const name = process.argv[2] || 'World';
console.log(greet(name));

// 导出模块
module.exports = { greet };
