import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
tests = ["test-miner.py", "test-language.py", "test-safety.py", "test-package.py", "test-wordgraph.py", "test-cli.py", "test-compiler.py", "test-compact.py", "test-determinism.py", "test-proof.py", "test-ndra-repo-gauntlet.py"]
failed = []
for test in tests:
    print(f"INDRO_TEST_RUN {test}")
    result = subprocess.run([sys.executable, os.path.join(HERE, test)])
    if result.returncode:
        failed.append(test)

workspace = os.environ.get("INDRO_CONVERGENCE_WORKSPACE")
if workspace is None:
    print("INDRO_INTEGRATION NOT_RUN convergence gauntlet (set INDRO_CONVERGENCE_WORKSPACE to run)")
else:
    print("INDRO_INTEGRATION_RUN convergence gauntlet")
    result = subprocess.run([sys.executable, os.path.join(HERE, "convergence_gauntlet.py"), "--self-test", "--workspace", workspace])
    if result.returncode:
        failed.append("convergence_gauntlet.py")
if failed:
    print("INDRO_SELFTEST FAIL " + " ".join(failed))
    raise SystemExit(1)
print(f"INDRO_SELFTEST PASS tests={len(tests)} integration={'NOT_RUN' if workspace is None else 'PASS'}")
