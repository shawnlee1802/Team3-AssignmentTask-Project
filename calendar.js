const MONTH_PARAM_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function toIsoDate(year, monthIndex, day) {
  return `${year}-${padNumber(monthIndex + 1)}-${padNumber(day)}`;
}

function normaliseMonth(value, now = new Date()) {
  const match = MONTH_PARAM_PATTERN.exec(value || "");
  if (!match) {
    return { year: now.getFullYear(), monthIndex: now.getMonth() };
  }

  return { year: Number(match[1]), monthIndex: Number(match[2]) - 1 };
}

function monthParam(year, monthIndex) {
  const date = new Date(year, monthIndex, 1);
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}`;
}

function buildCalendar(assignments, requestedMonth, now = new Date()) {
  const { year, monthIndex } = normaliseMonth(requestedMonth, now);
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const today = toIsoDate(now.getFullYear(), now.getMonth(), now.getDate());
  const assignmentsByDate = assignments.reduce((dates, assignment) => {
    if (assignment.due_date) {
      (dates[assignment.due_date] ||= []).push(assignment);
    }
    return dates;
  }, {});

  const days = [];
  for (let index = 0; index < firstWeekday; index += 1) {
    days.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = toIsoDate(year, monthIndex, day);
    days.push({ day, date, isToday: date === today, assignments: assignmentsByDate[date] || [] });
  }
  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return {
    weeks: Array.from({ length: days.length / 7 }, (_, index) => days.slice(index * 7, index * 7 + 7)),
    monthLabel: new Intl.DateTimeFormat("en-SG", { month: "long", year: "numeric" }).format(
      new Date(year, monthIndex, 1)
    ),
    currentMonth: monthParam(year, monthIndex),
    previousMonth: monthParam(year, monthIndex - 1),
    nextMonth: monthParam(year, monthIndex + 1),
    todayMonth: monthParam(now.getFullYear(), now.getMonth()),
    today,
  };
}

module.exports = { buildCalendar, normaliseMonth };
