"""PostFreely — Utils: {{variable}} interpolation"""
import re
import time
import uuid
import random
from datetime import datetime, timezone

def _dynamic_variable(key):
    if key in ("$guid", "$randomUUID"):
        return str(uuid.uuid4())
    if key == "$timestamp":
        return str(int(time.time()))
    if key == "$isoTimestamp":
        return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace("+00:00", "Z")
    if key == "$randomInt":
        return str(random.randint(1, 1000))
    return None

def interpolate(text, variables):
    if not isinstance(text, str): return text
    def repl(m):
        key = m.group(1).strip()
        dyn = _dynamic_variable(key)
        if dyn is not None:
            return dyn
        return str(variables.get(key, m.group(0)))
    return re.sub(r"\{\{(.+?)\}\}", repl, text)
