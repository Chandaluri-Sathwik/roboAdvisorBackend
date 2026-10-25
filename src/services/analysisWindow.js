export function getAnalysisStartDate(now, years) {
  const from = new Date(now);
  from.setUTCFullYear(from.getUTCFullYear() - years);
  from.setUTCDate(1);
  from.setUTCMonth(from.getUTCMonth() - 1);
  return from;
}
