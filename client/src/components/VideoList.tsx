import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye, Heart, TrendingUp, TrendingDown, Minus, Users, MessageCircle, Share2, Bookmark, Megaphone, Clock } from "lucide-react";
import { filterAdHashtags, isPromotionVideo } from "@shared/const";

const THUMB_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='320' fill='%23e5e7eb'%3E%3Crect width='180' height='320' rx='4'/%3E%3Ctext x='90' y='165' text-anchor='middle' font-size='12' fill='%239ca3af'%3ENo Image%3C/text%3E%3C/svg%3E";

export function VideoList({ videos, getSentimentBadge, getAppearanceBadge, formatNumber, getEngagementRate, rankInfo, metaKeywordsMap }: {
  videos: any[];
  getSentimentBadge: (sentiment: string | null) => React.ReactNode;
  getAppearanceBadge: (videoId: string) => React.ReactNode;
  formatNumber: (num: number | bigint | null | undefined) => string;
  getEngagementRate: (video: any) => number;
  rankInfo?: Record<string, { ranks: (number | null)[]; avgRank: number; dominanceScore: number }>;
  metaKeywordsMap?: Map<string, string[]>;
}) {
  const [selectedVideo, setSelectedVideo] = useState<any | null>(null);

  if (videos.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        該当する動画がありません
      </div>
    );
  }

  return (
    <>
      {/* Card Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {videos.map((video, idx) => {
          const er = getEngagementRate(video);
          const isPromo = video.isAd || isPromotionVideo(video.hashtags || []);
          const sentimentColor =
            video.sentiment === "positive" ? "bg-green-500" :
            video.sentiment === "negative" ? "bg-red-500" :
            "bg-gray-400";

          return (
            <button
              key={video.id}
              onClick={() => setSelectedVideo(video)}
              className="group relative rounded-sm border bg-card overflow-hidden text-left transition-all hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* Thumbnail */}
              <div className="relative aspect-[9/16] bg-muted overflow-hidden">
                <img
                  src={video.thumbnailUrl || THUMB_PLACEHOLDER}
                  alt={video.title || "動画サムネイル"}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = THUMB_PLACEHOLDER;
                  }}
                />

                {/* Rank badge */}
                <span className="absolute top-1.5 left-1.5 bg-black/60 text-white text-[10px] font-bold font-data px-1.5 py-0.5 rounded-sm leading-none">
                  #{idx + 1}
                </span>

                {/* Sentiment dot */}
                <span className={`absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full border border-white/50 ${sentimentColor}`} />

                {/* Duration */}
                {video.duration && (
                  <span className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[10px] font-data px-1.5 py-0.5 rounded-sm leading-none flex items-center gap-0.5">
                    <Clock className="h-2.5 w-2.5" />
                    {video.duration}秒
                  </span>
                )}

                {/* Promo badge */}
                {isPromo && (
                  <span className="absolute bottom-1.5 left-1.5 bg-orange-500/90 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded-sm leading-none flex items-center gap-0.5">
                    <Megaphone className="h-2.5 w-2.5" />AD
                  </span>
                )}
              </div>

              {/* Meta */}
              <div className="px-2 py-2 space-y-1">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground font-data">
                  <span className="flex items-center gap-0.5">
                    <Eye className="h-3 w-3" />
                    {formatNumber(video.viewCount)}
                  </span>
                  <span className="text-emerald-600 font-semibold">
                    ER {er.toFixed(1)}%
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">@{video.accountId}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedVideo} onOpenChange={(open) => !open && setSelectedVideo(null)}>
        {selectedVideo && (
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-base line-clamp-2 leading-snug">
                {selectedVideo.title || "タイトルなし"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-5 pt-2">
              {/* TikTok Player */}
              <div className="aspect-video bg-black rounded-sm overflow-hidden">
                <iframe
                  src={`https://www.tiktok.com/embed/${selectedVideo.videoId}`}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>

              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">投稿者:</span>{" "}
                  <span className="font-medium">@{selectedVideo.accountId}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">尺:</span>{" "}
                  <span className="font-medium font-data">{selectedVideo.duration}秒</span>
                </div>
                <div>
                  <span className="text-muted-foreground">フォロワー:</span>{" "}
                  <span className="font-medium font-data flex items-center gap-1 inline-flex">
                    <Users className="h-3.5 w-3.5" />
                    {formatNumber(selectedVideo.followerCount)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">センチメント:</span>{" "}
                  {getSentimentBadge(selectedVideo.sentiment)}
                </div>
              </div>

              {/* Engagement Grid */}
              <div className="grid grid-cols-5 gap-2">
                {[
                  { Icon: Eye, label: "再生数", value: selectedVideo.viewCount, cls: "text-blue-500" },
                  { Icon: Heart, label: "いいね", value: selectedVideo.likeCount, cls: "text-red-500" },
                  { Icon: MessageCircle, label: "コメント", value: selectedVideo.commentCount, cls: "text-green-500" },
                  { Icon: Share2, label: "シェア", value: selectedVideo.shareCount, cls: "text-purple-500" },
                  { Icon: Bookmark, label: "保存", value: selectedVideo.saveCount, cls: "text-orange-500" },
                ].map(({ Icon, label, value, cls }) => (
                  <div key={label} className="text-center p-2 bg-secondary/30 rounded-sm">
                    <Icon className={`h-4 w-4 mx-auto ${cls}`} />
                    <div className="font-semibold font-data text-sm mt-1">{formatNumber(value)}</div>
                    <div className="text-[10px] text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>

              {/* ER Summary */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="p-2 bg-emerald-50 dark:bg-emerald-950/20 rounded-sm text-center">
                  <div className="text-muted-foreground">ER</div>
                  <div className="font-bold text-emerald-700 dark:text-emerald-400 text-sm font-data">
                    {getEngagementRate(selectedVideo).toFixed(2)}%
                  </div>
                </div>
                <div className="p-2 bg-red-50 dark:bg-red-950/20 rounded-sm text-center">
                  <div className="text-muted-foreground">いいね率</div>
                  <div className="font-bold text-red-600 dark:text-red-400 text-sm font-data">
                    {selectedVideo.viewCount ? ((selectedVideo.likeCount || 0) / selectedVideo.viewCount * 100).toFixed(2) : "0"}%
                  </div>
                </div>
                {rankInfo?.[selectedVideo.videoId] && (
                  <div className="p-2 bg-purple-50 dark:bg-purple-950/20 rounded-sm text-center">
                    <div className="text-muted-foreground">平均順位</div>
                    <div className="font-bold text-purple-700 dark:text-purple-400 text-sm font-data">
                      {rankInfo[selectedVideo.videoId].avgRank.toFixed(1)}位
                    </div>
                  </div>
                )}
              </div>

              {/* Keywords & Hashtags */}
              {selectedVideo.keyHook && (
                <div className="text-sm">
                  <span className="text-muted-foreground">キーフック:</span>{" "}
                  <span className="font-medium">{selectedVideo.keyHook}</span>
                </div>
              )}

              {selectedVideo.keywords && selectedVideo.keywords.length > 0 && (
                <div>
                  <span className="text-sm text-muted-foreground">キーワード:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedVideo.keywords.map((kw: string, i: number) => (
                      <Badge key={i} variant="secondary" className="text-xs">{kw}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {(() => {
                const mkw = metaKeywordsMap?.get(selectedVideo.videoId);
                return mkw && mkw.length > 0 ? (
                  <div>
                    <span className="text-sm text-muted-foreground">SEOキーワード:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {mkw.map((kw: string, i: number) => (
                        <Badge key={i} className="text-xs bg-emerald-100 text-emerald-800 hover:bg-emerald-200">{kw}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}

              {selectedVideo.hashtags && selectedVideo.hashtags.length > 0 && (() => {
                const filteredTags = filterAdHashtags(selectedVideo.hashtags);
                return filteredTags.length > 0 ? (
                  <div>
                    <span className="text-sm text-muted-foreground">ハッシュタグ:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {filteredTags.map((tag: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs">#{tag}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}

              {/* Scores */}
              {selectedVideo.score && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">スコア</h4>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: "サムネイル", val: selectedVideo.score.thumbnailScore, cls: "text-purple-600" },
                      { label: "テキスト", val: selectedVideo.score.textScore, cls: "text-blue-600" },
                      { label: "音声", val: selectedVideo.score.audioScore, cls: "text-green-600" },
                      { label: "総合", val: selectedVideo.score.overallScore, cls: "text-orange-600" },
                    ].map(({ label, val, cls }) => (
                      <div key={label} className="text-center">
                        <div className="text-[10px] text-muted-foreground">{label}</div>
                        <div className={`text-xl font-bold font-data ${cls}`}>{val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
