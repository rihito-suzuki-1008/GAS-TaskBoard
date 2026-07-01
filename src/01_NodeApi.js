/**
 * Node mutation APIs and node write helpers.
 */

function addNode(payload) {
  payload = payload || {};
  return withLock_(function () {
    ensureSchema_();
    const actor = requireCurrentMember_();
    const rows = readAll_();
    const active = activeNodes_(rows.nodes);
    const nodesById = byId_(active, 'NodeId');
    const parentId = cleanString_(payload.parentId);
    const parent = nodesById[parentId];
    if (!parent) {
      throw new Error('親ノードが見つかりません。');
    }

    const statusColumns = sortByOrder_(rows.statusColumns);
    if (!statusColumns.length) {
      throw new Error('ステータス列がありません。');
    }

    const requestedNodeId = cleanString_(payload.nodeId || payload.clientNodeId);
    if (requestedNodeId && nodesById[requestedNodeId]) {
      throw new Error('同じIDのノードが既に存在します。');
    }
    const nodeId = requestedNodeId || newId_();
    const now = nowIso_();
    const schedule = normalizeSchedule_(payload.startDate, payload.endDate);
    const isShell = payload.isShell === true;
    const node = {
      NodeId: nodeId,
      ParentId: parentId,
      Name: isShell ? optionalName_(payload.name) : requireName_(payload.name),
      StatusColumnId: validateStatusId_(payload.statusColumnId || statusColumns[0].ColumnId, rows.statusColumns),
      AssigneeIds: normalizeAssigneeIds_(payload.assigneeIds || [], rows.members).join(','),
      Priority: normalizePriority_(payload.priority),
      StartDate: schedule.startDate,
      EndDate: schedule.endDate,
      Description: cleanString_(payload.description),
      SortOrder: nextSortOrder_(active.filter(function (n) { return n.ParentId === parentId; })),
      CreatedAt: now,
      UpdatedAt: now,
      UpdatedBy: actor.MemberId,
      DeletedAt: '',
      DeletedBy: ''
    };

    appendObject_(SHEET.NODES, node);
    const freshRows = readAll_();
    const affectedIds = unique_([nodeId].concat(ancestorIds_(nodeId, activeNodes_(freshRows.nodes))));
    return makeMutationPayload_(freshRows, affectedIds, payload.requestId, { createdNodeId: nodeId });
  });
}

function saveNode(payload) {
  payload = payload || {};
  return withLock_(function () {
    ensureSchema_();
    const actor = requireCurrentMember_();
    const requestId = cleanString_(payload.requestId);
    const patch = payload.patch || {};
    const nodeId = cleanString_(payload.nodeId);
    let rows = readAll_();
    let active = activeNodes_(rows.nodes);
    let nodesById = byId_(active, 'NodeId');
    const node = nodesById[nodeId];
    if (!node) {
      throw new Error('ノードが見つかりません。');
    }

    if (payload.baseUpdatedAt !== undefined && cleanString_(payload.baseUpdatedAt) !== cleanString_(node.UpdatedAt)) {
      return makeConflictPayload_(rows, nodeId, requestId);
    }

    const beforeStart = cleanString_(node.StartDate);
    const beforeEnd = cleanString_(node.EndDate);
    const beforeStatus = cleanString_(node.StatusColumnId);
    applyNodePatch_(node, patch, rows);
    node.UpdatedAt = nowIso_();
    node.UpdatedBy = actor.MemberId;

    if (scheduleWouldBeClearedWithDependencies_(node, rows.dependencies, nodesById)) {
      throw new Error('依存関係があるノードの日付は未設定にできません。先に依存関係を削除してください。');
    }

    const scheduleChanged = beforeStart !== node.StartDate || beforeEnd !== node.EndDate;
    const statusChanged = beforeStatus !== node.StatusColumnId;
    const writeMap = {};
    writeMap[node.NodeId] = node;

    let rescheduleResult = { shiftedIds: [] };
    if (scheduleChanged) {
      rescheduleResult = rescheduleFromSeeds_([node.NodeId], activeNodes_(rows.nodes), visibleDependencies_(rows.dependencies, nodesById), actor.MemberId, writeMap);
    }

    writeObjects_(SHEET.NODES, Object.keys(writeMap).map(function (id) { return writeMap[id]; }));
    rows = readAll_();
    const writeIds = Object.keys(writeMap);
    const affectedIds = unique_(writeIds.concat(ancestorIdsForMany_(writeIds, activeNodes_(rows.nodes))));
    return makeMutationPayload_(rows, affectedIds, requestId, {
      rescheduledCount: rescheduleResult.shiftedIds.filter(function (id) { return id !== node.NodeId; }).length,
      statusChanged: statusChanged
    });
  });
}

function moveNode(payload) {
  payload = payload || {};
  return withLock_(function () {
    ensureSchema_();
    const actor = requireCurrentMember_();
    const requestId = cleanString_(payload.requestId);
    let rows = readAll_();
    const active = activeNodes_(rows.nodes);
    const nodesById = byId_(active, 'NodeId');
    const nodeId = cleanString_(payload.nodeId);
    const newParentId = cleanString_(payload.newParentId);
    const node = nodesById[nodeId];
    const newParent = nodesById[newParentId];
    if (!node || !newParent) {
      throw new Error('移動対象または移動先が見つかりません。');
    }
    if (!node.ParentId) {
      throw new Error('ルートノードは移動できません。');
    }
    if (nodeId === newParentId) {
      throw new Error('自分自身を親にはできません。');
    }
    const descendants = collectDescendantIds_(nodeId, childrenMap_(active));
    if (descendants.indexOf(newParentId) !== -1) {
      throw new Error('子孫ノードを親にはできません。');
    }
    if (nodeHasDependency_(newParentId, rows.dependencies, nodesById)) {
      throw new Error('依存関係を持つ末端ノードの配下には移動できません。');
    }
    if (descendants.length && nodeHasDependency_(nodeId, rows.dependencies, nodesById)) {
      throw new Error('依存関係を持つノードをグループ化できません。');
    }

    const oldParentId = node.ParentId;
    if (payload.baseUpdatedAt !== undefined && cleanString_(payload.baseUpdatedAt) !== cleanString_(node.UpdatedAt)) {
      return makeConflictPayload_(rows, nodeId, requestId);
    }

    node.ParentId = newParentId;
    node.SortOrder = payload.newSortOrder !== undefined && payload.newSortOrder !== null && payload.newSortOrder !== ''
      ? Number(payload.newSortOrder)
      : nextSortOrder_(active.filter(function (n) { return n.ParentId === newParentId; }));
    node.UpdatedAt = nowIso_();
    node.UpdatedBy = actor.MemberId;
    writeObject_(SHEET.NODES, node);

    rows = readAll_();
    const affectedIds = unique_([nodeId, oldParentId, newParentId]
      .concat(ancestorIds_(oldParentId, activeNodes_(rows.nodes)))
      .concat(ancestorIds_(newParentId, activeNodes_(rows.nodes))));
    return makeMutationPayload_(rows, affectedIds, requestId, {});
  });
}

function deleteNode(payload) {
  payload = payload || {};
  return withLock_(function () {
    ensureSchema_();
    const actor = requireCurrentMember_();
    const rows = readAll_();
    const active = activeNodes_(rows.nodes);
    const nodesById = byId_(active, 'NodeId');
    const nodeId = cleanString_(payload.nodeId);
    const node = nodesById[nodeId];
    if (!node) {
      throw new Error('ノードが見つかりません。');
    }
    if (!node.ParentId) {
      throw new Error('ルートノードは削除できません。');
    }
    const targetIds = [nodeId].concat(collectDescendantIds_(nodeId, childrenMap_(active)));
    const now = nowIso_();
    const targets = targetIds.map(function (id) {
      const row = nodesById[id];
      row.DeletedAt = now;
      row.DeletedBy = actor.MemberId;
      row.UpdatedAt = now;
      row.UpdatedBy = actor.MemberId;
      return row;
    });
    writeObjects_(SHEET.NODES, targets);

    const freshRows = readAll_();
    const affectedIds = ancestorIds_(node.ParentId, activeNodes_(freshRows.nodes)).concat([node.ParentId]);
    return makeMutationPayload_(freshRows, affectedIds, cleanString_(payload.requestId), {
      deletedNodeIds: targetIds
    });
  });
}

function fitNodeToChildren(payload) {
  payload = payload || {};
  return withLock_(function () {
    ensureSchema_();
    const actor = requireCurrentMember_();
    const requestId = cleanString_(payload.requestId);
    let rows = readAll_();
    const active = activeNodes_(rows.nodes);
    const nodesById = byId_(active, 'NodeId');
    const nodeId = cleanString_(payload.nodeId);
    const node = nodesById[nodeId];
    if (!node) {
      throw new Error('ノードが見つかりません。');
    }
    if (payload.baseUpdatedAt !== undefined && cleanString_(payload.baseUpdatedAt) !== cleanString_(node.UpdatedAt)) {
      return makeConflictPayload_(rows, nodeId, requestId);
    }

    const childBounds = descendantOwnScheduleBounds_(nodeId, active);
    if (!childBounds.startDate || !childBounds.endDate) {
      throw new Error('子孫に日付が設定されたノードがありません。');
    }
    node.StartDate = childBounds.startDate;
    node.EndDate = childBounds.endDate;
    node.UpdatedAt = nowIso_();
    node.UpdatedBy = actor.MemberId;
    writeObject_(SHEET.NODES, node);

    rows = readAll_();
    const affectedIds = unique_([nodeId].concat(ancestorIds_(nodeId, activeNodes_(rows.nodes))));
    return makeMutationPayload_(rows, affectedIds, requestId, {});
  });
}

function applyNodePatch_(node, patch, rows) {
  if (patch.name !== undefined) {
    node.Name = requireName_(patch.name);
  }
  if (patch.statusColumnId !== undefined) {
    node.StatusColumnId = validateStatusId_(patch.statusColumnId, rows.statusColumns);
  }
  if (patch.assigneeIds !== undefined) {
    node.AssigneeIds = normalizeAssigneeIds_(patch.assigneeIds, rows.members).join(',');
  }
  if (patch.priority !== undefined) {
    node.Priority = normalizePriority_(patch.priority);
  }
  if (patch.description !== undefined) {
    const description = cleanString_(patch.description);
    if (description.length > 12000) {
      throw new Error('説明は12000文字以内で入力してください。');
    }
    node.Description = description;
  }
  if (patch.startDate !== undefined || patch.endDate !== undefined) {
    const schedule = normalizeSchedule_(
      patch.startDate !== undefined ? patch.startDate : node.StartDate,
      patch.endDate !== undefined ? patch.endDate : node.EndDate
    );
    node.StartDate = schedule.startDate;
    node.EndDate = schedule.endDate;
  }
}
