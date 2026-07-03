/**
 * Locking, identity, normalization, and domain validation.
 */

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) {
    throw new Error('他の操作が進行中です。しばらくして再試行してください。');
  }
  try {
    const result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function requireCurrentMember_() {
  const email = getCurrentEmail_();
  if (!email) {
    throw new Error('ログインユーザーのメールアドレスを取得できません。');
  }
  const member = readObjects_(SHEET.MEMBERS).find(function (m) {
    return normalizeEmail_(m.Email) === email;
  });
  if (!member) {
    throw new Error('あなたのアカウントはメンバー登録されていません。メンバー管理で登録してください。');
  }
  return member;
}

function getCurrentEmail_() {
  return normalizeEmail_(Session.getActiveUser().getEmail());
}

function requireName_(value) {
  const name = cleanString_(value);
  if (!name) {
    throw new Error('名称を入力してください。');
  }
  if (name.length > 200) {
    throw new Error('名称は200文字以内で入力してください。');
  }
  return name;
}

function optionalName_(value) {
  const name = cleanString_(value);
  if (name.length > 200) {
    throw new Error('名称は200文字以内で入力してください。');
  }
  return name;
}

function validateStatusId_(statusId, statusColumns) {
  const id = cleanString_(statusId);
  if (!statusColumns.some(function (s) { return cleanString_(s.ColumnId) === id; })) {
    throw new Error('ステータス列が見つかりません。');
  }
  return id;
}

function doneStatusColumnId_(statusColumns) {
  const done = (statusColumns || []).find(function (column) { return isTrue_(column.IsDoneColumn); }) || (statusColumns || [])[0] || {};
  return cleanString_(done.ColumnId);
}

function normalizeManualProgress_(value, allowBlank) {
  const text = cleanString_(value);
  if (allowBlank && text === '') {
    return '';
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || PROGRESS_VALUES.indexOf(numeric) === -1) {
    throw new Error('進捗率は 0/15/30/45/60/75/90/100 のいずれかで指定してください。');
  }
  return numeric;
}

function validManualProgress_(value) {
  const text = cleanString_(value);
  if (text === '') {
    return null;
  }
  const numeric = Number(text);
  return PROGRESS_VALUES.indexOf(numeric) !== -1 ? numeric : null;
}

function effectiveLeafProgress_(node, doneColumnId) {
  if (!node) {
    return 0;
  }
  if (cleanString_(node.StatusColumnId) === doneColumnId) {
    return 100;
  }
  const manual = validManualProgress_(node.Progress);
  return manual === null ? 0 : manual;
}

function normalizePriority_(value) {
  const priority = cleanString_(value) || 'Mid';
  if (PRIORITIES.indexOf(priority) === -1) {
    throw new Error('優先度が不正です。');
  }
  return priority;
}

function normalizeAssigneeIds_(value, members) {
  const ids = Array.isArray(value) ? value.map(cleanString_) : splitCsv_(value);
  const memberSet = {};
  members.forEach(function (m) { memberSet[cleanString_(m.MemberId)] = true; });
  const uniqueIds = unique_(ids.filter(Boolean));
  uniqueIds.forEach(function (id) {
    if (!memberSet[id]) {
      throw new Error('存在しないメンバーが担当者に含まれています。');
    }
  });
  return uniqueIds;
}

function normalizeSchedule_(startDate, endDate) {
  const start = cleanString_(startDate);
  const end = cleanString_(endDate);
  if (!start && !end) {
    return { startDate: '', endDate: '' };
  }
  if (!start || !end) {
    throw new Error('開始日と終了日は両方入力するか、両方空にしてください。');
  }
  if (!isValidDate_(start) || !isValidDate_(end)) {
    throw new Error('日付は YYYY-MM-DD 形式で入力してください。');
  }
  if (dateToDay_(start) > dateToDay_(end)) {
    throw new Error('開始日は終了日以前にしてください。');
  }
  return { startDate: start, endDate: end };
}

function scheduleWouldBeClearedWithDependencies_(node, dependencies, nodesById) {
  if (hasSchedule_(node)) {
    return false;
  }
  return visibleDependencies_(dependencies, nodesById).some(function (dep) {
    return cleanString_(dep.PredecessorNodeId) === node.NodeId || cleanString_(dep.SuccessorNodeId) === node.NodeId;
  });
}

function normalizeEmail_(email) {
  return cleanString_(email).toLowerCase();
}

function normalizeColor_(value) {
  const color = cleanString_(value);
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '';
}

function normalizeIncludeInWbs_(value) {
  if (value === undefined || value === null || cleanString_(value) === '') {
    return true;
  }
  return isTrue_(value);
}

function normalizeStatusColor_(value, name, isDoneColumn) {
  const color = normalizeColor_(value);
  if (color) {
    return color;
  }
  return defaultStatusColor_(name, isDoneColumn);
}

function defaultStatusColor_(name, isDoneColumn) {
  const text = cleanString_(name).toLowerCase();
  if (isDoneColumn || text.indexOf('完了') !== -1 || text.indexOf('done') !== -1) {
    return '#CFE8DE';
  }
  if (text.indexOf('進行') !== -1 || text.indexOf('progress') !== -1 || text.indexOf('doing') !== -1) {
    return '#CFE0F5';
  }
  if (text.indexOf('未着手') !== -1 || text.indexOf('todo') !== -1 || text.indexOf('to do') !== -1) {
    return '#DCE5DE';
  }
  return '#DDE3DF';
}

function ensureExactlyOneDone_(columns) {
  const done = columns.filter(function (c) { return isTrue_(c.IsDoneColumn); });
  if (done.length === 1) {
    columns.forEach(function (c) { c.IsDoneColumn = cleanString_(c.ColumnId) === cleanString_(done[0].ColumnId); });
    return;
  }
  if (!columns.length) {
    throw new Error('ステータス列がありません。');
  }
  if (done.length > 1) {
    const keeper = done[0].ColumnId;
    columns.forEach(function (c) { c.IsDoneColumn = cleanString_(c.ColumnId) === cleanString_(keeper); });
    return;
  }
  columns[columns.length - 1].IsDoneColumn = true;
}

function activeNodes_(nodes) {
  return nodes.filter(function (n) { return !cleanString_(n.DeletedAt); });
}

function visibleDependencies_(dependencies, nodesById) {
  return dependencies.filter(function (dep) {
    return nodesById[cleanString_(dep.PredecessorNodeId)] && nodesById[cleanString_(dep.SuccessorNodeId)];
  });
}

function nodeHasDependency_(nodeId, dependencies, nodesById) {
  return visibleDependencies_(dependencies, nodesById).some(function (dep) {
    return cleanString_(dep.PredecessorNodeId) === nodeId || cleanString_(dep.SuccessorNodeId) === nodeId;
  });
}

function hasSchedule_(node) {
  return !!node && isValidDate_(node.StartDate) && isValidDate_(node.EndDate) && dateToDay_(node.StartDate) <= dateToDay_(node.EndDate);
}
