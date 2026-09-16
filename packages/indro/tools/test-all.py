import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
tests = ["test-miner.py", "test-language.py", "test-safety.py", "test-package.py", "test-wordgraph.py", "test-cli.py", "test-compiler.py", "test-compact.py", "test-determinism.py", "test-proof.py"]
failed = []
for test in tests:
    print(f"INDRO_TEST_RUN {test}")
    result = subprocess.run([sys.executable, os.path.join(HERE, test)])
    if result.returncode:
        failed.append(test)
if failed:
    print("INDRO_SELFTEST FAIL " + " ".join(failed))
    raise SystemExit(1)
print(f"INDRO_SELFTEST PASS tests={len(tests)}")
