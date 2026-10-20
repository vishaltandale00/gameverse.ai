"""One causal session over two complete, source-built GBA engines.

The engines retain independent native savestates, including regional world and
save data. Only a source-originated travel event can change the active engine.
The source bridge owns validation and import of the traveling trainer/party.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import time
import uuid


REGIONS = ("emerald", "firered")
ROLLBACK_SLOT = 31
COPY_SLOT = 30
FORMAT = "whole-game-session-state/1"
MAILBOX_BYTES = 648
PAYLOAD_OFFSET = 32
REGION_NUMBER = {"firered": 1, "emerald": 2}
MAX_TRANSFER_FRAMES = 180


def _u32(raw: bytes, offset: int) -> int:
    return struct.unpack_from("<I", raw, offset)[0]


def _fnv1a(raw: bytes) -> int:
    value = 2166136261
    for byte in raw:
        value = ((value ^ byte) * 16777619) & 0xFFFFFFFF
    return value


@dataclass(frozen=True)
class TravelEvent:
    source: str
    target: str
    identity: str
    sequence: int
    payload: bytes
    crc: int


@dataclass(frozen=True)
class TravelRejection:
    source: str
    sequence: int
    error: str


class SourceBridge:
    """Exact source `gWholeGameBridge` ABI; bot inputs never reach this writer."""

    def __init__(self, profiles: dict, *, initialized_regions=("emerald",)):
        if set(profiles) != set(REGIONS):
            raise ValueError("bridge_profile_requires_both_regions")
        for region, profile in profiles.items():
            if profile.get("bytes") != MAILBOX_BYTES or not isinstance(profile.get("address"), int):
                raise ValueError(f"invalid_bridge_profile_{region}")
        self.profiles = copy.deepcopy(profiles)
        self.initialized_regions = set(initialized_regions)
        from tools.whole_game.elf_symbols import symbol
        self.party_count_addresses = {}
        self.callback_addresses = {}
        self.callback_targets = {}
        for region in REGIONS:
            elf = self.profiles[region]["elf"]
            path = Path(elf["path"])
            if digest(path) != elf["sha256"]:
                raise ValueError("bridge_elf_hash_mismatch")
            address, size = symbol(path, "gPlayerPartyCount")
            if size != 1 or not 0x02000000 <= address < 0x02040000:
                raise ValueError("invalid_native_party_count_symbol")
            self.party_count_addresses[region] = address
            main_address, main_size = symbol(path, "gMain")
            if main_size < 8 or not 0x03000000 <= main_address + 4 < 0x03008000:
                raise ValueError("invalid_source_main_symbol")
            self.callback_addresses[region] = main_address + 4
            targets = {}
            for name in ("CB2_Overworld", "CB2_NewGame", "CB2_InitCopyrightScreen",
                         "CB2_MainMenu", "CB2_ContinueSavedGame",
                         "CB2_InitCopyrightScreenAfterBootup",
                         "CB2_InitCopyrightScreenAfterTitleScreen", "MainCB2_Intro",
                         "CB2_Intro"):
                try:
                    targets[name] = symbol(path, name)[0]
                except ValueError:
                    pass
            self.callback_targets[region] = targets

    def _read(self, region: str, engine) -> bytes:
        address = self.profiles[region]["address"]
        raw = b"".join(engine.read_memory(address + offset, min(256, MAILBOX_BYTES - offset))
                       for offset in range(0, MAILBOX_BYTES, 256))
        if len(raw) != MAILBOX_BYTES or _u32(raw, 0) != 0x57474D31 or _u32(raw, 4) != 1 or \
                _u32(raw, 8) != REGION_NUMBER[region]:
            raise ValueError("invalid_source_bridge_header")
        return raw

    def prime(self, region: str, engine, *, max_frames: int = 60) -> int:
        """Let the source's first native callback initialize its EWRAM bridge."""
        for advanced in range(max_frames + 1):
            try:
                self._read(region, engine)
                return advanced
            except ValueError as error:
                if str(error) != "invalid_source_bridge_header" or advanced == max_frames:
                    raise
            receipt = engine.act({"keys": [], "frames": 1}, 1)
            if receipt.get("frames") != 1:
                raise ValueError("source_bridge_prime_did_not_advance")
        raise AssertionError("unreachable")

    @staticmethod
    def _write(engine, offset: int, raw: bytes) -> None:
        if not 0 <= offset < MAILBOX_BYTES or offset + len(raw) > MAILBOX_BYTES:
            raise ValueError("invalid_mailbox_write")
        # The low-level process independently enforces the ELF-verified span.
        engine.write_mailbox(offset, raw)

    def poll(self, region: str, engine) -> TravelEvent | TravelRejection | None:
        raw = self._read(region, engine)
        command, status = _u32(raw, 16), _u32(raw, 20)
        if command == 1 and status == 4:
            sequence = _u32(raw, 12)
            self._write(engine, 16, b"\0" * 8)
            return TravelRejection(region, sequence, f"source_export_error_{_u32(raw, 24)}")
        if status == 4:
            raise ValueError(f"source_bridge_error_{_u32(raw, 24)}")
        if command != 1 or status != 2:
            return None
        payload = raw[PAYLOAD_OFFSET:]
        crc = _u32(raw, 28)
        if crc != _fnv1a(payload) or payload[14] != REGION_NUMBER[region] or payload[13] > 6:
            raise ValueError("invalid_source_export_payload")
        sequence = _u32(raw, 12)
        if not sequence:
            raise ValueError("missing_source_event_sequence")
        target = next(name for name in REGIONS if name != region)
        identity = f"{region}:{sequence}:{hashlib.sha256(payload).hexdigest()}"
        return TravelEvent(region, target, identity, sequence, payload, crc)

    def observe_facts(self, region: str, engine) -> dict:
        raw = self._read(region, engine)
        count = engine.read_memory(self.party_count_addresses[region], 1)[0]
        if count > 6:
            raise ValueError("invalid_native_party_count")
        command, status = _u32(raw, 16), _u32(raw, 20)
        callback = int.from_bytes(engine.read_memory(self.callback_addresses[region], 4), "little")
        callback_name = next((name for name, address in self.callback_targets[region].items()
                              if address & ~1 == callback & ~1), None)
        facts = {"source_region": region, "bridge_command": command,
                 "bridge_status": status, "bridge_sequence": _u32(raw, 12),
                 "bridge_error": _u32(raw, 24), "native_party_count": count,
                 "source_callback2": callback, "source_callback2_name": callback_name,
                 "noninteractive_wait_safe": callback_name in (
                     "CB2_InitCopyrightScreenAfterBootup",
                     "CB2_InitCopyrightScreenAfterTitleScreen")}
        if command == 1 and status == 2:
            facts["source_party_count"] = raw[45]
            facts["source_party_sha256"] = hashlib.sha256(raw[PAYLOAD_OFFSET:]).hexdigest()
        return facts

    def import_to(self, region: str, engine, event: TravelEvent, *, max_frames: int = MAX_TRANSFER_FRAMES) -> int:
        if region != event.target or event.source == region or _fnv1a(event.payload) != event.crc:
            raise ValueError("invalid_transfer_payload")
        before = self._read(region, engine)
        if _u32(before, 20) == 1:
            raise ValueError("destination_bridge_busy")
        sequence = max(event.sequence, _u32(before, 12)) + 1
        if sequence > 0xFFFFFFFF:
            raise ValueError("bridge_sequence_exhausted")
        bootstrap = region not in self.initialized_regions
        payload = event.payload
        if bootstrap:
            # Source new-game scripts must award the destination starter. Hold
            # travelers in the journal until that native party slot exists.
            identity_only = bytearray(payload)
            identity_only[13] = 0
            identity_only[16:] = b"\0" * (len(identity_only) - 16)
            payload = bytes(identity_only)
        self._write(engine, PAYLOAD_OFFSET, payload)
        self._write(engine, 28, struct.pack("<I", _fnv1a(payload)))
        self._write(engine, 12, struct.pack("<I", sequence))
        self._write(engine, 24, b"\0" * 4)
        self._write(engine, 16, struct.pack("<II", 3 if bootstrap else 2, 1))
        advanced = 0
        while advanced < max_frames:
            step = min(6, max_frames - advanced)
            engine.act({"keys": [], "frames": step}, step)
            advanced += step
            state = self._read(region, engine)
            status = _u32(state, 20)
            if bootstrap and status == 2:
                # The original title/intro and native CB2_NewGame now run from
                # subsequent bot actions. No host-authored gameplay input.
                return advanced
            if status == 3:
                self._write(engine, 16, b"\0" * 8)
                self.initialized_regions.add(region)
                return advanced
            if status == 4:
                raise ValueError(f"source_import_error_{_u32(state, 24)}")
        raise TimeoutError("source_import_frame_limit")

    def ready_for_merge(self, region: str, engine, event: TravelEvent) -> bool:
        state = self._read(region, engine)
        if _u32(state, 16) == 3 and _u32(state, 20) == 3:
            self._write(engine, 16, b"\0" * 8)
            self.initialized_regions.add(region)
            return False
        if _u32(state, 20) != 5:
            return False
        count = engine.read_memory(self.party_count_addresses[region], 1)[0]
        if count > 6:
            raise ValueError("invalid_native_party_count")
        return count >= 1 and count + event.payload[13] <= 6

    def merge_to(self, region: str, engine, event: TravelEvent, *, max_frames: int = MAX_TRANSFER_FRAMES) -> int:
        if not self.ready_for_merge(region, engine, event):
            raise ValueError("native_starter_or_party_room_missing")
        before = self._read(region, engine)
        sequence = max(event.sequence, _u32(before, 12)) + 1
        if sequence > 0xFFFFFFFF:
            raise ValueError("bridge_sequence_exhausted")
        self._write(engine, PAYLOAD_OFFSET, event.payload)
        self._write(engine, 28, struct.pack("<I", event.crc))
        self._write(engine, 12, struct.pack("<I", sequence))
        self._write(engine, 24, b"\0" * 4)
        self._write(engine, 16, struct.pack("<II", 4, 1))
        advanced = 0
        while advanced < max_frames:
            step = min(6, max_frames - advanced)
            engine.act({"keys": [], "frames": step}, step)
            advanced += step
            state = self._read(region, engine)
            status = _u32(state, 20)
            if status == 3:
                self._write(engine, 16, b"\0" * 8)
                return advanced
            if status == 4:
                raise ValueError(f"source_merge_error_{_u32(state, 24)}")
        raise TimeoutError("source_merge_frame_limit")

    def acknowledge(self, region: str, engine, event: TravelEvent) -> None:
        raw = self._read(region, engine)
        if _u32(raw, 16) != 1 or _u32(raw, 20) != 2 or _u32(raw, 12) != event.sequence:
            raise ValueError("source_event_changed_before_ack")
        self._write(engine, 16, b"\0" * 8)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def _durable_json(path: Path, value: dict) -> None:
    with path.open("x") as file:
        json.dump(value, file, sort_keys=True, indent=2)
        file.write("\n")
        file.flush()
        os.fsync(file.fileno())


def _sync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class CompositionSession:
    """Coordinate two isolated native cores through a source mailbox codec.

    `engines` contains two ``tools.re.session.bridge.NativeSession`` compatible
    objects. `bridge` is a source-pinned codec with ``poll``, ``import_to``, and
    ``acknowledge`` methods. No public operation can request a region switch.
    """

    def __init__(self, engines: dict, bridge, manifest: dict, out: Path,
                 *, active: str = "emerald", max_action_frames: int = 120):
        if set(engines) != set(REGIONS) or active not in REGIONS:
            raise ValueError("composition_requires_two_engines")
        if not 1 <= max_action_frames <= 120:
            raise ValueError("invalid_action_limit")
        if manifest.get("format") != "whole-source-composition/1" or not manifest.get("bundleSha256"):
            raise ValueError("invalid_composition_manifest")
        sources = {item["id"]: item for item in manifest["sources"]}
        if set(sources) != set(REGIONS):
            raise ValueError("composition_source_mismatch")
        for region in REGIONS:
            if engines[region].game_version != sources[region]["rom"]["sha256"]:
                raise ValueError("engine_rom_mismatch")
        self.engines = engines
        self.bridge = bridge
        self.manifest = copy.deepcopy(manifest)
        self.bundle_sha256 = manifest["bundleSha256"]
        self.out = Path(out).resolve()
        self.out.mkdir(parents=True, exist_ok=True)
        self.checkpoint_dir = self.out / "composition-checkpoints"
        self.checkpoint_dir.mkdir(exist_ok=True)
        self.journal_dir = self.out / "composition-journal"
        self.journal_dir.mkdir(exist_ok=True)
        self.session_id = uuid.uuid4().hex
        self.active = active
        self.frame = 0
        self.region_frames = {region: 0 for region in REGIONS}
        self.max_action_frames = max_action_frames
        self.transfers: list[dict] = []
        self.completed_events: set[str] = set()
        self.last_event_sequence = {region: 0 for region in REGIONS}
        self.pending_event: TravelEvent | None = None
        self.last_rejection: dict | None = None
        self.restored_observation = None
        self.initialization_frames = 0
        self.runtime_identity = self._runtime_identity()
        if hasattr(self.bridge, "prime"):
            for region in REGIONS:
                advanced = self.bridge.prime(region, self.engines[region])
                self.region_frames[region] += advanced
                self.frame += advanced
                self.initialization_frames += advanced

    def _runtime_identity(self) -> dict:
        engines = {}
        for region, engine in self.engines.items():
            executable = getattr(getattr(engine, "process", None), "args", [None])[0]
            binary_hash = digest(Path(executable)) if executable else getattr(
                engine, "native_binary_sha256", None)
            if not binary_hash or not getattr(engine, "emulator", None):
                raise ValueError("missing_native_runtime_identity")
            engines[region] = {"nativeBinarySha256": binary_hash,
                               "emulator": copy.deepcopy(engine.emulator)}
        return {"adapterVersion": "whole-game-native-composition/1",
                "sessionSourceSha256": digest(Path(__file__)), "engines": engines}

    @property
    def engine(self):
        return self.engines[self.active]

    def hello(self) -> dict:
        return {
            "schema_version": 1, "adapter_version": "whole-game-native-composition/1",
            "session_id": self.session_id, "isolated": True,
            "game_id": "pokemon-emerald-firered-whole-source",
            "game_version": self.bundle_sha256,
            "capabilities": ["observe", "act", "checkpoint", "restore"],
            "max_action_frames": self.max_action_frames,
            "max_integration_frames": MAX_TRANSFER_FRAMES,
            "initialization_frames": self.initialization_frames,
            "composition": {"regions": list(REGIONS), "active": self.active,
                            "bundle_sha256": self.bundle_sha256},
        }

    def observe(self) -> dict:
        if self.restored_observation is not None:
            return copy.deepcopy(self.restored_observation)
        observation = self.engine.observe()
        facts = self.bridge.observe_facts(self.active, self.engine)
        observation.setdefault("facts", {}).update(facts)
        observation.setdefault("progress", {}).update({
            "source_callback2": facts["source_callback2_name"] or hex(facts["source_callback2"]),
            "native_party_count": facts["native_party_count"],
            "bridge_status": facts["bridge_status"],
        })
        if self.last_rejection is not None:
            observation["facts"]["last_travel_rejection"] = copy.deepcopy(self.last_rejection)
        command, status = facts["bridge_command"], facts["bridge_status"]
        if command == 1 and status == 2:
            observation["phase"] = "source_travel_ready"
        elif command == 3 and status == 2:
            observation["phase"] = "native_intro"
        elif status == 5:
            observation["phase"] = "native_party_merge_ready"
        elif self.pending_event is not None:
            observation["phase"] = "native_onboarding"
        observation["frame"] = self.frame
        observation["region"] = self.active
        observation["composition"] = {
            "active": self.active, "region_frames": dict(self.region_frames),
            "completed_transfers": len(self.transfers),
            "pending_merge": self.pending_event is not None,
            "pending_travelers": self.pending_event.payload[13] if self.pending_event else 0,
            "bundle_sha256": self.bundle_sha256,
        }
        # Source facts may describe local progress; the coordinator does not
        # infer success for either campaign from pixels or a travel event.
        observation.setdefault("terminal", False)
        observation.setdefault("success", False)
        observation.setdefault("progress", {})
        return observation

    def act(self, action: dict, limit: int | None = None) -> dict:
        requested = action.get("frames")
        total_limit = limit if limit is not None else self.max_action_frames + MAX_TRANSFER_FRAMES
        bound = min(self.max_action_frames, total_limit)
        if type(requested) is not int or not 1 <= requested <= bound:
            raise ValueError("invalid_action")
        source = self.active
        action_result = self.engine.act(action, bound)
        advanced = action_result.get("frames")
        if type(advanced) is not int or not 0 <= advanced <= requested:
            raise ValueError("invalid_native_frame_receipt")
        self.frame += advanced
        self.region_frames[source] += advanced
        self.restored_observation = None
        integration_budget = total_limit - advanced
        transfer = None
        if self.pending_event is not None:
            if self.active != self.pending_event.target:
                raise ValueError("pending_merge_region_mismatch")
            ready = self.bridge.ready_for_merge(self.active, self.engine, self.pending_event)
            if integration_budget >= MAX_TRANSFER_FRAMES and ready:
                transfer = self._merge_pending()
            else:
                transfer = {"id": self.pending_event.identity, "pending_merge": True,
                            "integration_frames": 0}
        else:
            event = self.bridge.poll(source, self.engines[source])
            if isinstance(event, TravelRejection):
                self.last_event_sequence[source] = max(self.last_event_sequence[source], event.sequence)
                self.last_rejection = {"source": source, "sequence": event.sequence,
                                       "reason": event.error}
                self._persist_rejection()
                transfer = {"rejected": event.error, "integration_frames": 0}
            elif event is not None:
                transfer = self._transfer(event, integration_budget)
        integration_frames = (transfer or {}).get("integration_frames", 0)
        return {"frames": advanced + integration_frames,
                "action_frames": advanced, "integration_frames": integration_frames,
                "region": self.active, "transfer": transfer}

    def _metadata(self) -> dict:
        return {
            "format": FORMAT, "bundleSha256": self.bundle_sha256,
            "runtimeIdentity": copy.deepcopy(self.runtime_identity),
            "active": self.active, "frame": self.frame,
            "regionFrames": dict(self.region_frames),
            "transfers": copy.deepcopy(self.transfers),
            "completedEvents": sorted(self.completed_events),
            "lastEventSequence": dict(self.last_event_sequence),
            "initializedRegions": sorted(self.bridge.initialized_regions),
            "pendingEvent": ({"source": self.pending_event.source, "target": self.pending_event.target,
                              "identity": self.pending_event.identity, "sequence": self.pending_event.sequence,
                              "payload": self.pending_event.payload.hex(), "crc": self.pending_event.crc}
                             if self.pending_event is not None else None),
            "lastRejection": copy.deepcopy(self.last_rejection),
        }

    def _capture(self, folder: Path, slot: int, *, metadata: dict | None = None) -> dict:
        folder.mkdir(parents=True, exist_ok=False)
        files = {}
        for region in REGIONS:
            engine = self.engines[region]
            engine._command(f"save {slot}")
            source = engine.out / f"checkpoint-{slot}.ss"
            target = folder / f"{region}.ss"
            shutil.copyfile(source, target)
            with target.open("rb") as file:
                os.fsync(file.fileno())
            files[region] = {"sha256": digest(target), "bytes": target.stat().st_size}
        record = dict(metadata or self._metadata(), files=files)
        observation = self.observe()
        image = observation.get("image")
        if image and Path(image).is_file():
            image_target = folder / "observation.png"
            shutil.copyfile(image, image_target)
            with image_target.open("rb") as file:
                os.fsync(file.fileno())
            record["observation"] = dict(observation, image="observation.png")
            record["observationSha256"] = digest(image_target)
        _durable_json(folder / "state.json", record)
        _sync_directory(folder)
        return record

    def checkpoint(self) -> dict:
        token = uuid.uuid4().hex
        target = self.checkpoint_dir / token
        staging = self.checkpoint_dir / f".{token}.tmp"
        try:
            self._capture(staging, COPY_SLOT)
            os.replace(staging, target)
            _sync_directory(self.checkpoint_dir)
            return {"checkpoint": token, "frame": self.frame,
                    "bundle_sha256": self.bundle_sha256, "path": str(target)}
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            raise

    def _validate_snapshot(self, folder: Path) -> dict:
        record = json.loads((folder / "state.json").read_text())
        if record.get("format") != FORMAT or record.get("bundleSha256") != self.bundle_sha256:
            raise ValueError("incompatible_composition_state")
        if record.get("runtimeIdentity") != self.runtime_identity:
            raise ValueError("incompatible_native_runtime_state")
        for region in REGIONS:
            source = folder / f"{region}.ss"
            pin = record["files"][region]
            if digest(source) != pin["sha256"] or source.stat().st_size != pin["bytes"]:
                raise ValueError("corrupt_composition_state")
        if "observation" in record and digest(folder / "observation.png") != record["observationSha256"]:
            raise ValueError("corrupt_composition_observation")
        return record

    def _load(self, folder: Path, record: dict) -> None:
        for region in REGIONS:
            engine = self.engines[region]
            shutil.copyfile(folder / f"{region}.ss", engine.out / f"checkpoint-{COPY_SLOT}.ss")
            engine._command(f"load {COPY_SLOT}")
            engine.frame = record["regionFrames"][region]
        self.active = record["active"]
        self.frame = record["frame"]
        self.region_frames = dict(record["regionFrames"])
        self.transfers = copy.deepcopy(record["transfers"])
        self.completed_events = set(record["completedEvents"])
        self.last_event_sequence = dict(record.get("lastEventSequence", {region: 0 for region in REGIONS}))
        self.bridge.initialized_regions = set(record["initializedRegions"])
        pending = record.get("pendingEvent")
        self.pending_event = TravelEvent(pending["source"], pending["target"], pending["identity"],
                                         pending["sequence"], bytes.fromhex(pending["payload"]),
                                         pending["crc"]) if pending else None
        self.last_rejection = copy.deepcopy(record.get("lastRejection"))
        self.restored_observation = copy.deepcopy(record.get("observation"))
        if self.restored_observation is not None:
            self.restored_observation["image"] = str(folder / "observation.png")

    def restore(self, token: str) -> dict:
        if not isinstance(token, str) or len(token) != 32 or any(c not in "0123456789abcdef" for c in token):
            raise ValueError("invalid_checkpoint")
        folder = self.checkpoint_dir / token
        return self.restore_path(folder)

    def restore_path(self, folder: Path) -> dict:
        """Load an exact-bundle checkpoint from this or a previous private run."""
        folder = Path(folder).resolve()
        record = self._validate_snapshot(folder)
        rollback = self.journal_dir / f"restore-{uuid.uuid4().hex}"
        pre = self._capture(rollback, ROLLBACK_SLOT)
        try:
            self._load(folder, record)
            self._publish_head(folder)
        except BaseException:
            self._load(rollback, pre)
            raise
        return {"frame": self.frame, "region": self.active}

    def _publish_head(self, folder: Path) -> None:
        folder = Path(folder).resolve()
        head = {"format": FORMAT, "bundleSha256": self.bundle_sha256,
                "snapshot": str(folder), "metadataSha256": digest(folder / "state.json")}
        temporary = self.out / f".composition-head-{uuid.uuid4().hex}.tmp"
        _durable_json(temporary, head)
        os.replace(temporary, self.out / "composition-head.json")
        _sync_directory(self.out)

    def _persist_rejection(self) -> None:
        folder = self.journal_dir / f"rejected-{uuid.uuid4().hex}"
        self._capture(folder, COPY_SLOT)
        self._publish_head(folder)

    def recover_head(self) -> dict:
        """Rehydrate the last atomically published composition head."""
        head = json.loads((self.out / "composition-head.json").read_text())
        if head.get("format") != FORMAT or head.get("bundleSha256") != self.bundle_sha256:
            raise ValueError("incompatible_composition_head")
        folder = Path(head["snapshot"]).resolve()
        if digest(folder / "state.json") != head["metadataSha256"]:
            raise ValueError("corrupt_composition_head")
        record = self._validate_snapshot(folder)
        self._load(folder, record)
        return {"frame": self.frame, "region": self.active}

    def _transfer(self, event, integration_budget: int) -> dict:
        """Commit only a source event with stable identity and destination."""
        source = self.active
        if event.source != source or event.target not in REGIONS or event.target == source:
            raise ValueError("invalid_source_travel_event")
        if event.identity in self.completed_events:
            self.bridge.acknowledge(source, self.engines[source], event)
            return {"id": event.identity, "replayed": True, "integration_frames": 0}
        if event.sequence <= self.last_event_sequence[source]:
            raise ValueError("source_event_sequence_reused")
        if event.target not in self.bridge.initialized_regions and event.payload[13] > 5:
            self.bridge.acknowledge(source, self.engines[source], event)
            self.last_event_sequence[source] = event.sequence
            self.last_rejection = {"source": source, "sequence": event.sequence,
                                   "reason": "first_arrival_requires_party_room_for_starter"}
            self._persist_rejection()
            return {"id": event.identity, "rejected": "first_arrival_requires_party_room_for_starter",
                    "integration_frames": 0}
        if integration_budget < MAX_TRANSFER_FRAMES:
            return {"id": event.identity, "pending_budget": True, "integration_frames": 0}
        rollback = self.journal_dir / f"travel-{uuid.uuid4().hex}"
        started = time.monotonic()
        pre = self._capture(rollback, ROLLBACK_SLOT)
        try:
            # Import is source-native. It must validate the shared trainer and
            # chosen six travelers before this coordinator changes active world.
            first_arrival = event.target not in self.bridge.initialized_regions
            extra_frames = self.bridge.import_to(event.target, self.engines[event.target], event,
                                                 max_frames=integration_budget)
            if type(extra_frames) is not int or extra_frames < 0:
                raise ValueError("invalid_bridge_frame_accounting")
            self.frame += extra_frames
            self.region_frames[event.target] += extra_frames
            self.bridge.acknowledge(source, self.engines[source], event)
            self.active = event.target
            self.completed_events.add(event.identity)
            self.last_event_sequence[source] = event.sequence
            if first_arrival:
                self.pending_event = event
            receipt = {"id": event.identity, "source": source, "target": event.target,
                       "frame": self.frame, "integration_frames": extra_frames,
                       "pending_merge": first_arrival,
                       "wall_ms": round((time.monotonic() - started) * 1000)}
            self.transfers.append(receipt)
            self.last_rejection = None
            self._capture(rollback / "post", COPY_SLOT)
            _durable_json(rollback / "committed.json", receipt)
            _sync_directory(rollback)
            self._publish_head(rollback / "post")
            self.restored_observation = None
            return receipt
        except Exception as error:
            self._load(rollback, pre)
            self.restored_observation = None
            # A rejected native import must not strand the player at the frozen
            # source export. Its preimage remains in the journal for inspection.
            self.bridge.acknowledge(source, self.engines[source], event)
            self.last_event_sequence[source] = event.sequence
            self.last_rejection = {"source": source, "sequence": event.sequence,
                                   "reason": str(error), "preimage": str(rollback)}
            self._capture(rollback / "rejected", COPY_SLOT)
            self._publish_head(rollback / "rejected")
            return {"id": event.identity, "rejected": str(error), "integration_frames": 0,
                    "preimage": str(rollback)}

    def _merge_pending(self) -> dict:
        event = self.pending_event
        if event is None:
            raise ValueError("no_pending_merge")
        rollback = self.journal_dir / f"merge-{uuid.uuid4().hex}"
        pre = self._capture(rollback, ROLLBACK_SLOT)
        started = time.monotonic()
        try:
            frames = self.bridge.merge_to(self.active, self.engine, event)
            self.frame += frames
            self.region_frames[self.active] += frames
            self.pending_event = None
            receipt = {"id": event.identity + ":merge", "source": event.source,
                       "target": event.target, "frame": self.frame,
                       "integration_frames": frames,
                       "wall_ms": round((time.monotonic() - started) * 1000)}
            self.transfers.append(receipt)
            self._capture(rollback / "post", COPY_SLOT)
            _durable_json(rollback / "committed.json", receipt)
            _sync_directory(rollback)
            self._publish_head(rollback / "post")
            self.restored_observation = None
            return receipt
        except BaseException:
            self._load(rollback, pre)
            self.restored_observation = None
            raise

    def close(self) -> None:
        errors = []
        for engine in self.engines.values():
            try:
                engine.close()
            except Exception as error:
                errors.append(error)
        if errors:
            raise errors[0]
