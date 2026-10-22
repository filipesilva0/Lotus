import gi, time, json, sys
gi.require_version('Gtk','3.0'); gi.require_version('WebKit2','4.1')
from gi.repository import Gtk, WebKit2, GObject

W, H = 1280, 820
win = Gtk.OffscreenWindow(); win.set_default_size(W, H)
ucm = WebKit2.UserContentManager()
ucm.add_script(WebKit2.UserScript('window.__TAURI_INTERNALS__={invoke:async()=>null,transformCallback:()=>0,metadata:{currentWindow:{label:"main"},currentWebview:{label:"main",windowLabel:"main"}}};', WebKit2.UserContentInjectedFrames.ALL_FRAMES, WebKit2.UserScriptInjectionTime.START, None, None))
view = GObject.new(WebKit2.WebView, web_context=WebKit2.WebContext.new_ephemeral(), user_content_manager=ucm); view.set_size_request(W, H)
view.get_settings().set_enable_developer_extras(False)
win.add(view); win.show_all()
loaded = {'v': False}
view.connect('load-changed', lambda v, e: loaded.update(v=True) if e == WebKit2.LoadEvent.FINISHED else None)

def pump(ms):
    end = time.time() + ms / 1000
    while time.time() < end:
        while Gtk.events_pending(): Gtk.main_iteration()
        time.sleep(0.01)
def load(url):
    loaded['v'] = False; view.load_uri(url)
    t = time.time()
    while not loaded['v'] and time.time() - t < 15: pump(50)
    pump(700)
def js(code, wait=250): view.run_javascript(code, None, None, None); pump(wait)
def shot(name):
    res = {}
    def cb(src, r):
        try: res['s'] = view.get_snapshot_finish(r)
        except Exception as e: res['e'] = str(e)
    view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, cb)
    t = time.time()
    while 's' not in res and 'e' not in res and time.time() - t < 10: pump(50)
    if 's' in res: res['s'].write_to_png(f'/tmp/shots/{name}.png'); print('saved', name)
    else: print('FAILED', name, res.get('e'))

now = int(time.time() * 1000)
def src(i, repo, title, year, cred, dom, finding, rel, agent, rej=False):
    return dict(id=f's{i}', title=title, authors=['A. Author', 'B. Writer'], year=year, url=f'https://{dom}/{i}', abstract='x'*200, repo=repo, domain=dom, credibility=cred, agentId=agent, finding=finding, relevance=rel, rejected=rej)
plan = [
  dict(id='t1', title='Efficiency of sparse attention', objective='How much compute and memory sparse attention saves on long inputs.', questions=['What speedups are reported?', 'Which sparsity patterns work best?']),
  dict(id='t2', title='Accuracy trade-offs', objective='Whether quality drops versus dense attention.', questions=['Which benchmarks show regressions?']),
  dict(id='t3', title='Hardware and implementation', objective='GPU kernels and practical deployment.', questions=['Which libraries implement it?', 'What are the memory limits?']),
]
personas = [dict(id='p1', name='Domain specialist', role='ML researcher focused on efficient transformers', focus='Accuracy of claims and terminology'),
            dict(id='p2', name='Sceptical peer reviewer', role='Reviewer hunting weak evidence', focus='Cherry-picked benchmarks and missing baselines'),
            dict(id='p3', name='Systems engineer', role='GPU kernel developer', focus='Whether speedups hold on real hardware')]
clar = [dict(id='c1', question='Which time period should the research cover?', why='Narrows the literature', answer='2020 onwards'),
        dict(id='c2', question='Are you interested in training, inference, or both?', why='Different bottlenecks', answer='Mostly inference'),
        dict(id='c3', question='Which model scales matter (small, 7B+, frontier)?', why='', answer='')]
def agent(i, title, status, action, n, tin, tout, ctx, log):
    return dict(id=f'agent-t{i}', topicId=f't{i}', title=title, status=status, action=action, iteration=2, log=[dict(t=now-60000+k*4000, text=x) for k, x in enumerate(log)], sourceIds=[f's{j}' for j in range(n)], tokensIn=tin, tokensOut=tout, ctxPeak=ctx)
agents = [agent(1, 'Efficiency of sparse attention', 'running', 'Querying arXiv, OpenAlex', 6, 9200, 1300, 5100, ['Round 1: thinking about what to search for', 'Searching: "sparse attention long context speedup"', 'Reading 4 abstracts', 'Round 2: thinking about what to search for', 'Searching: "block sparse attention kernels"']),
          agent(2, 'Accuracy trade-offs', 'running', 'Reading abstracts (4/8)', 5, 7800, 900, 6900, ['Round 1: thinking about what to search for', 'Searching: "sparse attention accuracy degradation benchmark"', 'Reading 4 abstracts']),
          agent(3, 'Hardware and implementation', 'queued', 'Waiting for a free slot', 0, 0, 0, 0, [])]
sources = [src(0,'arxiv','Longformer-style sparse attention for 128k contexts',2023,'preprint','arxiv.org','Reports 3.1x faster inference at 64k tokens with under 1% accuracy loss on long-document QA.',5,'agent-t1'),
  src(1,'pubmed','Efficient attention in clinical text models: a systematic review',2022,'high','pubmed.ncbi.nlm.nih.gov','Across 14 studies, sparse variants matched dense attention within 2 F1 points.',3,'agent-t1'),
  src(2,'openalex','FlashAttention-style kernels for block-sparse patterns',2023,'medium','dl.acm.org','Block-sparse kernels reach 70% of dense throughput while cutting memory by half.',4,'agent-t1'),
  src(3,'arxiv','When sparsity hurts: retrieval degradation in long-context LLMs',2024,'preprint','arxiv.org','Finds a 6-point drop on needle-in-haystack at 128k for fixed sparse patterns.',5,'agent-t2'),
  src(4,'openalex','A survey of efficient transformers',2022,'high','nature.com','Surveys 40 methods; notes inconsistent baselines make speedup claims hard to compare.',4,'agent-t2'),
  src(5,'openalex','Spammy listicle: top 10 attention tricks',2021,'unknown','blog.example.com','Low-quality listing with no methodology.',1,'agent-t2',rej=True)]
queries = [dict(t=now-50000+k*3500, agentId='agent-t1', repo=r, query=q, status=s, ms=m, count=c) for k,(r,q,s,m,c) in enumerate([
  ('arxiv','sparse attention long context speedup',200,512,6),('pubmed','sparse attention long context speedup',200,388,0),('openalex','sparse attention long context speedup',200,241,6),
  ('crossref','sparse attention accuracy degradation',503,96,0),('arxiv','sparse attention accuracy degradation benchmark',200,630,6),('openalex','block sparse attention kernels',200,274,6)])]
def proj(pid, title, phase, **kw):
    d = dict(id=pid, title=title, question='What does the literature say about sparse attention for long-context transformers?', tags=['#MachineLearning'], createdAt=now-3600000, updatedAt=now-120000, phase=phase, model='llama3.1:8b', clarifications=[], plan=[], personas=[], limits=dict(repos=dict(arxiv=True, pubmed=True, openalex=True, crossref=False), maxDepth=2, maxSourcesPerAgent=8, parallelAgents=2, yearCutoff=2020, requiredKeywords=[], excludedDomains=[], language=''), agents=[], sources=[], queries=[], injected=[], report='', tokensIn=0, tokensOut=0, supervisorCtx=0, numCtx=8192, paused=False, progress=0)
    d.update(kw); return d
report = """# Sparse attention for long-context transformers

## Executive summary

Sparse attention can cut inference cost substantially on long inputs, with reported speedups of about 3x at 64k tokens [1][3]. Quality is largely preserved on document-level tasks [1][2], but fixed sparsity patterns degrade retrieval-style tasks at very long contexts [4].

## Efficiency of sparse attention

- Block-sparse kernels reach roughly 70% of dense throughput while halving memory use [3].
- Comparisons across papers are hard because baselines differ [5].

## Accuracy trade-offs

A systematic review found sparse variants within 2 F1 points of dense attention [2], yet one study reports a 6-point drop on needle-in-haystack at 128k tokens [4].

## Critical review

**Sceptical peer reviewer:** most speedups come from a single hardware setup and few baselines [5].

## Limitations

Only abstracts were read, so implementation details are missing.

## References

1. A. Author et al. (2023). Longformer-style sparse attention for 128k contexts. *arXiv*. https://arxiv.org/abs/2301.00001
2. A. Author et al. (2022). Efficient attention in clinical text models. *PubMed*. https://pubmed.ncbi.nlm.nih.gov/111/
3. A. Author et al. (2023). FlashAttention-style kernels for block-sparse patterns. *OpenAlex*. https://doi.org/10.1000/x3
4. A. Author et al. (2024). When sparsity hurts. *arXiv*. https://arxiv.org/abs/2401.00004
5. A. Author et al. (2022). A survey of efficient transformers. *OpenAlex*. https://doi.org/10.1000/x5"""
P = {
 'scoping': [proj('a','New research task','scoping',question='')],
 'clarify': [proj('a','Sparse attention','scoping',clarifications=clar)],
 'plan': [proj('a','Sparse attention for long-context transformers','planning',clarifications=clar,plan=plan,personas=personas)],
 'live': [proj('a','Sparse attention for long-context transformers','running',clarifications=clar,plan=plan,personas=personas,agents=agents,sources=sources,queries=queries,injected=['focus on inference cost'],tokensIn=17000,tokensOut=2200,supervisorCtx=0,progress=0.42,startedAt=now-95000)],
 'report': [proj('a','Sparse attention for long-context transformers','done',clarifications=clar,plan=plan,personas=personas,agents=[dict(a, status='done', action='Done: 6 sources') for a in agents],sources=sources,queries=queries,report=report,tokensIn=31000,tokensOut=5400,supervisorCtx=7300,progress=1,startedAt=now-300000,finishedAt=now-20000)],
 'empty': [],
}
URL = 'http://127.0.0.1:8123'
def scenario(name, projects, dark=False, view_rail='Deep Research', extra=None):
    js(f"localStorage.clear(); localStorage.setItem('lotus.research.v1', {json.dumps(json.dumps(projects))}); localStorage.setItem('lotus.sessions.v1','[]'); localStorage.setItem('lotus.settings.v1', {json.dumps(json.dumps(dict(darkMode=dark, palette='blue', selectedModel='llama3.1:8b')))});")
    load(URL + '/index.html')
    js(f"document.querySelector('[title=\"{view_rail}\"], [aria-label=\"{view_rail}\"]')?.click();", 900)
    if extra: js(extra, 500)
    shot(name)

load(URL + '/index.html')
for n in sys.argv[1:] or ['empty','scoping','clarify','plan','live','report']:
    scenario('research-' + n, P[n])
scenario('research-live-dark', P['live'], dark=True)
