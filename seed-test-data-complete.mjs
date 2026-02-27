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
    console.log('🌱 完璧なテストデータのシーディングを開始します...');
    
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
    
    // 3. 分析スコアを作成
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
    
    // 4. 完璧な分析レポートを作成（AI insights付き）
    const positiveCount = testVideos.filter(v => v.sentiment === 'positive').length;
    const negativeCount = testVideos.filter(v => v.sentiment === 'negative').length;
    const neutralCount = testVideos.filter(v => v.sentiment === 'neutral').length;
    const totalViews = testVideos.reduce((sum, v) => sum + v.views, 0);
    const totalEngagement = testVideos.reduce((sum, v) => sum + v.likes + v.comments + v.shares + v.saves, 0);
    
    const positiveViews = testVideos.filter(v => v.sentiment === 'positive').reduce((sum, v) => sum + v.views, 0);
    const negativeViews = testVideos.filter(v => v.sentiment === 'negative').reduce((sum, v) => sum + v.views, 0);
    const positiveEngagement = testVideos.filter(v => v.sentiment === 'positive').reduce((sum, v) => sum + v.likes + v.comments + v.shares + v.saves, 0);
    const negativeEngagement = testVideos.filter(v => v.sentiment === 'negative').reduce((sum, v) => sum + v.likes + v.comments + v.shares + v.saves, 0);
    
    const keyInsights = [
      {
        category: 'positive',
        title: 'ポジティブ動画の高いエンゲージメント',
        description: 'ポジティブセンチメントの動画は平均エンゲージメント率が42.8%と、ネガティブ動画（8.5%）を大幅に上回っています。メイク関連コンテンツではポジティブな内容が視聴者の反応を引き出しやすい傾向が見られます。'
      },
      {
        category: 'positive',
        title: 'ハッシュタグ戦略の有効性',
        description: '#メイク、#美容、#コスメなどのハッシュタグが効果的に機能しており、特に#メイクアップは高いリーチを実現しています。これらのハッシュタグを継続的に活用することで、さらなるリーチ拡大が期待できます。'
      },
      {
        category: 'urgent',
        title: 'ネガティブコンテンツへの対応',
        description: 'ネガティブセンチメントの動画が全体の28.6%を占めており、これらの動画のエンゲージメント率が低いことが課題です。ネガティブなフィードバックを減らすため、コンテンツの品質向上やユーザーコメントへの対応を強化する必要があります。'
      },
      {
        category: 'risk',
        title: 'ニュートラルコンテンツの活用機会',
        description: 'ニュートラルセンチメントの動画（28.6%）は現在、ポジティブとネガティブの中間的な反応に留まっています。これらのコンテンツをより魅力的に改善することで、全体的なエンゲージメント向上の余地があります。'
      }
    ];
    
    const positiveWordsData = ['美しい', 'きれい', 'おすすめ', 'すごい', '素晴らしい', 'かわいい', '最高', '感動'];
    const negativeWordsData = ['つまらない', '退屈', '微妙', '失敗', 'うーん', 'いまいち', 'がっかり', '残念'];
    
    const facetsData = [
      { aspect: 'コンテンツの質', positive_percentage: 78, negative_percentage: 22 },
      { aspect: 'ビジュアル表現', positive_percentage: 85, negative_percentage: 15 },
      { aspect: 'ストーリー性', positive_percentage: 72, negative_percentage: 28 },
      { aspect: 'トレンド適合性', positive_percentage: 68, negative_percentage: 32 },
      { aspect: 'ユーザーエンゲージメント', positive_percentage: 81, negative_percentage: 19 }
    ];
    
    const [reportResult] = await connection.execute(
      'INSERT INTO analysis_reports (jobId, totalVideos, totalViews, totalEngagement, positiveCount, positivePercentage, negativeCount, negativePercentage, neutralCount, neutralPercentage, posNegPositiveCount, posNegPositivePercentage, posNegNegativeCount, posNegNegativePercentage, positiveViewsShare, negativeViewsShare, positiveEngagementShare, negativeEngagementShare, positiveWords, negativeWords, keyInsights, facets) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
        Math.round((negativeCount / (positiveCount + negativeCount)) * 100),
        Math.round((positiveViews / totalViews) * 100),
        Math.round((negativeViews / totalViews) * 100),
        Math.round((positiveEngagement / totalEngagement) * 100),
        Math.round((negativeEngagement / totalEngagement) * 100),
        JSON.stringify(positiveWordsData),
        JSON.stringify(negativeWordsData),
        JSON.stringify(keyInsights),
        JSON.stringify(facetsData)
      ]
    );
    console.log(`✅ 完璧な分析レポートを作成しました (Report ID: ${reportResult.insertId})`);
    
    // 5. Triple Search Results（重複分析）を作成
    const [tripleResult] = await connection.execute(
      'INSERT INTO triple_search_results (jobId, searchData, appearedInAll3Ids, appearedIn2Ids, appearedIn1OnlyIds, overlapRate, commonalityAnalysis) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        jobId,
        JSON.stringify([
          { sessionIndex: 1, totalFetched: 15, videoIds: videoIds.slice(0, 3).map(id => `video_${id}`) },
          { sessionIndex: 2, totalFetched: 15, videoIds: videoIds.slice(2, 5).map(id => `video_${id}`) },
          { sessionIndex: 3, totalFetched: 15, videoIds: videoIds.slice(4, 7).map(id => `video_${id}`) }
        ]),
        JSON.stringify(videoIds.slice(2, 4).map(id => `video_${id}`)),
        JSON.stringify(videoIds.slice(4, 6).map(id => `video_${id}`)),
        JSON.stringify(videoIds.slice(6, 7).map(id => `video_${id}`)),
        450,
        JSON.stringify({
          summary: 'メイク関連コンテンツの重複分析：3つのアカウント間で45%の重複率が確認されました。これは業界内で共通のトレンドやテーマが存在することを示しています。',
          keyHook: 'メイクアップのビフォーアフター表現、トレンドカラーの使用、プロのテクニック紹介',
          contentTrend: 'ナチュラルメイク、グラデーションメイク、韓国コスメの活用が主流。季節に応じたカラーパレットの変更が見られます。',
          formatFeatures: '動画尺は15-45秒が最適。テンポの良い編集、BGMの活用、テキストオーバーレイが効果的。',
          hashtagStrategy: '#メイク、#美容、#コスメ、#メイクアップ、#トレンドメイクが高いリーチを実現。地域別タグの活用も有効。',
          vseoTips: 'サムネイルに顔のアップを使用、目元を強調。タイトルに「簡単」「5分」などの時間表記を含める。コメント欄での質問への迅速な対応がエンゲージメント向上に繋がります。'
        })
      ]
    );
    console.log(`✅ 重複分析データを作成しました (Triple Search ID: ${tripleResult.insertId})`);
    
    console.log(`\n🎉 完璧なテストデータのシーディングが完了しました！`);
    console.log(`📊 分析ジョブID: ${jobId}`);
    console.log(`🎬 動画数: ${testVideos.length}`);
    console.log(`  - Positive: ${positiveCount}個 (${Math.round((positiveCount / testVideos.length) * 100)}%)`);
    console.log(`  - Negative: ${negativeCount}個 (${Math.round((negativeCount / testVideos.length) * 100)}%)`);
    console.log(`  - Neutral: ${neutralCount}個 (${Math.round((neutralCount / testVideos.length) * 100)}%)`);
    console.log(`📈 総再生数: ${totalViews.toLocaleString()}`);
    console.log(`💬 総エンゲージメント: ${totalEngagement.toLocaleString()}`);
    console.log(`🤖 AIインサイト: ${keyInsights.length}個`);
    console.log(`🔍 重複分析: 45%の重複率`);
    
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
