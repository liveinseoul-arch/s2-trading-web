#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""텔레그램 알림 (외부 의존성 없이 stdlib urllib).

환경변수 TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID 가 있으면 메시지를 보낸다(없으면 조용히 생략).
봇 생성: 텔레그램 @BotFather → /newbot → 토큰. chat_id: 봇과 대화 후
  https://api.telegram.org/bot<TOKEN>/getUpdates 의 chat.id.
.env.local 에 TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID 추가하면 Config()가 자동 로드.
"""
from __future__ import annotations
import os, json, ssl, urllib.request, urllib.error


def _ssl_context() -> ssl.SSLContext:
    """SSL 검증 컨텍스트. Windows 인증서 저장소에 (백신/방화벽의) 자체서명 루트가
    끼어들면 기본 검증이 CERTIFICATE_VERIFY_FAILED 로 실패하므로, 설치돼 있으면
    certifi 의 CA 번들을 우선 사용한다(검증 자체는 유지 → 안전)."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


_SSL_CTX = _ssl_context()


def telegram_send(text: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        print("[notify] TELEGRAM_BOT_TOKEN/CHAT_ID 미설정 → 알림 생략")
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    body = json.dumps({"chat_id": chat, "text": text, "parse_mode": "HTML",
                       "disable_web_page_preview": True}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20, context=_SSL_CTX) as r:
            r.read()
        print("[notify] 텔레그램 전송 완료")
        return True
    except urllib.error.HTTPError as e:
        print(f"[notify] 텔레그램 실패 {e.code}: {e.read().decode('utf-8')[:200]}")
        return False
    except Exception as e:
        print(f"[notify] 텔레그램 오류: {e}")
        return False


if __name__ == "__main__":
    import sys
    from pathlib import Path
    # 단독 실행 시 s2_method/.env.local 을 직접 로드(파이프라인에선 Config()가 로드)
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root))
    try:
        from config import load_env_file
        load_env_file(str(root / ".env.local"))
    except Exception as e:
        print(f"[notify] .env.local 로드 실패: {e}")
    telegram_send(sys.argv[1] if len(sys.argv) > 1 else "S2 텔레그램 테스트 ✅")
