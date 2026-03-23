import React from "react";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Eye, Heart, TrendingUp, TrendingDown, Minus, Users, MessageCircle, Share2, Bookmark, Megaphone } from "lucide-react";
import { filterAdHashtags, isPromotionVideo } from "@shared/const";

export function VideoList({ videos, getSentimentBadge, getAppearanceBadge, formatNumber, getEngagementRate, rankInfo, metaKeywordsMap }: {
  videos: any[];
  getSentimentBadge: (sentiment: string | null) => React.ReactNode;
  getAppearanceBadge: (videoId: string) => React.ReactNode;
  formatNumber: (num: number | bigint | null | undefined) => string;
  getEngagementRate: (video: any) => number;
  rankInfo?: Record<string, { ranks: (number | null)[]; avgRank: number; dominanceScore: number }>;
  metaKeywordsMap?: Map<string, string[]>;
}) {
  if (videos.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        該当する動画がありません
      </div>
    );
  }

  return (
    <Accordion type="single" collapsible className="w-full">
      {videos.map((video) => (
        <AccordionItem key={video.id} value={`video-${video.id}`}>
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-4 w-full pr-4">
              <img
                src={video.thumbnailUrl || "https://placehold.co/120x80/8A2BE2/white?text=No+Image"}
                alt={video.title || "動画サムネイル"}
                className="w-32 h-20 object-cover rounded flex-shrink-0"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src =
                    "https://placehold.co/120x80/8A2BE2/white?text=No+Image";
                }}
              />
              <div className="flex-1 text-left min-w-0">
                <div className="font-medium line-clamp-1">
                  {video.title || "タイトルなし"}
                </div>
                <div className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {formatNumber(video.viewCount)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Heart className="h-3 w-3" />
                    {formatNumber(video.likeCount)}
                  </span>
                  <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                    <TrendingUp className="h-3 w-3" />
                    ER {getEngagementRate(video).toFixed(2)}%
                  </span>
                  {rankInfo?.[video.videoId] && (
                    <span className="text-xs text-purple-600 font-medium">
                      平均{rankInfo[video.videoId].avgRank.toFixed(1)}位
                    </span>
                  )}
                  <span className="text-xs">@{video.accountId}</span>
                  {getSentimentBadge(video.sentiment)}
                  {getAppearanceBadge(video.videoId)}
                  {(video.isAd || isPromotionVideo(video.hashtags || [])) && (
                    <Badge className="bg-orange-100 text-orange-800">
                      <Megaphone className="h-3 w-3 mr-1" />{video.isAd ? "広告" : "プロモーション"}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="pt-4 space-y-6">
              {/* 動画プレーヤー */}
              <div className="aspect-video bg-black rounded overflow-hidden">
                <iframe
                  src={`https://www.tiktok.com/embed/${video.videoId}`}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>

              {/* 基本情報 */}
              <div>
                <h4 className="font-semibold mb-2">基本情報</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">プラットフォーム:</span>{" "}
                    <span className="font-medium">TikTok</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">尺:</span>{" "}
                    <span className="font-medium">{video.duration}秒</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">投稿者:</span>{" "}
                    <span className="font-medium">{video.accountName}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">フォロワー数:</span>{" "}
                    <span className="font-medium flex items-center gap-1">
                      <Users className="h-4 w-4" />
                      {formatNumber(video.followerCount)}
                    </span>
                  </div>
                </div>
              </div>

              {/* エンゲージメント数値 */}
              <div>
                <h4 className="font-semibold mb-2">エンゲージメント数値</h4>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="flex items-center gap-2">
                    <Eye className="h-5 w-5 text-blue-500" />
                    <div>
                      <div className="text-xs text-muted-foreground">再生数</div>
                      <div className="font-semibold">{formatNumber(video.viewCount)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Heart className="h-5 w-5 text-red-500" />
                    <div>
                      <div className="text-xs text-muted-foreground">いいね</div>
                      <div className="font-semibold">{formatNumber(video.likeCount)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <MessageCircle className="h-5 w-5 text-green-500" />
                    <div>
                      <div className="text-xs text-muted-foreground">コメント</div>
                      <div className="font-semibold">{formatNumber(video.commentCount)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Share2 className="h-5 w-5 text-purple-500" />
                    <div>
                      <div className="text-xs text-muted-foreground">シェア</div>
                      <div className="font-semibold">{formatNumber(video.shareCount)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Bookmark className="h-5 w-5 text-orange-500" />
                    <div>
                      <div className="text-xs text-muted-foreground">保存</div>
                      <div className="font-semibold">{formatNumber(video.saveCount)}</div>
                    </div>
                  </div>
                </div>
                {/* エンゲージメント率サマリー */}
                <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                  <div className="p-2 bg-emerald-50 rounded text-center">
                    <div className="text-muted-foreground">エンゲージメント率</div>
                    <div className="font-bold text-emerald-700 text-sm">{getEngagementRate(video).toFixed(2)}%</div>
                  </div>
                  <div className="p-2 bg-red-50 rounded text-center">
                    <div className="text-muted-foreground">いいね率</div>
                    <div className="font-bold text-red-600 text-sm">
                      {video.viewCount ? ((video.likeCount || 0) / video.viewCount * 100).toFixed(2) : "0"}%
                    </div>
                  </div>
                  {rankInfo?.[video.videoId] && (
                    <div className="p-2 bg-purple-50 rounded text-center">
                      <div className="text-muted-foreground">平均検索順位</div>
                      <div className="font-bold text-purple-700 text-sm">{rankInfo[video.videoId].avgRank.toFixed(1)}位</div>
                      <div className="text-muted-foreground mt-0.5">
                        {rankInfo[video.videoId].ranks.map((r, i) => r != null ? `S${i + 1}:${r}位` : null).filter(Boolean).join(" / ")}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 分析結果 */}
              <div>
                <h4 className="font-semibold mb-2">分析結果</h4>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">センチメント:</span>{" "}
                    {getSentimentBadge(video.sentiment)}
                  </div>
                  {video.keyHook && (
                    <div>
                      <span className="text-muted-foreground">キーフック:</span>{" "}
                      <span className="font-medium">{video.keyHook}</span>
                    </div>
                  )}
                  {video.keywords && video.keywords.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">キーワード:</span>{" "}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {video.keywords.map((keyword: string, i: number) => (
                          <Badge key={i} variant="secondary">{keyword}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {(() => {
                    const mkw = metaKeywordsMap?.get(video.videoId);
                    return mkw && mkw.length > 0 ? (
                      <div>
                        <span className="text-muted-foreground">SEOキーワード:</span>{" "}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {mkw.map((kw: string, i: number) => (
                            <Badge key={i} className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200">{kw}</Badge>
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}
                  {video.hashtags && video.hashtags.length > 0 && (() => {
                    const filteredTags = filterAdHashtags(video.hashtags);
                    return filteredTags.length > 0 ? (
                      <div>
                        <span className="text-muted-foreground">ハッシュタグ:</span>{" "}
                        <div className="flex flex-wrap gap-1 mt-1">
                          {filteredTags.map((tag: string, i: number) => (
                            <Badge key={i} variant="outline">#{tag}</Badge>
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>

              {/* スコア */}
              {video.score && (
                <div>
                  <h4 className="font-semibold mb-2">スコア</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground">サムネイル</div>
                      <div className="text-2xl font-bold text-purple-600">{video.score.thumbnailScore}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">テキスト</div>
                      <div className="text-2xl font-bold text-blue-600">{video.score.textScore}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">音声</div>
                      <div className="text-2xl font-bold text-green-600">{video.score.audioScore}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">総合</div>
                      <div className="text-2xl font-bold text-orange-600">{video.score.overallScore}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
