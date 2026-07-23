const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// idle 커넥션이 원격(Neon)에서 끊길 때 발생하는 에러로 프로세스 전체가 죽는 것을 방지
pool.on('error', (err) => {
  console.error('예기치 않은 DB 커넥션 에러:', err);
});

module.exports = { pool };
