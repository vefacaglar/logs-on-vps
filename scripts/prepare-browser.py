#!/usr/bin/env python3
"""Create optional browser configuration without persisting the plaintext password."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
CADDY_IMAGE = "caddy:2-alpine@sha256:f6228111e5fafa1a5238258d0858e103f10599b8d1659a146e7726681a002bb9"


def prepare(destination, environment=None, hash_password=None):
    environment = os.environ if environment is None else environment
    username = environment.get("LOGS_UI_USERNAME", "")
    password = environment.get("LOGS_UI_PASSWORD", "")
    if not username and not password:
        return False
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", username):
        raise ValueError("Set LOGS_UI_USERNAME using 1-64 letters, digits, underscores or hyphens")
    if not 12 <= len(password.encode()) <= 72 or password != password.strip() or "\n" in password or "\r" in password:
        raise ValueError("Set LOGS_UI_PASSWORD using 12-72 UTF-8 bytes without newlines or surrounding whitespace")
    if hash_password is None:
        # The secret travels only via stdin, not command arguments or child env.
        child_env = dict(os.environ)
        child_env.pop("LOGS_UI_PASSWORD", None)
        child_env.pop("LOGS_UI_USERNAME", None)
        result = subprocess.run(
            ["docker", "run", "--rm", "-i", CADDY_IMAGE, "caddy", "hash-password"],
            input=(password + "\n").encode(), capture_output=True, env=child_env, check=False,
        )
        if result.returncode:
            raise ValueError("Caddy password hashing failed; check Docker availability")
        password_hash = result.stdout.decode().strip()
    else:
        password_hash = hash_password(password)
    if not re.fullmatch(r"\$2[aby]\$\d{2}\$[./a-zA-Z0-9]{53}", password_hash):
        raise ValueError("Caddy returned an invalid bcrypt hash")
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    credentials = destination / "browser.env"
    credentials.touch(mode=0o600)
    credentials.chmod(0o600)
    credentials.write_text(f"LOGS_UI_USERNAME={username}\nLOGS_UI_PASSWORD_HASH={password_hash}\n")
    override = (ROOT / "deploy/compose.browser.yml").read_text()
    network = environment.get("LOGS_PROXY_NETWORK", "")
    if network:
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]*", network):
            raise ValueError("Invalid LOGS_PROXY_NETWORK")
        override = override.replace("${LOGS_PROXY_NETWORK:-databases_default}", network)
    (destination / "compose.override.yml").write_text(override)
    (destination / "browser-settings.json").write_text(json.dumps({
        "container": environment.get("LOGS_CADDY_CONTAINER", "") or "caddy",
        "config_path": environment.get("LOGS_CADDY_CONFIG_PATH", ""),
    }))
    return True


if __name__ == "__main__":
    try:
        configured = prepare(sys.argv[1])
        print("Browser authentication configured." if configured else "Browser secrets absent; keeping local-only access.")
    except ValueError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
