import logging
from secrets import compare_digest

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.routers import manuals, revisions, projects, auth, users, admin
from app.services.minio_service import get_storage

logger = logging.getLogger(__name__)


def authorize(request: Request):
    expected = get_settings().api_token.get_secret_value()
    if expected and not compare_digest(request.headers.get('Authorization', ''), f'Bearer {expected}'):
        raise HTTPException(401, 'Unauthorized')


app = FastAPI(title='Manual Management', dependencies=[Depends(authorize)])
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins,
    allow_methods=['GET', 'POST', 'PUT'], allow_headers=['Content-Type', 'Authorization', 'X-CSRF-Token'], allow_credentials=True)
app.include_router(manuals.router)
app.include_router(revisions.router)
app.include_router(projects.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(admin.router)


class PrivateApiResponses:
    """Set cache policy without buffering or changing request-stream exceptions."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope['path'].startswith('/api/'):
            return await self.app(scope, receive, send)
        async def private_send(message):
            if message['type'] == 'http.response.start':
                message['headers'] = [(key, value) for key, value in message['headers']
                    if key.lower() != b'cache-control'] + [(b'cache-control', b'no-store')]
            await send(message)
        await self.app(scope, receive, private_send)


app.add_middleware(PrivateApiResponses)


class UploadLimitMiddleware:
    """Bound multipart traffic before it can fill the server's temporary disk."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] != 'POST':
            return await self.app(scope, receive, send)
        limit = get_settings().max_upload_mb * 1024 * 1024 + 1024 * 1024
        headers = dict(scope['headers'])
        try:
            length = int(headers.get(b'content-length', b'0'))
        except ValueError:
            return await JSONResponse(status_code=400, content={'detail': 'Invalid Content-Length'})(scope, receive, send)
        if length > limit:
            return await JSONResponse(status_code=413, content={'detail': 'Upload exceeds the request size limit'})(scope, receive, send)
        total = 0
        async def bounded_receive():
            nonlocal total
            message = await receive()
            total += len(message.get('body', b''))
            if total > limit:
                raise HTTPException(413, 'Upload exceeds the request size limit')
            return message
        await self.app(scope, bounded_receive, send)


app.add_middleware(UploadLimitMiddleware)


@app.exception_handler(RequestValidationError)
def validation_error(request, error):
    messages = [f'{".".join(str(x) for x in item["loc"][1:])}: {item["msg"]}' for item in error.errors()]
    return JSONResponse(status_code=400, content={'detail': '; '.join(messages)})


@app.exception_handler(Exception)
def unexpected_error(request, error):
    logger.error('Request failed: %s %s', request.method, request.url.path,
        exc_info=(type(error), error, error.__traceback__))
    return JSONResponse(status_code=500, content={'detail': 'Unable to complete the request. Please try again.'})


@app.get('/health')
def health(db: Session = Depends(get_db), storage=Depends(get_storage)):
    result = {'status': 'ok', 'database': 'connected', 'minio': 'connected'}
    try:
        db.execute(text('SELECT 1'))
    except Exception:
        logger.exception('Database health check failed')
        db.rollback()
        result['database'] = 'unavailable'
    try:
        storage.health()
    except Exception:
        logger.exception('MinIO health check failed')
        result['minio'] = 'unavailable'
    if 'unavailable' in result.values():
        result['status'] = 'degraded'
        return JSONResponse(status_code=503, content=result)
    return result
