const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('스키마 적용 완료');
  await pool.end();
}

migrate().catch((err) => {
  console.error('스키마 적용 실패:', err);
  process.exit(1);
});
