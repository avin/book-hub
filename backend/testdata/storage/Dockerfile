FROM golang:1.26-alpine
RUN apk add --no-cache bash make git gcc musl-dev postgresql17-client python3 py3-pip py3-openssl openssl curl ca-certificates \
    && python3 -m venv --system-site-packages /opt/fixtures \
    && /opt/fixtures/bin/pip install --no-cache-dir pyftpdlib==2.1.0 boto3==1.40.70
ENV PATH=/usr/local/go/bin:/opt/fixtures/bin:$PATH
WORKDIR /workspace
