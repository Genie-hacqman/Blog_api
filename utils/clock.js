// "Now", in one place, so a test can pin it and cross a day boundary without waiting for midnight.
let pinned = null;

export const now = () => (pinned ? new Date(pinned) : new Date());

// tests only: setNowForTests(new Date("2026-01-01T23:59:00Z")), and setNowForTests(null) to let time run again
export const setNowForTests = (date) => {
    pinned = date ? new Date(date) : null;
};

// the UTC calendar day of a moment, as "YYYY-MM-DD" (analytics days are always UTC)
export const utcDay = (date = now()) => date.toISOString().slice(0, 10);

export const addDays = (day, count) => {
    const moment = new Date(`${day}T00:00:00.000Z`);
    moment.setUTCDate(moment.getUTCDate() + count);
    return moment.toISOString().slice(0, 10);
};

// every day from `from` to `to` inclusive
export const daysBetween = (from, to) => {
    const days = [];
    for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
    return days;
};
