import gi, time, json
gi.require_version('Gtk','3.0'); gi.require_version('WebKit2','4.1')
from gi.repository import Gtk, WebKit2, GObject
def make(W,H,tauri):
    win = Gtk.OffscreenWindow(); win.set_default_size(W,H)
    if tauri:
        ucm = WebKit2.UserContentManager()
        ucm.add_script(WebKit2.UserScript('window.__TAURI_INTERNALS__={invoke:async()=>null,transformCallback:()=>0,metadata:{currentWindow:{label:"main"},currentWebview:{label:"main",windowLabel:"main"}}};', WebKit2.UserContentInjectedFrames.ALL_FRAMES, WebKit2.UserScriptInjectionTime.START, None, None))
        v = GObject.new(WebKit2.WebView, web_context=WebKit2.WebContext.new_ephemeral(), user_content_manager=ucm)
    else: v = GObject.new(WebKit2.WebView, web_context=WebKit2.WebContext.new_ephemeral())
    v.set_size_request(W,H); win.add(v); win.show_all()
    st={'ok':False}; v.connect('load-changed', lambda a,e: st.update(ok=True) if e==WebKit2.LoadEvent.FINISHED else None)
    return v, st
def pump(ms):
    end=time.time()+ms/1000
    while time.time()<end:
        while Gtk.events_pending(): Gtk.main_iteration()
        time.sleep(0.01)
def load(v,st,url): 
    st['ok']=False; v.load_uri(url); t=time.time()
    while not st['ok'] and time.time()-t<15: pump(50)
    pump(700)
def js(v,code,w=300): v.run_javascript(code,None,None,None); pump(w)
def shot(v,name):
    r={}
    def cb(s,x):
        try: r['s']=v.get_snapshot_finish(x)
        except Exception as e: r['e']=str(e)
    v.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, cb); t=time.time()
    while 's' not in r and 'e' not in r and time.time()-t<10: pump(50)
    if 's' in r: r['s'].write_to_png(f'/tmp/shots/{name}.png'); print('saved',name)
    else: print('FAILED',name,r.get('e'))
U='http://127.0.0.1:8123'
# ---- island (browser mode so the BroadcastChannel event bus works)
v,st = make(480,520,False)
load(v,st,U+'/island.html'); shot(v,'island-1-strip')
js(v,"document.querySelector('[aria-label=\"Lotus island\"]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));",900); shot(v,'island-2-peek')
js(v,"document.querySelector('button[aria-label=\"Chat\"]')?.click();",900); shot(v,'island-3-chat')
load(v,st,U+'/island.html')
js(v,"new BroadcastChannel('lotus-bus').postMessage({name:'agent:permission',payload:{request_id:7,hook_event_name:'PermissionRequest',session_id:'s1',cwd:'C:\\\\code\\\\my-app',tool_name:'Bash',tool_input:{command:'npm run build && rm -rf dist/old'}}});",1100); shot(v,'island-4-approval')
# ---- desktop-mode pages
v,st = make(1280,820,True)
js(v,"1"); load(v,st,U+'/index.html')
js(v,"localStorage.clear(); localStorage.setItem('lotus.settings.v1', JSON.stringify({palette:'blue'}));")
load(v,st,U+'/index.html'); shot(v,'app-firstrun-engines')
js(v,"localStorage.setItem('lotus.sessions.v1','[]'); localStorage.setItem('lotus.setup.dismissed','1');"); load(v,st,U+'/index.html')
js(v,"document.querySelector('[aria-label=\"Voice Studio\"]')?.click();",1200); shot(v,'app-voice-offline')
js(v,"document.querySelector('[aria-label=\"Image Studio\"]')?.click();",900); shot(v,'app-image')
