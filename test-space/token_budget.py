"""Local token estimates; Claude's private web API exposes no exact count."""
import os
from pathlib import Path

import tiktoken

# Bundle the encoding data so token counting never fetches a file at runtime.
os.environ['TIKTOKEN_CACHE_DIR']=str(Path(__file__).parent/'resources'/'tiktoken')
ENCODING=tiktoken.get_encoding('o200k_base')

def count_text(value):
    return len(ENCODING.encode(value,disallowed_special=()))

def fit_delta(current,addition,limit):
    """Return a Unicode-safe prefix of addition within the visible token budget."""
    combined=current+addition
    if count_text(combined)<=limit:
        return addition,False
    low,high=0,len(addition)
    while low<high:
        middle=(low+high+1)//2
        if count_text(current+addition[:middle])<=limit:low=middle
        else:high=middle-1
    return addition[:low],True
