FROM python:3.13-slim
WORKDIR /app
COPY . .
RUN pip install sqlalchemy psycopg2-binary
# Step 1: syntax check the generated models
RUN python -m py_compile models.py
# Step 2: run integration test against real DB
CMD ["python", "test.py"]
