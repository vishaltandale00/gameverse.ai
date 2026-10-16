"""A data-only reference game and a bounded JSONL adapter seam."""
from __future__ import annotations

from collections import deque
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import time
import uuid

from .core import PlaytestError, digest, require


def validate_game(game):
    require(isinstance(game, dict) and game.get("schema_version") == 1, "invalid_game_schema")
    require(set(game) <= {"schema_version", "game_id", "title", "width", "height", "start", "goal", "walls",
                          "keys", "doors", "max_episode_steps", "source_components", "notes"}, "unknown_game_field")
    require(isinstance(game.get("game_id"), str) and 0 < len(game["game_id"]) <= 128, "invalid_game_id")
    for k in ("width", "height"):
        require(type(game.get(k)) is int and 2 <= game[k] <= 64, "invalid_game_dimensions")
    def point(p):
        require(isinstance(p, list) and len(p) == 2 and all(type(x) is int for x in p)
                and 0 <= p[0] < game["width"] and 0 <= p[1] < game["height"], "invalid_game_position")
        return tuple(p)
    start, goal = point(game.get("start")), point(game.get("goal"))
    walls = game.get("walls", [])
    require(isinstance(walls, list) and len(walls) <= 4096, "invalid_walls")
    occupied = {point(w) for w in walls}
    require(len(occupied) == len(walls), "duplicate_wall")
    require(start not in occupied and goal not in occupied and start != goal, "invalid_start_goal")
    keys, doors = game.get("keys", []), game.get("doors", [])
    require(isinstance(keys, list) and len(keys) <= 32 and isinstance(doors, list) and len(doors) <= 32,
            "invalid_game_objects")
    key_ids, all_ids = set(), set()
    for objects, kind in ((keys, "key"), (doors, "door")):
        for obj in objects:
            require(isinstance(obj, dict) and set(obj) <= {"id", "position", "requires"}, "invalid_game_object")
            ident = obj.get("id")
            require(isinstance(ident, str) and 0 < len(ident) <= 64 and ident not in all_ids, "invalid_object_id")
            all_ids.add(ident)
            p = point(obj.get("position"))
            require(p not in occupied and p != start and p != goal, "overlapping_game_objects")
            occupied.add(p)
            if kind == "key":
                require("requires" not in obj, "key_cannot_require_key")
                key_ids.add(ident)
            else:
                require(obj.get("requires") in key_ids, "door_requires_unknown_key")
    require(type(game.get("max_episode_steps", 200)) is int and 1 <= game.get("max_episode_steps", 200) <= 10000,
            "invalid_episode_limit")
    require(isinstance(game.get("source_components", []), list) and len(game.get("source_components", [])) <= 64,
            "invalid_source_components")
    require(len(json.dumps(game, allow_nan=False).encode()) <= 1024 * 1024, "game_size_limit")
    return game


class GridAdapter:
    """Known-map reference simulation. This does not infer a ROM's mechanics."""
    DIRECTIONS = (("up", 0, -1, "UP"), ("down", 0, 1, "DOWN"),
                  ("left", -1, 0, "LEFT"), ("right", 1, 0, "RIGHT"))

    def __init__(self, game):
        self.game = validate_game(game)
        self.position = tuple(game["start"])
        self.inventory, self.opened = set(), set()
        self.frame = self.turn = 0
        self.closed = False
        self.session_id = uuid.uuid4().hex
        self.version = digest(game)
        self.walls = {tuple(w) for w in game.get("walls", [])}

    def hello(self):
        return {"schema_version": 1, "adapter_version": "reference-grid/0.1.0", "session_id": self.session_id,
                "isolated": True, "game_id": self.game["game_id"], "game_version": self.version,
                "capabilities": ["observe", "act"], "max_action_frames": 1,
                "knowledge": "complete candidate manifest; not blind visual exploration"}

    def _key(self, pos=None):
        return digest({"position": pos or self.position, "inventory": sorted(self.inventory), "opened": sorted(self.opened)})

    def _walkable(self, p):
        return (0 <= p[0] < self.game["width"] and 0 <= p[1] < self.game["height"] and p not in self.walls
                and not any(tuple(d["position"]) == p and d["id"] not in self.opened for d in self.game.get("doors", [])))

    def _path(self, target):
        queue = deque([(self.position, [])])
        seen = {self.position}
        while queue:
            p, path = queue.popleft()
            if p == target:
                return path
            for name, x, y, key in self.DIRECTIONS:
                q = p[0] + x, p[1] + y
                if q not in seen and self._walkable(q):
                    seen.add(q)
                    queue.append((q, path + [name]))
        return None

    def _options(self):
        options = []
        for name, dx, dy, key in self.DIRECTIONS:
            p = self.position[0] + dx, self.position[1] + dy
            options.append({"id": "move_" + name, "description": "Take one grid step " + name,
                            "keys": [key], "frames": 1, "target": {"position": list(p)},
                            "target_state_key": self._key(p if self._walkable(p) else self.position)})
        # Named targets compile to one safe BFS hop, not an open-loop journey.
        objectives = [("goal", tuple(self.game["goal"]))]
        objectives += [("key:" + k["id"], tuple(k["position"])) for k in self.game.get("keys", []) if k["id"] not in self.inventory]
        for label, target in objectives:
            path = self._path(target)
            if path:
                options.append({"id": "navigate:" + label, "description": "Walk toward " + label + "; reobserve after one step",
                                "keys": [], "frames": 1, "target": {"kind": label, "position": list(target)},
                                "objective_hint": True, "next_direction": path[0], "continue_until_target": True})
        for door in self.game.get("doors", []):
            p = door["position"]
            if door["id"] not in self.opened and abs(p[0] - self.position[0]) + abs(p[1] - self.position[1]) == 1:
                options.append({"id": "interact:" + door["id"], "description": "Try opening door " + door["id"] + " using " + door["requires"],
                                "keys": ["A"], "frames": 1, "target": {"kind": "door", "id": door["id"]},
                                "objective_hint": door["requires"] in self.inventory})
            elif door["id"] not in self.opened and door["requires"] in self.inventory:
                paths = [self._path((p[0] + dx, p[1] + dy)) for _, dx, dy, _ in self.DIRECTIONS]
                paths = [x for x in paths if x]
                if paths:
                    path = min(paths, key=len)
                    options.append({"id": "approach:" + door["id"], "description": "Walk one step toward a door for which we hold the key",
                                    "keys": [], "frames": 1, "target": {"kind": "door", "id": door["id"]},
                                    "objective_hint": True, "next_direction": path[0], "continue_until_target": True})
        return options

    def observe(self):
        require(not self.closed, "session_closed")
        success = self.position == tuple(self.game["goal"])
        return {"frame": self.frame, "state_key": self._key(), "phase": "gameplay", "facts": {
                    "position": list(self.position), "inventory": sorted(self.inventory), "opened_doors": sorted(self.opened),
                    "goal": self.game["goal"], "map_knowledge": "manifest", "map": self.game},
                "progress": {"position": list(self.position), "inventory": sorted(self.inventory), "opened": sorted(self.opened)},
                "terminal": success or self.turn >= self.game.get("max_episode_steps", 200), "success": success,
                "options": self._options()}

    def act(self, action, *, max_frames):
        require(not self.closed and max_frames >= 1, "invalid_session_action")
        available = {a["id"]: a for a in self._options()}
        require(action["id"] in available, "stale_action")
        action = available[action["id"]]
        name = action.get("next_direction", action["id"].removeprefix("move_"))
        if action["id"].startswith("interact:"):
            ident = action["id"].partition(":")[2]
            door = next(d for d in self.game["doors"] if d["id"] == ident)
            if door["requires"] in self.inventory:
                self.opened.add(ident)
        else:
            for direction, dx, dy, _ in self.DIRECTIONS:
                if direction == name:
                    p = self.position[0] + dx, self.position[1] + dy
                    if self._walkable(p):
                        self.position = p
        for key in self.game.get("keys", []):
            if tuple(key["position"]) == self.position:
                self.inventory.add(key["id"])
        self.frame += 1
        self.turn += 1
        return {"frames": 1}

    def close(self):
        self.closed = True


class SubprocessAdapter:
    """JSONL worker launched as a private process group; never through a shell."""
    def __init__(self, command, *, timeout_s=10):
        require(isinstance(command, list) and command and all(isinstance(s, str) and s for s in command), "invalid_adapter_command")
        self.timeout_s = timeout_s
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, start_new_session=True)
        self.counter, self.buffer = 0, b""
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)

    def _request(self, operation, **fields):
        self.counter += 1
        ident = str(self.counter)
        payload = dict(id=ident, op=operation, **fields)
        raw = (json.dumps(payload, allow_nan=False) + "\n").encode()
        require(len(raw) <= 1024 * 1024, "adapter_request_size_limit")
        try:
            self.process.stdin.write(raw)
            self.process.stdin.flush()
        except (OSError, ValueError):
            raise PlaytestError("adapter_pipe_closed") from None
        deadline = time.monotonic() + self.timeout_s
        while b"\n" not in self.buffer:
            remaining = deadline - time.monotonic()
            require(remaining > 0 and self.selector.select(remaining), "adapter_timeout")
            chunk = os.read(self.process.stdout.fileno(), 65536)
            require(bool(chunk), "adapter_pipe_closed")
            self.buffer += chunk
            require(len(self.buffer) <= 1024 * 1024, "adapter_response_size_limit")
        line, self.buffer = self.buffer.split(b"\n", 1)
        try:
            response = json.loads(line)
        except (ValueError, UnicodeError):
            raise PlaytestError("adapter_invalid_json") from None
        require(isinstance(response, dict) and response.get("id") == ident, "adapter_response_id_mismatch")
        require(response.get("ok") is True, "adapter_operation_failed")
        require(isinstance(response.get("result"), dict), "adapter_invalid_result")
        return response["result"]

    def hello(self):
        return self._request("hello")

    def observe(self):
        return self._request("observe")

    def act(self, action, *, max_frames):
        return self._request("act", action=action, max_frames=max_frames)

    def close(self):
        try:
            if self.process.poll() is None:
                self._request("close")
        finally:
            if self.process.poll() is None:
                try:
                    os.killpg(self.process.pid, signal.SIGTERM)
                    self.process.wait(timeout=1)
                except (ProcessLookupError, subprocess.TimeoutExpired):
                    if self.process.poll() is None:
                        os.killpg(self.process.pid, signal.SIGKILL)
                        self.process.wait(timeout=1)
            self.selector.close()
            self.process.stdin.close()
            self.process.stdout.close()
