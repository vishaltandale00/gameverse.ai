"""Focused state and failure tests for the two-core composition transaction."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import struct

from tools.whole_game.session import CompositionSession, SourceBridge, TravelEvent, _fnv1a, digest


class FakeEngine:
    def __init__(self, out, game_version):
        self.out = Path(out)
        self.out.mkdir()
        self.game_version = game_version
        self.native_binary_sha256 = "fake-native-binary-v1"
        self.emulator = {"name": "fake-mgba", "version": "1", "bios": "fake", "rtc": "fixed"}
        self.frame = 0
        self.state = {"ticks": 0, "party": "local"}

    def _command(self, command):
        op, slot = command.split()
        file = self.out / f"checkpoint-{slot}.ss"
        if op == "save":
            file.write_text(json.dumps(self.state))
        elif op == "load":
            self.state = json.loads(file.read_text())
        else:
            raise AssertionError(command)
        return "state"

    def act(self, action, limit):
        advanced = min(action["frames"], limit, getattr(self, "stop_after", action["frames"]))
        self.state["ticks"] += advanced
        self.frame += advanced
        return {"frames": advanced}

    def observe(self):
        return {"frame": self.frame, "state_key": str(self.state), "phase": "field",
                "facts": {}, "progress": {}, "terminal": False, "success": False}

    def close(self):
        pass


class FakeBridge:
    def __init__(self, event=None, fail_import=False):
        self.initialized_regions = {"emerald", "firered"}
        self.event = event
        self.fail_import = fail_import

    def poll(self, region, engine):
        return self.event if region == "emerald" else None

    def observe_facts(self, region, engine):
        return {"bridge_command": 0, "bridge_status": 0, "native_party_count": 1,
                "source_callback2": 0, "source_callback2_name": "CB2_Overworld"}

    def import_to(self, region, engine, event, *, max_frames):
        engine.state["party"] = "travelers"
        engine.act({"frames": 3}, 3)
        if self.fail_import:
            raise RuntimeError("native_import_failure")
        return 3

    def acknowledge(self, region, engine, event):
        engine.state["export_acked"] = True
        self.event = None


class CompositionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.engines = {name: FakeEngine(self.root / name, name + "-hash")
                        for name in ("emerald", "firered")}
        payload = bytearray(616)
        payload[13] = 1
        self.event = TravelEvent("emerald", "firered", "emerald:1:payload", 1,
                                 bytes(payload), 0)
        self.manifest = {"format": "whole-source-composition/1", "bundleSha256": "exact-bundle",
                         "sources": [{"id": name, "rom": {"sha256": name + "-hash"}}
                                     for name in ("emerald", "firered")]}

    def tearDown(self):
        self.temp.cleanup()

    def session(self, bridge):
        return CompositionSession(self.engines, bridge, self.manifest, self.root / "run")

    def test_transfer_commit_and_portable_restore_both_worlds(self):
        bridge = FakeBridge(self.event)
        session = self.session(bridge)
        before = session.checkpoint()["checkpoint"]
        receipt = session.act({"keys": [], "frames": 2}, 182)
        self.assertEqual(receipt["frames"], 5)
        self.assertEqual(session.active, "firered")
        self.assertEqual(self.engines["firered"].state["party"], "travelers")
        self.assertTrue(self.engines["emerald"].state["export_acked"])
        self.assertTrue((session.out / "composition-head.json").is_file())
        after = session.checkpoint()["checkpoint"]
        session.restore(before)
        self.assertEqual(session.active, "emerald")
        self.assertEqual(self.engines["emerald"].state["ticks"], 0)
        self.assertEqual(self.engines["firered"].state["party"], "local")
        session.restore_path(session.checkpoint_dir / after)
        self.assertEqual(session.active, "firered")
        self.assertEqual(self.engines["firered"].state["party"], "travelers")

    def test_native_import_failure_rolls_back_both_worlds(self):
        session = self.session(FakeBridge(self.event, fail_import=True))
        receipt = session.act({"keys": [], "frames": 1}, 181)
        self.assertEqual(receipt["transfer"]["rejected"], "native_import_failure")
        self.assertEqual(session.active, "emerald")
        self.assertEqual(self.engines["firered"].state["party"], "local")
        self.assertEqual(self.engines["emerald"].state["ticks"], 1)
        self.assertTrue(self.engines["emerald"].state["export_acked"])
        self.assertTrue((session.out / "composition-head.json").exists())

    def test_commit_publication_failure_restores_preimage(self):
        session = self.session(FakeBridge(self.event))
        with patch.object(session, "_publish_head", side_effect=OSError("disk_full")):
            with self.assertRaisesRegex(OSError, "disk_full"):
                session.act({"keys": [], "frames": 1}, 181)
        self.assertEqual(session.active, "emerald")
        self.assertEqual(self.engines["firered"].state["party"], "local")
        self.assertEqual(session.last_event_sequence["emerald"], 1)
        self.assertTrue(self.engines["emerald"].state["export_acked"])
        self.assertTrue(list(session.journal_dir.glob("travel-*/emerald.ss")))

    def test_exact_bundle_and_sequence_reuse_fail_closed(self):
        session = self.session(FakeBridge(self.event))
        session.last_event_sequence["emerald"] = 1
        with self.assertRaisesRegex(ValueError, "sequence_reused"):
            session.act({"keys": [], "frames": 1}, 181)
        self.assertEqual(session.active, "emerald")
        token = session.checkpoint()["checkpoint"]
        session.bundle_sha256 = "other-bundle"
        with self.assertRaisesRegex(ValueError, "incompatible_composition_state"):
            session.restore(token)

    def test_six_travelers_rejects_before_first_arrival_and_source_resumes(self):
        payload = bytearray(self.event.payload)
        payload[13] = 6
        event = TravelEvent("emerald", "firered", "emerald:1:six", 1, bytes(payload), 0)
        bridge = FakeBridge(event)
        bridge.initialized_regions = {"emerald"}
        session = self.session(bridge)
        receipt = session.act({"keys": [], "frames": 2}, 182)
        self.assertEqual(receipt["transfer"]["rejected"],
                         "first_arrival_requires_party_room_for_starter")
        self.assertEqual(session.active, "emerald")
        self.assertTrue(self.engines["emerald"].state["export_acked"])
        self.assertEqual(self.engines["firered"].state["party"], "local")
        second = session.act({"keys": ["DOWN"], "frames": 3}, 183)
        self.assertEqual(second["frames"], 3)

    def test_native_breakpoint_receipt_controls_frame_accounting(self):
        self.engines["emerald"].stop_after = 1
        session = self.session(FakeBridge(self.event))
        result = session.act({"keys": ["RIGHT"], "frames": 20}, 200)
        self.assertEqual(result["action_frames"], 1)
        self.assertEqual(result["integration_frames"], 3)
        self.assertEqual(result["frames"], 4)
        self.assertEqual(session.frame, 4)

    def test_portable_restore_rejects_emulator_version_change(self):
        session = self.session(FakeBridge())
        path = Path(session.checkpoint()["path"])
        self.engines["firered"].emulator["version"] = "2"
        fresh = CompositionSession(self.engines, FakeBridge(), self.manifest, self.root / "fresh")
        with self.assertRaisesRegex(ValueError, "incompatible_native_runtime_state"):
            fresh.restore_path(path)


class MailboxProtocolTests(unittest.TestCase):
    def test_export_bootstrap_native_intro_and_starter_merge(self):
        with tempfile.TemporaryDirectory() as temp:
            elf = Path(temp) / "source.elf"
            elf.write_bytes(b"fake exact ELF for symbol stub")
            profile = {"rom_sha256": "rom", "elf": {"path": str(elf), "sha256": digest(elf)},
                       "address": 0x02010000, "bytes": 648}
            symbols = {"gPlayerPartyCount": (0x02020000, 1), "gMain": (0x03000000, 1084),
                       "CB2_Overworld": (0x08001001, 44), "CB2_NewGame": (0x08002001, 44)}
            def fake_symbol(_path, name):
                if name not in symbols:
                    raise ValueError("missing_or_ambiguous_source_symbol")
                return symbols[name]
            with patch("tools.whole_game.elf_symbols.symbol", side_effect=fake_symbol):
                codec = SourceBridge({"emerald": profile, "firered": profile},
                                     initialized_regions={"emerald"})

            class MailboxEngine:
                def __init__(self, region):
                    self.mailbox = bytearray(648)
                    struct.pack_into("<III", self.mailbox, 0, 0x57474D31, 1,
                                     1 if region == "firered" else 2)
                    self.party_count = 0

                def read_memory(self, address, length):
                    if 0x02010000 <= address < 0x02010000 + 648:
                        start = address - 0x02010000
                        return bytes(self.mailbox[start:start + length])
                    if address == 0x02020000:
                        return bytes([self.party_count])
                    if address == 0x03000004:
                        return struct.pack("<I", 0x08001001)
                    raise AssertionError(hex(address))

                def write_mailbox(self, offset, raw):
                    self.mailbox[offset:offset + len(raw)] = raw

                def act(self, action, limit):
                    if struct.unpack_from("<II", self.mailbox, 16) == (3, 1):
                        struct.pack_into("<I", self.mailbox, 20, 2)
                    elif struct.unpack_from("<II", self.mailbox, 16) == (4, 1):
                        struct.pack_into("<I", self.mailbox, 20, 3)
                    return {"frames": action["frames"]}

            source = MailboxEngine("emerald")
            destination = MailboxEngine("firered")
            payload = bytearray(616)
            payload[13] = 1
            payload[14] = 2
            crc = _fnv1a(payload)
            source.mailbox[32:] = payload
            struct.pack_into("<IIIII", source.mailbox, 12, 1, 1, 2, 0, crc)
            event = codec.poll("emerald", source)
            self.assertEqual(event.sequence, 1)
            self.assertEqual(event.target, "firered")
            self.assertEqual(codec.import_to("firered", destination, event), 6)
            self.assertEqual(destination.mailbox[45], 0)  # identity-only bootstrap
            self.assertEqual(struct.unpack_from("<II", destination.mailbox, 16), (3, 2))
            self.assertFalse(codec.ready_for_merge("firered", destination, event))
            # Original CB2_NewGame and starter are native game progress.
            destination.party_count = 1
            struct.pack_into("<I", destination.mailbox, 20, 3)
            self.assertFalse(codec.ready_for_merge("firered", destination, event))
            self.assertEqual(struct.unpack_from("<II", destination.mailbox, 16), (0, 0))
            struct.pack_into("<I", destination.mailbox, 20, 5)
            self.assertTrue(codec.ready_for_merge("firered", destination, event))
            self.assertEqual(codec.merge_to("firered", destination, event), 6)
            self.assertEqual(destination.mailbox[45], 1)
            self.assertEqual(struct.unpack_from("<II", destination.mailbox, 16), (0, 0))


if __name__ == "__main__":
    unittest.main()
