FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 1.1.0's PyPI wheel omits fast_sandbox/generated and crashes on import; 1.1.1 isn't on PyPI yet.
RUN pip install --no-cache-dir opensandbox-server==0.2.3
COPY sandbox.toml /root/.sandbox.toml
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
