FROM python:3.12-slim

WORKDIR /app

# Install system dependencies for audio processing + Google Cloud + Azure
RUN apt-get update && apt-get install -y \
    libssl-dev \
    libasound2-dev \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
