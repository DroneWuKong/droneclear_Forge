"""Conservative, position-based repairs for authored public HTML.

Preserves scripts, formatting and visible copy. Missing landmarks use an existing
content container where possible; icon-only buttons require explicit labels.
"""
import html
import re
from html.parser import HTMLParser

LABELS={'browse-back':'Go back','import-modal-close':'Close import dialog','lightbox-prev':'Previous image','lightbox-next':'Next image','btn-close-camera':'Close camera','btn-close-settings':'Close settings','drawer-close':'Close navigation','modal-close-x':'Close dialog','flag-modal-close':'Close flag details','plat-modal-close':'Close platform details','mobile-nav-toggle':'Toggle navigation','send-btn':'Send message'}
VOID={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
class Positions(HTMLParser):
    def __init__(self,text):
        super().__init__(convert_charrefs=True)
        self.text=text; self.lines=[0]; self.nodes=[]; self.stack=[]
        for match in re.finditer('\n',text): self.lines.append(match.end())
        self.feed(text)
    def position(self):
        line,col=self.getpos(); return self.lines[line-1]+col
    def handle_starttag(self,tag,attrs):
        node={'tag':tag,'attrs':dict(attrs),'start':self.position(),'open':self.get_starttag_text(),'end':None,'text':[]}
        self.nodes.append(node)
        if tag not in VOID:self.stack.append(node)
    def handle_startendtag(self,tag,attrs):
        self.handle_starttag(tag,attrs)
        if self.stack and self.stack[-1]['tag']==tag:self.stack.pop()
    def handle_endtag(self,tag):
        for i in range(len(self.stack)-1,-1,-1):
            if self.stack[i]['tag']==tag:
                self.stack[i]['end']=self.position();self.stack=self.stack[:i];break
    def handle_data(self,data):
        for node in self.stack:
            if node['tag'] in {'button','title'}:node['text'].append(data)

def normalize(text):
    parser=Positions(text); changes=[]
    def change(node,opening):changes.append((node['start'],node['start']+len(node['open']),opening))
    for node in parser.nodes:
        attrs=node['attrs']; opening=node['open']
        if node['tag']=='a' and str(attrs.get('target','')).lower()=='_blank':
            rel=set((attrs.get('rel') or '').lower().split())|{'noopener','noreferrer'}
            value=' '.join(sorted(rel))
            if 'rel' in attrs:opening=re.sub(r'\brel\s*=\s*([\'"])(.*?)\1',lambda m:'rel='+m[1]+value+m[1],opening,flags=re.I)
            else:opening=opening[:-1]+' rel="'+value+'">'
        if node['tag']=='button' and not (''.join(node['text']).strip() or attrs.get('aria-label') or attrs.get('title')):
            label=LABELS.get(attrs.get('id'))
            if 'mobile-menu-btn' in (attrs.get('class') or ''):label='Toggle navigation'
            if label:opening=opening[:-1]+' aria-label="'+label+'">'
        if opening!=node['open']:change(node,opening)
    body=next((n for n in parser.nodes if n['tag']=='body' and n['end'] is not None),None)
    main=next((n for n in parser.nodes if n['tag']=='main' and n['end'] is not None),None)
    if not main and body:
        candidates=[n for n in parser.nodes if n['tag']=='div' and n['end'] is not None and body['start']<n['start']<body['end'] and (n['attrs'].get('id') in {'page-content','main-content','app-content'} or set((n['attrs'].get('class') or '').split())&{'page','container','main-content','app-content'})]
        if candidates:
            main=max(candidates,key=lambda n:n['end']-n['start'])
            change(main,re.sub(r'^<div\b','<main',main['open'],flags=re.I))
            changes.append((main['end'],main['end']+len('</div>'),'</main>'))
        else:
            start=body['start']+len(body['open']);main={'start':start,'open':''}
            changes.append((start,start,'\n<main id="main-content">'))
            changes.append((body['end'],body['end'],'</main>\n'))
    if main and not any(n['tag']=='h1' for n in parser.nodes):
        title=next((''.join(n['text']).strip() for n in parser.nodes if n['tag']=='title'),'Page')
        heading='<h1 style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0">'+html.escape(title)+'</h1>'
        pos=main['start']+len(main['open'])
        changes.append((pos,pos,heading))
    # At a shared position apply the heading before the opening wrapper so the
    # wrapper ends up before it in the final document.
    for _,(start,end,value) in sorted(enumerate(changes),key=lambda item:(item[1][0],item[1][1],item[0]),reverse=True):text=text[:start]+value+text[end:]
    return text

if __name__=='__main__':
    from pathlib import Path
    for path in (Path(__file__).resolve().parents[1]/'forge-source').glob('*.html'):
        old=path.read_text(encoding='utf-8');new=normalize(old)
        if old!=new:path.write_text(new,encoding='utf-8');print(path.name)
