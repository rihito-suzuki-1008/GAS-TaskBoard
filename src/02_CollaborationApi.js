/**
 * Member and comment APIs.
 */

function getComments(nodeId) {
  ensureSchema_();
  const rows = readAll_();
  const active = activeNodes_(rows.nodes);
  if (!byId_(active, 'NodeId')[cleanString_(nodeId)]) {
    throw new Error('ノードが見つかりません。');
  }
  return rows.comments
    .filter(function (c) { return cleanString_(c.NodeId) === cleanString_(nodeId); })
    .sort(function (a, b) { return cleanString_(a.Timestamp).localeCompare(cleanString_(b.Timestamp)); })
    .map(clientComment_);
}

function addComment(payload) {
  payload = payload || {};
  return withLock_(function () {
    ensureSchema_();
    const actor = requireCurrentMember_();
    const rows = readAll_();
    const activeMap = byId_(activeNodes_(rows.nodes), 'NodeId');
    const nodeId = cleanString_(payload.nodeId);
    if (!activeMap[nodeId]) {
      throw new Error('ノードが見つかりません。');
    }
    const text = cleanString_(payload.text);
    if (!text) {
      throw new Error('コメント本文を入力してください。');
    }
    if (text.length > 4000) {
      throw new Error('コメントは4000文字以内で入力してください。');
    }
    const comment = {
      CommentId: newId_(),
      NodeId: nodeId,
      AuthorId: actor.MemberId,
      AuthorName: actor.Name,
      Timestamp: nowIso_(),
      Text: text
    };
    appendObject_(SHEET.COMMENTS, comment);
    return { ok: true, comment: clientComment_(comment), nodeId: nodeId };
  });
}

function upsertMember(payload) {
  payload = payload || {};
  return withLock_(function () {
    ensureSchema_();
    requireCurrentMember_();
    const rows = readAll_();
    const memberId = cleanString_(payload.memberId);
    const email = normalizeEmail_(payload.email);
    const name = requireName_(payload.name);
    const color = normalizeColor_(payload.color) || '#1E6F5C';
    const duplicate = rows.members.find(function (m) {
      return normalizeEmail_(m.Email) === email && cleanString_(m.MemberId) !== memberId;
    });
    if (duplicate) {
      throw new Error('同じメールアドレスのメンバーが既に存在します。');
    }

    if (memberId) {
      const member = rows.members.find(function (m) { return cleanString_(m.MemberId) === memberId; });
      if (!member) {
        throw new Error('メンバーが見つかりません。');
      }
      member.Name = name;
      member.Email = email;
      member.Color = color;
      writeObject_(SHEET.MEMBERS, member);
    } else {
      appendObject_(SHEET.MEMBERS, {
        MemberId: newId_(),
        Name: name,
        Email: email,
        Color: color
      });
    }
    return { ok: true, members: readAll_().members.map(clientMember_) };
  });
}

function deleteMember(payload) {
  payload = payload || {};
  return withLock_(function () {
    ensureSchema_();
    const actor = requireCurrentMember_();
    const rows = readAll_();
    const memberId = cleanString_(payload.memberId);
    const member = rows.members.find(function (m) { return cleanString_(m.MemberId) === memberId; });
    if (!member) {
      throw new Error('メンバーが見つかりません。');
    }
    if (rows.members.length <= 1) {
      throw new Error('最後の1人のメンバーは削除できません。');
    }
    if (memberId === actor.MemberId && payload.confirmSelf !== true) {
      throw new Error('自分自身を削除するには再確認が必要です。');
    }

    const affected = [];
    activeNodes_(rows.nodes).forEach(function (node) {
      const ids = splitCsv_(node.AssigneeIds);
      if (ids.indexOf(memberId) !== -1) {
        node.AssigneeIds = ids.filter(function (id) { return id !== memberId; }).join(',');
        node.UpdatedAt = nowIso_();
        node.UpdatedBy = actor.MemberId;
        affected.push(node);
      }
    });
    writeObjects_(SHEET.NODES, affected);
    deleteRow_(SHEET.MEMBERS, member.__row);

    const freshRows = readAll_();
    return {
      ok: true,
      members: freshRows.members.map(clientMember_),
      affectedNodeCount: affected.length,
      nodes: clientNodesByIds_(freshRows, affected.map(function (n) { return n.NodeId; }))
    };
  });
}
