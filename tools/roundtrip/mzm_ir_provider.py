"""MZM equipment/event profile for the shared actual-IR reconstruction provider."""
from pathlib import Path
import argparse
import json
from .ir_provider import run

PROFILE = {
    "id": "mzm.ir.equipment-events",
    "original_sha256": "fc94f65380b65b870a30b9b04b39cca1dc63d6e46a4a373d3904adc0912ebc37",
    "targets": [("events", "mzm.progress.events", "080608bc"),
                ("acquire", "mzm.progress.acquire", "080138d8")],
    "arena_address": 0x08800000, "arena_capacity": 4096, "arena_append": True,
}
EVENTS_PROFILE = dict(PROFILE, targets=[PROFILE["targets"][0]])

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--vectors", type=int, default=4096)
    parser.add_argument("--components", choices=("events", "all"), default="all")
    args = parser.parse_args()
    print(json.dumps(run(EVENTS_PROFILE if args.components == "events" else PROFILE,
                         args.original, args.baseline, args.output, args.vectors), indent=2))
