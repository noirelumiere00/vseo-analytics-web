// caseRoot.js — 案件ディレクトリの位置を1か所で決める。
//
// これを各ファイルで path.resolve(__dirname,'..','..') と書いていたため、
// --case で外部の案件を指定しても画像だけスキル本体側を見に行き、
// 全ページが [IMAGE NOT PROVIDED] になった。参照元が増えるほど直し漏れるので集約する。
const path = require('path');

function caseRoot() {
  const i = process.argv.indexOf('--case');
  const raw = i >= 0 ? process.argv[i + 1] : (process.env.DECK_CASE || null);
  // 既定はスキル本体の1つ上（従来どおり）。案件を外に置くときは --case を渡す
  return raw ? path.resolve(raw) : path.resolve(__dirname, '..', '..');
}

module.exports = { caseRoot };
