/**
 * Member and comment APIs.
 */

function getComments(nodeId) {
  requireSchemaExists_();
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
    requireSchemaExists_();
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
    const commentId = cleanString_(payload.commentId || payload.clientCommentId);
    const duplicate = rows.comments.some(function (c) { return cleanString_(c.CommentId) === commentId; });
    if (commentId && duplicate) {
      throw new Error('同じIDのコメントが既に存在します。');
    }
    const parentCommentId = cleanString_(payload.parentCommentId);
    if (parentCommentId) {
      const parent = rows.comments.find(function (c) { return cleanString_(c.CommentId) === parentCommentId; });
      if (!parent || cleanString_(parent.NodeId) !== nodeId) {
        throw new Error('返信先コメントが見つかりません。');
      }
      if (cleanString_(parent.ParentCommentId)) {
        throw new Error('返信は親コメントにのみ追加できます。');
      }
    }
    const memberSet = {};
    rows.members.forEach(function (m) { memberSet[cleanString_(m.MemberId)] = true; });
    const mentions = unique_(Array.isArray(payload.mentions) ? payload.mentions.map(cleanString_) : splitCsv_(payload.mentions))
      .filter(function (id) { return !!memberSet[id]; });
    const comment = {
      CommentId: commentId || newId_(),
      NodeId: nodeId,
      AuthorId: actor.MemberId,
      AuthorName: actor.Name,
      Timestamp: nowIso_(),
      Text: text,
      ParentCommentId: parentCommentId,
      Mentions: mentions.join(',')
    };
    appendObject_(SHEET.COMMENTS, comment);
    const freshRows = readAll_();
    return { ok: true, comment: clientComment_(comment), nodeId: nodeId, commentCounts: commentCounts_(freshRows) };
  });
}

function joinAsMember(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
    const email = getCurrentEmail_();
    if (!email) {
      throw new Error('ログインユーザーのメールアドレスを取得できません。Workspace ドメイン内のアカウントで開いてください。');
    }
    const rows = readAll_();
    const existing = rows.members.find(function (m) { return normalizeEmail_(m.Email) === email; });
    if (existing) {
      return {
        ok: true,
        members: rows.members.map(clientMember_),
        currentMember: clientMember_(existing)
      };
    }

    const name = requireName_(payload.name || email.split('@')[0]);
    const color = normalizeColor_(payload.color) || '#1E6F5C';
    let memberId = cleanString_(payload.clientMemberId);
    const duplicateId = memberId && rows.members.some(function (m) { return cleanString_(m.MemberId) === memberId; });
    if (!memberId || duplicateId) {
      memberId = newId_();
    }
    appendObject_(SHEET.MEMBERS, {
      MemberId: memberId,
      Name: name,
      Email: email,
      Color: color
    });
    const freshMembers = readAll_().members;
    const currentMember = freshMembers.find(function (m) { return normalizeEmail_(m.Email) === email; });
    return {
      ok: true,
      members: freshMembers.map(clientMember_),
      currentMember: currentMember ? clientMember_(currentMember) : null
    };
  });
}

function upsertMember(payload) {
  payload = payload || {};
  return withLock_(function () {
    requireSchemaExists_();
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
      const newMemberId = cleanString_(payload.clientMemberId);
      const duplicateId = rows.members.some(function (m) { return cleanString_(m.MemberId) === newMemberId; });
      if (newMemberId && duplicateId) {
        throw new Error('同じIDのメンバーが既に存在します。');
      }
      appendObject_(SHEET.MEMBERS, {
        MemberId: newMemberId || newId_(),
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
    requireSchemaExists_();
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
