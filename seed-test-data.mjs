import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DATABASE_URL?.split('@')[1]?.split(':')[0] || 'localhost',
  user: process.env.DATABASE_URL?.split('://')[1]?.split(':')[0] || 'root',
  password: process.env.DATABASE_URL?.split(':')[2]?.split('@')[0] || '',
  database: process.env.DATABASE_URL?.split('/')[3]?.split('?')[0] || 'vseo',
  ssl: { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function seedTestData() {
  const connection = await pool.getConnection();
  
  try {
    console.log('🌱 テストデータのシーディングを開始します...');
    
    const userId = 1;
    
    // 1. 分析ジョブを作成
    const [jobResult] = await connection.execute(
      'INSERT INTO analysis_jobs (userId, keyword, status, createdAt, completedAt) VALUES (?, ?, ?, NOW(), NOW())',
      [userId, 'メイク', 'completed']
    );
    const jobId = jobResult.insertId;
    console.log(`✅ 分析ジョブを作成しました (Job ID: ${jobId})`);
    
    // 2. テスト用動画データを作成
    const testVideos = [
      { platform: 'tiktok', url: 'https://www.tiktok.com/@makeup_artist/video/1234567890', sentiment: 'positive', views: 150000, likes: 12000, comments: 3500, shares: 2100, saves: 4200 },
      { platform: 'tiktok', url: 'https://www.tiktok.com/@makeup_artist/video/1234567891', sentiment: 'positive', views: 125000, likes: 10500, comments: 2800, shares: 1800, saves: 3600 },
      { platform: 'tiktok', url: 'https://www.tiktok.com/@makeup_artist/video/1234567892', sentiment: 'positive', views: 180000, likes: 14200, comments: 4100, shares: 2500, saves: 5000 },
      { platform: 'tiktok', url: 'https://www.tiktok.com/@makeup_artist/video/1234567893', sentiment: 'negative', views: 45000, likes: 1800, comments: 800, shares: 300, saves: 500 },
      { platform: 'tiktok', url: 'https://www.tiktok.com/@makeup_artist/video/1234567894', sentiment: 'negative', views: 38000, likes: 1200, comments: 600, shares: 200, saves: 400 },
      { platform: 'tiktok', url: 'https://www.tiktok.com/@makeup_artist/video/1234567895', sentiment: 'neutral', views: 95000, likes: 4500, comments: 1500, shares: 800, saves: 1800 },
      { platform: 'tiktok', url: 'https://www.tiktok.com/@makeup_artist/video/1234567896', sentiment: 'neutral', views: 78000, likes: 3200, comments: 1200, shares: 600, saves: 1400 },
    ];
    
    const videoIds = [];
    for (const video of testVideos) {
      const videoId = `video_${jobId}_${Math.random().toString(36).substr(2, 9)}`;
      const [videoResult] = await connection.execute(
        'INSERT INTO videos (jobId, platform, videoUrl, videoId, title, description, sentiment, viewCount, likeCount, commentCount, shareCount, saveCount, hashtags, duration, thumbnailUrl, accountName, accountId, followerCount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          jobId,
          video.platform,
          video.url,
          videoId,
          'テスト動画タイトル',
          'テスト用動画説明',
          video.sentiment,
          video.views,
          video.likes,
          video.comments,
          video.shares,
          video.saves,
          JSON.stringify(['#メイク', '#美容', '#メイクアップ', '#コスメ']),
          Math.floor(Math.random() * 30) + 15,
          'https://example.com/thumbnail.jpg',
          'テストクリエイター',
          `creator_${Math.random().toString(36).substr(2, 9)}`,
          Math.floor(Math.random() * 100000) + 10000
        ]
      );
      videoIds.push(videoResult.insertId);
    }
    console.log(`✅ ${testVideos.length}個のテスト動画を作成しました`);
    
    // 3. 分析スコアを作成（正しいスキーマに合わせる）
    for (let i = 0; i < videoIds.length; i++) {
      await connection.execute(
        'INSERT INTO analysis_scores (videoId, thumbnailScore, textScore, audioScore, durationScore, overallScore) VALUES (?, ?, ?, ?, ?, ?)',
        [
          videoIds[i],
          Math.floor(Math.random() * 100),
          Math.floor(Math.random() * 100),
          Math.floor(Math.random() * 100),
          Math.floor(Math.random() * 100),
          Math.floor(Math.random() * 100)
        ]
      );
    }
    console.log(`✅ ${videoIds.length}個の分析スコアを作成しました`);
    
    // 4. 分析レポートを作成
    const positiveCount = testVideos.filter(v => v.sentiment === 'positive').length;
    const negativeCount = testVideos.filter(v => v.sentiment === 'negative').length;
    const neutralCount = testVideos.filter(v => v.sentiment === 'neutral').length;
    const totalViews = testVideos.reduce((sum, v) => sum + v.views, 0);
    const totalEngagement = testVideos.reduce((sum, v) => sum + v.likes + v.comments + v.shares + v.saves, 0);
    
    const [reportResult] = await connection.execute(
      'INSERT INTO analysis_reports (jobId, totalVideos, totalViews, totalEngagement, positiveCount, positivePercentage, negativeCount, negativePercentage, neutralCount, neutralPercentage, posNegPositiveCount, posNegPositivePercentage, posNegNegativeCount, posNegNegativePercentage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        jobId,
        testVideos.length,
        totalViews,
        totalEngagement,
        positiveCount,
        Math.round((positiveCount / testVideos.length) * 100),
        negativeCount,
        Math.round((negativeCount / testVideos.length) * 100),
        neutralCount,
        Math.round((neutralCount / testVideos.length) * 100),
        positiveCount,
        Math.round((positiveCount / (positiveCount + negativeCount)) * 100),
        negativeCount,
        Math.round((negativeCount / (positiveCount + negativeCount)) * 100)
      ]
    );
    console.log(`✅ 分析レポートを作成しました (Report ID: ${reportResult.insertId})`);
    
    console.log(`\n🎉 テストデータのシーディングが完了しました！`);
    console.log(`📊 分析ジョブID: ${jobId}`);
    console.log(`🎬 動画数: ${testVideos.length}`);
    console.log(`  - Positive: ${positiveCount}個`);
    console.log(`  - Negative: ${negativeCount}個`);
    console.log(`  - Neutral: ${neutralCount}個`);
    
  } catch (error) {
    console.error('❌ エラーが発生しました:', error.message);
    throw error;
  } finally {
    await connection.release();
    await pool.end();
  }
}

seedTestData()
  .then(() => {
    console.log('✅ プロセス終了');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ シーディング失敗:', err.message);
    process.exit(1);
  });
