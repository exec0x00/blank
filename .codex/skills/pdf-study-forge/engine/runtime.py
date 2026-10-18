from pathlib import Path
import os,shutil,glob

def browser_executable(playwright):
    explicit=os.environ.get('PDF_FORGE_BROWSER')
    if explicit:
        if not Path(explicit).is_file():raise RuntimeError('PDF_FORGE_BROWSER does not point to a file')
        return explicit
    bundled=playwright.chromium.executable_path
    if Path(bundled).is_file():return bundled
    for name in ('chromium','chromium-browser','google-chrome','google-chrome-stable'):
        if found:=shutil.which(name):return found
    candidates=glob.glob('/opt/pw-browsers/chromium-*/chrome-linux*/chrome')
    candidates+=glob.glob('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    for key in ('PROGRAMFILES','PROGRAMFILES(X86)','LOCALAPPDATA'):
        if os.environ.get(key):candidates+=glob.glob(os.path.join(os.environ[key],'Google','Chrome','Application','chrome.exe'))
    if candidates:return sorted(candidates)[-1]
    raise RuntimeError('Chromium not found. Install Chrome/Chromium, set PDF_FORGE_BROWSER, or run python -m playwright install chromium once (network required).')
