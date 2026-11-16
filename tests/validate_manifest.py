"""Validate app.json with Kiro Crew's own manifest parser (read-only, installs nothing).

Run with the Python that ships inside KiroCrew.app, e.g.:
  /Applications/KiroCrew.app/Contents/Resources/backend-dist/kirocrew-backend-arm64/bin/python3.12 tests/validate_manifest.py
"""
import json
import sys
from pathlib import Path

from kiro_crew.apps.manifest import AppManifest

root = Path(__file__).resolve().parent.parent
manifest = AppManifest.from_dict(json.loads((root / "app.json").read_text()))
errors = manifest.validate(root)
print("manifest errors:", errors or "none")
print("permissions:", manifest.permissions)
print("backend:", manifest.backend)
print("commands:", manifest.dependencies.commands)
sys.exit(1 if errors else 0)
