import colors from './todo-colors.json' with { type: 'json' };
import type { TodoColor } from './contracts';

export const TODO_COLORS = colors as { id: TodoColor; name: string; value: string }[];

// Monday-first cells; use setFullYear because Date's constructor maps years 0–99 to 1900–1999.
export function todoCalendarDays(month: string): (number | null)[] {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match || Number(match[1]) === 0) return [];
  const first = new Date(0);
  first.setFullYear(Number(match[1]), Number(match[2]) - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const last = new Date(first);
  last.setMonth(last.getMonth() + 1, 0);
  return [...Array<null>(offset).fill(null), ...Array.from({ length: last.getDate() }, (_, index) => index + 1)];
}

export function formatTodoTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Date normalizes impossible dates, so compare every field before accepting local wall time.
export function parseTodoTime(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, second, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
      date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) return null;
  return date.getTime();
}
