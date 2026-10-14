const colors = require('./todo-colors.json');
const MAX_NOTE_LENGTH = 1_000_000;

function noteTitle(text) { return text.split(/\r?\n/, 1)[0].trim() || '无标题便签'; }
function validateNoteInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.text !== 'string' || input.text.length > MAX_NOTE_LENGTH || !colors.some(color => color.id === input.color)) {
    throw new TypeError('便签内容过长或颜色无效');
  }
  return { text: input.text, color: input.color };
}
function validateNoteId(id) {
  if (typeof id !== 'string' || !id || id.length > 64) throw new TypeError('无效的便签标识');
}
function validateNoteItems(items) {
  if (!Array.isArray(items)) throw new TypeError('Invalid persisted note list');
  const ids = new Set();
  for (const item of items) {
    validateNoteId(item?.id);validateNoteInput(item);
    if (ids.has(item.id)) throw new TypeError('Duplicate note id');
    ids.add(item.id);
  }
}
module.exports = { noteTitle, validateNoteInput, validateNoteId, validateNoteItems, MAX_NOTE_LENGTH };
