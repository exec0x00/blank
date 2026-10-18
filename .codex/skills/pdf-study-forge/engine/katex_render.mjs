import katex from '../vendor/katex/katex.mjs';
import '../vendor/katex/contrib/mhchem.mjs';
import {readFileSync} from 'node:fs';
const items=JSON.parse(readFileSync(0,'utf8'));
const out=items.map(({tex,display})=>katex.renderToString(tex,{displayMode:display,throwOnError:true,strict:'warn',trust:false,output:'htmlAndMathml',maxExpand:1000,maxSize:50}));
process.stdout.write(JSON.stringify(out));
