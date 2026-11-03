"""把 demo/layer.* 套到上一层的 index.html，产生 demo/salary-demo.html。在任何位置执行都可以。"""
from pathlib import Path
here = Path(__file__).resolve().parent
src = (here.parent / 'index.html').read_text(encoding='utf-8')
assert src.count('DL.save(') >= 3
src = src.replace('DL.save(', '__DS(DL,')
old = 'a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),2000)'
assert old in src
src = src.replace(old, 'a.click();setTimeout(()=>{a.remove();URL.revokeObjectURL(u)},2000)')
src = src.replace('<title>发薪分配工具</title>', '<title>发薪分配工具 Demo</title>')
css = (here / 'layer.css').read_text(encoding='utf-8')
js = (here / 'layer.js').read_text(encoding='utf-8')
assert '</script' not in js
assert src.count('</head>') == 1 and src.count('</body>') == 1
src = src.replace('</head>', '<style>\n' + css + '</style>\n</head>').replace('</body>', '<script>\n' + js + '</script>\n</body>')
(here / 'salary-demo.html').write_text(src, encoding='utf-8')
