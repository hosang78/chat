const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const COOKIE_NAME = 'chat_session';

// 세션은 서버 메모리에만 존재. 서버 재시작 시 전부 사라지는 것을 의도함(최소 기록 원칙).
const sessions = new Map();

function createSession(role, nickname) {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { role, nickname, isAdmin: role === 'admin' });
  return sessionId;
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function updateNickname(sessionId, nickname) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (session.isAdmin) return false; // 관리자 닉네임은 고정
  session.nickname = nickname;
  return true;
}

function sign(sessionId) {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(sessionId).digest('hex');
  return `${sessionId}.${sig}`;
}

function verify(cookieValue) {
  if (!cookieValue) return null;
  const dotIndex = cookieValue.lastIndexOf('.');
  if (dotIndex === -1) return null;
  const sessionId = cookieValue.slice(0, dotIndex);
  const sig = cookieValue.slice(dotIndex + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(sessionId).digest('hex');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  return sessionId;
}

module.exports = { COOKIE_NAME, createSession, getSession, updateNickname, sign, verify };
