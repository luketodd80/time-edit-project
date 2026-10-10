"""Eastern Time clock. Tests can freeze it; production uses the real clock."""
from datetime import datetime
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
_frozen = None


def freeze(dt):
    global _frozen
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ET)
    _frozen = dt.astimezone(ET)


def unfreeze():
    global _frozen
    _frozen = None


def now():
    if _frozen is not None:
        return _frozen
    return datetime.now(ET)
