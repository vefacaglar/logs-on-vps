#!/usr/bin/env python3
"""Manage only the log site's route in the existing persistent Caddyfile."""
import fcntl
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile


DOMAIN = "logs.vefacaglar.com"
UPSTREAM = "logs-on-vps-browser:8080"
BEGIN = "# BEGIN logs-on-vps managed route"
END = "# END logs-on-vps managed route"


def run(arguments):
    result = subprocess.run(arguments, capture_output=True, text=True)
    if result.returncode:
        # Existing Caddy settings and diagnostics can contain other app secrets.
        raise RuntimeError("Caddy setup command failed; configuration output was withheld")
    return result.stdout


def domain_routes(value):
    if isinstance(value, dict):
        if any(DOMAIN in item.get("host", []) for item in value.get("match", [])):
            return [value]
        return [route for child in value.values() for route in domain_routes(child)]
    if isinstance(value, list):
        return [route for child in value for route in domain_routes(child)]
    return []


def upstreams(value):
    if isinstance(value, dict):
        found = [item.get("dial") for item in value.get("upstreams", [])] if value.get("handler") == "reverse_proxy" else []
        return found + [dial for child in value.values() for dial in upstreams(child)]
    if isinstance(value, list):
        return [dial for child in value for dial in upstreams(child)]
    return []


def updated_config(original, adapted):
    block = f"{BEGIN}\n{DOMAIN} {{\n    reverse_proxy {UPSTREAM}\n}}\n{END}\n"
    if BEGIN in original or END in original:
        if original.count(BEGIN) != 1 or original.count(END) != 1:
            raise RuntimeError("Invalid logs managed-route markers")
        pattern = re.compile(r"(?ms)^" + re.escape(BEGIN) + r"\n.*?^" + re.escape(END) + r"(?:\n|$)")
        if len(list(pattern.finditer(original))) != 1:
            raise RuntimeError("Invalid logs managed-route marker order")
        return pattern.sub(lambda _: block, original, count=1)
    routes = domain_routes(adapted)
    if routes and all(set(upstreams(route)) == {UPSTREAM} for route in routes):
        return original  # Preserve a compatible route previously added manually.
    if routes or DOMAIN in original:
        raise RuntimeError("An unmanaged logs domain route exists with a different or ambiguous configuration")
    return original + ("\n" if original.endswith("\n") else "\n\n") + block


def mounted_config(mounts, config):
    target = PurePosixPath(config)
    if not target.is_absolute() or ".." in target.parts:
        raise RuntimeError("Caddy config path must be absolute")
    matches = []
    for mount in mounts:
        if mount.get("Type") not in ("bind", "volume"):
            continue
        try:
            relative = target.relative_to(mount["Destination"])
        except ValueError:
            continue
        matches.append((len(mount["Destination"]), Path(mount["Source"]) / str(relative)))
    if not matches:
        raise RuntimeError("Caddyfile must be on a persistent Docker mount")
    return max(matches, key=lambda item: item[0])[1]


def apply_config(source, command, config, backup_directory, runner=run):
    original = source.read_text()
    adapted = json.loads(runner(command + ["adapt", "--config", config, "--adapter", "caddyfile"]))
    replacement = updated_config(original, adapted)
    if replacement == original:
        runner(command + ["validate", "--config", config, "--adapter", "caddyfile"])
        runner(command + ["reload", "--config", config, "--adapter", "caddyfile", "--force"])
        print("Existing logs route reloaded.")
        return
    backup_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, backup_name = tempfile.mkstemp(prefix="Caddyfile-", dir=backup_directory)
    with open(descriptor, "w") as backup:
        backup.write(original)
    if source.read_text() != original:
        raise RuntimeError("Caddyfile changed concurrently; retry deployment")
    try:
        # Keep the inode intact for single-file bind mounts.
        source.write_text(replacement)
        runner(command + ["validate", "--config", config, "--adapter", "caddyfile"])
        if source.read_text() != replacement:
            raise RuntimeError("Caddyfile changed concurrently")
        runner(command + ["reload", "--config", config, "--adapter", "caddyfile", "--force"])
    except (RuntimeError, OSError):
        if source.read_text() != replacement:
            raise RuntimeError(f"Concurrent Caddyfile change preserved; original backup: {backup_name}") from None
        source.write_text(original)
        try:
            runner(command + ["reload", "--config", config, "--adapter", "caddyfile", "--force"])
        except RuntimeError:
            raise RuntimeError(f"Caddyfile restored but reload failed; backup: {backup_name}") from None
        raise RuntimeError("Caddy validation/reload failed; original configuration restored") from None
    print("Caddy HTTPS route configured for logs.vefacaglar.com.")


def main(settings_path, backup_directory):
    settings = json.loads(Path(settings_path).read_text())
    container = settings.get("container") or "caddy"
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]*", container):
        raise RuntimeError("Invalid Caddy container name")
    details = json.loads(run(["docker", "inspect", container]))[0]
    if not details["State"]["Running"]:
        raise RuntimeError("The existing Caddy container is not running")
    arguments = details["Config"].get("Cmd") or []
    if any(value in ("--resume", "--watch", "-w") or value.startswith("--watch=") for value in arguments):
        raise RuntimeError("Caddy must use a Caddyfile without --resume/--watch")
    config = settings.get("config_path") or "/etc/caddy/Caddyfile"
    if not settings.get("config_path"):
        for index, value in enumerate(arguments):
            if value in ("--config", "-c") and index + 1 < len(arguments):
                config = arguments[index + 1]
            elif value.startswith("--config="):
                config = value.partition("=")[2]
    source = mounted_config(details["Mounts"], config)
    if not source.is_file():
        raise RuntimeError("The persistent Caddyfile was not found")
    browser_ids = run(["docker", "ps", "--filter", "label=com.docker.compose.project=logs-on-vps",
                       "--filter", "label=com.docker.compose.service=browser", "--format", "{{.ID}}"]).split()
    if len(browser_ids) != 1:
        raise RuntimeError("Exactly one authenticated browser container must be running")
    browser = json.loads(run(["docker", "inspect", browser_ids[0]]))[0]
    shared = set(browser["NetworkSettings"]["Networks"]) & set(details["NetworkSettings"]["Networks"])
    if not any("logs-on-vps-browser" in (browser["NetworkSettings"]["Networks"][name].get("Aliases") or []) for name in shared):
        raise RuntimeError("Caddy and browser must share LOGS_PROXY_NETWORK; set it in GitHub Environment variables")
    lock_path = source.parent / ".logs-on-vps-caddy.lock"
    with lock_path.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        apply_config(source, ["docker", "exec", container, "caddy"], config, Path(backup_directory))


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        sys.exit(str(error))
