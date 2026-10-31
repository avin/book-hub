export function formatBytes(value: number) {
  if (value < 1024) {
    return `${value}\u00a0B`;
  }

  const units = ['KB', 'MB', 'GB'];
  let nextValue = value / 1024;
  let unitIndex = 0;

  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }

  return `${nextValue.toFixed(nextValue >= 10 ? 0 : 1)}\u00a0${units[unitIndex]}`;
}
