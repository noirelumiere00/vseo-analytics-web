#!/usr/bin/env python3
"""fetch_covers.py — 資料に載せる投稿カバー画像を assets/covers/<video_id>.jpg に揃える

なぜ要るか:
  初訪資料は「実画像＋ワンフレーズ」で見せる（2026-09 上長FB）。ところが
  build_input_md.py が参照する assets/…/top01.jpg 等を作る工程がどこにも無く、
  実案件でも画像欄が [IMAGE NOT PROVIDED] のまま並んでいた。
  さらに順位名（top01.jpg）で保存すると、順位の決め方が変わった瞬間に
  別人の投稿へ画像が付け替わる（verify_assets.py 冒頭の事故）。
  そこで画像は **動画ID名** で保存する。ファイル名が投稿そのものを指すので取り違えが起きない。

取得の順番（上から試し、最初に取れたものを使う）:
  1. 取得JSON の coverUrl    署名付きURL（x-expires）。期限が過ぎていれば試さない
  2. TikTok oEmbed           https://www.tiktok.com/oembed?url=<投稿URL> の thumbnail_url
                             （公開の埋め込み用API。ログイン不要。応答の動画IDが一致するときだけ採用。
                              1秒間隔で逐次。429 が返ったらそこで止める。CAPTCHA回避や偽装はしない）
  3. 取得済みの写真投稿      <media>/<id>_photos/01.jpg（tiktok-acquire --mode fetch の出力）
  4. 取得済みの動画のコマ    <media>/<id>.mp4 の 0.5 秒目。検索画面のカバーとは別物なので
                             manifest に via=frame と残し、「検索するとこう見える」のページには使わない
  検証: 短辺240px未満・ほぼ単色（白や黒のカード。輝度の標準偏差<22）は却下（Pillow がある場合）。
  どれも取れなければ **作らない**（生成画像・プレースホルダで埋めない）。
  取れなかった投稿は manifest.json に理由付きで残し、資料の例示には使われない。
  既にある画像は上書きしない（--refresh のときだけ）。同じ投稿の画像がページ間・版間で変わらないように。
  --refresh でも、取り直した画像が検証を通ったときだけ置き換える（劣化した応答で判定済みのカバーを消さない）。
  manifest.json は1本ごとに保存する（途中で落ちても、それまでの取得経路と sha256 が残る）。
  ネット取得が3回続けて失敗したら、以降はネットを使わない（無応答の回線で1本30秒ずつ黙って待たない）。

使い方:
  python3 tools/fetch_covers.py --case <案件ディレクトリ>                 # labels.json の投稿（無ければ各軸の上位）
  python3 tools/fetch_covers.py --case . --media-dir <run-dir>/media     # 取得済み媒体を優先して使う
  python3 tools/fetch_covers.py --case . --top 30 --no-network           # ネットに出ない（3〜4だけ）

依存: 標準ライブラリ＋ffmpeg（ffmpeg が無い場合は JPEG/PNG をそのまま置くだけで、動画からは抜けない）
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import http.client
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fvlib import pr_basis, safe_vid  # noqa: E402

UA = "Mozilla/5.0 (compatible; tiktok-deck/cover-fetch)"
MAX_H = 960        # 資料に貼るには十分。原寸のまま入れると PPTX が数十MBになる


def load_json(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def axis_posts(case_dir: str, cfg: dict, top: int) -> list[dict]:
    """case.json の各軸の表示順上位 top 本。競合の PR 投稿は順位に関係なく入れる
    （label_posts.py --init の候補と同じ範囲にしておかないと、ラベルは付くのにカバーが無い投稿が出る）"""
    out = []
    for key in ("keywords", "brands"):
        for ax in cfg.get(key) or []:
            if not ax.get("file"):
                continue
            p = os.path.join(case_dir, ax["file"])
            if not os.path.exists(p):
                print(f"  ! 取得JSONがありません（この軸は飛ばします）: {ax['file']}")
                continue
            d = load_json(p)
            vs = (d.get("videos") if isinstance(d, dict) else d) or []
            out += vs[:top]
            if key == "brands" and not ax.get("own"):
                out += [v for v in vs[top:] if pr_basis(v)]
    return out


def label_posts(case_dir: str) -> list[dict] | None:
    p = os.path.join(case_dir, "labels.json")
    if not os.path.exists(p):
        return None
    d = load_json(p)
    return d.get("posts") if isinstance(d, dict) else d


def raw_index(case_dir: str, cfg: dict) -> dict:
    """video_id → 取得JSONの1件。labels.json には coverUrl を持たせていないため引き直す"""
    idx = {}
    for key in ("keywords", "brands"):
        for ax in cfg.get(key) or []:
            if not ax.get("file"):
                continue
            p = os.path.join(case_dir, ax["file"])
            if not os.path.exists(p):
                continue
            d = load_json(p)
            for v in (d.get("videos") if isinstance(d, dict) else d) or []:
                vid = str(v.get("id") or "")
                if vid and vid not in idx:
                    idx[vid] = v
    return idx


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 16), b""):
            h.update(b)
    return h.hexdigest()


def is_image(b: bytes) -> str | None:
    if b[:3] == b"\xff\xd8\xff":
        return "jpg"
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "webp"
    if b[4:12] in (b"ftypheic", b"ftypmif1", b"ftypavif"):
        return "heic"
    return None


NET_TIMEOUT = 8.0      # 1回の取得の待ち時間。無応答の回線で長く黙らない
NET_DOWN_AFTER = 3     # ネット取得がこの回数続けて失敗したら、以降はネットを使わない


def http_get(url: str, timeout: float = NET_TIMEOUT) -> bytes:
    # 取得JSON由来の URL だけを叩く。file:// 等を通すと手元のファイルを資料に取り込めてしまう
    if not re.match(r"^https?://", str(url or ""), re.I):
        raise urllib.error.URLError(f"http(s) 以外の URL は取得しない: {str(url)[:40]}")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:   # noqa: S310  公開URLのみ
            return r.read()
    except urllib.error.HTTPError:
        raise
    except (http.client.HTTPException, ValueError) as e:
        # 応答が途中で切れた（IncompleteRead）・壊れた応答・不正なURL。1本の失敗として扱い、全体を落とさない
        raise urllib.error.URLError(f"{type(e).__name__}: {e}") from e


def to_jpeg(src: str, dst: str, ffmpeg: str | None, seek: float | None = None) -> bool:
    """src（画像 or 動画）を高さ MAX_H 以下の JPEG にする。ffmpeg が無ければ JPEG/PNG のコピーだけ"""
    if ffmpeg:
        cmd = [ffmpeg, "-loglevel", "error", "-y"]
        if seek is not None:
            cmd += ["-ss", str(seek)]
        cmd += ["-i", src, "-frames:v", "1",
                "-vf", f"scale=-2:'min({MAX_H},ih)'", "-q:v", "3", dst]
        r = subprocess.run(cmd, capture_output=True, text=True)
        return r.returncode == 0 and os.path.exists(dst) and os.path.getsize(dst) > 0
    with open(src, "rb") as f:
        kind = is_image(f.read(16))
    if kind == "jpg":
        shutil.copyfile(src, dst)
        return True
    return False


def from_bytes(b: bytes, dst: str, ffmpeg: str | None) -> tuple[bool, str]:
    kind = is_image(b)
    if not kind:
        return False, "画像ではない応答（失効・拒否ページの可能性）"
    tmp = dst + f".src.{kind}"
    with open(tmp, "wb") as f:
        f.write(b)
    try:
        if kind == "jpg" and not ffmpeg:
            os.replace(tmp, dst)
            return True, ""
        if not ffmpeg:
            return False, f"{kind} 形式は ffmpeg が無いと JPEG にできない"
        ok = to_jpeg(tmp, dst, ffmpeg)
        return ok, "" if ok else f"{kind} を JPEG に変換できない"
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


class RateLimited(Exception):
    pass


_last_oembed = [0.0]


def oembed_thumb(post_url: str) -> tuple[str | None, str | None]:
    """(thumbnail_url, embed_product_id)。1秒間隔で逐次に叩く"""
    wait = 1.0 - (time.time() - _last_oembed[0])
    if wait > 0:
        time.sleep(wait)
    _last_oembed[0] = time.time()
    q = urllib.parse.urlencode({"url": post_url})
    try:
        b = http_get(f"https://www.tiktok.com/oembed?{q}")
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise RateLimited() from e
        raise
    d = json.loads(b.decode("utf-8"))
    return d.get("thumbnail_url") or None, str(d.get("embed_product_id") or "") or None


def expired(url: str) -> bool:
    m = re.search(r"[?&]x-expires=(\d+)", url or "")
    return bool(m) and int(m.group(1)) < time.time() + 60


def quality_ok(path: str) -> tuple[bool, str, int | None, int | None]:
    """短辺と単色判定。Pillow が無ければ寸法だけ ffprobe で見る"""
    try:
        from PIL import Image, ImageStat
        with Image.open(path) as im:
            w, h = im.size
            if min(w, h) < 240:
                return False, f"小さすぎる（{w}x{h}）", w, h
            sd = ImageStat.Stat(im.convert("L").resize((64, 114))).stddev[0]
            if sd < 22:
                return False, f"ほぼ単色（輝度の標準偏差 {sd:.0f}）", w, h
            return True, "", w, h
    except ImportError:
        return True, "", None, None
    except OSError as e:
        return False, f"画像として読めない: {e}", None, None


def fetch_one(v: dict, dst: str, media_dirs: list[str], ffmpeg: str | None,
              network: bool, state: dict) -> tuple[str | None, list[str]]:
    vid = str(v.get("id") or v.get("video_id") or "")
    errs: list[str] = []

    def accept(via):
        ok, why, _w, _h = quality_ok(dst)
        if ok:
            return via
        errs.append(f"{via}: {why}")
        os.remove(dst)
        return None

    def net_failed(msg):
        errs.append(msg)
        state["net_fail"] = state.get("net_fail", 0) + 1
        if state["net_fail"] >= NET_DOWN_AFTER and not state.get("network_down"):
            state["network_down"] = True
            print(f"  ! ネット取得が{NET_DOWN_AFTER}回続けて失敗。以降はネットを使わず、取得済みの媒体だけで続けます"
                  "（回線・プロキシを直して再実行すると、取れなかった投稿だけを取り直します）", flush=True)

    def net_ok():
        state["net_fail"] = 0

    if network and not state.get("rate_limited") and not state.get("network_down"):
        cu = v.get("coverUrl") or v.get("cover_image_url") or ""
        if cu and not expired(cu):
            try:
                b = http_get(cu)
                net_ok()
                ok, why = from_bytes(b, dst, ffmpeg)
                if ok and accept("coverUrl"):
                    return "coverUrl", errs
                if not ok:
                    errs.append(f"coverUrl: {why}")
            except urllib.error.HTTPError as e:
                net_ok()                               # 応答は返っている（403/404 は回線の問題ではない）
                errs.append(f"coverUrl: {e}")
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                net_failed(f"coverUrl: {e}")
        elif cu:
            errs.append("coverUrl: 署名の期限切れ（x-expires）")
        urls = [v.get("url") or ""]
        if v.get("mediaType") == "photo" or v.get("media") == "photo":
            # 写真投稿は /video/ の URL だと oEmbed が失敗することがある
            urls.append(re.sub(r"/video/(\d+)", r"/photo/\1", urls[0]))
        for u in [x for x in dict.fromkeys(urls) if x.startswith("http")]:
            if state.get("network_down"):
                break
            try:
                th, pid = oembed_thumb(u)
                net_ok()
            except RateLimited:
                state["rate_limited"] = True
                errs.append("oEmbed: 429（回数制限）。以降のネット取得を止めました。時間を置いて再実行してください")
                break
            except urllib.error.HTTPError as e:
                net_ok()
                errs.append(f"oEmbed: {e}")
                continue
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                net_failed(f"oEmbed: {e}")
                continue
            except ValueError as e:
                errs.append(f"oEmbed: 応答を読めない（{e}）")
                continue
            if not th:
                errs.append("oEmbed: thumbnail_url が無い（削除・非公開の可能性）")
                continue
            if pid and pid != vid:
                # 別の投稿のサムネを掴むと、キャプションと画像がずれる（過去の事故と同じ型）
                errs.append(f"oEmbed: 応答の動画ID {pid} が {vid} と一致しない")
                continue
            try:
                ok, why = from_bytes(http_get(th), dst, ffmpeg)
                net_ok()
            except urllib.error.HTTPError as e:
                net_ok()
                errs.append(f"oEmbed画像: {e}")
                continue
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                net_failed(f"oEmbed画像: {e}")
                continue
            if ok and accept("oembed"):
                return "oembed", errs
            if not ok:
                errs.append(f"oEmbed: {why}")
    elif not network:
        errs.append("ネット取得を無効化（--no-network）")
    elif state.get("network_down"):
        errs.append("ネット取得は停止中（続けて失敗したため）")
    for md in media_dirs:
        ph = os.path.join(md, f"{vid}_photos")
        if os.path.isdir(ph):
            imgs = sorted(x for x in os.listdir(ph) if x.lower().endswith((".jpg", ".jpeg", ".png", ".webp")))
            if imgs and to_jpeg(os.path.join(ph, imgs[0]), dst, ffmpeg) and accept("photo"):
                return "photo", errs
            errs.append(f"写真フォルダはあるが使える画像が無い: {ph}")
        mp4 = os.path.join(md, f"{vid}.mp4")
        if os.path.exists(mp4):
            if not ffmpeg:
                errs.append("動画はあるが ffmpeg が無いので抜けない")
                continue
            for t in (0.5, 1.5, 0):
                if to_jpeg(mp4, dst, ffmpeg, seek=t) and accept("frame"):
                    return "frame", errs
            errs.append(f"動画から使えるコマを抜けない: {mp4}")
    return None, errs



def _utf8_stdio():
    """日本語 Windows のパイプ（cp932）で絵文字入りのキャプションを print すると落ちる。置換して続ける"""
    for st_ in (sys.stdout, sys.stderr):
        if hasattr(st_, "reconfigure"):
            try:
                st_.reconfigure(errors="replace")
            except (ValueError, OSError):
                pass

def main() -> int:
    _utf8_stdio()
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--case", required=True, help="案件ディレクトリ（case.json がある場所）")
    ap.add_argument("--media-dir", action="append", default=[],
                    help="取得済み媒体のフォルダ（tiktok-acquire の <run-dir>/media）。複数可。"
                         "既定で <case>/media も見る")
    ap.add_argument("--top", type=int, default=30,
                    help="labels.json が無いとき、各軸の表示順上位を何本まで取るか（既定30）")
    ap.add_argument("--no-network", action="store_true", help="coverUrl / oEmbed を使わない")
    ap.add_argument("--refresh", action="store_true", help="既にある画像も取り直す（既定は上書きしない）")
    ap.add_argument("--all", action="store_true",
                    help="labels.json があっても各軸の上位 --top 本を対象にする（二次提案以降の資料で、"
                         "保存率などで選ばれた投稿のカバーも揃えたいとき）")
    args = ap.parse_args()

    case_dir = os.path.abspath(os.path.expanduser(args.case))
    cfg_path = os.path.join(case_dir, "case.json")
    if not os.path.exists(cfg_path):
        raise SystemExit(f"[致命的] case.json がありません: {cfg_path}")
    cfg = load_json(cfg_path)
    media_dirs = [os.path.abspath(os.path.expanduser(m)) for m in args.media_dir]
    own_media = os.path.join(case_dir, "media")
    if os.path.isdir(own_media) and own_media not in media_dirs:
        media_dirs.append(own_media)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("  ! ffmpeg が見つかりません。取得済み動画からは抜けず、WebP のカバーも変換できません")

    idx = raw_index(case_dir, cfg)
    lp = None if args.all else label_posts(case_dir)
    if lp is not None:
        targets = []
        for p in lp:
            vid = str(p.get("video_id") or "")
            if vid:
                # 取得JSONに無い（手で足した）投稿も URL があれば oEmbed で取れる
                targets.append(idx.get(vid) or {"id": vid, "url": p.get("url")})
        basis = "labels.json の投稿"
    else:
        targets = axis_posts(case_dir, cfg, args.top)
        basis = f"各軸の表示順上位{args.top}本"
    seen, uniq = set(), []
    for v in targets:
        vid = safe_vid(v.get("id"))
        if not vid:
            # 投稿IDはファイル名（assets/covers/<id>.jpg）になる。数字以外は案件の外へ書きうるので扱わない
            print(f"  ! 投稿ID {str(v.get('id'))[:40]!r} が数字でないため飛ばします")
            continue
        if vid not in seen:
            seen.add(vid)
            uniq.append(v)

    out_dir = os.path.join(case_dir, "assets", "covers")
    os.makedirs(out_dir, exist_ok=True)
    man_path = os.path.join(out_dir, "manifest.json")
    manifest = load_json(man_path) if os.path.exists(man_path) else {}

    def save_manifest():
        tmp = man_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=1)
        os.replace(tmp, man_path)

    got = kept = 0
    missing = []
    state: dict = {}
    try:
        for i, v in enumerate(uniq, start=1):
            vid = str(v["id"])
            dst = os.path.join(out_dir, f"{vid}.jpg")
            if os.path.exists(dst) and not args.refresh:
                digest = sha256_of(dst)
                prev = manifest.get(vid) or {}
                if prev.get("ok") and prev.get("sha256") == digest:
                    kept += 1
                    continue
                # 取得経路の分からない既存画像（manifest が消えた・手で置いた）。中身を確かめ、
                # 経路は existing のまま残す（「検索するとこう見える」のページには使わない）
                with open(dst, "rb") as f:
                    kind = is_image(f.read(16))
                ok, why, w, h = quality_ok(dst) if kind == "jpg" else (False, f"JPEG ではない（{kind or '不明'}）", None, None)
                if ok:
                    kept += 1
                    manifest[vid] = {"ok": True, "via": "existing", "url": v.get("url"), "sha256": digest, "w": w, "h": h}
                else:
                    missing.append(vid)
                    manifest[vid] = {"ok": False, "errors": [f"既存の画像が使えない: {why}（消すか --refresh で取り直す）"],
                                     "url": v.get("url"), "sha256": digest}
                save_manifest()
                continue
            # 一時ファイルに取り、検証を通ったときだけ置き換える（--refresh で判定済みの画像を失わない）
            tmp = dst + ".new.jpg"
            via, errs = fetch_one(v, tmp, media_dirs, ffmpeg, not args.no_network, state)
            if via:
                got += 1
                os.replace(tmp, dst)
                _ok, _why, w, h = quality_ok(dst)
                manifest[vid] = {"ok": True, "via": via, "url": v.get("url"), "sha256": sha256_of(dst),
                                 "w": w, "h": h, "fetched_at": dt.datetime.now().isoformat(timespec="seconds")}
                mark = via
            else:
                if os.path.exists(tmp):
                    os.remove(tmp)
                if os.path.exists(dst):
                    # --refresh で取り直せなかった。今ある画像と記録はそのまま使う
                    kept += 1
                    manifest.setdefault(vid, {"ok": True, "via": "existing", "url": v.get("url"),
                                              "sha256": sha256_of(dst)})
                    manifest[vid]["refresh_errors"] = errs
                    mark = "取り直せず（既存を維持）"
                else:
                    missing.append(vid)
                    manifest[vid] = {"ok": False, "errors": errs, "url": v.get("url")}
                    mark = "取れず"
            save_manifest()
            print(f"  [{i}/{len(uniq)}] {vid}: {mark}", flush=True)
    finally:
        save_manifest()
    log = manifest

    print(f"対象: {basis} {len(uniq)}本 → 新規 {got} / 既存 {kept} / 取れなかった {len(missing)}")
    print(f"→ {out_dir}")
    if missing:
        print("  取れなかった投稿は資料の例示に使われません（理由は manifest.json）:")
        for vid in missing[:15]:
            print(f"   - {vid}: {'; '.join(log[vid]['errors'])[:120]}")
        if len(missing) > 15:
            print(f"   …ほか {len(missing) - 15} 本")
    # 1枚も取れないのは設定の誤り（media-dir の指定漏れ・ネット遮断）であることが多い。黙って通さない
    return 1 if uniq and got + kept == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
