"""Use Studio's stdlib HTTP transport behind an asynchronous interface."""
import asyncio
import urllib.request
import urllib.error
import httpx

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):return None

class Body(httpx.AsyncByteStream):
    def __init__(self,response):self.response=response
    async def __aiter__(self):
        while True:
            try:data=await asyncio.to_thread(self.response.read1,8192)
            except (OSError,ValueError) as e:raise httpx.ReadError('Studio transport read failed') from e
            if not data:return
            yield data
    async def aclose(self):self.response.close()

class StudioTransport(httpx.AsyncBaseTransport):
    async def handle_async_request(self,request):
        data=await request.aread()
        headers=dict(request.headers)
        # urllib uses identity encoding by default; do not advertise unsupported HTTP compression.
        headers['accept-encoding']='identity'
        req=urllib.request.Request(str(request.url),data=data if data else None,headers=headers,method=request.method)
        def open_request():
            try:return urllib.request.build_opener(NoRedirect()).open(req,timeout=180)
            except urllib.error.HTTPError as response:return response
            except urllib.error.URLError as error:raise httpx.ConnectError('Studio transport could not connect') from error
        response=await asyncio.to_thread(open_request)
        return httpx.Response(response.status,headers=list(response.headers.items()),stream=Body(response),request=request)
