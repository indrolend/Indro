import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
words = json.load(open(os.path.join(ROOT, 'words.json'), encoding='utf-8'))['words']
primitives = {
    'status','audit','checkpoint','save','verify','build','test','smoke','play','doctor',
    'agent','diffcheck','ship','dogfood','suggest','bench','languagebench','crosscheck','selftest','evidence'
}
consequential = {'commit','push','merge','rebase','reset','clean','release','publish','ship'}

def resolve(word, stack=()):
    if word in stack:
        raise AssertionError('cycle: ' + ' -> '.join(stack + (word,)))
    if word in primitives:
        return [word]
    assert word in words, f'unknown word {word}'
    out=[]
    for step in words[word]['steps']:
        parts=step.split()
        assert parts, (word, step)
        verb=parts[0]
        assert verb not in consequential, (word, step)
        if len(parts)>1:
            assert verb in primitives, f'argument-bearing composite step unsupported: {word}: {step}'
            out.append(step)
        else:
            out.extend(resolve(verb, stack+(word,)))
    return out

for name in words:
    plan=resolve(name)
    assert plan, name
    assert all(step.split()[0] not in consequential for step in plan), (name,plan)

assert resolve('learn') == ['dogfood','suggest','bench','languagebench','crosscheck','selftest']
assert resolve('orient') == ['status','audit']
assert resolve('resume') == ['status','audit']
assert resolve('measure') == ['bench','languagebench','crosscheck']
assert resolve('mature') == ['checkpoint','verify','agent']
print(f'INDRO_TEST PASS word graph composites={len(words)}')
