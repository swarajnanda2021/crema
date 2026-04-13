"""
Standard response envelope — every API response follows this shape.

{ "data": ... , "meta": { "resource": "posts", "total": 148, "limit": 20, "offset": 0 } }

Single items: data is a dict. Lists: data is an array. Toggles: data is { toggled, count }.
"""


def ok(data, *, resource="", total=None, limit=None, offset=None):
    meta = {"resource": resource}
    if total is not None:
        meta["total"] = total
    if limit is not None:
        meta["limit"] = limit
    if offset is not None:
        meta["offset"] = offset
    return {"data": data, "meta": meta}


def toggled(state: bool, count: int, *, resource=""):
    return {"data": {"toggled": state, "count": count}, "meta": {"resource": resource}}
