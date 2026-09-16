import os
import subprocess
import sys

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cli=os.path.join(ROOT,'indro.py')
out=subprocess.check_output([sys.executable,cli,'plan','learn'],text=True)
assert 'dogfood -> suggest -> bench -> languagebench -> crosscheck -> selftest' in out,out
out=subprocess.check_output([sys.executable,cli,'plan','mature'],text=True)
assert 'checkpoint -> verify -> agent' in out,out
print('INDRO_TEST PASS portable plan runner')

out=subprocess.check_output([sys.executable,cli,'plan','measure'],text=True)
assert 'bench -> languagebench -> crosscheck' in out,out
out=subprocess.check_output([sys.executable,cli,'plan','resume'],text=True)
assert 'status -> audit' in out,out
