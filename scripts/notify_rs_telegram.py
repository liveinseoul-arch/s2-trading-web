#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# [2026-08-16 랙 수리] RS 채널 텔레그램 알림 헬퍼 (신설 · 침묵 실패 관문용)
#
# 무엇: run_rs_kr_jp.ps1 · run_kr_perf_weekly.ps1 이 단계 실패 시 호출한다.
#       s2_method/.env.local 의 TELEGRAM_RS_CHAT_ID + (TELEGRAM_RS_BOT_TOKEN 또는
#       TELEGRAM_BOT_TOKEN 폴백)으로 전송 — s2_method/rs_pyramid_signal.py 의
#       telegram_send_rs 패턴 준용(S2/T1 chat 폴백 금지).
#       ★토큰 값은 절대 출력하지 않는다. 미설정이면 전송 생략.
#       항상 exit 0 — 알림 실패가 잡의 exit 코드를 덮어쓰지 않게 한다.
#
# 실행: C:/quantBacktest/venv/Scripts/python.exe notify_rs_telegram.py "메시지"
# 되돌리기: 이 파일을 삭제하고 두 ps1 의 Notify 함수·호출부를 제거하면 원복된다.
# 근거: quant_infra/2026-08/RS_LEDGER_LAG_2026-08-16.md (4주 침묵 실패)
#       승인: 해달별님 2026-08-16 「전체 패키지」
# [2026-08-16 랙 수리] 끝
import json
import os
import ssl
import sys
import urllib.request
from pathlib import Path

# scripts → s2-trading-web → s2_method
ENV_LOCAL = Path(__file__).resolve().parents[2] / ".env.local"


def _load_env_local():
    if not ENV_LOCAL.exists():
        return
    for line in ENV_LOCAL.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def main():
    text = " ".join(sys.argv[1:]).strip() or "(빈 메시지)"
    _load_env_local()
    token = os.environ.get("TELEGRAM_RS_BOT_TOKEN") or os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_RS_CHAT_ID")
    if not token or not chat:
        print("[notify-rs] TELEGRAM_RS_CHAT_ID(또는 봇 토큰) 미설정 — 전송 생략")
        return
    url = "https://api.telegram.org/bot%s/sendMessage" % token
    body = json.dumps({"chat_id": chat, "text": text,
                       "disable_web_page_preview": True}).encode("utf-8")
    req = urllib.request.Request(url, data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20, context=_ssl_context()) as r:
            r.read()
        print("[notify-rs] 텔레그램(RS) 전송 완료")
    except Exception as e:
        print("[notify-rs] 텔레그램 오류: %s" % e)


if __name__ == "__main__":
    main()
    sys.exit(0)
