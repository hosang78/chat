-- 블라인드 채팅방 POC 스키마
-- 설계 원칙: 대화 내용 + 최소한의 접속 기록(접속 시각, 세션ID) 외에는 남기지 않음.

CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL,
  nickname    TEXT NOT NULL,
  is_admin    BOOLEAN NOT NULL DEFAULT false,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  deleted_by  TEXT
);

CREATE TABLE IF NOT EXISTS replies (
  id          SERIAL PRIMARY KEY,
  message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL,
  nickname    TEXT NOT NULL,
  is_admin    BOOLEAN NOT NULL DEFAULT false,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,
  deleted_by  TEXT
);

CREATE TABLE IF NOT EXISTS reactions (
  id             SERIAL PRIMARY KEY,
  message_id     INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  session_id     TEXT NOT NULL,
  reaction_type  TEXT NOT NULL CHECK (reaction_type IN ('like', 'dislike')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, session_id)
);

-- 최소 접속 기록: 접속 시각 + 세션ID만. 개인 식별 정보 없음.
CREATE TABLE IF NOT EXISTS access_log (
  id          SERIAL PRIMARY KEY,
  session_id  TEXT NOT NULL,
  nickname    TEXT,
  is_admin    BOOLEAN NOT NULL DEFAULT false,
  entered_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at);
CREATE INDEX IF NOT EXISTS idx_replies_message_id ON replies (message_id);
CREATE INDEX IF NOT EXISTS idx_reactions_message_id ON reactions (message_id);
