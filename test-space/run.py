import argparse
import getpass
import os
import webbrowser
import uvicorn
from app import create_app

if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Local Claude account Messages server')
    parser.add_argument('--port',type=int,default=7860)
    parser.add_argument('--no-open',action='store_true')
    parser.add_argument('--prompt-session-key',action='store_true',help='Read a Claude sessionKey securely before starting')
    parser.add_argument('--session-key-env',default='CLAUDE_SESSION_KEY',help='Environment variable containing the Claude sessionKey (default: CLAUDE_SESSION_KEY)')
    args=parser.parse_args()
    session_key=getpass.getpass('Claude sessionKey: ') if args.prompt_session_key else os.environ.get(args.session_key_env)
    if session_key is not None and not session_key.strip():parser.error('The session key is empty.')
    application=create_app(initial_session_key=session_key)
    if not args.no_open:webbrowser.open(f'http://127.0.0.1:{args.port}/')
    uvicorn.run(application,host='0.0.0.0',port=args.port,access_log=False,ws_max_size=16*1024*1024)
