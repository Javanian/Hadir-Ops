"""Write the API's OpenAPI document to a file (for the published API reference).

    python scripts/export_openapi.py openapi.json

Production servers do not serve /openapi.json; CI publishes the reference
from this file to GitHub Pages instead.
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("FACE_ENABLED", "false")

from app.main import app  # noqa: E402

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python scripts/export_openapi.py OUTPUT")
    Path(sys.argv[1]).write_text(json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {sys.argv[1]}")
