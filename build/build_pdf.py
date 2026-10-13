import glob,os
from playwright.sync_api import sync_playwright
O="/home/user/blank/output/"
H='<div style="font:8px sans-serif;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>Engineering Chemistry</span><span>Unit 1</span></div>'
F='<div style="font:8px sans-serif;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args=['--no-sandbox']); pg=b.new_page()
    for f in sorted(glob.glob(O+"*.html")):
        pg.goto("file://"+f,wait_until="load")
        pg.pdf(path=f[:-5]+".pdf",format="A4",print_background=True,display_header_footer=True,header_template=H,footer_template=F,margin={"top":"18mm","bottom":"18mm","left":"16mm","right":"16mm"})
    b.close()
