"""Generate the public directory from the same route inventory as the site build."""
import html
import json
import re

RESEARCH = set('patterns-home priorities ask-pie evidence-lab intel/feed intel intel-commercial intel-dfr industry tracker grants timeline patterns brief clock entity-graph adversary-bom mirroring actors ttps evasion market-lens forecast-accountability pie-trends pie-search brief-archive lexicon'.split())
HELP = set('support donate terms privacy contribute analytics data-status miner-health intel-health api-docs verify audit-doctrine contribute-doctrine'.split())
LEARN = set('guides academy start software-library troubleshoot'.split())
ALIASES = {'forge', 'hub', 'intel', 'tools-home'}
LABELS = {'':'Build home','builder':'My build','models':'Developer models','patterns-home':'Today','ask-pie':'Research a question','intel/feed':'News','pie-search':'Advanced record search','cost':'Cost estimate','priorities':'Watchlist & priorities','miner-health':'Dataset coverage','intel-health':'Collection pipeline','data-status':'Data status','gallery':'Example builds','tools':'RF tools'}
LABELS['test-lab'] = 'System Test Lab'
DESCRIPTIONS = {'builder':'Select parts and review recorded compatibility in your current build.','models':'Download the retained CUAS detector family with formats, hashes, metrics, and integration guidance.','ask-pie':'Find cited records and save an evidence packet.','pie-search':'Filter and inspect the full indexed corpus.','cost':'Review prices and weights for your saved parts or a catalog model.','tools':'Terrain, channel planning, mesh planning, and link budget tools.','intel/feed':'UAS-related articles, with a separate full-corpus view.','gallery':'Unvalidated example component lists to inspect in the Builder.'}
DESCRIPTIONS['test-lab'] = 'Download general software tests, prepare Gauntlet III and DoW evidence, and review local results.'
def write_directory(pages, source, output):
    entries=[]
    for filename, destination in pages.items():
        route=destination.removesuffix('index.html').strip('/')
        if route.startswith('private') or route in ALIASES: continue
        path=source/filename
        if not path.exists(): continue
        content=path.read_text(encoding='utf-8')
        title=re.search(r'<title>(.*?)</title>',content,re.I|re.S)
        title=html.unescape(re.sub('<[^>]+>', '', title.group(1))) if title else route.replace('-', ' ').title()
        title=re.sub(r'\s*[—|·]\s*(?:Forge|UAS.*|Patterns|P\.I\.E).*$', '', title).strip()
        title=re.sub(r'^(?:Forge|UAS Patterns)\s*[—|·]\s*', '', title).strip()
        area='Research' if route in RESEARCH else 'Help' if route in HELP else 'Learn' if route in LEARN or route.endswith('-guide') else 'Build'
        origin='https://uas-patterns.com' if area=='Research' or route in {'miner-health','intel-health','data-status'} else 'https://uas-forge.com'
        entries.append({'title':LABELS.get(route,title),'description':DESCRIPTIONS.get(route, ''),'area':area,'url':origin+'/'+route+'/' if route else origin+'/'})
    entries.append({'title':'Handbook','description':'Read the Drone Integration Handbook.','area':'Learn','url':'https://uas-handbook.com/'})
    (output/'static'/'site-directory.json').write_text(json.dumps(entries,indent=2)+'\n',encoding='utf-8')
