const ADJECTIVES = [
  '용감한', '신중한', '조용한', '유쾌한', '성실한', '날쌘', '느긋한', '현명한',
  '엉뚱한', '다정한', '씩씩한', '차분한', '엄청난', '수줍은', '든든한', '재빠른',
];

const NOUNS = [
  '판다', '여우', '고래', '부엉이', '수달', '너구리', '고양이', '호랑이',
  '펭귄', '다람쥐', '토끼', '고슴도치', '앵무새', '두더지', '물개', '사막여우',
];

function randomNickname() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  return `${adj}${noun}${num}`;
}

module.exports = { randomNickname };
