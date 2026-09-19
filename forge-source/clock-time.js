(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UasClockTime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function fromTotalMinutes(totalMinutesExact) {
    const total = Math.max(0, Number(totalMinutesExact));
    let minutesToMidnight = Math.floor(total);
    let secondsComponent = Math.round((total - minutesToMidnight) * 60);
    if (secondsComponent === 60) {
      minutesToMidnight += 1;
      secondsComponent = 0;
    }
    return {
      minutesToMidnight,
      secondsComponent,
      totalMinutesExact: total,
      display: `${minutesToMidnight}m ${secondsComponent.toString().padStart(2, '0')}s`,
      // N minutes before midnight is the (60-N) minute mark. Negative rotation
      // keeps the existing counter-clockwise animation and is SVG-equivalent.
      angleDeg: -(total / 60) * 360,
    };
  }

  function scoreToTime(score) {
    // Compatibility fallback for old snapshots without minutes_to_midnight.
    const numericScore = Number.isFinite(Number(score)) ? Number(score) : 0;
    return fromTotalMinutes(Math.max(0.1, (100 - numericScore) / 100 * 30));
  }

  function resolveClockTime(data, score) {
    const canonical = Number(data && data.minutes_to_midnight);
    if (Number.isFinite(canonical) && canonical >= 0) {
      return fromTotalMinutes(canonical);
    }
    return scoreToTime(score);
  }

  return { fromTotalMinutes, scoreToTime, resolveClockTime };
});
