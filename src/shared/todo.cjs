const TODO_COLORS = require('./todo-colors.json');

function validateTodoInput(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.text !== 'string' || !input.text.trim() || input.text.length > 2000 ||
      !TODO_COLORS.some(color => color.id === input.color)) throw new TypeError('请输入待办内容（最多2000字）并选择预设颜色');
  if (input.remindAt !== null && (!Number.isSafeInteger(input.remindAt) || input.remindAt <= now || input.remindAt > 253402300799000)) {
    throw new TypeError('提醒时间必须是有效的未来时间');
  }
  return { text: input.text.trim(), color: input.color, remindAt: input.remindAt };
}

function validateTodoItems(items) {
  if (!Array.isArray(items)) throw new TypeError('Invalid persisted todo list');
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 64 || ids.has(item.id) ||
        typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2000 ||
        !TODO_COLORS.some(color => color.id === item.color) ||
        (item.remindAt === null ? item.reminderState !== null :
          !Number.isSafeInteger(item.remindAt) || item.remindAt < 0 || item.remindAt > 253402300799000 ||
          !['pending', 'notified', 'missed'].includes(item.reminderState))) throw new TypeError('Invalid persisted todo item');
    ids.add(item.id);
  }
}

module.exports = { validateTodoInput, validateTodoItems };
