"""Dev server: python -m app  (still honors PORT, DATA_DIR, and the password env vars)."""
import os

from app import create_app

app = create_app()
app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8090")))
