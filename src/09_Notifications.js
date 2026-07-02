/**
 * Slack notification helpers.
 */

function buildStatusChangeNotification_(node, beforeColumn, afterColumn, actor, rows) {
  const beforeName = beforeColumn ? cleanString_(beforeColumn.Name) : '未設定';
  const afterName = afterColumn ? cleanString_(afterColumn.Name) : '未設定';
  const actorName = actor ? cleanString_(actor.Name) : '不明';
  const path = parentPath_(node, activeNodes_(rows.nodes));
  const webAppUrl = webAppUrl_();
  const lines = [
    'タスクのステータスが変更されました',
    'タスク: ' + cleanString_(node.Name),
    path ? '親パス: ' + path : '',
    '変更: ' + beforeName + ' -> ' + afterName,
    '実行者: ' + actorName,
    webAppUrl ? 'URL: ' + webAppUrl : ''
  ].filter(Boolean);
  return {
    text: lines.join('\n'),
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*タスクのステータスが変更されました*'
        }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: '*タスク*\n' + slackEscape_(cleanString_(node.Name)) },
          { type: 'mrkdwn', text: '*変更*\n' + slackEscape_(beforeName) + ' -> ' + slackEscape_(afterName) },
          { type: 'mrkdwn', text: '*実行者*\n' + slackEscape_(actorName) },
          { type: 'mrkdwn', text: '*親パス*\n' + slackEscape_(path || '-') }
        ]
      }
    ].concat(webAppUrl ? [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '<' + webAppUrl + '|Webアプリを開く>'
      }
    }] : [])
  };
}

function postToSlack_(payload) {
  try {
    const webhookUrl = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL');
    if (!webhookUrl || !payload) {
      return;
    }
    UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (error) {
    // Notifications are best-effort. A Slack failure must never fail the save.
  }
}

function parentPath_(node, activeNodes) {
  const nodesById = byId_(activeNodes, 'NodeId');
  const names = [];
  let current = node;
  const seen = {};
  while (current && cleanString_(current.ParentId)) {
    const parentId = cleanString_(current.ParentId);
    if (seen[parentId]) {
      break;
    }
    seen[parentId] = true;
    const parent = nodesById[parentId];
    if (!parent) {
      break;
    }
    names.unshift(cleanString_(parent.Name));
    current = parent;
  }
  return names.join(' > ');
}

function webAppUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (error) {
    return '';
  }
}

function slackEscape_(value) {
  return cleanString_(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
