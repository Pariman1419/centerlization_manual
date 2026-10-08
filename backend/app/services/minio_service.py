from datetime import timedelta
from functools import lru_cache
from urllib.parse import quote, urlsplit

from minio import Minio
from urllib3 import PoolManager, Timeout

from app.config import get_settings


class MinioStorage:
    def __init__(self):
        settings = get_settings()
        self.bucket = settings.minio_bucket
        credentials = {'access_key': settings.minio_access_key.get_secret_value(),
            'secret_key': settings.minio_secret_key.get_secret_value(), 'region': settings.minio_region}
        self.client = Minio(settings.minio_endpoint, secure=settings.minio_secure,
            http_client=PoolManager(timeout=Timeout(connect=5, read=60), retries=False), **credentials)
        endpoint = urlsplit(settings.minio_public_endpoint)
        if endpoint.scheme not in ('http', 'https') or not endpoint.netloc or endpoint.path not in ('', '/'):
            raise ValueError('MINIO_PUBLIC_ENDPOINT must be an http(s) origin without a path')
        # Sign for the public host; changing the host afterward breaks SigV4.
        self.public_client = Minio(endpoint.netloc, secure=endpoint.scheme == 'https', **credentials)

    def health(self):
        if not self.client.bucket_exists(self.bucket):
            raise RuntimeError('Manual bucket does not exist')
        return True

    def upload(self, key, data, size, content_type='application/pdf'):
        self.client.put_object(self.bucket, key, data, size, content_type=content_type)

    def prefix_exists(self, prefix):
        return next(self.client.list_objects(self.bucket, prefix=prefix, recursive=True), None) is not None

    def delete(self, key):
        self.client.remove_object(self.bucket, key)

    def url(self, key, filename, download=False, content_type='application/pdf'):
        # Only PDFs are ever shown inline; every other type is forced to download.
        is_pdf = content_type == 'application/pdf'
        disposition = 'inline' if is_pdf and not download else 'attachment'
        return self.public_client.presigned_get_object(self.bucket, key, expires=timedelta(minutes=10),
            response_headers={'response-content-type': content_type if is_pdf else 'application/octet-stream',
                'response-content-disposition': f'{disposition}; filename="manual.pdf"; filename*=UTF-8\'\'{quote(filename, safe="")}'})


@lru_cache
def get_storage():
    return MinioStorage()
