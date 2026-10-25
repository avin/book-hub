import ftplib, io, socket, ssl
import boto3
from botocore.config import Config

host = 'storage-fixtures'
context = ssl.create_default_context(cafile='/fixtures/server.pem')
payload = b'Book Hub original fixture\x00\xff'
class ImplicitFTP(ftplib.FTP_TLS):
    def connect(self, host='', port=0, timeout=-999, source_address=None):
        self.host = host
        self.port = port
        self.sock = self.context.wrap_socket(socket.create_connection((host, port), self.timeout), server_hostname=host)
        self.af = self.sock.family
        self.file = self.sock.makefile('r', encoding=self.encoding)
        self.welcome = self.getresp()
        return self.welcome

for name, port, cls in [('ftp', 2121, ftplib.FTP), ('explicit', 2122, ftplib.FTP_TLS), ('implicit', 2990, ImplicitFTP)]:
    client = cls(timeout=10, **({'context':context} if cls is not ftplib.FTP else {}))
    client.connect(host, port)
    client.login('bookhub','bookhub-test-password')
    if cls is not ftplib.FTP:
        client.prot_p()
    client.storbinary('STOR books/smoke.bin', io.BytesIO(payload))
    result = bytearray()
    client.retrbinary('RETR books/smoke.bin', result.extend)
    assert bytes(result) == payload
    client.delete('books/smoke.bin')
    client.quit()
    print(name + ': authenticated upload/read/delete OK', flush=True)
for port, cls in [(2122, ftplib.FTP_TLS), (2990, ImplicitFTP)]:
    client = cls(timeout=10, context=ssl.create_default_context())
    try:
        client.connect(host, port)
        client.login('bookhub','bookhub-test-password')
        raise AssertionError('untrusted certificate accepted')
    except ssl.SSLCertVerificationError:
        print(str(port) + ': untrusted certificate rejected', flush=True)
    finally:
        client.close()

client = boto3.client('s3', endpoint_url='http://storage-s3:3900', region_name='garage',
    aws_access_key_id='GK00000000000000000000000000000001',
    aws_secret_access_key='codex-bookhub-s3-test-secret-000000000000000000000000000000000000',
    config=Config(signature_version='s3v4', s3={'addressing_style':'path'}))
client.put_object(Bucket='bookhub-test', Key='smoke/book.bin', Body=payload)
assert client.get_object(Bucket='bookhub-test', Key='smoke/book.bin')['Body'].read() == payload
assert client.list_objects_v2(Bucket='bookhub-test', Prefix='smoke/')['KeyCount'] == 1
client.delete_object(Bucket='bookhub-test', Key='smoke/book.bin')
assert client.list_objects_v2(Bucket='bookhub-test', Prefix='smoke/')['KeyCount'] == 0
print('Garage S3 SigV4 authenticated put/get/list/delete OK', flush=True)
