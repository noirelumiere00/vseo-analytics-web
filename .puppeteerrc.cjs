const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // キャッシュディレクトリをプロジェクト内に設定
  // これにより、本番環境でもブラウザが確実に見つかる
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
