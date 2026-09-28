# Sample-1 analysis: Jev (5 passes), Qwen (1 pass) and a Jev->Qwen cascade derived offline,
# scored against the AI-reviewed reference (not a human adjudication). Reads the gzipped traces.
import json,glob,collections,sys,os,gzip
os.chdir(os.path.expanduser('~/Development/DEMIURGO-bench'))
ref={a['scenario']:{(p['task'],p['ref']):p for p in a['pairs']} for a in json.load(open('evals/knowledge/v2/reference/sample-1/reference.json'))}
REL=lambda ef:[e for e in ef if e not in('preserve','pending')]
def outcomes(path):
    t=json.load(gzip.open(path)); out=[]
    for e in t['events']:
        if e['scenario'] not in ref: continue
        for o in e['outcomes']: out.append((e['scenario'],e['repetition'],o))
    return out
def score(rows,name):
    c=collections.Counter()
    for sc,rep,o in rows:
        j=ref[sc][(o['task'],o['ref'])]
        exp=set(REL(j['effects'])); got=set(o['effects'])
        pend='pending' in got
        relv=bool(exp)
        c['pairs']+=1; c['invalid']+=o['invalid']
        if o.get('omissionReason')=='version_precedence': c['structural']+=1; continue
        if relv:
            c['rel']+=1
            if pend: c['rel_pending']+=1
            elif exp<=got and not (got-set(j['effects'])): c['rel_ok']+=1
            elif not (got-{'preserve'}): c['rel_silent_miss']+=1
            else: c['rel_wrong_auto']+=1
        else:
            c['irr']+=1
            if pend: c['irr_pending']+=1
            elif got<= {'preserve'}: c['irr_ok']+=1
            else: c['irr_false_alarm']+=1
        # label agreement
        for k,v in o['labels'].items():
            if k in j['labels']:
                c['lab']+=1; c['lab_ok']+= v in j['labels'][k]
                if relv: c['rlab']+=1; c['rlab_ok']+= v in j['labels'][k]
    f=lambda a,b: f"{c[a]}/{c[b]}" 
    print(f"{name:34} rel:{c['rel']:3} ok {c['rel_ok']:3} pend {c['rel_pending']:3} silentMiss {c['rel_silent_miss']:2} wrongAuto {c['rel_wrong_auto']:2} | irr:{c['irr']:4} ok {c['irr_ok']:4} pend {c['irr_pending']:3} falseAl {c['irr_false_alarm']:2} | lab {c['lab_ok']/max(c['lab'],1):.3f} relLab {c['rlab_ok']/max(c['rlab'],1):.3f} inv {c['invalid']} struct {c['structural']}")
    return c
for p in sorted(glob.glob('evals/knowledge/v2/runs/jev/traces/*isolated*.trace.json.gz'))+sorted(glob.glob('evals/knowledge/v2/runs/qwen-sample-1/traces/*.trace.json.gz')):
    score(outcomes(p),p.split('runs/')[1].replace('.trace.json.gz','').replace('/traces',''))
# cascade: jev rep outcomes, pending -> qwen outcome for same pair
print('--- cascade Jev->Qwen (derived offline)')
for cfg in ['A-isolated-dev','A-isolated-validation','B-isolated-dev','B-isolated-validation']:
    q={(sc,o['task'],o['ref']):o for sc,rep,o in outcomes(f'evals/knowledge/v2/runs/qwen-sample-1/traces/{cfg}.trace.json.gz')}
    rows=[];esc=0;miss=0
    for sc,rep,o in outcomes(f'evals/knowledge/v2/runs/jev/traces/{cfg}.trace.json.gz'):
        if 'pending' in o['effects'] or o['invalid']:
            qo=q.get((sc,o['task'],o['ref']))
            if qo: o=qo; esc+=1
            else: miss+=1
        rows.append((sc,rep,o))
    score(rows,f'cascade/{cfg} (esc {esc}, noQwen {miss})')
print('=== relevant pairs detail')
for C in 'AB':
  for part in ['dev','validation']:
    cfg=f'{C}-isolated-{part}'
    jv=collections.defaultdict(list)
    for sc,rep,o in outcomes(f'evals/knowledge/v2/runs/jev/traces/{cfg}.trace.json.gz'): jv[(sc,o['task'],o['ref'])].append(o)
    q={(sc,o['task'],o['ref']):o for sc,rep,o in outcomes(f'evals/knowledge/v2/runs/qwen-sample-1/traces/{cfg}.trace.json.gz')}
    for k,os_ in sorted(jv.items()):
        j=ref[k[0]][(k[1],k[2])]
        if not REL(j['effects']): continue
        je=collections.Counter('+'.join(sorted(o['effects'])) for o in os_)
        jc=[o['confidence'] for o in os_]
        qo=q.get(k)
        print(cfg,k, 'REF',j['effects'], 'amb' if j['ambiguous'] else '', {kk:v for kk,v in j['labels'].items()})
        print('    jev', dict(je), 'conf', min(jc),'-',max(jc), os_[0]['labels'])
        if qo: print('    qwen', qo['effects'], qo['confidence'], qo['labels'])
print('=== Jev false alarms A-validation')
for sc,rep,o in outcomes('evals/knowledge/v2/runs/jev/traces/A-isolated-validation.trace.json.gz'):
    j=ref[sc][(o['task'],o['ref'])]
    if not REL(j['effects']) and 'pending' not in o['effects'] and set(o['effects'])-{'preserve'}:
        print(sc,rep,o['task'],o['ref'],o['effects'],o['labels'],o['confidence'],'REF',j['effects'],j['labels'])
