from urllib.parse import urlsplit

from sites import cosme, rakuten, yahoo

SITES = {m.NAME: m for m in (cosme, rakuten, yahoo)}

# 自動アクセスを明示的に拒否している／ログインが要るため対象外にしたサイト。
# 回避策は実装しない（利用規約・アカウント停止のリスクがあるため）。
UNSUPPORTED = {
    "amazon.co.jp": "口コミ一覧の閲覧にログインが必要",
    "lipscosme.com": "自動アクセスを拒否（CloudFront 403）",
    "qoo10.jp": "自動アクセスを拒否（HTTP 523）",
}


def detect(url):
    # 対象外の判定はホスト名で行う。URL全体の部分一致だと、クエリに amazon.co.jp を含む
    # 楽天の商品URLまで「ログインが必要」で拒否してしまう
    netloc = (urlsplit(url if "://" in url else "https://" + url).hostname or "").lower()
    for host, why in UNSUPPORTED.items():
        if netloc == host or netloc.endswith("." + host):
            return None, why
    for m in SITES.values():
        ref = m.match_url(url)
        if ref:
            return m, ref
    return None, ("対応していないURLです。渡せるのは @cosme の商品URL（/products/<数字>/）、"
                  "楽天の口コミURL（review.rakuten.co.jp/item/1/<店舗>_<商品>/）か商品URL（item.rakuten.co.jp/…）、"
                  "Yahoo!の店舗商品URL（store.shopping.yahoo.co.jp/<店舗>/<商品>.html）か口コミ一覧URL")
