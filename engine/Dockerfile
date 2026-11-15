# Default base: the python:3.12.14-slim multi-arch index, pinned by digest (Docker
# Hub, resolved 2026-11-15) so a re-pushed tag cannot change the build. The tag
# is informational; the digest is what is pulled. Production may substitute a
# separately reviewed repository@sha256 digest of the same CPython minor version
# (3.12, the one supported version; engine/README.md) and must enroll the built
# image's digest.
ARG PYTHON_IMAGE=python:3.12.14-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f
FROM ${PYTHON_IMAGE}
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
WORKDIR /app
# Signature verification (cryptography) and the zstd back-end for Inspect .eval
# logs (zstandard): hash-locked wheels only, no source builds, no cache.
COPY requirements-image.txt /tmp/requirements-image.txt
RUN python -m pip install --no-cache-dir --disable-pip-version-check --no-input \
        --require-hashes --only-binary=:all: -r /tmp/requirements-image.txt \
    && rm /tmp/requirements-image.txt \
    && python -I -c "from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey; import zstandard"
COPY --chown=10001:10001 . /app/engine
USER 10001:10001
ENTRYPOINT ["python", "-I", "-c", "import sys; sys.path.insert(0, '/app'); from engine.worker import main; sys.exit(main())"]
CMD ["--readiness"]
