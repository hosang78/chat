require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cookie = require('cookie');
const { WebSocketServer } = require('ws');

const { pool } = require('./db');
const session = require('./session');
const { containsBannedWord, isReservedNickname } = require('./filter');
const { randomNickname } = require('./nicknames');
const { startEmailNotifier } = require('./notifier');

const USER_PASSWORD = process.env.USER_PASSWORD || 'shpoc!';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'suhyup!';
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function readSessionId(req) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const raw = cookies[session.COOKIE_NAME];
  return raw ? session.verify(raw) : null;
}

function requireSession(req, res, next) {
  const sessionId = readSessionId(req);
  const current = sessionId ? session.getSession(sessionId) : null;
  if (!current) {
    return res.status(401).json({ error: '입장이 필요합니다.' });
  }
  req.sessionId = sessionId;
  req.currentSession = current;
  next();
}

function wrapAsync(handler) {
  return (req, res, next) => handler(req, res, next).catch(next);
}

// --- 입장 ---
app.post(
  '/api/login',
  wrapAsync(async (req, res) => {
    const { password } = req.body || {};
    let role = null;
    if (password === ADMIN_PASSWORD) role = 'admin';
    else if (password === USER_PASSWORD) role = 'user';

    if (!role) {
      return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
    }

    const nickname = role === 'admin' ? 'ict' : randomNickname();
    const sessionId = session.createSession(role, nickname);

    await pool.query(
      'INSERT INTO access_log (session_id, nickname, is_admin, entered_at) VALUES ($1, $2, $3, now())',
      [sessionId, nickname, role === 'admin']
    );

    res.setHeader(
      'Set-Cookie',
      cookie.serialize(session.COOKIE_NAME, session.sign(sessionId), {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 12, // 12시간
      })
    );

    res.json({ nickname, isAdmin: role === 'admin' });
  })
);

app.get('/api/me', requireSession, (req, res) => {
  res.json({ nickname: req.currentSession.nickname, isAdmin: req.currentSession.isAdmin });
});

app.post('/api/logout', requireSession, (req, res) => {
  session.destroySession(req.sessionId);
  for (const [ws, client] of clients) {
    if (client.sessionId === req.sessionId) ws.close(4002, '로그아웃');
  }
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(session.COOKIE_NAME, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  );
  res.json({ ok: true });
});

// --- 닉네임 변경 (관리자 제외) ---
app.post('/api/nickname', requireSession, (req, res) => {
  if (req.currentSession.isAdmin) {
    return res.status(403).json({ error: '관리자 닉네임은 변경할 수 없습니다.' });
  }
  const nickname = (req.body?.nickname || '').trim();
  if (nickname.length < 1 || nickname.length > 20) {
    return res.status(400).json({ error: '닉네임은 1~20자로 입력해주세요.' });
  }
  if (isReservedNickname(nickname) || containsBannedWord(nickname)) {
    return res.status(400).json({ error: '사용할 수 없는 닉네임입니다.' });
  }
  session.updateNickname(req.sessionId, nickname);
  res.json({ nickname });
});

// --- 메시지 목록 조회 ---
app.get(
  '/api/messages',
  requireSession,
  wrapAsync(async (_req, res) => {
    const messagesResult = await pool.query(`
      SELECT m.id, m.nickname, m.is_admin,
             CASE WHEN m.deleted_at IS NULL THEN m.content ELSE NULL END AS content,
             m.created_at, m.deleted_at,
             COALESCE(SUM(CASE WHEN r.reaction_type = 'like' THEN 1 ELSE 0 END), 0)::int AS likes,
             COALESCE(SUM(CASE WHEN r.reaction_type = 'dislike' THEN 1 ELSE 0 END), 0)::int AS dislikes
      FROM messages m
      LEFT JOIN reactions r ON r.message_id = m.id
      WHERE m.hidden = false
      GROUP BY m.id
      ORDER BY m.created_at ASC
      LIMIT 300
    `);

    const messageIds = messagesResult.rows.map((m) => m.id);
    const repliesResult = messageIds.length
      ? await pool.query(
          `SELECT id, message_id, nickname, is_admin,
                  CASE WHEN deleted_at IS NULL THEN content ELSE NULL END AS content,
                  created_at, deleted_at
           FROM replies
           WHERE message_id = ANY($1) AND hidden = false
           ORDER BY created_at ASC`,
          [messageIds]
        )
      : { rows: [] };

    const repliesByMessage = new Map();
    for (const reply of repliesResult.rows) {
      if (!repliesByMessage.has(reply.message_id)) repliesByMessage.set(reply.message_id, []);
      repliesByMessage.get(reply.message_id).push(reply);
    }

    const messages = messagesResult.rows.map((m) => ({
      ...m,
      replies: repliesByMessage.get(m.id) || [],
    }));

    res.json({ messages });
  })
);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ws -> { sessionId, nickname, isAdmin }
const clients = new Map();
// 간단한 도배 방지: 세션당 마지막 전송 시각
const lastSentAt = new Map();
const MIN_INTERVAL_MS = 400;
// 세션ID -> 그 세션이 읽은 마지막 메시지 id (현재 접속 중인 세션 기준으로만 집계됨)
const sessionLastRead = new Map();

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(data);
  }
}

function broadcastPresence() {
  const uniqueSessions = new Set([...clients.values()].map((c) => c.sessionId));
  broadcast({ type: 'presence', count: uniqueSessions.size });
}

function markSessionRead(sessionId, messageId) {
  const prev = sessionLastRead.get(sessionId) || 0;
  if (messageId > prev) sessionLastRead.set(sessionId, messageId);
}

async function broadcastUnreadCounts() {
  const connectedSessionIds = [...new Set([...clients.values()].map((c) => c.sessionId))];
  const result = await pool.query(
    `SELECT id FROM messages WHERE hidden = false AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 300`
  );
  const counts = {};
  for (const row of result.rows) {
    let unread = 0;
    for (const sessionId of connectedSessionIds) {
      if ((sessionLastRead.get(sessionId) || 0) < row.id) unread++;
    }
    counts[row.id] = unread;
  }
  broadcast({ type: 'unread-update', counts });
}

function rateLimited(sessionId) {
  const now = Date.now();
  const last = lastSentAt.get(sessionId) || 0;
  if (now - last < MIN_INTERVAL_MS) return true;
  lastSentAt.set(sessionId, now);
  return false;
}

wss.on('connection', (ws, req) => {
  const sessionId = readSessionId(req);
  const current = sessionId ? session.getSession(sessionId) : null;
  if (!current) {
    ws.close(4001, '입장이 필요합니다.');
    return;
  }
  clients.set(ws, { sessionId, ...current });
  broadcastPresence();
  broadcastUnreadCounts().catch((err) => console.error('안읽음 집계 실패:', err));

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const client = clients.get(ws);
    if (!client) return;
    // 닉네임은 세션 기준 최신값으로 항상 다시 조회 (변경 반영)
    const liveSession = session.getSession(client.sessionId);
    if (!liveSession) return;

    try {
      await handleClientMessage(ws, client, liveSession, msg);
    } catch (err) {
      console.error('ws message 처리 실패:', err);
      ws.send(JSON.stringify({ type: 'error', error: '요청 처리 중 오류가 발생했습니다.' }));
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcastPresence();
    broadcastUnreadCounts().catch((err) => console.error('안읽음 집계 실패:', err));
  });
});

async function handleClientMessage(ws, client, liveSession, msg) {
  if (msg.type === 'chat') {
    const content = String(msg.content || '').trim();
    if (!content || content.length > 1000) return;
    if (rateLimited(client.sessionId)) return;
    if (containsBannedWord(content)) {
      ws.send(JSON.stringify({ type: 'error', error: '부적절한 표현이 포함되어 있어 전송할 수 없습니다.' }));
      return;
    }
    const result = await pool.query(
      `INSERT INTO messages (session_id, nickname, is_admin, content)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nickname, is_admin, content, created_at, deleted_at`,
      [client.sessionId, liveSession.nickname, liveSession.isAdmin, content]
    );
    broadcast({ type: 'chat', message: { ...result.rows[0], likes: 0, dislikes: 0, replies: [] } });
    markSessionRead(client.sessionId, result.rows[0].id);
    await broadcastUnreadCounts();
    return;
  }

  if (msg.type === 'read') {
    const lastMessageId = Number(msg.lastMessageId);
    if (!lastMessageId) return;
    markSessionRead(client.sessionId, lastMessageId);
    await broadcastUnreadCounts();
    return;
  }

  if (msg.type === 'reply') {
    const messageId = Number(msg.messageId);
    const content = String(msg.content || '').trim();
    if (!messageId || !content || content.length > 500) return;
    if (rateLimited(client.sessionId)) return;
    if (containsBannedWord(content)) {
      ws.send(JSON.stringify({ type: 'error', error: '부적절한 표현이 포함되어 있어 전송할 수 없습니다.' }));
      return;
    }
    const result = await pool.query(
      `INSERT INTO replies (message_id, session_id, nickname, is_admin, content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, message_id, nickname, is_admin, content, created_at, deleted_at`,
      [messageId, client.sessionId, liveSession.nickname, liveSession.isAdmin, content]
    );
    broadcast({ type: 'reply', reply: result.rows[0] });
    return;
  }

  if (msg.type === 'reaction') {
    const messageId = Number(msg.messageId);
    const reactionType = msg.reactionType;
    if (!messageId || !['like', 'dislike'].includes(reactionType)) return;

    const existing = await pool.query(
      'SELECT reaction_type FROM reactions WHERE message_id = $1 AND session_id = $2',
      [messageId, client.sessionId]
    );
    if (existing.rows.length && existing.rows[0].reaction_type === reactionType) {
      await pool.query('DELETE FROM reactions WHERE message_id = $1 AND session_id = $2', [
        messageId,
        client.sessionId,
      ]);
    } else {
      await pool.query(
        `INSERT INTO reactions (message_id, session_id, reaction_type) VALUES ($1, $2, $3)
         ON CONFLICT (message_id, session_id) DO UPDATE SET reaction_type = EXCLUDED.reaction_type`,
        [messageId, client.sessionId, reactionType]
      );
    }
    const counts = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN reaction_type = 'like' THEN 1 ELSE 0 END), 0)::int AS likes,
         COALESCE(SUM(CASE WHEN reaction_type = 'dislike' THEN 1 ELSE 0 END), 0)::int AS dislikes
       FROM reactions WHERE message_id = $1`,
      [messageId]
    );
    broadcast({ type: 'reaction', messageId, ...counts.rows[0] });
    return;
  }

  if (msg.type === 'delete') {
    if (!liveSession.isAdmin) return;
    const target = msg.target === 'reply' ? 'replies' : 'messages';
    const id = Number(msg.id);
    if (!id) return;
    const hide = Boolean(msg.hidden);
    await pool.query(
      `UPDATE ${target} SET deleted_at = now(), deleted_by = $2, hidden = $3 WHERE id = $1`,
      [id, liveSession.nickname, hide]
    );
    broadcast({ type: 'delete', target: msg.target === 'reply' ? 'reply' : 'message', id, hidden: hide });
    return;
  }
}

server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});

startEmailNotifier(pool);
