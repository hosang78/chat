const BANNED_WORDS = [
  '씨발', '시발', 'ㅅㅂ', 'ㅆㅂ', '병신', 'ㅂㅅ', '좆', '개새끼', '개새기',
  '미친놈', '미친년', '지랄', '썅', '닥쳐', '꺼져', '창녀', '걸레', 'fuck', 'shit',
];

const RESERVED_NICKNAMES = ['ict', 'admin', 'administrator', '관리자', '운영자', '매니저', 'manager'];

function normalize(text) {
  return text.toLowerCase().replace(/[\s.\-_!@#$%^&*()~`'".,]/g, '');
}

function containsBannedWord(text) {
  const normalized = normalize(text);
  return BANNED_WORDS.some((word) => normalized.includes(normalize(word)));
}

function isReservedNickname(nickname) {
  const normalized = normalize(nickname);
  return RESERVED_NICKNAMES.some((reserved) => normalized === normalize(reserved));
}

module.exports = { containsBannedWord, isReservedNickname, normalize };
