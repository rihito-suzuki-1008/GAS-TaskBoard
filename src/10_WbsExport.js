/**
 * Project settings and one-way WBS sheet export.
 */

var WBS_SHEET_NAME = 'WBS';
var WBS_EXPORT_GUARD_KEY = 'WBS_EXPORT_STARTED_AT';
var WBS_EXPORT_GUARD_MS = 60 * 1000;

function upsertMilestone(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    requireCurrentMember_();
    const rows = readAll_();
    const milestoneId = cleanString_(payload.milestoneId);
    const name = requireName_(payload.name);
    const date = cleanString_(payload.date);
    if (!isValidDate_(date)) {
      throw new Error('マイルストーン日付は YYYY-MM-DD 形式で入力してください。');
    }
    const note = cleanString_(payload.note);
    const sortOrder = payload.sortOrder !== undefined && payload.sortOrder !== null && payload.sortOrder !== ''
      ? Number(payload.sortOrder)
      : nextSortOrder_(rows.milestones);

    if (milestoneId) {
      const milestone = rows.milestones.find(function (item) { return cleanString_(item.MilestoneId) === milestoneId; });
      if (!milestone) {
        throw new Error('マイルストーンが見つかりません。');
      }
      milestone.Name = name;
      milestone.Date = date;
      milestone.Note = note;
      milestone.SortOrder = sortOrder;
      writeObject_(SHEET.MILESTONES, milestone);
    } else {
      const newMilestoneId = cleanString_(payload.clientMilestoneId);
      const duplicateId = rows.milestones.some(function (item) { return cleanString_(item.MilestoneId) === newMilestoneId; });
      if (newMilestoneId && duplicateId) {
        throw new Error('同じIDのマイルストーンが既に存在します。');
      }
      appendObject_(SHEET.MILESTONES, {
        MilestoneId: newMilestoneId || newId_(),
        Name: name,
        Date: date,
        Note: note,
        SortOrder: sortOrder
      });
    }
    return { ok: true, milestones: readAll_().milestones.map(clientMilestone_).sort(compareSortOrder_) };
  });
}

function deleteMilestone(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    requireCurrentMember_();
    const rows = readAll_();
    const milestoneId = cleanString_(payload.milestoneId);
    const milestone = rows.milestones.find(function (item) { return cleanString_(item.MilestoneId) === milestoneId; });
    if (!milestone) {
      throw new Error('マイルストーンが見つかりません。');
    }
    deleteRow_(SHEET.MILESTONES, milestone.__row);
    return { ok: true, milestones: readAll_().milestones.map(clientMilestone_).sort(compareSortOrder_) };
  });
}

function upsertMeeting(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    requireCurrentMember_();
    const rows = readAll_();
    const meetingId = cleanString_(payload.meetingId);
    const name = requireName_(payload.name);
    const schedule = cleanString_(payload.schedule);
    const note = cleanString_(payload.note);
    const sortOrder = payload.sortOrder !== undefined && payload.sortOrder !== null && payload.sortOrder !== ''
      ? Number(payload.sortOrder)
      : nextSortOrder_(rows.meetings);

    if (meetingId) {
      const meeting = rows.meetings.find(function (item) { return cleanString_(item.MeetingId) === meetingId; });
      if (!meeting) {
        throw new Error('会議体が見つかりません。');
      }
      meeting.Name = name;
      meeting.Schedule = schedule;
      meeting.Note = note;
      meeting.SortOrder = sortOrder;
      writeObject_(SHEET.MEETINGS, meeting);
    } else {
      const newMeetingId = cleanString_(payload.clientMeetingId);
      const duplicateId = rows.meetings.some(function (item) { return cleanString_(item.MeetingId) === newMeetingId; });
      if (newMeetingId && duplicateId) {
        throw new Error('同じIDの会議体が既に存在します。');
      }
      appendObject_(SHEET.MEETINGS, {
        MeetingId: newMeetingId || newId_(),
        Name: name,
        Schedule: schedule,
        Note: note,
        SortOrder: sortOrder
      });
    }
    return { ok: true, meetings: readAll_().meetings.map(clientMeeting_).sort(compareSortOrder_) };
  });
}

function deleteMeeting(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    requireCurrentMember_();
    const rows = readAll_();
    const meetingId = cleanString_(payload.meetingId);
    const meeting = rows.meetings.find(function (item) { return cleanString_(item.MeetingId) === meetingId; });
    if (!meeting) {
      throw new Error('会議体が見つかりません。');
    }
    deleteRow_(SHEET.MEETINGS, meeting.__row);
    return { ok: true, meetings: readAll_().meetings.map(clientMeeting_).sort(compareSortOrder_) };
  });
}

function exportWbs() {
  requireSchemaExists_();
  const actor = requireCurrentMember_();
  const scriptProps = PropertiesService.getScriptProperties();
  const nowMs = Date.now();
  const runningAt = Number(scriptProps.getProperty(WBS_EXPORT_GUARD_KEY)) || 0;
  if (runningAt && nowMs - runningAt < WBS_EXPORT_GUARD_MS) {
    throw new Error('WBS出力が実行中です。しばらくして再試行してください。');
  }
  scriptProps.setProperty(WBS_EXPORT_GUARD_KEY, String(nowMs));

  try {
    const rows = readAll_();
    const documentProps = PropertiesService.getDocumentProperties();
    const nowIso = nowIso_();
    const createdAt = documentProps.getProperty('WBS_CREATED_AT') || nowIso;
    const version = (Number(documentProps.getProperty('WBS_VERSION')) || 0) + 1;
    const model = buildWbsModel_(rows, {
      actorName: actor.Name,
      now: nowIso,
      createdAt: createdAt,
      version: version
    });
    writeWbsSheet_(model);
    documentProps.setProperty('WBS_CREATED_AT', createdAt);
    documentProps.setProperty('WBS_VERSION', String(version));
    return {
      ok: true,
      version: version,
      rowCount: model.taskRows.length,
      warning: model.warning || ''
    };
  } finally {
    scriptProps.deleteProperty(WBS_EXPORT_GUARD_KEY);
  }
}

function buildWbsModel_(rows, options) {
  rows = rows || {};
  options = options || {};
  const nodes = (rows.nodes || []).filter(function (node) { return !wbsClean_(wbsGet_(node, 'DeletedAt', 'deletedAt')); });
  const members = rows.members || [];
  const statusColumns = rows.statusColumns || [];
  const milestones = (rows.milestones || []).slice().sort(wbsCompareSort_);
  const meetings = (rows.meetings || []).slice().sort(wbsCompareSort_);
  const logs = rows.activityLog || rows.activityLogs || [];
  const derivedState = computeWbsDerived_(nodes, statusColumns);
  const root = derivedState.root || nodes[0] || {};
  const visibleRows = filterWbsTree_(derivedState);
  const maxDepth = Math.max(3, visibleRows.reduce(function (max, row) { return Math.max(max, row.depth); }, 0));
  const layout = buildWbsLayout_(maxDepth, milestones.length, meetings.length, visibleRows.length);
  const dateRange = buildWbsDateRange_(visibleRows, derivedState.derived, options);
  layout.totalCols = layout.ganttStartCol + dateRange.dateColumns.length - 1;
  const actuals = deriveActuals_(logs, {
    progressByNodeId: derivedState.progressByNodeId
  });
  const values = wbsEmptyMatrix_(layout.totalRows, layout.totalCols, '');
  const backgrounds = wbsEmptyMatrix_(layout.totalRows, layout.totalCols, WBS_COLORS.white);

  fillWbsStaticSections_(values, backgrounds, layout, {
    root: root,
    visibleRows: visibleRows,
    derived: derivedState.derived,
    milestones: milestones,
    meetings: meetings,
    dateRange: dateRange,
    options: options
  });
  fillWbsTasks_(values, backgrounds, layout, {
    visibleRows: visibleRows,
    members: members,
    derived: derivedState.derived,
    actuals: actuals,
    dateRange: dateRange,
    progressByNodeId: derivedState.progressByNodeId
  });

  return {
    values: values,
    backgrounds: backgrounds,
    layout: layout,
    taskRows: visibleRows,
    dateColumns: dateRange.dateColumns,
    warning: dateRange.warning,
    sectionRows: visibleRows.filter(function (row) { return row.depth === 1; }).map(function (row) { return row.sheetRow; })
  };
}

var WBS_COLORS = {
  white: '#FFFFFF',
  note: '#F3F5F2',
  label: '#595959',
  header: '#3F3F3F',
  paleYellow: '#FFF2CC',
  saturday: '#DDEBF7',
  sunday: '#FCE4D6',
  plan: '#D9EAD3',
  section: '#404040',
  border: '#B7B7B7',
  completed: '#E7E6E6'
};

function buildWbsLayout_(maxDepth, milestoneCount, meetingCount, taskCount) {
  const taskNameStartCol = 2;
  const metaStartCol = taskNameStartCol + maxDepth;
  const deliverableCol = metaStartCol;
  const noteCol = metaStartCol + 1;
  const companyCol = metaStartCol + 2;
  const assigneeCol = metaStartCol + 3;
  const planStartCol = metaStartCol + 4;
  const planEndCol = metaStartCol + 5;
  const planDaysCol = metaStartCol + 6;
  const actualStartCol = metaStartCol + 7;
  const actualEndCol = metaStartCol + 8;
  const actualDaysCol = metaStartCol + 9;
  const progressCol = metaStartCol + 10;
  const doneCol = metaStartCol + 11;
  const ganttStartCol = metaStartCol + 12;

  let row = 1;
  const noteRow = row;
  row += 1;
  const metaStartRow = row;
  row += 3;
  const metaEndRow = row - 1;
  const milestoneStartRow = row;
  row += Math.max(1, milestoneCount) + 1;
  const milestoneEndRow = row - 1;
  const meetingStartRow = row;
  row += Math.max(1, meetingCount) + 1;
  const meetingEndRow = row - 1;
  const headerRow1 = row;
  row += 1;
  const headerRow2 = row;
  row += 1;
  const taskStartRow = row;
  const taskEndRow = taskCount ? taskStartRow + taskCount - 1 : taskStartRow;

  return {
    maxDepth: maxDepth,
    taskNameStartCol: taskNameStartCol,
    metaStartCol: metaStartCol,
    deliverableCol: deliverableCol,
    noteCol: noteCol,
    companyCol: companyCol,
    assigneeCol: assigneeCol,
    planStartCol: planStartCol,
    planEndCol: planEndCol,
    planDaysCol: planDaysCol,
    actualStartCol: actualStartCol,
    actualEndCol: actualEndCol,
    actualDaysCol: actualDaysCol,
    progressCol: progressCol,
    doneCol: doneCol,
    ganttStartCol: ganttStartCol,
    noteRow: noteRow,
    metaStartRow: metaStartRow,
    metaEndRow: metaEndRow,
    milestoneStartRow: milestoneStartRow,
    milestoneEndRow: milestoneEndRow,
    meetingStartRow: meetingStartRow,
    meetingEndRow: meetingEndRow,
    headerRow1: headerRow1,
    headerRow2: headerRow2,
    taskStartRow: taskStartRow,
    taskEndRow: taskEndRow,
    totalRows: Math.max(taskEndRow, headerRow2),
    totalCols: ganttStartCol + 1
  };
}

function buildWbsDateRange_(visibleRows, derived, options) {
  const days = [];
  visibleRows.forEach(function (row) {
    const plan = wbsPlanForNode_(row.node, derived[wbsNodeId_(row.node)]);
    if (wbsIsValidDate_(plan.startDate) && wbsIsValidDate_(plan.endDate)) {
      days.push(wbsDateToDay_(plan.startDate), wbsDateToDay_(plan.endDate));
    }
  });
  let startDay;
  let endDay;
  if (days.length) {
    startDay = Math.min.apply(null, days) - 7;
    endDay = Math.max.apply(null, days) + 7;
  } else {
    const today = wbsClean_(options.today) || wbsClean_(options.now).slice(0, 10) || wbsTodayText_();
    startDay = wbsDateToDay_(today) - 7;
    endDay = wbsDateToDay_(today) + 30;
  }
  let warning = '';
  if (endDay - startDay + 1 > 400) {
    endDay = startDay + 399;
    warning = '計画範囲が400日を超えたため、日付列を400日分に切り詰めました。';
  }
  const dateColumns = [];
  for (let day = startDay; day <= endDay; day += 1) {
    dateColumns.push({ day: day, date: wbsDayToDate_(day), dow: wbsDow_(day) });
  }
  return { startDay: startDay, endDay: endDay, dateColumns: dateColumns, warning: warning };
}

function fillWbsStaticSections_(values, backgrounds, layout, context) {
  const rootName = wbsClean_(wbsGet_(context.root, 'Name', 'name')) || 'プロジェクト';
  const nowDate = wbsClean_(context.options.now).slice(0, 10) || wbsTodayText_();
  const createdDate = wbsClean_(context.options.createdAt).slice(0, 10) || nowDate;
  const plannedStarts = [];
  const plannedEnds = [];
  context.visibleRows.forEach(function (row) {
    const plan = wbsPlanForNode_(row.node, context.derived[wbsNodeId_(row.node)]);
    if (plan.startDate && plan.endDate) {
      plannedStarts.push(plan.startDate);
      plannedEnds.push(plan.endDate);
    }
  });
  const minStart = plannedStarts.length ? plannedStarts.sort()[0] : '';
  const maxEnd = plannedEnds.length ? plannedEnds.sort()[plannedEnds.length - 1] : '';

  wbsSetRowBackground_(backgrounds, layout.noteRow, 1, layout.totalCols, WBS_COLORS.note);
  values[layout.noteRow - 1][0] = 'このシートはアプリから自動生成されます。手編集は次回出力で上書きされます';

  const meta = [
    ['プロジェクト名', rootName, '開始日', minStart ? wbsDateValue_(minStart) : '', '終了日', maxEnd ? wbsDateValue_(maxEnd) : ''],
    ['作成者', wbsClean_(context.options.actorName), '初回作成日', wbsDateValue_(createdDate), '更新日', wbsDateValue_(nowDate)],
    ['バージョン', 'v' + String(context.options.version || 1), 'タスク数', context.visibleRows.length, '', '']
  ];
  meta.forEach(function (rowValues, rowIndex) {
    const sheetRow = layout.metaStartRow + rowIndex;
    for (let pair = 0; pair < 3; pair += 1) {
      const labelCol = 1 + pair * 2;
      const valueCol = labelCol + 1;
      values[sheetRow - 1][labelCol - 1] = rowValues[pair * 2];
      values[sheetRow - 1][valueCol - 1] = rowValues[pair * 2 + 1];
      backgrounds[sheetRow - 1][labelCol - 1] = WBS_COLORS.label;
      backgrounds[sheetRow - 1][valueCol - 1] = WBS_COLORS.paleYellow;
    }
  });

  values[layout.milestoneStartRow - 1][0] = 'マイルストーン';
  wbsSetRowBackground_(backgrounds, layout.milestoneStartRow, 1, layout.totalCols, WBS_COLORS.header);
  context.milestones.forEach(function (milestone, index) {
    const sheetRow = layout.milestoneStartRow + index + 1;
    const name = wbsClean_(wbsGet_(milestone, 'Name', 'name'));
    const date = wbsClean_(wbsGet_(milestone, 'Date', 'date'));
    values[sheetRow - 1][0] = name;
    values[sheetRow - 1][1] = date ? wbsDateValue_(date) : '';
    values[sheetRow - 1][2] = wbsClean_(wbsGet_(milestone, 'Note', 'note'));
    const dateIndex = wbsDateIndex_(context.dateRange, date);
    if (dateIndex >= 0) {
      values[sheetRow - 1][layout.ganttStartCol - 1 + dateIndex] = '▼ ' + name;
    }
  });
  if (!context.milestones.length) {
    values[layout.milestoneStartRow][0] = 'なし';
  }

  values[layout.meetingStartRow - 1][0] = '会議体';
  wbsSetRowBackground_(backgrounds, layout.meetingStartRow, 1, layout.totalCols, WBS_COLORS.header);
  context.meetings.forEach(function (meeting, index) {
    const sheetRow = layout.meetingStartRow + index + 1;
    values[sheetRow - 1][0] = wbsClean_(wbsGet_(meeting, 'Name', 'name'));
    values[sheetRow - 1][1] = wbsClean_(wbsGet_(meeting, 'Schedule', 'schedule'));
    values[sheetRow - 1][2] = wbsClean_(wbsGet_(meeting, 'Note', 'note'));
  });
  if (!context.meetings.length) {
    values[layout.meetingStartRow][0] = 'なし';
  }

  const leftHeaders = ['WBS番号'];
  for (let i = 0; i < layout.maxDepth; i += 1) {
    leftHeaders.push('タスク名' + (i + 1));
  }
  leftHeaders.push('成果物', '備考', '会社名', '責任者', '計画開始日', '計画終了日', '計画日数', '実績開始日', '実績終了日', '実績日数', '進捗率', '完了フラグ');
  leftHeaders.forEach(function (label, index) {
    values[layout.headerRow1 - 1][index] = label;
  });
  context.dateRange.dateColumns.forEach(function (date, index) {
    const col = layout.ganttStartCol + index;
    values[layout.headerRow1 - 1][col - 1] = wbsFormatMonthDay_(date.date);
    values[layout.headerRow2 - 1][col - 1] = wbsWeekdayLabel_(date.dow);
    backgrounds[layout.headerRow1 - 1][col - 1] = WBS_COLORS.header;
    backgrounds[layout.headerRow2 - 1][col - 1] = WBS_COLORS.header;
  });
  wbsSetRowBackground_(backgrounds, layout.headerRow1, 1, layout.totalCols, WBS_COLORS.header);
  wbsSetRowBackground_(backgrounds, layout.headerRow2, 1, layout.totalCols, WBS_COLORS.header);
}

function fillWbsTasks_(values, backgrounds, layout, context) {
  const membersById = {};
  context.members.forEach(function (member) {
    membersById[wbsClean_(wbsGet_(member, 'MemberId', 'id'))] = member;
  });
  context.visibleRows.forEach(function (row, index) {
    const node = row.node;
    const nodeId = wbsNodeId_(node);
    const sheetRow = layout.taskStartRow + index;
    row.sheetRow = sheetRow;
    const matrixRow = values[sheetRow - 1];
    const bgRow = backgrounds[sheetRow - 1];
    const plan = wbsPlanForNode_(node, context.derived[nodeId]);
    const actual = context.actuals[nodeId] || {};
    const assigneeIds = wbsSplitCsv_(wbsGet_(node, 'AssigneeIds', 'assigneeIds'));
    const assigneeNames = [];
    const companies = [];
    assigneeIds.forEach(function (id) {
      const member = membersById[id];
      if (!member) {
        return;
      }
      const name = wbsClean_(wbsGet_(member, 'Name', 'name'));
      const company = wbsClean_(wbsGet_(member, 'Company', 'company'));
      if (name) {
        assigneeNames.push(name);
      }
      if (company && companies.indexOf(company) === -1) {
        companies.push(company);
      }
    });

    matrixRow[0] = row.number;
    matrixRow[layout.taskNameStartCol + row.depth - 2] = wbsClean_(wbsGet_(node, 'Name', 'name'));
    matrixRow[layout.deliverableCol - 1] = wbsClean_(wbsGet_(node, 'Deliverable', 'deliverable'));
    matrixRow[layout.noteCol - 1] = wbsClean_(wbsGet_(node, 'Note', 'note'));
    matrixRow[layout.companyCol - 1] = companies.join('・');
    matrixRow[layout.assigneeCol - 1] = assigneeNames.join('・');
    matrixRow[layout.planStartCol - 1] = plan.startDate ? wbsDateValue_(plan.startDate) : '';
    matrixRow[layout.planEndCol - 1] = plan.endDate ? wbsDateValue_(plan.endDate) : '';
    matrixRow[layout.planDaysCol - 1] = plan.startDate && plan.endDate ? wbsDaysFormula_(sheetRow, layout.planStartCol, layout.planEndCol) : '';
    matrixRow[layout.actualStartCol - 1] = actual.startDate ? wbsDateValue_(actual.startDate) : '';
    matrixRow[layout.actualEndCol - 1] = actual.endDate ? wbsDateValue_(actual.endDate) : '';
    matrixRow[layout.actualDaysCol - 1] = actual.startDate && actual.endDate ? wbsDaysFormula_(sheetRow, layout.actualStartCol, layout.actualEndCol) : '';
    matrixRow[layout.progressCol - 1] = (Number(context.progressByNodeId[nodeId]) || 0) / 100;
    matrixRow[layout.doneCol - 1] = '=IF(' + wbsA1_(sheetRow, layout.progressCol) + '=1,"完了","")';

    context.dateRange.dateColumns.forEach(function (date, dateIndex) {
      const col = layout.ganttStartCol + dateIndex;
      bgRow[col - 1] = date.dow === 0 ? WBS_COLORS.sunday : date.dow === 6 ? WBS_COLORS.saturday : WBS_COLORS.white;
      if (plan.startDate && plan.endDate && date.date >= plan.startDate && date.date <= plan.endDate) {
        bgRow[col - 1] = WBS_COLORS.plan;
      }
      if (actual.startDate && actual.endDate && date.date >= actual.startDate && date.date <= actual.endDate) {
        matrixRow[col - 1] = '★';
      }
    });

    if (row.depth === 1) {
      for (let col = 0; col < bgRow.length; col += 1) {
        bgRow[col] = WBS_COLORS.section;
      }
    }
  });
}

function writeWbsSheet_(model) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(WBS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(WBS_SHEET_NAME);
  }
  const rowCount = model.values.length;
  const colCount = model.values[0] ? model.values[0].length : 1;
  ensureWbsSheetSize_(sheet, rowCount, colCount);
  sheet.clear();
  sheet.setConditionalFormatRules([]);
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  sheet.getRange(1, 1, rowCount, colCount).setValues(model.values);
  sheet.getRange(1, 1, rowCount, colCount).setBackgrounds(model.backgrounds);
  sheet.getRange(1, 1, rowCount, colCount).setVerticalAlignment('middle').setWrap(false);
  sheet.getRange(model.layout.noteRow, 1, 1, colCount).setFontColor('#666666').setFontStyle('italic');
  sheet.getRange(model.layout.metaStartRow, 1, model.layout.metaEndRow - model.layout.metaStartRow + 1, 6).setFontWeight('bold');
  sheet.getRangeList(['A', 'C', 'E'].map(function (col) {
    return col + model.layout.metaStartRow + ':' + col + model.layout.metaEndRow;
  })).setFontColor('#FFFFFF');
  sheet.getRange(model.layout.milestoneStartRow, 1, 1, colCount).setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.getRange(model.layout.meetingStartRow, 1, 1, colCount).setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.getRange(model.layout.headerRow1, 1, 2, colCount).setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');

  if (model.sectionRows.length) {
    sheet.getRangeList(model.sectionRows.map(function (row) {
      return 'A' + row + ':' + wbsColumnLetter_(colCount) + row;
    })).setFontColor('#FFFFFF').setFontWeight('bold');
  }

  if (model.taskRows.length) {
    const start = model.layout.taskStartRow;
    const rows = model.taskRows.length;
    [model.layout.planStartCol, model.layout.planEndCol, model.layout.actualStartCol, model.layout.actualEndCol].forEach(function (col) {
      sheet.getRange(start, col, rows, 1).setNumberFormat('yyyy/mm/dd');
    });
    sheet.getRange(start, model.layout.progressCol, rows, 1).setNumberFormat('0%');
    const validation = SpreadsheetApp.newDataValidation()
      .requireValueInList(['0', '0.15', '0.3', '0.45', '0.6', '0.75', '0.9', '1'], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(start, model.layout.progressCol, rows, 1).setDataValidation(validation);
    const doneCol = wbsColumnLetter_(model.layout.doneCol);
    const tableRange = sheet.getRange(start, 1, rows, model.layout.doneCol);
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + doneCol + start + '="完了"')
      .setBackground(WBS_COLORS.completed)
      .setRanges([tableRange])
      .build();
    sheet.setConditionalFormatRules([rule]);
  }

  sheet.setFrozenRows(model.layout.headerRow2);
  sheet.setFrozenColumns(model.layout.doneCol);
  sheet.setColumnWidth(1, 78);
  sheet.setColumnWidths(model.layout.taskNameStartCol, model.layout.maxDepth, 150);
  sheet.setColumnWidths(model.layout.metaStartCol, 12, 96);
  if (model.dateColumns.length) {
    sheet.setColumnWidths(model.layout.ganttStartCol, model.dateColumns.length, 24);
  }
  sheet.getRange(1, 1, rowCount, colCount).setBorder(true, true, true, true, true, true, WBS_COLORS.border, SpreadsheetApp.BorderStyle.SOLID);
  SpreadsheetApp.flush();
}

function ensureWbsSheetSize_(sheet, rowCount, colCount) {
  if (sheet.getMaxRows() < rowCount) {
    sheet.insertRowsAfter(sheet.getMaxRows(), rowCount - sheet.getMaxRows());
  }
  if (sheet.getMaxColumns() < colCount) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), colCount - sheet.getMaxColumns());
  }
}

function computeWbsDerived_(nodes, statusColumns) {
  const children = {};
  const nodesById = {};
  nodes.forEach(function (node) {
    const id = wbsNodeId_(node);
    nodesById[id] = node;
    const parentId = wbsClean_(wbsGet_(node, 'ParentId', 'parentId'));
    if (!children[parentId]) {
      children[parentId] = [];
    }
    children[parentId].push(id);
  });
  Object.keys(children).forEach(function (parentId) {
    children[parentId].sort(function (a, b) { return wbsCompareSort_(nodesById[a], nodesById[b]); });
  });
  const doneColumn = (statusColumns || []).find(function (column) {
    return wbsIsTrue_(wbsGet_(column, 'IsDoneColumn', 'isDoneColumn'));
  }) || (statusColumns || [])[0] || {};
  const doneColumnId = wbsClean_(wbsGet_(doneColumn, 'ColumnId', 'id'));
  const progressMemo = {};
  const boundsMemo = {};

  function progressOf(id) {
    if (progressMemo[id] !== undefined) {
      return progressMemo[id];
    }
    const node = nodesById[id];
    const childIds = children[id] || [];
    if (!node) {
      return 0;
    }
    if (!childIds.length) {
      const manual = wbsValidProgress_(wbsGet_(node, 'Progress', 'manualProgress'));
      progressMemo[id] = wbsClean_(wbsGet_(node, 'StatusColumnId', 'statusColumnId')) === doneColumnId ? 100 : manual === null ? 0 : manual;
      return progressMemo[id];
    }
    const sum = childIds.reduce(function (total, childId) { return total + progressOf(childId); }, 0);
    progressMemo[id] = Math.round((sum / childIds.length) * 10) / 10;
    return progressMemo[id];
  }

  function boundsOf(id) {
    if (boundsMemo[id]) {
      return boundsMemo[id];
    }
    const node = nodesById[id];
    const starts = [];
    const ends = [];
    if (node && wbsHasSchedule_(node)) {
      starts.push(wbsClean_(wbsGet_(node, 'StartDate', 'startDate')));
      ends.push(wbsClean_(wbsGet_(node, 'EndDate', 'endDate')));
    }
    (children[id] || []).forEach(function (childId) {
      const bounds = boundsOf(childId);
      if (bounds.startDate && bounds.endDate) {
        starts.push(bounds.startDate);
        ends.push(bounds.endDate);
      }
    });
    boundsMemo[id] = starts.length ? { startDate: starts.sort()[0], endDate: ends.sort()[ends.length - 1] } : { startDate: '', endDate: '' };
    return boundsMemo[id];
  }

  const derived = {};
  const progressByNodeId = {};
  nodes.forEach(function (node) {
    const id = wbsNodeId_(node);
    const bounds = boundsOf(id);
    progressByNodeId[id] = progressOf(id);
    derived[id] = {
      hasChildren: (children[id] || []).length > 0,
      progress: progressByNodeId[id],
      displayStartDate: bounds.startDate,
      displayEndDate: bounds.endDate
    };
  });
  const root = nodes.find(function (node) { return !wbsClean_(wbsGet_(node, 'ParentId', 'parentId')); }) || nodes[0] || null;
  return { nodes: nodes, nodesById: nodesById, children: children, derived: derived, progressByNodeId: progressByNodeId, root: root };
}

function filterWbsTree_(state) {
  const rootId = state.root ? wbsNodeId_(state.root) : '';
  const rows = [];
  function visitChildren(parentId, depth, prefix) {
    let index = 0;
    (state.children[parentId] || []).forEach(function (childId) {
      const node = state.nodesById[childId];
      if (!node || !wbsIncludeInWbs_(node)) {
        return;
      }
      index += 1;
      const number = prefix ? prefix + '-' + index : String(index);
      rows.push({ node: node, depth: depth, number: number, sheetRow: 0 });
      visitChildren(childId, depth + 1, number);
    });
  }
  visitChildren(rootId, 1, '');
  return rows;
}

function deriveActuals_(logs, options) {
  logs = logs || [];
  options = options || {};
  const grouped = {};
  logs.forEach(function (log) {
    const nodeId = wbsClean_(wbsGet_(log, 'NodeId', 'nodeId'));
    if (!nodeId) {
      return;
    }
    if (!grouped[nodeId]) {
      grouped[nodeId] = [];
    }
    grouped[nodeId].push(log);
  });
  const actuals = {};
  Object.keys(grouped).forEach(function (nodeId) {
    const nodeLogs = grouped[nodeId].slice().sort(function (a, b) {
      return wbsClean_(wbsGet_(a, 'ChangedAt', 'changedAt')).localeCompare(wbsClean_(wbsGet_(b, 'ChangedAt', 'changedAt')));
    });
    const startCandidates = [];
    nodeLogs.forEach(function (log) {
      const field = wbsClean_(wbsGet_(log, 'Field', 'field'));
      const changedAt = wbsClean_(wbsGet_(log, 'ChangedAt', 'changedAt'));
      if (!changedAt) {
        return;
      }
      if (field === 'status') {
        startCandidates.push(changedAt.slice(0, 10));
      }
      if (field === 'progress' && Number(wbsGet_(log, 'NewValue', 'newValue')) > 0) {
        startCandidates.push(changedAt.slice(0, 10));
      }
    });
    const currentProgress = Number(options.progressByNodeId && options.progressByNodeId[nodeId]) || 0;
    let endDate = '';
    if (currentProgress === 100) {
      nodeLogs.forEach(function (log) {
        if (wbsIsTrue_(wbsGet_(log, 'NewValueIsDone', 'newValueIsDone'))) {
          endDate = wbsClean_(wbsGet_(log, 'ChangedAt', 'changedAt')).slice(0, 10);
        }
      });
    }
    actuals[nodeId] = {
      startDate: startCandidates.length ? startCandidates.sort()[0] : '',
      endDate: endDate
    };
  });
  return actuals;
}

function wbsPlanForNode_(node, derived) {
  const ownStart = wbsClean_(wbsGet_(node, 'StartDate', 'startDate'));
  const ownEnd = wbsClean_(wbsGet_(node, 'EndDate', 'endDate'));
  if (wbsIsValidDate_(ownStart) && wbsIsValidDate_(ownEnd)) {
    return { startDate: ownStart, endDate: ownEnd };
  }
  return {
    startDate: derived && derived.displayStartDate ? derived.displayStartDate : '',
    endDate: derived && derived.displayEndDate ? derived.displayEndDate : ''
  };
}

function wbsSetRowBackground_(backgrounds, row, startCol, colCount, color) {
  for (let col = startCol; col < startCol + colCount; col += 1) {
    backgrounds[row - 1][col - 1] = color;
  }
}

function wbsEmptyMatrix_(rows, cols, value) {
  const matrix = [];
  for (let row = 0; row < rows; row += 1) {
    const line = [];
    for (let col = 0; col < cols; col += 1) {
      line.push(value);
    }
    matrix.push(line);
  }
  return matrix;
}

function wbsDaysFormula_(row, startCol, endCol) {
  const start = wbsA1_(row, startCol);
  const end = wbsA1_(row, endCol);
  return '=IF(AND(' + start + '<>"",' + end + '<>""),' + end + '-' + start + '+1,"")';
}

function wbsA1_(row, col) {
  return wbsColumnLetter_(col) + row;
}

function wbsColumnLetter_(col) {
  let value = '';
  let current = col;
  while (current > 0) {
    const mod = (current - 1) % 26;
    value = String.fromCharCode(65 + mod) + value;
    current = Math.floor((current - mod) / 26);
  }
  return value;
}

function wbsDateIndex_(dateRange, dateText) {
  const day = wbsIsValidDate_(dateText) ? wbsDateToDay_(dateText) : NaN;
  if (!Number.isFinite(day) || day < dateRange.startDay || day > dateRange.endDay) {
    return -1;
  }
  return day - dateRange.startDay;
}

function wbsNodeId_(node) {
  return wbsClean_(wbsGet_(node, 'NodeId', 'id'));
}

function wbsGet_(obj, gasKey, clientKey) {
  if (!obj) {
    return '';
  }
  if (Object.prototype.hasOwnProperty.call(obj, gasKey)) {
    return obj[gasKey];
  }
  return obj[clientKey];
}

function wbsIncludeInWbs_(node) {
  const value = wbsGet_(node, 'IncludeInWbs', 'includeInWbs');
  if (value === undefined || value === null || wbsClean_(value) === '') {
    return true;
  }
  return wbsIsTrue_(value);
}

function wbsCompareSort_(a, b) {
  const diff = (Number(wbsGet_(a, 'SortOrder', 'sortOrder')) || 0) - (Number(wbsGet_(b, 'SortOrder', 'sortOrder')) || 0);
  if (diff !== 0) {
    return diff;
  }
  return wbsClean_(wbsGet_(a, 'Name', 'name')).localeCompare(wbsClean_(wbsGet_(b, 'Name', 'name')), 'ja');
}

function wbsValidProgress_(value) {
  if (value === null || value === undefined || wbsClean_(value) === '') {
    return null;
  }
  const numeric = Number(value);
  return [0, 15, 30, 45, 60, 75, 90, 100].indexOf(numeric) !== -1 ? numeric : null;
}

function wbsHasSchedule_(node) {
  const start = wbsClean_(wbsGet_(node, 'StartDate', 'startDate'));
  const end = wbsClean_(wbsGet_(node, 'EndDate', 'endDate'));
  return wbsIsValidDate_(start) && wbsIsValidDate_(end) && wbsDateToDay_(start) <= wbsDateToDay_(end);
}

function wbsSplitCsv_(value) {
  if (Array.isArray(value)) {
    return value.map(wbsClean_).filter(Boolean);
  }
  return wbsClean_(value).split(',').map(wbsClean_).filter(Boolean);
}

function wbsClean_(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function wbsIsTrue_(value) {
  return value === true || wbsClean_(value).toLowerCase() === 'true' || wbsClean_(value) === '1';
}

function wbsIsValidDate_(value) {
  const text = wbsClean_(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const parts = text.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
}

function wbsDateToDay_(value) {
  if (!wbsIsValidDate_(value)) {
    return NaN;
  }
  const parts = value.split('-').map(Number);
  return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000);
}

function wbsDayToDate_(day) {
  const date = new Date(day * 86400000);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function wbsDateValue_(dateText) {
  if (!wbsIsValidDate_(dateText)) {
    return '';
  }
  const parts = dateText.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function wbsDow_(day) {
  return new Date(day * 86400000).getUTCDay();
}

function wbsWeekdayLabel_(dow) {
  return ['日', '月', '火', '水', '木', '金', '土'][dow] || '';
}

function wbsFormatMonthDay_(dateText) {
  return String(Number(dateText.slice(5, 7))) + '/' + String(Number(dateText.slice(8, 10)));
}

function wbsTodayText_() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildWbsModel_: buildWbsModel_,
    deriveActuals_: deriveActuals_,
    filterWbsTree_: filterWbsTree_,
    computeWbsDerived_: computeWbsDerived_,
    wbsColumnLetter_: wbsColumnLetter_
  };
}
