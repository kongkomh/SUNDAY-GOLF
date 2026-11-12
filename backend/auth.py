"""
Sunday Golf Tracker - Authentication & Session Management
Supports Google OAuth 2.0 and HMAC-SHA256 Signed Session Cookies
"""

import os
import time
import hmac
import hashlib
import base64
import json
import urllib.request
import urllib.parse
from typing import Dict, Any, Optional

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "sunday-golf-tracker-default-secret-2026-xyz").encode("utf-8")
SESSION_DURATION_SEC = 30 * 24 * 3600  # 30 days


def create_session_token(user_id: str) -> str:
    """Creates a tamper-proof signed session token: user_id:timestamp:sig"""
    ts = str(int(time.time()))
    payload = f"{user_id}:{ts}"
    sig = hmac.new(SESSION_SECRET, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    raw = f"{payload}:{sig}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8")


def verify_session_token(token: str) -> Optional[str]:
    """Verifies a signed session token. Returns user_id if valid and not expired, else None."""
    if not token:
        return None
    try:
        raw = base64.urlsafe_b64decode(token.encode("utf-8")).decode("utf-8")
        parts = raw.split(":")
        if len(parts) != 3:
            return None
        user_id, ts_str, sig = parts
        payload = f"{user_id}:{ts_str}"
        expected_sig = hmac.new(SESSION_SECRET, payload.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        ts = int(ts_str)
        if time.time() - ts > SESSION_DURATION_SEC:
            return None
        return user_id
    except Exception:
        return None


def is_google_oauth_configured() -> bool:
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)


def get_google_auth_url(redirect_uri: str, state: str = "") -> str:
    """Builds the Google OAuth 2.0 redirect URL"""
    if not is_google_oauth_configured():
        return ""
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "state": state,
        "prompt": "select_account"
    }
    return f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"


def exchange_code_for_user(code: str, redirect_uri: str) -> Optional[Dict[str, Any]]:
    """Exchanges authorization code for Google user profile"""
    if not is_google_oauth_configured():
        return None

    # 1. Exchange code for access token
    token_url = "https://oauth2.googleapis.com/token"
    token_data = urllib.parse.urlencode({
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code"
    }).encode("utf-8")

    try:
        req = urllib.request.Request(token_url, data=token_data, headers={"Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            token_json = json.loads(resp.read().decode("utf-8"))
        access_token = token_json.get("access_token")
        if not access_token:
            return None

        # 2. Get user info
        user_url = "https://www.googleapis.com/oauth2/v3/userinfo"
        user_req = urllib.request.Request(user_url, headers={"Authorization": f"Bearer {access_token}"})
        with urllib.request.urlopen(user_req, timeout=10) as user_resp:
            user_json = json.loads(user_resp.read().decode("utf-8"))

        return {
            "id": user_json.get("sub"),
            "email": user_json.get("email"),
            "name": user_json.get("name") or user_json.get("email", "").split("@")[0],
            "picture": user_json.get("picture")
        }
    except Exception as e:
        print(f"[AUTH ERROR] Failed to exchange code with Google: {e}")
        return None
