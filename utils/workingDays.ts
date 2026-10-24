const MS_PER_DAY = 86400000;

// Mon-Fri only (UTC); public holidays are not accounted for.
// Starting on a weekend counts from the next Monday, so day 1 is never a Saturday or Sunday.
export const addWorkingDays = (from: Date, days: number): Date => {
  const result = new Date(from.getTime());
  let remaining = days;
  while (remaining > 0) {
    result.setTime(result.getTime() + MS_PER_DAY);
    const dow = result.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return result;
};
