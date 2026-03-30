"""PostFreely — Utils: {{variable}} interpolation"""
import re

def interpolate(text, variables):
    if not isinstance(text, str): return text
    return re.sub(r"\{\{(.+?)\}\}", lambda m: str(variables.get(m.group(1).strip(), m.group(0))), text)
