import hashlib
import hmac
import time

from fastapi import Request

COOKIE = "cb_studio_session"
SESSION_AGE = 24 * 60 * 60


def session_cookie(token: str) -> str:
    expiry = str(int(time.time()) + SESSION_AGE)
    signature = hmac.new(token.encode(), expiry.encode(), hashlib.sha256).hexdigest()
    return f"{expiry}.{signature}"


def authenticated(request: Request) -> bool:
    token = request.app.state.settings.studio_token
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer ") and hmac.compare_digest(auth[7:].encode(), token.encode()):
        return True
    cookie = request.cookies.get(COOKIE, "")
    try:
        expiry, signature = cookie.split(".")
        timestamp = int(expiry)
        if not int(time.time()) < timestamp <= int(time.time()) + SESSION_AGE:
            return False
        expected = hmac.new(token.encode(), expiry.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(signature.encode(), expected.encode())
    except (ValueError, TypeError):
        return False
