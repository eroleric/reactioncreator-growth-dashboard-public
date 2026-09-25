// Legacy Yes/No answers and comment-bearing answers share the existing bounded field.
export function parseStrategyAnswer(value) {
  if (['YES', 'NO', 'OTHER'].includes(value)) return {answer:value, comment:''};
  let result;
  try { result = JSON.parse(value); } catch { throw new Error('Invalid strategy answer'); }
  if (!result || !['YES', 'NO', 'OTHER'].includes(result.answer) || typeof result.comment !== 'string' || result.comment.length > 1000 || Object.keys(result).some(k => !['answer','comment'].includes(k))) throw new Error('Invalid strategy answer');
  return {answer:result.answer, comment:result.comment.trim()};
}
export function encodeStrategyAnswer(answer, comment = '') {
  const value = JSON.stringify({answer, comment:comment.trim()});
  parseStrategyAnswer(value);
  if (value.length > 2000) throw new Error('Please shorten your comment.');
  return value;
}
