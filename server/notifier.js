const nodemailer = require('nodemailer');

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1시간
const PREVIEW_LIMIT = 20;
const PREVIEW_CONTENT_MAX_LENGTH = 80;

function buildTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function startEmailNotifier(pool) {
  const transporter = buildTransporter();
  const to = process.env.NOTIFY_EMAIL_TO;
  const from = process.env.NOTIFY_EMAIL_FROM || process.env.SMTP_USER;

  if (!transporter || !to) {
    console.log('이메일 알림 비활성화: SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/NOTIFY_EMAIL_TO 환경변수를 확인하세요.');
    return;
  }

  let lastCheckedAt = new Date();

  async function checkAndNotify() {
    const checkedAt = new Date();
    try {
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM messages
         WHERE created_at > $1 AND hidden = false AND deleted_at IS NULL`,
        [lastCheckedAt]
      );
      const count = countResult.rows[0].count;

      if (count > 0) {
        const previewResult = await pool.query(
          `SELECT nickname, content, created_at
           FROM messages
           WHERE created_at > $1 AND hidden = false AND deleted_at IS NULL
           ORDER BY created_at ASC
           LIMIT $2`,
          [lastCheckedAt, PREVIEW_LIMIT]
        );
        const lines = previewResult.rows.map((row) => {
          const content =
            row.content.length > PREVIEW_CONTENT_MAX_LENGTH
              ? `${row.content.slice(0, PREVIEW_CONTENT_MAX_LENGTH)}...`
              : row.content;
          return `[${row.nickname}] ${content}`;
        });
        const more = count > PREVIEW_LIMIT ? `\n...외 ${count - PREVIEW_LIMIT}건 더 있음` : '';

        await transporter.sendMail({
          from,
          to,
          subject: `블라인드 채팅방 새 메시지 ${count}건`,
          text: `지난 1시간 동안 새 메시지 ${count}건이 등록되었습니다.\n\n${lines.join('\n')}${more}`,
        });
      }

      lastCheckedAt = checkedAt;
    } catch (err) {
      console.error('새 메시지 이메일 알림 처리 실패:', err);
    }
  }

  setInterval(checkAndNotify, CHECK_INTERVAL_MS);
  console.log('이메일 알림 활성화: 1시간마다 새 메시지를 확인합니다.');
}

module.exports = { startEmailNotifier };
