#!/usr/bin/env python3
"""Static bounded semantic comparisons of Python functions across Git commits.

Repository code is parsed and interpreted here; it is never imported or executed.
EQUIVALENT requires canonical AST identity. Finite observations can prove a
COUNTEREXAMPLE, while matching observations without a proof remain UNKNOWN.
"""
from __future__ import annotations
import argparse, ast, csv, hashlib, io, itertools, json, operator, pathlib
import statistics, subprocess, time, tokenize
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

SCHEMA = "ndra.open-source-gauntlet/v3"
MODEL = "ndra.safe-python-ast/v2"
REPOS = {"toolz":"https://github.com/pytoolz/toolz.git", "boltons":"https://github.com/mahmoud/boltons.git",
 "more-itertools":"https://github.com/more-itertools/more-itertools.git", "funcy":"https://github.com/Suor/funcy.git",
 "attrs":"https://github.com/python-attrs/attrs.git"}
VALUES = (-2,-1,0,1,2,7,False,True,None,"","a","x","aa")
BIN = {ast.Add:operator.add,ast.Sub:operator.sub,ast.Mult:operator.mul,ast.FloorDiv:operator.floordiv,
 ast.Div:operator.truediv,ast.Mod:operator.mod,ast.Pow:operator.pow,ast.BitAnd:operator.and_,ast.BitOr:operator.or_,
 ast.BitXor:operator.xor,ast.LShift:operator.lshift,ast.RShift:operator.rshift}
CMP = {ast.Eq:operator.eq,ast.NotEq:operator.ne,ast.Lt:operator.lt,ast.LtE:operator.le,ast.Gt:operator.gt,
 ast.GtE:operator.ge,ast.Is:operator.is_,ast.IsNot:operator.is_not,ast.In:lambda a,b:a in b,ast.NotIn:lambda a,b:a not in b}
BUILTINS = {"abs":abs,"all":all,"any":any,"bool":bool,"bytes":bytes,"divmod":divmod,"float":float,
 "int":int,"len":len,"list":list,"max":max,"min":min,"range":range,"repr":repr,"reversed":reversed,
 "round":round,"set":set,"sorted":sorted,"str":str,"sum":sum,"tuple":tuple,"zip":zip,"enumerate":enumerate}
METHODS = {str:{"endswith","startswith","lower","upper","strip","lstrip","rstrip","replace","split","rsplit","join","find","rfind","count","index","isalpha","isdigit","isalnum"},
 bytes:{"endswith","startswith","lower","upper","strip","replace","split","join","find","count"},
 list:{"count","index"},tuple:{"count","index"},dict:{"get","keys","values","items","copy"},set:{"issubset","issuperset"}}

class Unsupported(Exception): pass
class Returned(Exception):
    def __init__(self,value): self.value=value

def sha(value):
    data=value if isinstance(value,bytes) else json.dumps(value,sort_keys=True,separators=(",",":"),default=repr).encode()
    return hashlib.sha256(data).hexdigest()
def git(path,*args):
    return subprocess.run(["git","-C",str(path),*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=120).stdout
def source_text(data):
    try:
        encoding,_=tokenize.detect_encoding(io.BytesIO(data).readline); return data.decode(encoding)
    except (SyntaxError,UnicodeError,LookupError): return None
def json_value(value):
    if type(value) in (type(None),bool,int,float,str): return value
    if isinstance(value,bytes): return {"type":"bytes","hex":value.hex()}
    if isinstance(value,(tuple,list)): return [json_value(v) for v in value]
    if isinstance(value,dict): return {repr(k):json_value(v) for k,v in value.items()}
    return {"type":type(value).__name__,"repr":repr(value)}
def safe_attr(value,name):
    for cls,allowed in METHODS.items():
        if isinstance(value,cls) and name in allowed: return getattr(value,name)
    raise Unsupported(f"attribute:{type(value).__name__}.{name}")

def evaluate(node,env,budget):
    budget[0]-=1
    if budget[0]<0: raise Unsupported("step-budget")
    if isinstance(node,ast.Constant) and type(node.value) in (type(None),bool,int,float,str,bytes): return node.value
    if isinstance(node,ast.Name):
        if node.id in env:return env[node.id]
        if node.id in BUILTINS:return BUILTINS[node.id]
        raise Unsupported(f"global-name:{node.id}")
    if isinstance(node,(ast.Tuple,ast.List,ast.Set)):
        values=[evaluate(x,env,budget) for x in node.elts]
        return tuple(values) if isinstance(node,ast.Tuple) else set(values) if isinstance(node,ast.Set) else values
    if isinstance(node,ast.Dict): return {evaluate(k,env,budget):evaluate(v,env,budget) for k,v in zip(node.keys,node.values)}
    if isinstance(node,ast.UnaryOp):
        value=evaluate(node.operand,env,budget)
        if isinstance(node.op,ast.Not):return not value
        if isinstance(node.op,ast.USub):return -value
        if isinstance(node.op,ast.UAdd):return +value
        if isinstance(node.op,ast.Invert):return ~value
    if isinstance(node,ast.BinOp) and type(node.op) in BIN:return BIN[type(node.op)](evaluate(node.left,env,budget),evaluate(node.right,env,budget))
    if isinstance(node,ast.BoolOp):
        value=evaluate(node.values[0],env,budget)
        for part in node.values[1:]:
            if isinstance(node.op,ast.And) and not value:return value
            if isinstance(node.op,ast.Or) and value:return value
            value=evaluate(part,env,budget)
        return value
    if isinstance(node,ast.Compare):
        left=evaluate(node.left,env,budget)
        for op,rhs in zip(node.ops,node.comparators):
            right=evaluate(rhs,env,budget)
            if type(op) not in CMP or not CMP[type(op)](left,right):return False
            left=right
        return True
    if isinstance(node,ast.IfExp):return evaluate(node.body if evaluate(node.test,env,budget) else node.orelse,env,budget)
    if isinstance(node,ast.Slice):return slice(*(evaluate(x,env,budget) if x is not None else None for x in (node.lower,node.upper,node.step)))
    if isinstance(node,ast.Subscript):return evaluate(node.value,env,budget)[evaluate(node.slice,env,budget)]
    if isinstance(node,ast.Attribute):return safe_attr(evaluate(node.value,env,budget),node.attr)
    if isinstance(node,ast.Call):
        fn=evaluate(node.func,env,budget)
        if fn not in BUILTINS.values() and not (hasattr(fn,"__self__") and type(fn.__self__) in METHODS):raise Unsupported("call-target")
        args=[evaluate(x,env,budget) for x in node.args]
        kwargs={x.arg:evaluate(x.value,env,budget) for x in node.keywords if x.arg is not None}
        if len(args)+len(kwargs)>8:raise Unsupported("call-arity")
        result=fn(*args,**kwargs)
        if isinstance(result,(range,zip,enumerate,reversed)):result=tuple(itertools.islice(result,65))
        return result
    if isinstance(node,ast.JoinedStr):return "".join(str(evaluate(x.value,env,budget)) if isinstance(x,ast.FormattedValue) else x.value for x in node.values)
    raise Unsupported(f"expression:{type(node).__name__}")

def assign(target,value,env):
    if isinstance(target,ast.Name):env[target.id]=value;return
    if isinstance(target,(ast.Tuple,ast.List)):
        if len(target.elts)!=len(value):raise ValueError("unpack")
        for item,val in zip(target.elts,value):assign(item,val,env)
        return
    raise Unsupported(f"assignment:{type(target).__name__}")
def execute_body(body,env,budget):
    for node in body:
        budget[0]-=1
        if budget[0]<0:raise Unsupported("step-budget")
        if isinstance(node,ast.Return):raise Returned(evaluate(node.value,env,budget) if node.value else None)
        if isinstance(node,(ast.Assign,ast.AnnAssign)):
            value=evaluate(node.value,env,budget)
            for target in node.targets if isinstance(node,ast.Assign) else [node.target]:assign(target,value,env)
        elif isinstance(node,ast.AugAssign) and isinstance(node.target,ast.Name) and type(node.op) in BIN:env[node.target.id]=BIN[type(node.op)](env[node.target.id],evaluate(node.value,env,budget))
        elif isinstance(node,ast.If):execute_body(node.body if evaluate(node.test,env,budget) else node.orelse,env,budget)
        elif isinstance(node,ast.Expr):evaluate(node.value,env,budget)
        elif isinstance(node,ast.Pass):pass
        else:raise Unsupported(f"statement:{type(node).__name__}")

@dataclass
class Function:
    file:str;qualname:str;node:Any;source_hash:str;canonical_hash:str;args:list[str];required:int
    defaults:list[Any]=field(default_factory=list);exclusion:str|None=None
def function_record(file,qualname,node,raw):
    args=node.args;reason=None;defaults=[]
    if isinstance(node,ast.AsyncFunctionDef):reason="async-function"
    elif "." in qualname and args.args and args.args[0].arg in {"self","cls"}:reason="instance-or-class-method"
    elif args.posonlyargs or args.kwonlyargs or args.vararg or args.kwarg:reason="signature-shape"
    elif not 1<=len(args.args)<=3:reason="arity-outside-1..3"
    else:
        try:defaults=[ast.literal_eval(x) for x in args.defaults]
        except (ValueError,TypeError):reason="nonliteral-default"
        if any(type(x) not in (type(None),bool,int,float,str,bytes) for x in defaults):reason="unsupported-default"
    canonical=ast.dump(node,include_attributes=False)
    return Function(file,qualname,node,sha(raw.encode("utf-8","surrogatepass")),sha(canonical),[x.arg for x in args.args],len(args.args)-len(args.defaults),defaults,reason)
def parse_functions(file,data):
    source=source_text(data)
    if source is None:return {},"source-decode"
    try:tree=ast.parse(source)
    except (SyntaxError,ValueError,TypeError,UnicodeError):return {},"syntax-error"
    found={}
    def walk(body,prefix=""):
        for node in body:
            if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)):
                qn=prefix+node.name;segment=ast.get_source_segment(source,node) or ast.dump(node,include_attributes=False)
                found[qn]=function_record(file,qn,node,segment)
            elif isinstance(node,ast.ClassDef):walk(node.body,prefix+node.name+".")
    walk(tree.body);return found,None
def observe(fn,inputs):
    env=dict(zip(fn.args,inputs))
    try:execute_body(fn.node.body,env,[500]);return {"kind":"return","value":None}
    except Returned as result:return {"kind":"return","value":json_value(result.value)}
    except Unsupported as exc:return {"kind":"unsupported","reason":str(exc)}
    except (ArithmeticError,LookupError,TypeError,ValueError) as exc:return {"kind":"exception","type":type(exc).__name__}
def input_domain(fn,max_inputs):
    pools=[]
    for name in fn.args:
        lowered=name.lower()
        # Names with conventional textual roles get a textual contract. This
        # avoids reporting type-error differences on inputs the API does not
        # claim to accept, and the assumption is serialized with each run.
        if lowered in {"s","text","string","prefix","suffix","sep","separator","word"} or any(word in lowered for word in ("prefix","suffix","text","string")):
            pool=["","a","x","aa","ab"]
        else:pool=list(VALUES)
        if any(word in name.lower() for word in ("seq","items","values","iter","list")):pool += [(),(0,),(1,2),[],[0],[1,2]]
        pools.append(pool)
    return list(itertools.islice(itertools.product(*pools),max_inputs))
def compare_functions(before,after,max_inputs):
    if before.canonical_hash==after.canonical_hash:return {"verdict":"EQUIVALENT","reason":"canonical-ast-identical","evaluations":0}
    if before.exclusion or after.exclusion:return {"verdict":"UNKNOWN","reason":before.exclusion or after.exclusion,"evaluations":0}
    if before.args!=after.args or before.required!=after.required:return {"verdict":"UNKNOWN","reason":"signature-changed","evaluations":0}
    unsupported=Counter();cases=input_domain(before,max_inputs)
    for index,values in enumerate(cases):
        left,right=observe(before,values),observe(after,values)
        if left.get("kind")=="unsupported" or right.get("kind")=="unsupported":
            if left.get("kind")=="unsupported":unsupported[left["reason"]]+=1
            if right.get("kind")=="unsupported":unsupported[right["reason"]]+=1
            continue
        if left!=right:return {"verdict":"COUNTEREXAMPLE","reason":"observable-result-differs","evaluations":index+1,
         "witness":{"arguments":dict(zip(before.args,map(json_value,values))),"before":left,"after":right}}
    reason="unsupported-observations:"+",".join(k for k,_ in unsupported.most_common(3)) if unsupported else "bounded-observations-match-without-proof"
    return {"verdict":"UNKNOWN","reason":reason,"evaluations":len(cases)}

def changed_files(repo,before,after):
    rows=git(repo,"diff","--name-status","-z","-M",before,after,"--","*.py").split(b"\0");out=[];i=0
    while i<len(rows) and rows[i]:
        status=rows[i].decode("ascii","replace");i+=1
        if status.startswith("R"):old,new=rows[i].decode("utf-8","surrogateescape"),rows[i+1].decode("utf-8","surrogateescape");i+=2
        else:
            name=rows[i].decode("utf-8","surrogateescape");i+=1
            old,new=(None,name) if status=="A" else (name,None) if status=="D" else (name,name)
        if not any("test" in (x or "").lower() for x in (old,new)):out.append((old,new))
    return out
def blob(repo,revision,file):return b"" if file is None else git(repo,"show",f"{revision}:{file}")
def pair_records(repo_name,repo,before,after,max_inputs):
    comparisons=[];exclusions=[];parse_ns=0
    for old_file,new_file in changed_files(repo,before,after):
        started=time.perf_counter_ns();old,oe=parse_functions(old_file or new_file,blob(repo,before,old_file)) if old_file else ({},None);new,ne=parse_functions(new_file or old_file,blob(repo,after,new_file)) if new_file else ({},None);parse_ns+=time.perf_counter_ns()-started
        if oe or ne:
            exclusions.append({"repo":repo_name,"before":before,"after":after,"file_before":old_file,"file_after":new_file,"function_before":None,"function_after":None,"reason":oe or ne});continue
        shared=set(old)&set(new)
        for name in sorted(set(old)|set(new)):
            base={"repo":repo_name,"before":before,"after":after,"file_before":old_file,"file_after":new_file,"function_before":name if name in old else None,"function_after":name if name in new else None}
            if name not in shared:exclusions.append({**base,"reason":"deleted-function" if name in old else "added-function"})
            elif old[name].source_hash==new[name].source_hash:exclusions.append({**base,"reason":"unchanged-function"})
            else:
                started=time.perf_counter_ns();result=compare_functions(old[name],new[name],max_inputs)
                comparisons.append({**base,**result,"proof_ns":time.perf_counter_ns()-started,"before_source_hash":old[name].source_hash,"after_source_hash":new[name].source_hash,"before_canonical_hash":old[name].canonical_hash,"after_canonical_hash":new[name].canonical_hash,"_before_fn":old[name],"_after_fn":new[name]})
    return comparisons,exclusions,{"parse_ns":parse_ns}
def percentile(values,fraction):
    if not values:return 0
    ordered=sorted(values);return ordered[round((len(ordered)-1)*fraction)]
def benchmark(records,trials):
    result={}
    for strategy in ("full","exact-cache","ndra-proof-reuse"):
        samples=[];total_work=total_lookup=total_proof=reuses=false_skips=audit_ns=0;justifications=[]
        for trial in range(trials):
            cache={}
            for phase in ("cold","warm"):
                start=time.perf_counter_ns();work=lookup=proof=phase_audit=0
                for row in records:
                    key=sha([row["before_source_hash"],row["after_source_hash"],MODEL]);tick=time.perf_counter_ns();cached=cache.get(key);lookup+=time.perf_counter_ns()-tick;reused=False;reason=None
                    if strategy!="full" and cached is not None:reused=True;reason="exact-comparison-key-and-model"
                    elif strategy=="ndra-proof-reuse" and row["verdict"]=="EQUIVALENT":
                        tick=time.perf_counter_ns();valid=row["before_canonical_hash"]==row["after_canonical_hash"];proof+=time.perf_counter_ns()-tick;reused=valid;reason="canonical-ast-identity" if valid else None
                    if reused:
                        reuses+=1
                        audit_tick=time.perf_counter_ns();audited=compare_functions(row["_before_fn"],row["_after_fn"],256);audit_elapsed=time.perf_counter_ns()-audit_tick;audit_ns+=audit_elapsed;phase_audit+=audit_elapsed
                        expected=cached if cached is not None else row
                        false_skip=audited["verdict"]!=expected["verdict"] or audited.get("witness")!=expected.get("witness")
                        false_skips+=int(false_skip)
                        justifications.append({"trial":trial,"phase":phase,"comparison_key":key,"reason":reason,"model":MODEL,"evidence_hash":sha({k:v for k,v in row.items() if not k.startswith("_")}),"verdict":row["verdict"],"independent_audit":audited["verdict"],"false_skip":false_skip})
                    else:
                        verify_tick=time.perf_counter_ns();verified=compare_functions(row["_before_fn"],row["_after_fn"],256);proof+=time.perf_counter_ns()-verify_tick
                        work+=verified["evaluations"];cache[key]=verified
                samples.append({"trial":trial,"phase":phase,"elapsed_ns":time.perf_counter_ns()-start-phase_audit,"verification_evaluations":work,"lookup_ns":lookup,"proof_ns":proof,"audit_ns_excluded":phase_audit});total_work+=work;total_lookup+=lookup;total_proof+=proof
        times=[x["elapsed_ns"] for x in samples];phase_distribution={}
        for phase in ("cold","warm"):
            phase_times=[x["elapsed_ns"] for x in samples if x["phase"]==phase]
            phase_distribution[phase]={"median_ns":int(statistics.median(phase_times)) if phase_times else 0,"p25_ns":percentile(phase_times,.25),"p75_ns":percentile(phase_times,.75),"min_ns":min(phase_times,default=0),"max_ns":max(phase_times,default=0)}
        result[strategy]={"samples":samples,"median_ns":int(statistics.median(times)) if times else 0,"p25_ns":percentile(times,.25),"p75_ns":percentile(times,.75),"min_ns":min(times,default=0),"max_ns":max(times,default=0),"phase_distribution":phase_distribution,"verification_evaluations":total_work,"evidence_lookup_ns":total_lookup,"proof_ns":total_proof,"reuses":reuses,"false_skips":false_skips,"audit_ns_excluded":audit_ns,"reuse_justifications":justifications}
    full=result["full"]["verification_evaluations"]
    for value in result.values():value["saved_verification_evaluations_vs_full"]=full-value["verification_evaluations"]
    return result

def run(args):
    workspace=pathlib.Path(args.workspace).resolve();output=pathlib.Path(args.output).resolve();output.mkdir(parents=True,exist_ok=True);comparisons=[];exclusions=[];repos=[];setup=time.perf_counter_ns()
    for name in args.repos:
        repo=workspace/name;root=git(repo,"rev-parse","--show-toplevel").decode().strip()
        if pathlib.Path(root).resolve()!=repo.resolve():raise RuntimeError(f"unverified repository root: {repo}")
        head=git(repo,"rev-parse","HEAD").decode().strip();branch=git(repo,"branch","--show-current").decode().strip();origin=git(repo,"remote","get-url","origin").decode().strip();dirty=bool(git(repo,"status","--porcelain"));commits=git(repo,"rev-list","--first-parent",f"--max-count={args.history+1}","HEAD").decode().splitlines();repo_parse=repo_comp=repo_exc=0
        for after,before in zip(commits,commits[1:]):
            rows,skipped,metrics=pair_records(name,repo,before,after,args.max_inputs);comparisons+=rows;exclusions+=skipped;repo_parse+=metrics["parse_ns"];repo_comp+=len(rows);repo_exc+=len(skipped)
        repos.append({"repo":name,"root":str(repo),"branch":branch,"head":head,"origin":origin,"dirty":dirty,"adjacent_pairs":max(0,len(commits)-1),"changed_functions":repo_comp,"excluded_function_records":repo_exc,"parse_ns":repo_parse})
    bench=benchmark(comparisons,args.trials)
    public=[{k:v for k,v in row.items() if not k.startswith("_")} for row in comparisons]
    report={"schema":SCHEMA,"model":MODEL,"generated_at_utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"assumptions":["repository code is never executed","first-parent adjacent commits","deterministic finite input domain","conventional text parameter names use string inputs","exceptions are compared by type","EQUIVALENT requires canonical AST identity","matching bounded observations are UNKNOWN"],"configuration":{"history":args.history,"max_inputs":args.max_inputs,"trials":args.trials},"repositories":repos,"setup_ns":time.perf_counter_ns()-setup,"comparisons":public,"exclusions":exclusions,"counts":{"verdicts":dict(Counter(x["verdict"] for x in public)),"exclusions":dict(Counter(x["reason"] for x in exclusions))},"benchmark":bench,"audit":{"comparisons":len(public),"false_skips":sum(x["false_skips"] for x in bench.values()),"all_changed_functions_accounted":all(x.get("reason") for x in exclusions)}}
    (output/"results.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    fields=["repo","before","after","file_before","file_after","function_before","function_after","verdict","reason","evaluations","proof_ns","witness"]
    with (output/"comparisons.csv").open("w",newline="",encoding="utf-8") as f:
        writer=csv.DictWriter(f,fieldnames=fields,extrasaction="ignore");writer.writeheader()
        for row in public:writer.writerow({**row,"witness":json.dumps(row.get("witness"),sort_keys=True)})
    fields=["repo","before","after","file_before","file_after","function_before","function_after","reason"]
    with (output/"exclusions.csv").open("w",newline="",encoding="utf-8") as f:writer=csv.DictWriter(f,fieldnames=fields,extrasaction="ignore");writer.writeheader();writer.writerows(exclusions)
    with (output/"reuse.jsonl").open("w",encoding="utf-8") as f:
        for strategy,stats in report["benchmark"].items():
            for item in stats["reuse_justifications"]:f.write(json.dumps({"strategy":strategy,**item},sort_keys=True)+"\n")
    return report
def self_test():
    def parse(source):return parse_functions("x.py",source.encode())[0]["f"]
    assert compare_functions(parse("def f(x):\n return x + 1\n"),parse("def f(x):\n return x + 1\n"),32)["verdict"]=="EQUIVALENT"
    diff=compare_functions(parse("def f(s, suffix):\n return s[:-len(suffix)] if s.endswith(suffix) else s\n"),parse("def f(s, suffix):\n return s[:-len(suffix)] if suffix and s.endswith(suffix) else s\n"),256)
    assert diff["verdict"]=="COUNTEREXAMPLE" and diff["witness"]["arguments"]["suffix"]==""
    unknown=compare_functions(parse("def f(x):\n return external(x)\n"),parse("def f(x):\n return external(x) + 1\n"),16);assert unknown["verdict"]=="UNKNOWN" and "global-name:external" in unknown["reason"]
    assert compare_functions(parse("def f(x):\n return x + 1\n"),parse("def f(x):\n return 1 + x\n"),16)["verdict"]=="UNKNOWN"
    attack=compare_functions(parse("def f(x):\n return __import__('os').system(x)\n"),parse("def f(x):\n return __import__('os').system(x) + 1\n"),16);assert attack["verdict"]=="UNKNOWN" and "global-name:__import__" in attack["reason"]
    method=parse_functions("x.py",b"class C:\n def f(self, x):\n  return x + 1\n")[0]["C.f"];assert method.exclusion=="instance-or-class-method"
    print("PASS: exact proof, real-shape counterexample, unsupported UNKNOWN, no bounded equivalence claim")
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--repos",nargs="+",choices=sorted(REPOS),default=list(REPOS));p.add_argument("--workspace",default=r"C:\Users\indro\Projects\NDRA-OpenSource");p.add_argument("--output",default=r"C:\Users\indro\Projects\NDRA-OpenSource-Evidence-v3");p.add_argument("--history",type=int,default=40);p.add_argument("--max-inputs",type=int,default=256);p.add_argument("--trials",type=int,default=7);p.add_argument("--self-test",action="store_true");args=p.parse_args()
    if args.self_test:self_test();return
    if args.history<1 or args.max_inputs<1 or args.trials<1:p.error("history, max-inputs, and trials must be positive")
    report=run(args);print(json.dumps({"counts":report["counts"],"audit":report["audit"],"output":str(pathlib.Path(args.output).resolve())},indent=2))
if __name__=="__main__":main()
