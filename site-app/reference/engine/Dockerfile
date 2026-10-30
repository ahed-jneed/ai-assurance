# Development default only. Production must replace PYTHON_IMAGE with a
# reviewed repository@sha256 digest and enroll the built image's digest.
ARG PYTHON_IMAGE=python:3.12.14-slim
FROM ${PYTHON_IMAGE}
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
WORKDIR /app
COPY --chown=10001:10001 . /app/engine
USER 10001:10001
ENTRYPOINT ["python", "-I", "-c", "import sys; sys.path.insert(0, '/app'); from engine.worker import main; sys.exit(main())"]
CMD ["--readiness"]
