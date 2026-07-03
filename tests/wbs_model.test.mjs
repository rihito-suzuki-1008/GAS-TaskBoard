import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildWbsModel_,
  deriveActuals_,
  wbsColumnLetter_
} = require('../src/10_WbsExport.js');

const statusColumns = [
  { ColumnId: 'todo', Name: '未着手', SortOrder: 1000, IsDoneColumn: false },
  { ColumnId: 'done', Name: '完了', SortOrder: 2000, IsDoneColumn: true }
];

function baseRows() {
  return {
    statusColumns,
    members: [
      { MemberId: 'm1', Name: '佐藤', Email: 'sato@example.com', Company: 'ACME', Color: '#1E6F5C' },
      { MemberId: 'm2', Name: '田中', Email: 'tanaka@example.com', Company: 'ACME', Color: '#2F6FDB' }
    ],
    milestones: [],
    meetings: [],
    activityLog: [],
    nodes: [
      { NodeId: 'root', ParentId: '', Name: '案件', StatusColumnId: 'todo', SortOrder: 1000 },
      { NodeId: 'a', ParentId: 'root', Name: 'A', StatusColumnId: 'todo', SortOrder: 1000, StartDate: '2026-07-01', EndDate: '2026-07-03' },
      { NodeId: 'b', ParentId: 'root', Name: 'B', StatusColumnId: 'todo', SortOrder: 2000, IncludeInWbs: false, StartDate: '2026-07-02', EndDate: '2026-07-04' },
      { NodeId: 'b1', ParentId: 'b', Name: 'B-1', StatusColumnId: 'todo', SortOrder: 1000, StartDate: '2026-07-02', EndDate: '2026-07-04' },
      { NodeId: 'c', ParentId: 'root', Name: 'C', StatusColumnId: 'todo', SortOrder: 3000, StartDate: '2026-07-05', EndDate: '2026-07-06' },
      { NodeId: 'c1', ParentId: 'c', Name: 'C-1', StatusColumnId: 'todo', SortOrder: 1000, StartDate: '2026-07-05', EndDate: '2026-07-05' },
      { NodeId: 'c1a', ParentId: 'c1', Name: 'C-1-a', StatusColumnId: 'done', SortOrder: 1000, Progress: 100, StartDate: '2026-07-05', EndDate: '2026-07-05' },
      { NodeId: 'c1a1', ParentId: 'c1a', Name: 'C-1-a-1', StatusColumnId: 'todo', SortOrder: 1000, Progress: 45, StartDate: '2026-07-05', EndDate: '2026-07-05' }
    ]
  };
}

test('WBS numbering skips IncludeInWbs=false subtrees', () => {
  const model = buildWbsModel_(baseRows(), {
    actorName: '佐藤',
    now: '2026-07-03T00:00:00.000Z',
    createdAt: '2026-07-03T00:00:00.000Z',
    version: 1
  });
  assert.deepEqual(model.taskRows.map(row => [row.number, row.node.NodeId]), [
    ['1', 'a'],
    ['2', 'c'],
    ['2-1', 'c1'],
    ['2-1-1', 'c1a'],
    ['2-1-1-1', 'c1a1']
  ]);
});

test('template layout keeps management columns fixed and places deep task names', () => {
  const model = buildWbsModel_(baseRows(), {
    actorName: '佐藤',
    now: '2026-07-03T00:00:00.000Z',
    createdAt: '2026-07-03T00:00:00.000Z',
    version: 1
  });
  assert.equal(model.layout.maxDepth, 4);
  assert.equal(model.layout.taskNameStartCol, 2);
  assert.equal(model.layout.taskNameEndCol, 5);
  assert.equal(model.layout.taskDisplayCol, 6);
  assert.equal(model.layout.deliverableCol, 7);
  assert.equal(model.layout.doneCol, 18);
  assert.equal(model.layout.ganttStartCol, 19);
  assert.equal(model.layout.taskStartRow, 14);
  assert.deepEqual(model.sectionRows, [14, 15]);
  assert.deepEqual(model.normalRows, [16, 17, 18]);
  assert.equal(wbsColumnLetter_(model.layout.ganttStartCol), 'S');
  const deepest = model.taskRows.find(row => row.node.NodeId === 'c1a1');
  assert.equal(model.values[deepest.sheetRow - 1][4], 'C-1-a-1');
  assert.equal(model.backgrounds[0][0], '#D9D9D9');
  assert.equal(model.backgrounds[1][5], '#D9D9D9');
  assert.equal(model.backgrounds[0][8], '#FFFFDD');
  assert.equal(model.backgrounds[1][8], '#FFFFDD');
  assert.equal(model.backgrounds[0][9], '#FFFFFF');
  assert.equal(model.backgrounds[0][10], '#D9D9D9');
  assert.equal(model.backgrounds[1][10], '#FFFFDD');
  assert.equal(model.backgrounds[2][0], '#FFFFFF');
  assert.equal(model.values[model.layout.headerRow2 - 1][0], 'No.');
  assert.equal(model.values[model.layout.headerRow2 - 1][5], 'タスク');
  assert.equal(model.values[model.layout.headerRow2 - 1][17], '完了フラグ');
});

test('template places milestones and dated meetings on gantt rows', () => {
  const rows = baseRows();
  rows.milestones = [
    { MilestoneId: 'ms1', Name: 'Kick Off', Date: '2026-07-05', SortOrder: 1000 }
  ];
  rows.meetings = [
    { MeetingId: 'mt1', Name: '定例会', Schedule: '2026-07-06 毎週月曜', SortOrder: 1000 }
  ];
  const model = buildWbsModel_(rows, {
    actorName: '佐藤',
    now: '2026-07-03T00:00:00.000Z',
    createdAt: '2026-07-03T00:00:00.000Z',
    version: 1
  });
  const milestoneDateIndex = model.dateColumns.findIndex(date => date.date === '2026-07-05');
  const meetingDateIndex = model.dateColumns.findIndex(date => date.date === '2026-07-06');
  assert.notEqual(milestoneDateIndex, -1);
  assert.notEqual(meetingDateIndex, -1);
  assert.equal(model.values[model.layout.milestoneBodyStartRow - 1][model.layout.ganttStartCol + milestoneDateIndex - 1], 'Kick Off');
  assert.equal(model.values[model.layout.milestoneBodyStartRow][model.layout.ganttStartCol + milestoneDateIndex - 1], '▼');
  assert.equal(model.values[model.layout.meetingBodyStartRow - 1][2], '定例会 2026-07-06 毎週月曜');
  assert.equal(model.values[model.layout.meetingBodyStartRow - 1][model.layout.ganttStartCol + meetingDateIndex - 1], '▼');
});

test('deriveActuals uses first activity and last done snapshot only for current 100%', () => {
  const logs = [
    { NodeId: 'n1', Field: 'progress', NewValue: 30, NewValueIsDone: false, ChangedAt: '2026-07-02T01:00:00.000Z' },
    { NodeId: 'n1', Field: 'status', NewValue: 'doing', NewValueIsDone: false, ChangedAt: '2026-07-03T01:00:00.000Z' },
    { NodeId: 'n1', Field: 'progress', NewValue: 100, NewValueIsDone: true, ChangedAt: '2026-07-04T01:00:00.000Z' },
    { NodeId: 'n1', Field: 'status', NewValue: 'done', NewValueIsDone: true, ChangedAt: '2026-07-05T01:00:00.000Z' },
    { NodeId: 'n2', Field: 'progress', NewValue: 15, NewValueIsDone: false, ChangedAt: '2026-07-06T01:00:00.000Z' },
    { NodeId: 'n2', Field: 'progress', NewValue: 100, NewValueIsDone: true, ChangedAt: '2026-07-07T01:00:00.000Z' }
  ];
  const actuals = deriveActuals_(logs, { progressByNodeId: { n1: 100, n2: 90 } });
  assert.deepEqual(actuals.n1, { startDate: '2026-07-02', endDate: '2026-07-05' });
  assert.deepEqual(actuals.n2, { startDate: '2026-07-06', endDate: '' });
});
