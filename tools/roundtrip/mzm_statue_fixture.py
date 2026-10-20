"""Bounded native statue cross-entry fixtures with explicit borrowed-record moves.

Run only against an explicit original/candidate pair. This does not run SpriteUpdate
or implement game behavior: C contains concrete source-fixture expectations and
calls the actual cartridge entries in two mGBA cores.
"""

import argparse
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
import time


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONTRACT = ROOT / "research/ir-workshop/roundtrip-20261016/mzm-ir/statue-consumption-contract/contract.json"
ORACLE = ROOT / "tools/behavior_ir/oracle.c.in"
ENTRIES = {"behavior": 0x08013DE0, "wait": 0x08014468,
           "timer": 0x08014494, "acquire": 0x080138D8}


def pin(path):
    path = Path(path).resolve()
    data = path.read_bytes()
    return {"path": str(path), "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest()}


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")


def normalize(contract):
    """Expand finite declarative expectations, without executing a game model."""
    for label, address in ENTRIES.items():
        if int(contract["entries"][label], 16) != address:
            raise ValueError("Unsupported original entry contract: " + label)
    if contract["constants"]["delta_time"] != 1 or contract["constants"]["two_third_second"] != 40:
        raise ValueError("Unsupported timer fixture contract")
    cases = []
    for fixture in contract["cross_entry_fixtures"] + contract["focused_fixtures"]:
        for selector in fixture.get("selectors", [fixture.get("selector", 0)]):
            initial = fixture["initial"]
            observations = fixture.get("observations")
            if observations is None:
                expected = fixture["expected"]
                if fixture["id"].startswith("timer-boundary-"):
                    observations = [{"entry": "timer", **expected}]
                else:
                    observations = [
                        {"entry": "behavior", "return": expected["behavior"]},
                        {"entry": "wait", "pose": expected["wait_pose"],
                         "work0": expected["wait_work0"]}]
            for slot in (0, 23):
                state = {"beamBombs": initial.get("beamBombs", 0),
                         "suitMisc": initial.get("suitMisc", 0),
                         "events": list(initial.get("events", [0] * 8)),
                         "pose": initial["pose"], "work0": initial["work0"]}
                actions = []
                for observation in observations:
                    entry = observation["entry"]
                    if entry not in ENTRIES:
                        raise ValueError("Unsupported native entry")
                    count = observation.get("calls", 1)
                    if not 1 <= count <= 40:
                        raise ValueError("Unbounded fixture repetition")
                    if count > 1 and (entry != "timer" or
                            state["work0"] - observation["work0"] != count or
                            observation["work0"] <= 0):
                        raise ValueError("Only the explicit 40-to-1 timer interval may expand")
                    for index in range(count):
                        # A repeated timer observation explicitly supplies the endpoint.
                        # Expand its concrete interval; no native/reference behavior C.
                        for field in ("beamBombs", "suitMisc", "pose", "work0"):
                            if field in observation:
                                state[field] = (observation[field] + count - index - 1
                                                if field == "work0" and count > 1
                                                else observation[field])
                        if "field" in observation:
                            state[observation["field"]] = observation["value"]
                        for event in observation.get("events_set", []):
                            state["events"][event // 32] |= 1 << (event % 32)
                        actions.append({"entry": entry, "pc": ENTRIES[entry],
                                        "argument0": selector if entry in ("behavior", "acquire") else 0,
                                        "expected_return": observation.get("return"),
                                        "expected": {**state, "events": list(state["events"])}})
                cases.append({"id": fixture["id"], "selector": selector, "slot": slot,
                              "route": "UnknownItemChozoStatue; direct-entry synthetic only"
                              if selector in (88, 89, 148) else "direct-entry synthetic; scheduler not executed",
                              "initial": {"beamBombs": initial.get("beamBombs", 0),
                                          "suitMisc": initial.get("suitMisc", 0),
                                          "events": initial.get("events", [0] * 8),
                                          "pose": initial["pose"], "work0": initial["work0"]},
                              "actions": actions})
    return cases


def c_array(values):
    return "{" + ",".join(str(v) + "u" for v in values) + "}"


def render(cases, oracle):
    # Reuse the established native entry/ABI budget and byte bus access helpers.
    headers = oracle.split('#include "generated.c"', 1)[0]
    helpers = oracle.split("static unsigned long instructions;", 1)[1].split("static const struct", 1)[0]
    helpers = "static unsigned long instructions;" + helpers
    action_rows, case_rows = [], []
    cursor = 0
    labels = list(ENTRIES)
    for case in cases:
        initial = case["initial"]
        case_rows.append("{" + ",".join(map(str, [case["slot"], case["selector"],
            initial["pose"], initial["work0"], initial["beamBombs"], initial["suitMisc"],
            cursor, len(case["actions"])])) + "," + c_array(initial["events"]) + "}")
        for action in case["actions"]:
            expected = action["expected"]
            action_rows.append("{" + ",".join(map(str, [action["pc"], action["argument0"],
                labels.index(action["entry"]), action["expected_return"] is not None,
                action["expected_return"] or 0, expected["pose"], expected["work0"],
                expected["beamBombs"], expected["suitMisc"]])).replace("True", "1").replace("False", "0")
                + "," + c_array(expected["events"]) + "}")
        cursor += len(case["actions"])
    declarations = """
#include <time.h>
struct Fixture { unsigned slot,selector,pose,work,beam,suit,first,count; uint32_t events[8]; };
struct Action { uint32_t pc,arg; unsigned kind,check_return; uint32_t result; unsigned pose,work,beam,suit; uint32_t events[8]; };
struct Snapshot { uint8_t equipment[20],events[32],scratch[56],records[24*56+32]; };
static const struct Fixture fixtures[] = { @CASES@ };
static const struct Action actions[] = { @ACTIONS@ };
static const char *labels[]={"behavior","wait","timer","acquire"};
static double now(void){ struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t); return t.tv_sec+t.tv_nsec/1e9; }
static struct mCore *load(const char *path){
 struct mCore *c=GBACoreCreate(); if(!c||!c->init(c))return NULL;
 mCoreInitConfig(c,NULL); mCoreConfigSetDefaultIntValue(&c->config,"skipBios",1);
 mCoreConfigSetDefaultIntValue(&c->config,"useBios",0); mCoreLoadConfig(c);
 if(!mCoreLoadFile(c,path))return NULL; c->reset(c); return c;
}
static void snapshot(struct mCore *c,struct Snapshot *s){
 rd(c,0x03001530,s->equipment,20); rd(c,0x02037e00,s->events,32);
 rd(c,0x03000738,s->scratch,56); rd(c,0x030001ac-16,s->records,sizeof(s->records));
}
static void install(struct mCore *c,const struct Snapshot *s){
 wr(c,0x03001530,s->equipment,20); wr(c,0x02037e00,s->events,32);
 wr(c,0x03000738,s->scratch,56); wr(c,0x030001ac-16,s->records,sizeof(s->records));
}
static int equal(const struct Snapshot *a,const struct Snapshot *b,unsigned fi,unsigned step,const char *why){
 const uint8_t *left=(const uint8_t*)a,*right=(const uint8_t*)b;
 for(unsigned i=0;i<sizeof(*a);i++)if(left[i]!=right[i]){
  fprintf(stderr,"fixture=%u step=%u %s snapshot_byte=%u expected=%u actual=%u\\n",fi,step,why,i,left[i],right[i]);return 0;
 }return 1;
}
int main(int argc,char **argv){
 if(argc!=3)return 2; double start=now(); struct mCore *cores[2]={load(argv[1]),load(argv[2])};
 if(!cores[0]||!cores[1]){fprintf(stderr,"ROM/core initialization failed\\n");return 3;}
 unsigned calls=0,per_entry[4]={0}; printf("{\\"observations\\":[");
 for(unsigned fi=0;fi<sizeof(fixtures)/sizeof(fixtures[0]);fi++){
  const struct Fixture *f=&fixtures[fi]; struct Snapshot initial;
  memset(&initial,0,sizeof(initial));
  for(unsigned i=0;i<sizeof(initial.equipment);i++)initial.equipment[i]=(0xa5+i*7)&255;
  initial.equipment[12]=f->beam; initial.equipment[14]=f->suit;
  memcpy(initial.events,f->events,32);
  for(unsigned i=0;i<sizeof(initial.records);i++)initial.records[i]=(0x53+fi*17+i*7)&255;
  for(unsigned slot=0;slot<24;slot++)initial.records[16+slot*56]&=~1u;
  uint8_t *record=initial.records+16+f->slot*56;
  record[0]|=1; record[0x32]&=~0x80u; record[0x1d]=f->selector;
  record[0x24]=f->pose; record[0x2c]=f->work; memcpy(initial.scratch,record,56);
  for(unsigned side=0;side<2;side++)install(cores[side],&initial);
  for(unsigned step=0;step<f->count;step++){
   const struct Action *a=&actions[f->first+step]; uint32_t result[2];
   struct Snapshot observed[2],expected=initial;
   expected.equipment[12]=a->beam; expected.equipment[14]=a->suit;
   memcpy(expected.events,a->events,32);
   expected.scratch[0x24]=a->pose; expected.scratch[0x2c]=a->work;
   memcpy(expected.records+16+f->slot*56,expected.scratch,56);
   for(unsigned side=0;side<2;side++){
    uint8_t borrowed[56]; uint32_t args[4]={a->arg,0,0,0};
    /* Fixture storage move only: the original SpriteUpdate is not called. */
    rd(cores[side],0x030001ac+f->slot*56,borrowed,56); wr(cores[side],0x03000738,borrowed,56);
    if(!call(cores[side],a->pc,args,&result[side])){
     fprintf(stderr,"fixture=%u step=%u side=%u ABI/instruction budget failed\\n",fi,step,side);return 4;
    }
    /* Verify array and guards before fixture writeback, detecting stray writes. */
    struct Snapshot before_commit; snapshot(cores[side],&before_commit);
    uint8_t before_records[sizeof(initial.records)]; memcpy(before_records,initial.records,sizeof(before_records));
    if(step){ const struct Action *previous=&actions[f->first+step-1];
     before_records[16+f->slot*56+0x24]=previous->pose;
     before_records[16+f->slot*56+0x2c]=previous->work;
    }
    if(memcmp(before_records,before_commit.records,sizeof(before_records))){
     fprintf(stderr,"fixture=%u step=%u side=%u native modified persistent array/guards before writeback\\n",fi,step,side);return 5;
    }
    rd(cores[side],0x03000738,borrowed,56); wr(cores[side],0x030001ac+f->slot*56,borrowed,56);
    snapshot(cores[side],&observed[side]);
    if(!equal(&expected,&observed[side],fi,step,side?"candidate source expectation":"original source expectation"))return 6;
    if(a->check_return&&result[side]!=a->result){
     fprintf(stderr,"fixture=%u step=%u side=%u full-r0 expected=%u actual=%u\\n",fi,step,side,a->result,result[side]);return 7;
    }
   }
   if(!equal(&observed[0],&observed[1],fi,step,"original/candidate state parity"))return 8;
   if(a->check_return&&result[0]!=result[1])return 9;
   printf("%s{\\"case\\":%u,\\"step\\":%u,\\"entry\\":\\"%s\\",\\"original_r0_u32\\":%u,\\"candidate_r0_u32\\":%u}",
          calls?",":"",fi,step,labels[a->kind],result[0],result[1]);
   calls++; per_entry[a->kind]++;
  }
 }
 printf("],\\"outcome\\":\\"pass\\",\\"fixture_cases\\":%zu,\\"call_pairs\\":%u,\\"native_calls\\":%u,\\"instructions_total\\":%lu,\\"native_wall_s\\":%.9f,\\"entry_call_pairs\\":{\\"behavior\\":%u,\\"wait\\":%u,\\"timer\\":%u,\\"acquire\\":%u}}\\n",
 sizeof(fixtures)/sizeof(fixtures[0]),calls,calls*2,instructions,now()-start,per_entry[0],per_entry[1],per_entry[2],per_entry[3]);
 for(unsigned side=0;side<2;side++)cores[side]->deinit(cores[side]); return 0;
}
"""
    # Above literal is regular Python text; one escaping layer belongs to C.
    declarations = declarations.replace("\\\\", "\\")
    return headers + helpers + declarations.replace("@CASES@", ",\n".join(case_rows)).replace("@ACTIONS@", ",\n".join(action_rows))


def run(original, candidate, contract_path, output):
    started = time.monotonic()
    original, candidate, contract_path = map(lambda p: Path(p).resolve(), (original, candidate, contract_path))
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    report = {"schema": "mzm-statue-native-fixture-v1", "outcome": "failed",
              "scope": "Bounded native direct-entry sequences with fixture borrow/copyback; original SpriteUpdate not executed",
              "queue_s": None, "platform": platform.platform(), "stages": [],
              "limitations": ["Synthetic state; no gameplay frames/campaign/save/concurrency proof",
                              "Selectors 88/89/148 normally route to UnknownItemChozoStatue; direct-entry synthetic only",
                              "Void native r0 values are observations, not source return contracts"]}
    def stage(name, command, timeout):
        begin = time.monotonic()
        try:
            result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired as error:
            def decoded(value):
                return value.decode(errors="replace") if isinstance(value, bytes) else value or ""
            (output / (name + ".stdout")).write_text(decoded(error.stdout))
            (output / (name + ".stderr")).write_text(decoded(error.stderr))
            report["stages"].append({"name": name, "command": command,
                                     "wall_s": time.monotonic()-begin,
                                     "returncode": None, "outcome": "timeout", "timeout_s": timeout})
            raise
        (output / (name + ".stdout")).write_text(result.stdout)
        (output / (name + ".stderr")).write_text(result.stderr)
        report["stages"].append({"name": name, "command": command, "wall_s": time.monotonic()-begin,
                                 "returncode": result.returncode, "outcome": "pass" if result.returncode == 0 else "failed"})
        if result.returncode:
            raise RuntimeError(name + " failed; retained stderr: " + str(output / (name + ".stderr")))
        return result.stdout
    try:
        report["inputs"] = {"original": pin(original), "candidate": pin(candidate),
                            "fixture_source": pin(contract_path), "driver": pin(__file__), "oracle_template": pin(ORACLE)}
        contract = json.loads(contract_path.read_text())
        for source in contract["pins"]:
            source_path = Path(source["path"])
            if not source_path.is_absolute():
                source_path = ROOT / source_path
            if pin(source_path)["sha256"] != source["sha256"]:
                raise ValueError("Stale source/header/artifact pin: " + str(source_path))
        original_pin = next(row for row in contract["pins"] if row["path"].endswith("local/roms/Metroid - Zero Mission (USA).gba"))
        if report["inputs"]["original"]["sha256"] != original_pin["sha256"]:
            raise ValueError("Original ROM does not match source contract")
        before, after = original.read_bytes(), candidate.read_bytes()
        for pc, size in ((ENTRIES["acquire"], 0x30C), (0x080608BC, 0x6C)):
            offset = pc - 0x08000000
            if before[offset:offset+size] != after[offset:offset+size]:
                raise ValueError("Acquisition/event service must remain original in this candidate")
        cases = normalize(contract)
        if len(cases) > 128 or sum(len(c["actions"]) for c in cases) > 4096:
            raise ValueError("Fixture resource bound exceeded")
        write_json(output / "normalized-fixtures.json", cases)
        shutil.copyfile(contract_path, output / "contract.json")
        shutil.copyfile(__file__, output / "fixture-script.py")
        shutil.copyfile(ORACLE, output / "oracle.c.in")
        harness = output / "native-fixture.c"
        harness.write_text(render(cases, ORACLE.read_text()))
        compiler = shutil.which("cc")
        if not compiler:
            raise RuntimeError("Host C compiler unavailable")
        binary = output / "native-fixture"
        stage("compile", [compiler, "-O2", "-std=c11", "-I/opt/homebrew/include", str(harness),
              "-L/opt/homebrew/lib", "-Wl,-rpath,/opt/homebrew/lib", "-lmgba", "-o", str(binary)], 120)
        native = json.loads(stage("native", [str(binary), str(original), str(candidate)], 60))
        write_json(output / "native-results.json", native)
        expected_calls = sum(len(c["actions"]) for c in cases)
        if native.get("outcome") != "pass" or native["call_pairs"] != expected_calls or native["fixture_cases"] != len(cases):
            raise ValueError("Incomplete native fixture result")
        if pin(original) != report["inputs"]["original"] or pin(candidate) != report["inputs"]["candidate"]:
            raise ValueError("Input ROM changed during verification")
        report.update(outcome="pass", fixture_cases=len(cases), source_fixture_groups=contract["fixture_count"],
                      native_call_pairs=expected_calls, native_calls=expected_calls*2,
                      entry_call_pairs=native["entry_call_pairs"], build_mode="clean generated host C; one compile; cache status unavailable",
                      native_wall_s=native["native_wall_s"], instructions_total=native["instructions_total"])
    except Exception as error:
        report["error"] = str(error)
        raise
    finally:
        report["total_wall_s"] = time.monotonic() - started
        report["timing_note"] = "Stage and native internal times are nested in total, not additive; queue and comparable before/after unavailable."
        report["artifacts"] = [pin(p) for p in sorted(output.iterdir()) if p.is_file() and p.name != "receipt.json"]
        write_json(output / "receipt.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT)
    parser.add_argument("--output", type=Path, required=True, help="New, nonexistent evidence directory")
    args = parser.parse_args()
    report = run(args.original, args.candidate, args.contract, args.output)
    print(json.dumps({k: report[k] for k in ("outcome", "fixture_cases", "native_call_pairs", "native_calls", "total_wall_s")}, indent=2))


if __name__ == "__main__":
    main()
