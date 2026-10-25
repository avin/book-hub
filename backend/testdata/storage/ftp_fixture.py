import os
from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler, TLS_FTPHandler
from pyftpdlib.servers import FTPServer
from pyftpdlib.ioloop import IOLoop

class ImplicitTLSHandler(TLS_FTPHandler):
    def handle(self):
        self.secure_connection(self.get_ssl_context())
    def handle_ssl_established(self):
        FTPHandler.handle(self)

loop = IOLoop()
servers = []
for name, port, base in [('ftp', 2121, FTPHandler), ('explicit', 2122, TLS_FTPHandler), ('implicit', 2990, ImplicitTLSHandler)]:
    home = '/tmp/fixture-' + name
    os.makedirs(home + '/books', exist_ok=True)
    auth = DummyAuthorizer()
    auth.add_user('bookhub', 'bookhub-test-password', home, perm='elradfmwMT')
    handler = type(name + 'Handler', (base,), {'authorizer': auth, 'passive_ports': range(30000,30100)})
    if base is not FTPHandler:
        handler.certfile = '/fixtures/server.pem'
        handler.keyfile = '/fixtures/server.key'
        handler.tls_control_required = True
        handler.tls_data_required = True
    servers.append(FTPServer(('0.0.0.0', port), handler, ioloop=loop))
print('FTP 2121; explicit FTPS 2122; implicit FTPS 2990', flush=True)
loop.loop()
