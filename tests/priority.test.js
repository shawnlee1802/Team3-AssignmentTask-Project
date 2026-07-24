const assert = require("assert");
const { getAssignmentPriority, getReminderStatus, getReminderCountdown } = require("../app");

function toIso(daysFromToday) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysFromToday);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const cases = [
  { dueDate: toIso(0), status: "Not Started", expected: "High" },
  { dueDate: toIso(3), status: "In Progress", expected: "High" },
  { dueDate: toIso(5), status: "Not Started", expected: "High" },
  { dueDate: toIso(6), status: "Not Started", expected: "Medium" },
  { dueDate: toIso(7), status: "Not Started", expected: "Medium" },
  { dueDate: toIso(8), status: "Not Started", expected: "Low" },
  { dueDate: toIso(-1), status: "Not Started", expected: "Overdue" },
  { dueDate: toIso(2), status: "Completed", expected: "Completed" },
  { dueDate: toIso(2), status: "completed", expected: "Completed" },
];

for (const testCase of cases) {
  const actual = getAssignmentPriority(testCase.dueDate, testCase.status);
  assert.strictEqual(actual, testCase.expected, `${testCase.dueDate} / ${testCase.status} -> ${actual}`);
}

assert.strictEqual(getReminderStatus(toIso(-1), "Completed"), null);
assert.strictEqual(getReminderCountdown(toIso(-1), "Completed"), null);
assert.strictEqual(getReminderStatus(toIso(-1), "Not Started").label, "Overdue Warning");
assert.strictEqual(getReminderCountdown(toIso(1), "Not Started").text, "Due Tomorrow");

console.log(`Verified ${cases.length} priority scenarios and reminder behavior.`);
