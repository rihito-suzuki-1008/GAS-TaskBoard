/**
 * @OnlyCurrentDoc
 *
 * GAS task management app web entrypoints.
 * The spreadsheet is the source of truth; derived values are always calculated
 * at read/write time and are never persisted.
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('タスク管理')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  // Client*.html and Styles.html are fragments injected into <script>/<style>.
  // Reading them as standalone HtmlOutput makes GAS validate JS template
  // literals such as `<aside ...>` as real HTML and reject otherwise valid code.
  return HtmlService.createTemplateFromFile(filename).getRawContent();
}

function loadAll() {
  ensureSchema_();
  const rows = readAll_();
  const activeNodes = activeNodes_(rows.nodes);
  const setupRequired = activeNodes.length === 0 && rows.members.length === 0 && rows.statusColumns.length === 0;
  if (setupRequired) {
    return {
      ok: true,
      setupRequired: true,
      currentEmail: getCurrentEmail_(),
      spreadsheetId: SpreadsheetApp.getActive().getId(),
      version: APP_VERSION
    };
  }
  if (activeNodes.length === 0 || rows.members.length === 0 || rows.statusColumns.length === 0) {
    throw new Error('初期データが不完全です。Nodes / Members / StatusColumns を確認してください。');
  }
  return makeFullPayload_(rows);
}

function setupProject(payload) {
  payload = payload || {};
  return withLock_(function () {
    ensureSchema_();
    const rows = readAll_();
    if (rows.nodes.length || rows.members.length || rows.statusColumns.length) {
      throw new Error('初回セットアップは空の案件でのみ実行できます。');
    }

    const email = getCurrentEmail_();
    if (!email) {
      throw new Error('ログインユーザーのメールアドレスを取得できません。Workspace ドメイン内のアカウントで開いてください。');
    }

    const now = nowIso_();
    const memberId = newId_();
    const memberName = cleanString_(payload.memberName) || email.split('@')[0];
    const memberColor = normalizeColor_(payload.color) || '#1E6F5C';
    const statusTodo = newId_();
    const statusDoing = newId_();
    const statusDone = newId_();
    const rootId = newId_();
    const projectName = cleanString_(payload.projectName) || '新規案件';

    appendObject_(SHEET.MEMBERS, {
      MemberId: memberId,
      Name: memberName,
      Email: email,
      Color: memberColor
    });
    appendObject_(SHEET.STATUS_COLUMNS, {
      ColumnId: statusTodo,
      Name: '未着手',
      SortOrder: 1000,
      IsDoneColumn: false,
      Color: '#DCE5DE'
    });
    appendObject_(SHEET.STATUS_COLUMNS, {
      ColumnId: statusDoing,
      Name: '進行中',
      SortOrder: 2000,
      IsDoneColumn: false,
      Color: '#CFE0F5'
    });
    appendObject_(SHEET.STATUS_COLUMNS, {
      ColumnId: statusDone,
      Name: '完了',
      SortOrder: 3000,
      IsDoneColumn: true,
      Color: '#CFE8DE'
    });
    appendObject_(SHEET.NODES, {
      NodeId: rootId,
      ParentId: '',
      Name: projectName,
      StatusColumnId: statusTodo,
      AssigneeIds: memberId,
      Priority: 'Mid',
      StartDate: '',
      EndDate: '',
      Description: '',
      SortOrder: 1000,
      CreatedAt: now,
      UpdatedAt: now,
      UpdatedBy: memberId,
      DeletedAt: '',
      DeletedBy: ''
    });

    return makeFullPayload_(readAll_());
  });
}

function ping() {
  return { ok: true, version: APP_VERSION, email: getCurrentEmail_() };
}
