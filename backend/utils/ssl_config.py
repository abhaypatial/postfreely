"""Runtime SSL helpers for outbound HTTPS calls."""
import os
import ssl


def env_flag(name, default=False):
    value = str(os.environ.get(name, "")).strip().lower()
    if not value:
        return default
    return value in ("1", "true", "yes", "on")


def outbound_ssl_context():
    ctx = ssl.create_default_context()
    if env_flag("POSTFREELY_INSECURE_SSL", False):
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


def outbound_ssl_mode():
    return "insecure" if env_flag("POSTFREELY_INSECURE_SSL", False) else "verified"
