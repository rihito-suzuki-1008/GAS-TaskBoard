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
    const rows = readAll_({ includeActivityLog: true });
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
  const layout = buildWbsLayout_(maxDepth, meetings.length, visibleRows.length);
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
    sectionRows: visibleRows.filter(function (row) { return row.depth === 1; }).map(function (row) { return row.sheetRow; }),
    normalRows: visibleRows.filter(function (row) { return row.depth !== 1; }).map(function (row) { return row.sheetRow; })
  };
}

var WBS_COLORS = {
  white: '#FFFFFF',
  metaLabel: '#D9D9D9',
  paleYellow: '#FFFFDD',
  header: '#CCCCCC',
  saturday: '#A4C2F4',
  sunday: '#F4CCCC',
  plan: '#B7E1CD',
  section: '#666666',
  completed: '#B7B7B7',
  border: '#000000'
};

var WBS_PROGRESS_OPTIONS = ['0.0', '0.15', '0.3', '0.45', '0.6', '0.75', '0.9', '1'];
var WBS_PROGRESS_COLORS = [
  { value: 0, color: '#D9D9D9' },
  { value: 0.15, color: '#F4CCCC' },
  { value: 0.3, color: '#FCE5CD' },
  { value: 0.45, color: '#FFF2CC' },
  { value: 0.6, color: '#D9EAD3' },
  { value: 0.75, color: '#CFE2F3' },
  { value: 0.9, color: '#D9D2E9' },
  { value: 1, color: '#B6D7A8' }
];

function buildWbsLayout_(maxDepth, meetingCount, taskCount) {
  const noCol = 1;
  const taskNameStartCol = 2;
  const indentDepth = 4;
  const taskNameEndCol = taskNameStartCol + indentDepth - 1;
  const taskDisplayCol = 6;
  const deliverableCol = 7;
  const noteCol = 8;
  const companyCol = 9;
  const assigneeCol = 10;
  const planStartCol = 11;
  const planEndCol = 12;
  const planDaysCol = 13;
  const actualStartCol = 14;
  const actualEndCol = 15;
  const actualDaysCol = 16;
  const progressCol = 17;
  const doneCol = 18;
  const ganttStartCol = 19;

  const metaStartRow = 1;
  const metaEndRow = 2;
  const headerRow1 = 4;
  const headerRow2 = 5;
  const milestoneStartRow = 6;
  const milestoneBodyStartRow = 7;
  const milestoneBodyRows = 3;
  const milestoneEndRow = milestoneBodyStartRow + milestoneBodyRows - 1;
  const meetingStartRow = milestoneEndRow + 1;
  const meetingBodyStartRow = meetingStartRow + 1;
  const meetingBodyRows = Math.max(3, meetingCount);
  const meetingEndRow = meetingBodyStartRow + meetingBodyRows - 1;
  const taskStartRow = meetingEndRow + 1;
  const taskEndRow = taskCount ? taskStartRow + taskCount - 1 : taskStartRow;

  return {
    noCol: noCol,
    maxDepth: maxDepth,
    indentDepth: indentDepth,
    taskNameStartCol: taskNameStartCol,
    taskNameEndCol: taskNameEndCol,
    taskDisplayCol: taskDisplayCol,
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
    metaStartRow: metaStartRow,
    metaEndRow: metaEndRow,
    milestoneStartRow: milestoneStartRow,
    milestoneBodyStartRow: milestoneBodyStartRow,
    milestoneBodyRows: milestoneBodyRows,
    milestoneEndRow: milestoneEndRow,
    meetingStartRow: meetingStartRow,
    meetingBodyStartRow: meetingBodyStartRow,
    meetingBodyRows: meetingBodyRows,
    meetingEndRow: meetingEndRow,
    headerRow1: headerRow1,
    headerRow2: headerRow2,
    taskStartRow: taskStartRow,
    taskEndRow: taskEndRow,
    leftEndCol: doneCol,
    totalRows: Math.max(taskEndRow, meetingEndRow),
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

  values[0][2] = 'プロジェクト名';
  values[0][6] = rootName;
  values[0][10] = '開始日';
  values[0][11] = '終了日';
  values[0][13] = '更新日';
  values[1][10] = minStart ? wbsDateValue_(minStart) : '';
  values[1][11] = maxEnd ? wbsDateValue_(maxEnd) : '';
  values[1][13] = wbsDateValue_(nowDate);
  wbsSetBackgrounds_(backgrounds, 1, 1, 2, 6, WBS_COLORS.metaLabel);
  wbsSetBackgrounds_(backgrounds, 1, 7, 2, 3, WBS_COLORS.paleYellow);
  wbsSetBackgrounds_(backgrounds, 1, 11, 1, 2, WBS_COLORS.metaLabel);
  wbsSetBackgrounds_(backgrounds, 1, 14, 1, 1, WBS_COLORS.metaLabel);
  wbsSetBackgrounds_(backgrounds, 2, 11, 1, 2, WBS_COLORS.paleYellow);
  wbsSetBackgrounds_(backgrounds, 2, 14, 1, 1, WBS_COLORS.paleYellow);

  wbsSetBackgrounds_(backgrounds, layout.headerRow1, 1, 2, layout.totalCols, WBS_COLORS.header);
  values[layout.headerRow1 - 1][layout.companyCol - 1] = 'タスクオーナー';
  values[layout.headerRow1 - 1][layout.planEndCol - 1] = '計画';
  values[layout.headerRow1 - 1][layout.actualEndCol - 1] = '実績';
  values[layout.headerRow2 - 1][0] = 'No.';
  for (let depth = 0; depth < layout.indentDepth - 1; depth += 1) {
    values[layout.headerRow2 - 1][layout.taskNameStartCol + depth - 1] = depth + 1;
  }
  values[layout.headerRow2 - 1][layout.taskDisplayCol - 1] = 'タスク';
  values[layout.headerRow2 - 1][layout.deliverableCol - 1] = '成果物';
  values[layout.headerRow2 - 1][layout.noteCol - 1] = '備考';
  values[layout.headerRow2 - 1][layout.companyCol - 1] = '会社名';
  values[layout.headerRow2 - 1][layout.assigneeCol - 1] = '責任者';
  values[layout.headerRow2 - 1][layout.planStartCol - 1] = '開始';
  values[layout.headerRow2 - 1][layout.planEndCol - 1] = '終了';
  values[layout.headerRow2 - 1][layout.planDaysCol - 1] = '日数';
  values[layout.headerRow2 - 1][layout.actualStartCol - 1] = '開始';
  values[layout.headerRow2 - 1][layout.actualEndCol - 1] = '終了';
  values[layout.headerRow2 - 1][layout.actualDaysCol - 1] = '日数';
  values[layout.headerRow2 - 1][layout.progressCol - 1] = '進捗率';
  values[layout.headerRow2 - 1][layout.doneCol - 1] = '完了フラグ';
  context.dateRange.dateColumns.forEach(function (date, index) {
    const col = layout.ganttStartCol + index;
    values[layout.headerRow1 - 1][col - 1] = wbsDateValue_(date.date);
    values[layout.headerRow2 - 1][col - 1] = wbsWeekdayLabel_(date.dow);
  });

  values[layout.milestoneStartRow - 1][1] = 'マイルストーン';
  wbsSetRowBackground_(backgrounds, layout.milestoneStartRow, 1, layout.totalCols, WBS_COLORS.section);
  wbsSetBackgrounds_(backgrounds, layout.milestoneBodyStartRow, 1, layout.milestoneBodyRows, layout.leftEndCol, WBS_COLORS.paleYellow);
  context.milestones.forEach(function (milestone) {
    const name = wbsClean_(wbsGet_(milestone, 'Name', 'name'));
    const date = wbsClean_(wbsGet_(milestone, 'Date', 'date'));
    const dateIndex = wbsDateIndex_(context.dateRange, date);
    if (dateIndex >= 0) {
      const col = layout.ganttStartCol + dateIndex;
      wbsAppendCellText_(values, layout.milestoneBodyStartRow, col, name);
      wbsAppendCellText_(values, layout.milestoneBodyStartRow + 1, col, '▼');
    }
  });

  values[layout.meetingStartRow - 1][1] = '会議体';
  wbsSetRowBackground_(backgrounds, layout.meetingStartRow, 1, layout.totalCols, WBS_COLORS.section);
  wbsSetBackgrounds_(backgrounds, layout.meetingBodyStartRow, 1, layout.meetingBodyRows, layout.leftEndCol, WBS_COLORS.paleYellow);
  context.meetings.forEach(function (meeting, index) {
    const sheetRow = layout.meetingBodyStartRow + index;
    const name = wbsClean_(wbsGet_(meeting, 'Name', 'name'));
    const schedule = wbsClean_(wbsGet_(meeting, 'Schedule', 'schedule'));
    const note = wbsClean_(wbsGet_(meeting, 'Note', 'note'));
    values[sheetRow - 1][2] = [name, schedule].filter(Boolean).join(' ');
    wbsMeetingMarkerDates_(meeting).forEach(function (date) {
      const dateIndex = wbsDateIndex_(context.dateRange, date);
      if (dateIndex >= 0) {
        wbsAppendCellText_(values, sheetRow, layout.ganttStartCol + dateIndex, '▼');
      }
    });
    if (!schedule && note) {
      values[sheetRow - 1][2] = [name, note].filter(Boolean).join(' ');
    }
  });
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
    matrixRow[wbsTaskNameCol_(layout, row.depth) - 1] = wbsClean_(wbsGet_(node, 'Name', 'name'));
    if (row.depth === 1) {
      wbsSetRowBackground_(backgrounds, sheetRow, 1, layout.totalCols, WBS_COLORS.section);
      return;
    }

    wbsSetBackgrounds_(backgrounds, sheetRow, 1, 1, layout.planDaysCol - 1, WBS_COLORS.paleYellow);
    wbsSetBackgrounds_(backgrounds, sheetRow, layout.actualStartCol, 1, 2, WBS_COLORS.paleYellow);
    backgrounds[sheetRow - 1][layout.planDaysCol - 1] = WBS_COLORS.header;
    backgrounds[sheetRow - 1][layout.actualDaysCol - 1] = WBS_COLORS.header;
    backgrounds[sheetRow - 1][layout.doneCol - 1] = WBS_COLORS.header;
    matrixRow[layout.deliverableCol - 1] = wbsClean_(wbsGet_(node, 'Deliverable', 'deliverable'));
    matrixRow[layout.noteCol - 1] = wbsClean_(wbsGet_(node, 'Note', 'note'));
    matrixRow[layout.companyCol - 1] = companies.join('・');
    matrixRow[layout.assigneeCol - 1] = assigneeNames.join('・');
    matrixRow[layout.planStartCol - 1] = plan.startDate ? wbsDateValue_(plan.startDate) : '';
    matrixRow[layout.planEndCol - 1] = plan.endDate ? wbsDateValue_(plan.endDate) : '';
    matrixRow[layout.planDaysCol - 1] = wbsDaysFormula_(sheetRow, layout.planStartCol, layout.planEndCol);
    matrixRow[layout.actualStartCol - 1] = actual.startDate ? wbsDateValue_(actual.startDate) : '';
    matrixRow[layout.actualEndCol - 1] = actual.endDate ? wbsDateValue_(actual.endDate) : '';
    matrixRow[layout.actualDaysCol - 1] = wbsDaysFormula_(sheetRow, layout.actualStartCol, layout.actualEndCol);
    matrixRow[layout.progressCol - 1] = (Number(context.progressByNodeId[nodeId]) || 0) / 100;
    matrixRow[layout.doneCol - 1] = '=IF(' + wbsA1_(sheetRow, layout.progressCol) + '=1, "完了", "")';

    context.dateRange.dateColumns.forEach(function (_date, dateIndex) {
      const col = layout.ganttStartCol + dateIndex;
      bgRow[col - 1] = WBS_COLORS.white;
      matrixRow[col - 1] = wbsActualMarkerFormula_(sheetRow, col, layout.actualStartCol, layout.actualEndCol);
    });
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
  applyWbsPreValueFormats_(sheet, model, rowCount);
  sheet.getRange(1, 1, rowCount, colCount).setValues(model.values);
  sheet.getRange(1, 1, rowCount, colCount).setBackgrounds(model.backgrounds);
  applyWbsTemplateFormats_(sheet, model, rowCount, colCount);

  if (model.taskRows.length) {
    const start = model.layout.taskStartRow;
    const rows = model.taskRows.length;
    [model.layout.planStartCol, model.layout.planEndCol, model.layout.actualStartCol, model.layout.actualEndCol].forEach(function (col) {
      sheet.getRange(start, col, rows, 1).setNumberFormat('yyyy/mm/dd');
    });
    sheet.getRange(start, model.layout.progressCol, rows, 1).setNumberFormat('General');
    const validation = SpreadsheetApp.newDataValidation()
      .requireValueInList(WBS_PROGRESS_OPTIONS, true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(start, model.layout.progressCol, rows, 1).setDataValidation(validation);
  }

  sheet.setConditionalFormatRules(buildWbsConditionalFormatRules_(sheet, model));
  SpreadsheetApp.flush();
}

function applyWbsPreValueFormats_(sheet, model, rowCount) {
  const layout = model.layout;
  const textRanges = [
    sheet.getRange(1, layout.noCol, rowCount, 1),
    sheet.getRange(1, layout.taskNameStartCol, rowCount, layout.taskDisplayCol - layout.taskNameStartCol + 1),
    sheet.getRange(1, layout.deliverableCol, rowCount, 2),
    sheet.getRange(1, layout.companyCol, rowCount, 2)
  ];
  textRanges.forEach(function (range) {
    range.setNumberFormat('@');
  });
  if (model.dateColumns.length) {
    sheet.getRange(layout.milestoneBodyStartRow, layout.ganttStartCol, layout.milestoneBodyRows, model.dateColumns.length).setNumberFormat('@');
    sheet.getRange(layout.meetingBodyStartRow, layout.ganttStartCol, layout.meetingBodyRows, model.dateColumns.length).setNumberFormat('@');
  }
}

function applyWbsTemplateFormats_(sheet, model, rowCount, colCount) {
  const layout = model.layout;
  sheet.setHiddenGridlines(true);
  sheet.setFrozenRows(0);
  sheet.setFrozenColumns(layout.taskDisplayCol);
  sheet.getRange(1, 1, rowCount, colCount)
    .setFontFamily('Arial')
    .setFontColor('#000000')
    .setVerticalAlignment('middle')
    .setWrap(false);

  sheet.getRange(layout.headerRow1, 1, 2, colCount)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.getRangeList(['C1', 'K1:L1', 'N1']).setFontWeight('bold');
  sheet.getRange(layout.headerRow1, layout.ganttStartCol, 1, model.dateColumns.length || 1).setNumberFormat('m/d');
  sheet.getRange(2, layout.planStartCol, 1, 2).setNumberFormat('yyyy/mm/dd');
  sheet.getRange(2, layout.actualStartCol, 1, 1).setNumberFormat('yyyy/mm/dd');

  const sectionRows = [layout.milestoneStartRow, layout.meetingStartRow].concat(model.sectionRows || []);
  if (sectionRows.length) {
    sheet.getRangeList(sectionRows.map(function (row) {
      return 'A' + row + ':' + wbsColumnLetter_(colCount) + row;
    })).setFontColor('#FFFFFF').setFontWeight('bold');
  }

  applyWbsTemplateBorders_(sheet, model);

  sheet.setColumnWidth(1, 45);
  sheet.setColumnWidths(layout.taskNameStartCol, layout.indentDepth, 18);
  sheet.setColumnWidth(layout.taskDisplayCol, 149);
  sheet.setColumnWidth(layout.deliverableCol, 150);
  sheet.setColumnWidth(layout.noteCol, 87);
  sheet.setColumnWidth(layout.companyCol, 46);
  sheet.setColumnWidth(layout.assigneeCol, 63);
  sheet.setColumnWidths(layout.planStartCol, 2, 75);
  sheet.setColumnWidth(layout.planDaysCol, 31);
  sheet.setColumnWidths(layout.actualStartCol, 2, 75);
  sheet.setColumnWidth(layout.actualDaysCol, 31);
  sheet.setColumnWidth(layout.progressCol, 75);
  sheet.setColumnWidth(layout.doneCol, 70);
  if (model.dateColumns.length) {
    sheet.setColumnWidths(layout.ganttStartCol, model.dateColumns.length, 36);
  }
}

function applyWbsTemplateBorders_(sheet, model) {
  const layout = model.layout;
  const style = SpreadsheetApp.BorderStyle.SOLID;
  const color = WBS_COLORS.border;
  function border(row, col, rows, cols, top, left, bottom, right, vertical, horizontal) {
    sheet.getRange(row, col, rows, cols).setBorder(top, left, bottom, right, vertical, horizontal, color, style);
  }

  border(1, 1, 2, 6, true, true, true, true, false, false);
  border(1, 7, 2, 3, true, false, true, true, false, false);
  border(1, layout.planStartCol, 2, 2, true, true, true, true, true, true);
  border(1, layout.actualStartCol, 2, 1, true, true, true, true, false, true);

  border(layout.headerRow1, 1, 2, 1, true, true, true, true, false, false);
  border(layout.headerRow1, layout.taskNameStartCol, 2, layout.taskDisplayCol - layout.taskNameStartCol + 1, true, true, true, true, false, false);
  border(layout.headerRow1, layout.deliverableCol, 2, 1, true, true, true, true, false, false);
  border(layout.headerRow1, layout.noteCol, 2, 1, true, true, true, true, false, false);
  border(layout.headerRow1, layout.companyCol, 2, 2, true, true, true, true, true, true);
  border(layout.headerRow1, layout.planStartCol, 1, 3, true, false, true, true, false, false);
  border(layout.headerRow2, layout.planStartCol, 1, 3, true, true, true, true, true, false);
  border(layout.headerRow1, layout.actualStartCol, 1, 3, true, true, true, false, false, false);
  border(layout.headerRow2, layout.actualStartCol, 1, 3, true, true, true, false, true, false);
  border(layout.headerRow1, layout.progressCol, 2, 1, true, true, true, true, false, false);
  border(layout.headerRow1, layout.doneCol, 2, 1, true, false, true, true, false, false);
  if (model.dateColumns.length) {
    border(layout.headerRow1, layout.ganttStartCol, 2, model.dateColumns.length, true, true, true, true, true, true);
  }

  border(layout.milestoneStartRow, layout.doneCol, layout.meetingEndRow - layout.milestoneStartRow + 1, 1, false, false, false, true, false, false);

  wbsRowBlocks_(model.normalRows || []).forEach(function (block) {
    border(block.start, 1, block.count, 1, true, true, true, false, false, true);
    border(block.start, layout.taskNameStartCol, block.count, layout.taskDisplayCol - layout.taskNameStartCol + 1, true, true, true, true, false, true);
    border(block.start, layout.deliverableCol, block.count, 1, true, false, true, true, false, true);
    border(block.start, layout.noteCol, block.count, layout.assigneeCol - layout.noteCol + 1, true, true, true, true, true, true);
    border(block.start, layout.planStartCol, block.count, 3, true, true, true, true, true, true);
    border(block.start, layout.actualStartCol, block.count, 3, true, true, true, true, true, true);
    border(block.start, layout.progressCol, block.count, 2, true, true, true, true, true, true);
  });
}

function buildWbsConditionalFormatRules_(sheet, model) {
  const layout = model.layout;
  const rules = [];
  if (model.dateColumns.length) {
    const bodyRange = sheet.getRange(layout.milestoneBodyStartRow, layout.ganttStartCol, layout.totalRows - layout.milestoneBodyStartRow + 1, model.dateColumns.length);
    [layout.milestoneStartRow, layout.meetingStartRow].concat(model.sectionRows || []).forEach(function (row) {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=' + wbsColumnLetter_(layout.ganttStartCol) + '$4<>""')
        .setBackground(WBS_COLORS.section)
        .setFontColor('#FFFFFF')
        .setRanges([sheet.getRange(row, layout.ganttStartCol, 1, model.dateColumns.length)])
        .build());
    });
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=WEEKDAY(S$4)=1')
      .setBackground(WBS_COLORS.sunday)
      .setFontColor(WBS_COLORS.sunday)
      .setRanges([bodyRange])
      .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=WEEKDAY(S$4)=7')
      .setBackground(WBS_COLORS.saturday)
      .setFontColor(WBS_COLORS.saturday)
      .setRanges([bodyRange])
      .build());
  }
  if (model.taskRows.length) {
    const taskRows = model.taskRows.length;
    const taskGanttRange = sheet.getRange(layout.taskStartRow, layout.ganttStartCol, taskRows, model.dateColumns.length || 1);
    const leftTaskRange = sheet.getRange(layout.taskStartRow, 1, taskRows, layout.leftEndCol);
    const progressRange = sheet.getRange(layout.taskStartRow, layout.progressCol, taskRows, 1);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(S$4>=$K' + layout.taskStartRow + '-0.0001,S$4<=$L' + layout.taskStartRow + '+0.0001)')
      .setBackground(WBS_COLORS.plan)
      .setRanges([taskGanttRange])
      .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$R' + layout.taskStartRow + '="完了"')
      .setBackground(WBS_COLORS.completed)
      .setRanges([leftTaskRange])
      .build());
    WBS_PROGRESS_COLORS.forEach(function (progress) {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$' + wbsColumnLetter_(layout.progressCol) + layout.taskStartRow + '=' + progress.value)
        .setBackground(progress.color)
        .setRanges([progressRange])
        .build());
    });
  }
  if (model.dateColumns.length) {
    const headerRange = sheet.getRange(layout.headerRow1, layout.ganttStartCol, 2, model.dateColumns.length);
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=WEEKDAY(S$4)=1')
      .setBackground(WBS_COLORS.sunday)
      .setRanges([headerRange])
      .build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=WEEKDAY(S$4)=7')
      .setBackground(WBS_COLORS.saturday)
      .setRanges([headerRange])
      .build());
  }
  return rules;
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

function wbsSetBackgrounds_(backgrounds, startRow, startCol, rowCount, colCount, color) {
  for (let row = startRow; row < startRow + rowCount; row += 1) {
    wbsSetRowBackground_(backgrounds, row, startCol, colCount, color);
  }
}

function wbsRowBlocks_(rows) {
  const sorted = rows
    .map(function (row) { return Number(row) || 0; })
    .filter(function (row) { return row > 0; })
    .sort(function (a, b) { return a - b; });
  const blocks = [];
  sorted.forEach(function (row) {
    const last = blocks[blocks.length - 1];
    if (last && last.start + last.count === row) {
      last.count += 1;
      return;
    }
    blocks.push({ start: row, count: 1 });
  });
  return blocks;
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
  return '=IF(AND(' + start + '<>"", ' + end + '<>""), ' + end + '-' + start + '+1, "")';
}

function wbsActualMarkerFormula_(row, dateCol, actualStartCol, actualEndCol) {
  const dateCell = wbsColumnLetter_(dateCol) + '$4';
  const startCell = '$' + wbsColumnLetter_(actualStartCol) + row;
  const endCell = '$' + wbsColumnLetter_(actualEndCol) + row;
  return '=IF(AND(' + dateCell + '<>"", ' + dateCell + '>=' + startCell + '-0.0001, ' + dateCell + '<=' + endCell + '+0.0001), "★", "")';
}

function wbsTaskNameCol_(layout, depth) {
  const safeDepth = Math.max(1, Math.min(Number(depth) || 1, layout.indentDepth));
  return layout.taskNameStartCol + safeDepth - 1;
}

function wbsAppendCellText_(values, row, col, text) {
  const value = wbsClean_(text);
  if (!value) {
    return;
  }
  const current = wbsClean_(values[row - 1][col - 1]);
  values[row - 1][col - 1] = current ? current + ' / ' + value : value;
}

function wbsMeetingMarkerDates_(meeting) {
  const text = [
    wbsGet_(meeting, 'Name', 'name'),
    wbsGet_(meeting, 'Schedule', 'schedule'),
    wbsGet_(meeting, 'Note', 'note')
  ].map(wbsClean_).join(' ');
  const result = [];
  const seen = {};
  const matches = text.match(/\d{4}-\d{2}-\d{2}/g) || [];
  matches.forEach(function (dateText) {
    if (wbsIsValidDate_(dateText) && !seen[dateText]) {
      seen[dateText] = true;
      result.push(dateText);
    }
  });
  return result;
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
