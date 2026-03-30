"""PostFreely - API: Collection Runner."""
import concurrent.futures
import copy
import threading
import time
import uuid

import api_proxy
import db_access
import db_collections
import db_misc


_RUNS = {}
_RUNS_LOCK = threading.Lock()
_RUN_RETENTION_SECONDS = 900


def _now():
    return time.time()


def _cleanup_runs():
    cutoff = _now() - _RUN_RETENTION_SECONDS
    stale = []
    for run_id, state in _RUNS.items():
        finished_at = state.get("finished_at")
        if finished_at and finished_at < cutoff:
            stale.append(run_id)
    for run_id in stale:
        _RUNS.pop(run_id, None)


def _run_summary(state):
    return {
        "run_id": state["run_id"],
        "status": state["status"],
        "collection_id": state["collection_id"],
        "collection_name": state["collection_name"],
        "planned_requests": state["planned_requests"],
        "total_requests": state["total_requests"],
        "total_pass": state["total_pass"],
        "total_fail": state["total_fail"],
        "total_ms": state["total_ms"],
        "iterations": state["iterations"],
        "completed_iterations": state["completed_iterations"],
        "data_rows_used": state["data_rows_used"],
        "parallelism": state["parallelism"],
        "stopped": state["status"] == "stopped",
        "stopped_reason": state.get("stopped_reason", ""),
        "error": state.get("error"),
        "started_at": state["started_at"],
        "finished_at": state.get("finished_at"),
    }


def _snapshot_state(state, since=0):
    start_index = max(0, int(since or 0))
    summary = _run_summary(state)
    summary["result_count"] = len(state["results"])
    summary["results"] = copy.deepcopy(state["results"][start_index:])
    return summary


def _create_run_state(run_id, collection, reqs, total_iterations, data_rows_used, parallelism, actor_id, target_owner_id):
    return {
        "run_id": run_id,
        "status": "running",
        "actor_id": actor_id,
        "target_owner_id": target_owner_id,
        "collection_id": collection.get("id"),
        "collection_name": collection.get("name"),
        "planned_requests": len(reqs) * total_iterations,
        "total_requests": 0,
        "total_pass": 0,
        "total_fail": 0,
        "total_ms": 0,
        "iterations": total_iterations,
        "completed_iterations": 0,
        "completed_iteration_ids": [],
        "data_rows_used": data_rows_used,
        "parallelism": parallelism,
        "results": [],
        "started_at": _now(),
        "updated_at": _now(),
        "finished_at": None,
        "stop_requested": False,
        "stopped_reason": "",
        "error": None,
    }


def _set_run_state(run_id, state):
    with _RUNS_LOCK:
        _cleanup_runs()
        _RUNS[run_id] = state


def _with_run(run_id, updater):
    with _RUNS_LOCK:
        state = _RUNS.get(run_id)
        if not state:
            return None
        updater(state)
        state["updated_at"] = _now()
        return copy.deepcopy(state)


def _get_run(run_id):
    with _RUNS_LOCK:
        _cleanup_runs()
        state = _RUNS.get(run_id)
        return copy.deepcopy(state) if state else None


def _stop_requested(run_id):
    with _RUNS_LOCK:
        state = _RUNS.get(run_id)
        if not state:
            return True
        return bool(state.get("stop_requested"))


def _request_stop(run_id):
    with _RUNS_LOCK:
        state = _RUNS.get(run_id)
        if not state:
            return None
        if state["status"] in ("completed", "stopped", "error"):
            return copy.deepcopy(state)
        state["stop_requested"] = True
        state["status"] = "stopping"
        state["updated_at"] = _now()
        return copy.deepcopy(state)


def _sleep_with_stop(delay_ms, run_id):
    remaining = max(0, int(delay_ms))
    while remaining > 0:
        if _stop_requested(run_id):
            return False
        step = min(remaining, 120)
        time.sleep(step / 1000.0)
        remaining -= step
    return not _stop_requested(run_id)


def _build_result(request_def, iteration, data_row, response):
    status_code = response.get("status_code", 0)
    passed = 200 <= status_code < 300
    return {
        "request_id": request_def["id"],
        "request_name": request_def.get("name", request_def.get("url", "?")),
        "method": request_def.get("method", "GET"),
        "url": request_def.get("url", ""),
        "iteration": iteration,
        "data_row": data_row,
        "status_code": status_code,
        "status_text": response.get("status_text", ""),
        "elapsed_ms": response.get("elapsed_ms", 0),
        "size_bytes": response.get("size_bytes", 0),
        "passed": passed,
        "error": response.get("error") if not passed else None,
        "error_detail": response.get("error_detail", ""),
        "error_hint": response.get("error_hint", ""),
        "body_preview": response.get("body_preview", ""),
        "response": response,
    }


def _append_result(run_id, result):
    def updater(state):
        state["results"].append(result)
        state["total_requests"] += 1
        state["total_pass"] += int(result["passed"])
        state["total_fail"] += int(not result["passed"])
        state["total_ms"] += int(result.get("elapsed_ms", 0))

    _with_run(run_id, updater)


def _mark_iteration_complete(run_id, iteration):
    def updater(state):
        completed = state.setdefault("completed_iteration_ids", [])
        if iteration not in completed:
            completed.append(iteration)
            completed.sort()
        state["completed_iterations"] = len(completed)

    _with_run(run_id, updater)


def _finish_run(run_id, *, status, stopped_reason="", error=None):
    def updater(state):
        state["status"] = status
        state["stopped_reason"] = stopped_reason
        state["error"] = error
        state["finished_at"] = _now()

    _with_run(run_id, updater)


def _iteration_worker(run_id, pf_context, collection_id, env_id, reqs, iteration, data_row, delay_ms):
    if _stop_requested(run_id):
        return {"iteration": iteration, "completed": False, "stopped": True}

    for request_def in reqs:
        if _stop_requested(run_id):
            return {"iteration": iteration, "completed": False, "stopped": True}

        if delay_ms > 0 and not _sleep_with_stop(delay_ms, run_id):
            return {"iteration": iteration, "completed": False, "stopped": True}

        fake = {
            "_pf_context": pf_context,
            "method": "POST",
            "path": "/api/proxy",
            "params": {},
            "query": {},
            "headers": {},
            "body": {
                "method": request_def.get("method", "GET"),
                "url": request_def.get("url", ""),
                "params": copy.deepcopy(request_def.get("params", [])),
                "headers": copy.deepcopy(request_def.get("headers", [])),
                "body": request_def.get("body", ""),
                "auth": copy.deepcopy(request_def.get("auth", {"type": "none"})),
                "collection_id": collection_id,
                "env_id": env_id,
                "data_vars": data_row,
            },
        }
        response = api_proxy.send_request(fake).get("data", {})
        _append_result(run_id, _build_result(request_def, iteration, data_row, response))

    _mark_iteration_complete(run_id, iteration)
    return {"iteration": iteration, "completed": True, "stopped": False}


def _runner_worker(run_id, pf_context, collection_id, env_id, reqs, total_iterations, data_rows, delay_ms, parallelism):
    try:
        max_workers = max(1, min(int(parallelism or 1), total_iterations))
        futures = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="pf-run") as executor:
            for iteration in range(1, total_iterations + 1):
                data_row = data_rows[iteration - 1] if data_rows else {}
                futures.append(
                    executor.submit(
                        _iteration_worker,
                        run_id,
                        pf_context,
                        collection_id,
                        env_id,
                        reqs,
                        iteration,
                        data_row,
                        delay_ms,
                    )
                )

            for future in concurrent.futures.as_completed(futures):
                future.result()

        if _stop_requested(run_id):
            _finish_run(run_id, status="stopped", stopped_reason="Stopped by user")
        else:
            _finish_run(run_id, status="completed")
    except Exception as exc:
        _finish_run(run_id, status="error", error=str(exc))


def run_collection(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    body = req["body"]
    collection_id = body.get("collection_id")
    env_id = body.get("env_id")
    delay_ms = int(body.get("delay_ms", 0))
    iterations = int(body.get("iterations", 1))
    request_filter = body.get("request_ids")
    data_rows = body.get("data_rows") or []
    run_id = body.get("run_id") or str(uuid.uuid4())
    settings = db_misc.get_settings(owner_id=ctx.get("actor_id"))
    parallelism = int(body.get("parallel") or settings.get("runner_parallel") or 4)
    parallelism = max(1, min(parallelism, 12))

    collection = db_collections.get_one(collection_id, owner_id=ctx["target_owner_id"])
    if not collection:
        return {"status": 404, "data": {"error": "Collection not found"}}

    requests = collection.get("requests", [])
    if request_filter:
        requests = [item for item in requests if item["id"] in request_filter]
    if not requests:
        return {"status": 400, "data": {"error": "Collection has no runnable requests"}}

    if not isinstance(data_rows, list):
        data_rows = []
    data_rows = [row for row in data_rows if isinstance(row, dict)]
    total_iterations = len(data_rows) if data_rows else max(iterations, 1)

    state = _create_run_state(
        run_id,
        collection,
        requests,
        total_iterations,
        len(data_rows),
        parallelism,
        ctx.get("actor_id"),
        ctx.get("target_owner_id"),
    )
    _set_run_state(run_id, state)

    pf_context = {
        "mode": ctx["mode"],
        "user": ctx.get("user"),
        "actor_id": ctx.get("actor_id"),
        "target_owner_id": ctx.get("target_owner_id"),
        "is_admin": ctx.get("is_admin", False),
    }

    worker = threading.Thread(
        target=_runner_worker,
        args=(run_id, pf_context, collection_id, env_id, requests, total_iterations, data_rows, delay_ms, parallelism),
        daemon=True,
    )
    worker.start()
    return {"data": _snapshot_state(state, 0)}


def get_collection_run(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    run_id = req["params"]["id"]
    since_raw = ((req.get("query") or {}).get("since") or ["0"])[0]
    try:
        since = int(since_raw)
    except Exception:
        since = 0
    state = _get_run(run_id)
    if not state:
        return {"status": 404, "data": {"error": "Run not found"}}
    if state.get("actor_id") != ctx.get("actor_id") and not ctx.get("is_admin"):
        return {"status": 403, "data": {"error": "Run access denied"}}
    return {"data": _snapshot_state(state, since)}


def stop_collection_run(req):
    ctx = db_access.request_context(req, require_auth=db_access.public_config().get("auth_required", False))
    run_id = (req.get("body") or {}).get("run_id")
    if not run_id:
        return {"status": 400, "data": {"error": "run_id required"}}
    current = _get_run(run_id)
    if current and current.get("actor_id") != ctx.get("actor_id") and not ctx.get("is_admin"):
        return {"status": 403, "data": {"error": "Run access denied"}}
    state = _request_stop(run_id)
    if not state:
        return {"status": 404, "data": {"error": "Run not found"}}
    return {"data": _snapshot_state(state, 0)}
