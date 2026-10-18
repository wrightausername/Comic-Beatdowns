import tempfile

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class BodyLimitMiddleware:
    """Spool bounded request bodies before the framework's multipart parser.

    Small requests stay in memory. Large requests spool to the OS temp directory,
    with a hard cap even when Content-Length is absent or dishonest.
    """

    def __init__(self, app: ASGIApp, max_bytes: int):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http" or scope.get("method") not in {"POST", "PUT", "PATCH"}:
            return await self.app(scope, receive, send)

        async def reject():
            await JSONResponse({"detail": "Request exceeds the 65 MB limit"}, status_code=413)(
                scope, receive, send
            )

        length = dict(scope.get("headers", [])).get(b"content-length", b"0")
        if length.isdigit() and int(length) > self.max_bytes:
            return await reject()
        received = 0
        with tempfile.SpooledTemporaryFile(max_size=1024 * 1024) as spool:
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                body = message.get("body", b"")
                received += len(body)
                if received > self.max_bytes:
                    return await reject()
                spool.write(body)
                if not message.get("more_body", False):
                    break
            spool.seek(0)
            complete = False

            async def replay() -> Message:
                nonlocal complete
                if complete:
                    return await receive()
                body = spool.read(64 * 1024)
                complete = spool.tell() == received
                return {"type": "http.request", "body": body, "more_body": not complete}

            await self.app(scope, replay, send)
