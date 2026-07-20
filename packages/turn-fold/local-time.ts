function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function sameLocalDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function formatLocalTimestamp(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const current = new Date(now);
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return "";

  const time = `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
  if (sameLocalDate(date, current)) return time;
  return `${String(date.getFullYear())}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())} ${time}`;
}
