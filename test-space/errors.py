class APIError(Exception):
    def __init__(self, status, message, code='upstream_error', param=None, retry_after=None):
        super().__init__(message)
        self.status, self.code, self.param, self.retry_after = status, code, param, retry_after

    def body(self):
        kind = 'invalid_request_error' if self.status in (400, 404, 413, 422, 501) else 'authentication_error' if self.status in (401, 403) else 'rate_limit_error' if self.status == 429 else 'server_error'
        return {'error': {'message': str(self), 'type': kind, 'param': self.param, 'code': self.code}}

def unsupported(param):
    raise APIError(400, f'{param} is not supported by this Claude bridge.', 'unsupported_parameter', param)
