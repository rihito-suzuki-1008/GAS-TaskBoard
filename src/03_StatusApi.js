/**
 * Kanban status column APIs.
 */

function upsertStatusColumn(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    requireCurrentMember_();
    const rows = readAll_();
    const columnId = cleanString_(payload.columnId);
    const name = requireName_(payload.name);
    let columns = rows.statusColumns;
    let requestedDoneColumnId = '';
    if (columnId) {
      const column = columns.find(function (c) { return cleanString_(c.ColumnId) === columnId; });
      if (!column) {
        throw new Error('ステータス列が見つかりません。');
      }
      column.Name = name;
      if (payload.sortOrder !== undefined && payload.sortOrder !== null && payload.sortOrder !== '') {
        column.SortOrder = Number(payload.sortOrder);
      }
      column.Color = normalizeStatusColor_(payload.color, name, payload.isDoneColumn === true || isTrue_(column.IsDoneColumn));
      if (payload.isDoneColumn === true) {
        requestedDoneColumnId = columnId;
      }
    } else {
      const newColumnId = cleanString_(payload.clientColumnId);
      const duplicateId = columns.some(function (c) { return cleanString_(c.ColumnId) === newColumnId; });
      if (newColumnId && duplicateId) {
        throw new Error('同じIDのステータス列が既に存在します。');
      }
      const createdColumnId = newColumnId || newId_();
      requestedDoneColumnId = payload.isDoneColumn === true ? createdColumnId : '';
      const newColumn = {
        ColumnId: createdColumnId,
        Name: name,
        SortOrder: payload.sortOrder !== undefined && payload.sortOrder !== null && payload.sortOrder !== ''
          ? Number(payload.sortOrder)
          : nextSortOrder_(columns),
        IsDoneColumn: false,
        Color: normalizeStatusColor_(payload.color, name, payload.isDoneColumn === true)
      };
      columns.push(newColumn);
      appendObject_(SHEET.STATUS_COLUMNS, newColumn);
      columns = readAll_().statusColumns;
    }
    if (requestedDoneColumnId) {
      columns.forEach(function (c) { c.IsDoneColumn = cleanString_(c.ColumnId) === requestedDoneColumnId; });
    }
    ensureExactlyOneDone_(columns);
    writeObjects_(SHEET.STATUS_COLUMNS, columns.filter(function (c) { return !!c.__row; }));
    return { ok: true, statusColumns: readAll_().statusColumns.map(clientStatusColumn_) };
  });
}

function deleteStatusColumn(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    requireCurrentMember_();
    const rows = readAll_();
    const columnId = cleanString_(payload.columnId);
    const column = rows.statusColumns.find(function (c) { return cleanString_(c.ColumnId) === columnId; });
    if (!column) {
      throw new Error('ステータス列が見つかりません。');
    }
    if (isTrue_(column.IsDoneColumn)) {
      throw new Error('完了列は削除できません。先に別の列を完了列にしてください。');
    }
    if (rows.statusColumns.length <= 1) {
      throw new Error('最後のステータス列は削除できません。');
    }
    const used = activeNodes_(rows.nodes).some(function (n) { return cleanString_(n.StatusColumnId) === columnId; });
    if (used) {
      throw new Error('この列に所属するノードがあります。先に別の列へ移動してください。');
    }
    deleteRow_(SHEET.STATUS_COLUMNS, column.__row);
    const columns = readAll_().statusColumns;
    ensureExactlyOneDone_(columns);
    writeObjects_(SHEET.STATUS_COLUMNS, columns);
    return { ok: true, statusColumns: readAll_().statusColumns.map(clientStatusColumn_) };
  });
}
