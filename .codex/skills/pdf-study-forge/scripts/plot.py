#!/usr/bin/env python3
"""Draw a print-ready 2-D graph from explicit data, with no executable input expressions."""
from pathlib import Path
import argparse,json,sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from figstyle import axes2d,save,SERIES,REF

def main():
    a=argparse.ArgumentParser();a.add_argument('spec');a.add_argument('output');args=a.parse_args()
    s=json.loads(Path(args.spec).read_text());fig,ax=axes2d()
    for i,line in enumerate(s['series']):
        if len(line['x'])!=len(line['y']) or not line['x']:raise ValueError('Each series needs equal nonempty x/y arrays')
        ax.plot(line['x'],line['y'],label=line['label'],color=SERIES[i%len(SERIES)],linestyle=line.get('style','-'),linewidth=2,marker=line.get('marker',None))
    ax.set_xlabel(s['xlabel']);ax.set_ylabel(s['ylabel'])
    if 'xlim' in s:ax.set_xlim(*s['xlim'])
    if 'ylim' in s:ax.set_ylim(*s['ylim'])
    if s.get('aspect')=='equal':ax.set_aspect('equal',adjustable='box')
    elif s.get('aspect','auto')!='auto':raise ValueError('aspect must be auto or equal')
    if 'title' in s:ax.set_title(s['title'],fontsize=13)
    for note in s.get('annotations',[]):ax.annotate(note['text'],xy=note['xy'],xytext=note['xytext'],arrowprops={'arrowstyle':'->','lw':.8},fontsize=10)
    ax.grid(alpha=.18);ax.legend(frameon=False,fontsize=10);fig.tight_layout()
    Path(args.output).parent.mkdir(parents=True,exist_ok=True);save(fig,args.output);print(args.output)
if __name__=='__main__':main()
