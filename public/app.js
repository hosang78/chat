(function () {
  const loginView = document.getElementById('login-view');
  const chatView = document.getElementById('chat-view');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password-input');
  const loginError = document.getElementById('login-error');
  const loginSubmitBtn = document.getElementById('login-submit-btn');
  const loginWaiting = document.getElementById('login-waiting');
  const myNicknameEl = document.getElementById('my-nickname');
  const connStatusEl = document.getElementById('conn-status');
  const presenceCountEl = document.getElementById('presence-count');
  const editNicknameBtn = document.getElementById('edit-nickname-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const messageList = document.getElementById('message-list');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const sendStatus = document.getElementById('send-status');
  const emojiToggleBtn = document.getElementById('emoji-toggle-btn');
  const emojiPanel = document.getElementById('emoji-panel');

  const EMOJIS = [
    '😀', '😂', '😅', '😍', '😢', '😭', '😡', '😱',
    '👍', '👎', '🙏', '👏', '🙌', '💪', '🤝', '✌️',
    '❤️', '🔥', '🎉', '👀', '🤔', '😴', '☕', '💡',
  ];

  function renderEmojiPanel() {
    EMOJIS.forEach((emoji) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        insertAtCursor(chatInput, emoji);
        emojiPanel.classList.add('hidden');
        chatInput.focus();
      });
      emojiPanel.appendChild(btn);
    });
  }

  function insertAtCursor(input, text) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    const cursor = start + text.length;
    input.setSelectionRange(cursor, cursor);
  }

  emojiToggleBtn.addEventListener('click', () => {
    emojiPanel.classList.toggle('hidden');
  });

  renderEmojiPanel();

  let myNickname = '';
  let isAdmin = false;
  let ws = null;

  // 메시지 id -> DOM 참조 (실시간 갱신용)
  const messageEls = new Map();

  function renderNicknameHeader() {
    myNicknameEl.textContent = myNickname;
    myNicknameEl.classList.toggle('admin-name', isAdmin);
    if (isAdmin) {
      const badge = document.createElement('span');
      badge.className = 'badge-admin';
      badge.textContent = '관리자';
      myNicknameEl.appendChild(badge);
    }
  }

  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function buildReplyEl(reply) {
    const el = document.createElement('div');
    el.className = 'reply';
    el.dataset.id = reply.id;

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const nick = document.createElement('span');
    nick.textContent = reply.nickname;
    if (reply.is_admin) nick.classList.add('admin-name');
    meta.appendChild(nick);
    const time = document.createElement('span');
    time.textContent = formatTime(reply.created_at);
    meta.appendChild(time);
    el.appendChild(meta);

    const content = document.createElement('div');
    content.className = 'message-content';
    if (reply.deleted_at) {
      content.textContent = '삭제된 답글입니다.';
      el.classList.add('deleted');
    } else {
      content.textContent = reply.content;
    }
    el.appendChild(content);

    if (isAdmin && !reply.deleted_at) {
      const actions = document.createElement('div');
      actions.className = 'message-actions';
      const delBtn = document.createElement('button');
      delBtn.className = 'delete-btn';
      delBtn.textContent = '삭제';
      delBtn.addEventListener('click', () => {
        ws.send(JSON.stringify({ type: 'delete', target: 'reply', id: reply.id }));
      });
      actions.appendChild(delBtn);

      const hideBtn = document.createElement('button');
      hideBtn.className = 'delete-btn';
      hideBtn.textContent = '삭제후숨기기';
      hideBtn.addEventListener('click', () => {
        if (!confirm('이 답글을 완전히 숨기시겠어요? 흔적 없이 목록에서 사라집니다.')) return;
        ws.send(JSON.stringify({ type: 'delete', target: 'reply', id: reply.id, hidden: true }));
      });
      actions.appendChild(hideBtn);

      el.appendChild(actions);
    }
    return el;
  }

  function buildMessageEl(message) {
    const root = document.createElement('div');
    root.className = 'message';
    root.dataset.id = message.id;
    if (message.deleted_at) root.classList.add('deleted');

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const nick = document.createElement('span');
    nick.textContent = message.nickname;
    if (message.is_admin) nick.classList.add('admin-name');
    meta.appendChild(nick);
    if (message.is_admin) {
      const badge = document.createElement('span');
      badge.className = 'badge-admin';
      badge.textContent = '관리자';
      meta.appendChild(badge);
    }
    const time = document.createElement('span');
    time.textContent = formatTime(message.created_at);
    meta.appendChild(time);
    root.appendChild(meta);

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = message.deleted_at ? '관리자에 의해 삭제된 메시지입니다.' : message.content;
    root.appendChild(content);

    const actions = document.createElement('div');
    actions.className = 'message-actions';

    const likeBtn = document.createElement('button');
    likeBtn.textContent = `👍 ${message.likes || 0}`;
    likeBtn.addEventListener('click', () => {
      ws.send(JSON.stringify({ type: 'reaction', messageId: message.id, reactionType: 'like' }));
    });
    actions.appendChild(likeBtn);

    const dislikeBtn = document.createElement('button');
    dislikeBtn.textContent = `👎 ${message.dislikes || 0}`;
    dislikeBtn.addEventListener('click', () => {
      ws.send(JSON.stringify({ type: 'reaction', messageId: message.id, reactionType: 'dislike' }));
    });
    actions.appendChild(dislikeBtn);

    const replyToggle = document.createElement('button');
    replyToggle.textContent = '댓글';
    actions.appendChild(replyToggle);

    if (isAdmin && !message.deleted_at) {
      const delBtn = document.createElement('button');
      delBtn.className = 'delete-btn';
      delBtn.textContent = '삭제';
      delBtn.addEventListener('click', () => {
        ws.send(JSON.stringify({ type: 'delete', target: 'message', id: message.id }));
      });
      actions.appendChild(delBtn);

      const hideBtn = document.createElement('button');
      hideBtn.className = 'delete-btn';
      hideBtn.textContent = '삭제후숨기기';
      hideBtn.addEventListener('click', () => {
        if (!confirm('이 메시지를 완전히 숨기시겠어요? 흔적 없이 목록에서 사라집니다.')) return;
        ws.send(JSON.stringify({ type: 'delete', target: 'message', id: message.id, hidden: true }));
      });
      actions.appendChild(hideBtn);
    }

    root.appendChild(actions);

    const repliesEl = document.createElement('div');
    repliesEl.className = 'replies';
    (message.replies || []).forEach((reply) => repliesEl.appendChild(buildReplyEl(reply)));
    root.appendChild(repliesEl);

    const replyForm = document.createElement('form');
    replyForm.className = 'reply-form';
    const replyInput = document.createElement('input');
    replyInput.type = 'text';
    replyInput.placeholder = '댓글을 입력하세요';
    replyInput.maxLength = 500;
    const replySubmit = document.createElement('button');
    replySubmit.type = 'submit';
    replySubmit.textContent = '등록';
    replyForm.appendChild(replyInput);
    replyForm.appendChild(replySubmit);
    replyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = replyInput.value.trim();
      if (!text) return;
      ws.send(JSON.stringify({ type: 'reply', messageId: message.id, content: text }));
      replyInput.value = '';
    });
    root.appendChild(replyForm);

    replyToggle.addEventListener('click', () => {
      replyForm.classList.toggle('open');
      if (replyForm.classList.contains('open')) replyInput.focus();
    });

    messageEls.set(message.id, { root, content, likeBtn, dislikeBtn, repliesEl });
    return root;
  }

  function appendMessage(message) {
    messageList.appendChild(buildMessageEl(message));
    messageList.scrollTop = messageList.scrollHeight;
  }

  function appendReply(reply) {
    const ref = messageEls.get(reply.message_id);
    if (!ref) return;
    ref.repliesEl.appendChild(buildReplyEl(reply));
    messageList.scrollTop = messageList.scrollHeight;
  }

  function updateReaction(messageId, likes, dislikes) {
    const ref = messageEls.get(messageId);
    if (!ref) return;
    ref.likeBtn.textContent = `👍 ${likes}`;
    ref.dislikeBtn.textContent = `👎 ${dislikes}`;
  }

  function markDeleted(target, id, hidden) {
    if (target === 'message') {
      const ref = messageEls.get(id);
      if (!ref) return;
      if (hidden) {
        ref.root.remove();
        messageEls.delete(id);
        return;
      }
      ref.root.classList.add('deleted');
      ref.content.textContent = '관리자에 의해 삭제된 메시지입니다.';
    } else {
      const el = messageList.querySelector(`.reply[data-id="${id}"]`);
      if (!el) return;
      if (hidden) {
        el.remove();
        return;
      }
      el.classList.add('deleted');
      el.querySelector('.message-content').textContent = '삭제된 답글입니다.';
    }
  }

  let loggedOut = false;

  function setConnStatus(state) {
    connStatusEl.classList.remove('online', 'connecting');
    if (state === 'online') {
      connStatusEl.classList.add('online');
      connStatusEl.textContent = '연결됨';
    } else {
      connStatusEl.classList.add('connecting');
      connStatusEl.textContent = '연결 중...';
    }
  }

  function updatePresence(count) {
    presenceCountEl.textContent = `👥 ${count}명 접속 중`;
  }

  let pendingChatText = null;

  function connectWebSocket() {
    setConnStatus('connecting');
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}/ws`);

    ws.addEventListener('open', () => {
      setConnStatus('online');
      if (pendingChatText) {
        const textToSend = pendingChatText;
        ws.send(JSON.stringify({ type: 'chat', content: textToSend }));
        // 전송 직후 연결이 곧바로 끊길 수 있어(세션 만료 등) 잠시 뒤 연결이
        // 살아있는 걸 확인하고서야 성공으로 간주해 초안을 지운다.
        setTimeout(() => {
          if (pendingChatText === textToSend && ws && ws.readyState === WebSocket.OPEN) {
            pendingChatText = null;
            chatInput.value = '';
            sendStatus.classList.add('hidden');
          }
        }, 1000);
      }
    });

    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'chat') appendMessage(data.message);
      else if (data.type === 'reply') appendReply(data.reply);
      else if (data.type === 'reaction') updateReaction(data.messageId, data.likes, data.dislikes);
      else if (data.type === 'delete') markDeleted(data.target, data.id, data.hidden);
      else if (data.type === 'presence') updatePresence(data.count);
      else if (data.type === 'error') alert(data.error);
    });

    ws.addEventListener('close', (event) => {
      if (event.code === 4001) {
        // 서버가 재시작되어 세션이 사라진 경우 (예: 무료 플랜 슬립 후 재기동)
        resetToLoginView('세션이 만료되었습니다. 서버가 재시작되었을 수 있어요 — 비밀번호를 다시 입력해주세요.');
        return;
      }
      setConnStatus('connecting');
      if (!loggedOut) setTimeout(connectWebSocket, 2000);
    });
  }

  async function loadMessages() {
    const res = await fetch('/api/messages');
    const data = await res.json();
    messageList.innerHTML = '';
    messageEls.clear();
    data.messages.forEach(appendMessage);
  }

  async function enterChat(nickname, admin) {
    loggedOut = false;
    myNickname = nickname;
    isAdmin = admin;
    renderNicknameHeader();
    editNicknameBtn.classList.toggle('hidden', isAdmin);
    loginView.classList.add('hidden');
    chatView.classList.remove('hidden');
    await loadMessages();
    connectWebSocket();
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = '입장 중...';
    loginWaiting.classList.remove('hidden');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput.value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        loginError.textContent = data.error || '입장에 실패했습니다.';
        return;
      }
      const data = await res.json();
      await enterChat(data.nickname, data.isAdmin);
    } catch (err) {
      loginError.textContent = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.';
    } finally {
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.textContent = '입장하기';
      loginWaiting.classList.add('hidden');
    }
  });

  editNicknameBtn.addEventListener('click', async () => {
    const next = prompt('새 닉네임을 입력하세요 (1~20자)', myNickname);
    if (next === null) return;
    const res = await fetch('/api/nickname', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: next }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || '닉네임 변경에 실패했습니다.');
      return;
    }
    myNickname = data.nickname;
    renderNicknameHeader();
  });

  function resetToLoginView(message) {
    loggedOut = true;
    if (ws) {
      ws.close();
      ws = null;
    }
    const hadUnsentDraft = Boolean(pendingChatText);
    pendingChatText = null;
    messageList.innerHTML = '';
    messageEls.clear();
    if (!hadUnsentDraft) chatInput.value = ''; // 보내지 못한 초안은 재입장 후 이어 쓸 수 있게 남겨둠
    passwordInput.value = '';
    sendStatus.classList.add('hidden');
    presenceCountEl.textContent = '';
    myNickname = '';
    isAdmin = false;
    chatView.classList.add('hidden');
    loginView.classList.remove('hidden');
    loginError.textContent = message || '';
  }

  logoutBtn.addEventListener('click', async () => {
    if (!confirm('로그아웃하시겠어요?')) return;
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    resetToLoginView();
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    emojiPanel.classList.add('hidden');
    const text = chatInput.value.trim();
    if (!text) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pendingChatText = text;
      sendStatus.textContent = '🔌 서버에 연결하는 중입니다. 연결되면 자동으로 전송돼요...';
      sendStatus.classList.remove('hidden');
      return;
    }
    ws.send(JSON.stringify({ type: 'chat', content: text }));
    chatInput.value = '';
  });

  // 이미 로그인된 세션(쿠키)이 있으면 자동 입장
  fetch('/api/me')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data) enterChat(data.nickname, data.isAdmin);
    })
    .catch(() => {});
})();
