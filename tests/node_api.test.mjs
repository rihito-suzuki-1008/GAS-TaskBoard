import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

global.cleanString_ = value => value === null || value === undefined ? '' : String(value).trim();
global.activeNodes_ = nodes => nodes.filter(node => !global.cleanString_(node.DeletedAt));
global.byId_ = (rows, idField) => rows.reduce((map, row) => {
  map[global.cleanString_(row[idField])] = row;
  return map;
}, {});
global.childrenMap_ = nodes => nodes.reduce((map, node) => {
  const parentId = global.cleanString_(node.ParentId);
  if (!map[parentId]) map[parentId] = [];
  map[parentId].push(global.cleanString_(node.NodeId));
  return map;
}, {});
global.ancestorIds_ = (nodeId, activeNodes) => {
  const nodesById = global.byId_(activeNodes, 'NodeId');
  const result = [];
  let current = nodesById[nodeId];
  while (current && global.cleanString_(current.ParentId)) {
    const parentId = global.cleanString_(current.ParentId);
    if (result.includes(parentId)) break;
    result.push(parentId);
    current = nodesById[parentId];
  }
  return result;
};
global.unique_ = values => Array.from(new Set((values || []).map(global.cleanString_).filter(Boolean)));
global.doneStatusColumnId_ = statusColumns => global.cleanString_((statusColumns.find(column => column.IsDoneColumn) || statusColumns[0] || {}).ColumnId);
global.nowIso_ = () => '2026-07-05T00:00:00.000Z';

const require = createRequire(import.meta.url);
const { rollupParentStatuses_ } = require('../src/01_NodeApi.js');

const statusColumns = [
  { ColumnId: 'todo', Name: '未着手', SortOrder: 1000, IsDoneColumn: false },
  { ColumnId: 'doing', Name: '進行中', SortOrder: 2000, IsDoneColumn: false },
  { ColumnId: 'done', Name: '完了', SortOrder: 3000, IsDoneColumn: true }
];

function rowsWithChildren(childStatuses, parentStatus = 'todo') {
  return {
    statusColumns,
    nodes: [
      { NodeId: 'root', ParentId: '', Name: 'Root', StatusColumnId: 'todo' },
      { NodeId: 'parent', ParentId: 'root', Name: 'Parent', StatusColumnId: parentStatus },
      ...childStatuses.map((status, index) => ({
        NodeId: `child${index + 1}`,
        ParentId: 'parent',
        Name: `Child ${index + 1}`,
        StatusColumnId: status
      }))
    ]
  };
}

test('rollup sets parent to in progress when any child is done but not all are done', () => {
  const rows = rowsWithChildren(['done', 'todo']);
  const writeMap = {};
  const changedIds = rollupParentStatuses_(rows, ['child1'], 'actor-1', writeMap);

  assert.equal(rows.nodes.find(node => node.NodeId === 'parent').StatusColumnId, 'doing');
  assert.equal(writeMap.parent.StatusColumnId, 'doing');
  assert.equal(writeMap.parent.UpdatedBy, 'actor-1');
  assert.ok(changedIds.includes('parent'));
});

test('rollup keeps all-done children in the done status', () => {
  const rows = rowsWithChildren(['done', 'done']);
  const writeMap = {};
  rollupParentStatuses_(rows, ['child1'], 'actor-1', writeMap);

  assert.equal(rows.nodes.find(node => node.NodeId === 'parent').StatusColumnId, 'done');
  assert.equal(writeMap.parent.StatusColumnId, 'done');
});
