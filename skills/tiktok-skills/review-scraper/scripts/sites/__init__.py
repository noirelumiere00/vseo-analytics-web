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
    for host, why in UNSUPPORTED.items():
        if host in url:
            return None, why
    for m in SITES.values():
        ref = m.match_url(url)
        if ref:
            return m, ref
    return None, "対応していないURLです（@cosme / 楽天 / Yahoo!ショッピングのみ）"
